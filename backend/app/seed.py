"""把标签词表和景点种子写入数据库。"""

from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path

from app.blind import assert_blind_name, redact_full_name
from app.catalog import DATA_DIR, load_catalog
from app.data.tag_library import SPOT_EN
from app.constants import STRENGTH_WEIGHT
from app.repo import ensure_llm_provider
from app.db import DEFAULT_DB_PATH, connect, init_schema

SPOTS_PATH = DATA_DIR / "spots.json"
CUSTOM_DIMENSION = ("custom", "景点特色")
TEXT_FIELDS = ("description", "summary_100w", "events_and_discounts", "ai_strategy", "tag_interpretation")


def _insert_tag(
    conn: sqlite3.Connection,
    name: str,
    source: str,
    dimensions: list[tuple[str, str]],
    name_en: str = "",
    region: str = "na",
) -> int:
    conn.execute(
        "INSERT INTO tags (name, name_en, source, region) VALUES (?, ?, ?, ?)",
        (name, name_en, source, region),
    )
    tag_id = conn.execute("SELECT id FROM tags WHERE name = ?", (name,)).fetchone()["id"]
    conn.executemany(
        "INSERT INTO tag_dimensions (tag_id, dimension_key, dimension_label) VALUES (?, ?, ?)",
        [(tag_id, key, label) for key, label in dimensions],
    )
    return tag_id


def seed(conn: sqlite3.Connection, *, reset: bool = False) -> dict:
    if reset:
        conn.executescript(
            """
            DELETE FROM trip_plans;
            DELETE FROM spot_tags;
            DELETE FROM spots;
            DELETE FROM tag_dimensions;
            DELETE FROM tags;
            """
        )
    catalog = load_catalog()
    existing = conn.execute("SELECT COUNT(*) AS n FROM tags").fetchone()["n"]
    if existing:
        _sync_catalog(conn, catalog)
    else:
        for tag in catalog.tags:
            dimensions = [(item["key"], item["label"]) for item in tag["dimensions"]]
            _insert_tag(conn, tag["name"], "catalog", dimensions, tag.get("name_en") or "", "na")
    _archive_china_catalog(conn, catalog)
    _sync_spots(conn)
    ensure_llm_provider(conn)
    conn.commit()
    active = conn.execute("SELECT COUNT(*) AS n FROM tags WHERE region = 'na'").fetchone()["n"]
    china = conn.execute("SELECT COUNT(*) AS n FROM tags WHERE region = 'cn'").fetchone()["n"]
    spot_count = conn.execute("SELECT COUNT(*) AS n FROM spots").fetchone()["n"]
    return {
        "seeded": not bool(existing),
        "tag_count": active,
        "china_tag_count": china,
        "spot_count": spot_count,
        "catalog_unique": len(catalog.tags),
        "catalog_parsed": catalog.parsed_total,
        "catalog_declared": catalog.declared_total,
        "cross_dimension_names": catalog.cross_dimension_names,
    }


def _sync_catalog(conn: sqlite3.Connection, catalog) -> None:
    """把北美词表写进已有库。中国区归档标签不在这里删除。"""
    wanted = {tag["name"] for tag in catalog.tags}
    for tag in catalog.tags:
        dimensions = [(item["key"], item["label"]) for item in tag["dimensions"]]
        row = conn.execute("SELECT id FROM tags WHERE name = ?", (tag["name"],)).fetchone()
        if row is None:
            _insert_tag(conn, tag["name"], "catalog", dimensions, tag.get("name_en") or "", "na")
            continue
        conn.execute(
            "UPDATE tags SET name_en = ?, source = 'catalog', region = 'na' WHERE id = ?",
            (tag.get("name_en") or "", row["id"]),
        )
        conn.execute("DELETE FROM tag_dimensions WHERE tag_id = ?", (row["id"],))
        conn.executemany(
            "INSERT INTO tag_dimensions (tag_id, dimension_key, dimension_label) VALUES (?, ?, ?)",
            [(row["id"], key, label) for key, label in dimensions],
        )
    stale = conn.execute(
        "SELECT id, name FROM tags WHERE source = 'catalog' AND region = 'na'"
    ).fetchall()
    for row in stale:
        if row["name"] in wanted:
            continue
        used = conn.execute("SELECT 1 FROM spot_tags WHERE tag_id = ? LIMIT 1", (row["id"],)).fetchone()
        if used:
            conn.execute("UPDATE tags SET source = 'spot' WHERE id = ?", (row["id"],))
            continue
        conn.execute("DELETE FROM tag_dimensions WHERE tag_id = ?", (row["id"],))
        conn.execute("DELETE FROM tags WHERE id = ?", (row["id"],))
    for name, english in SPOT_EN.items():
        conn.execute(
            "UPDATE tags SET name_en = ? WHERE name = ? AND name_en = ''",
            (english, name),
        )


def _archive_china_catalog(conn: sqlite3.Connection, na_catalog) -> None:
    """旧中国词表留在库里，region=cn，本版本的列表和匹配都不读它。"""
    na_names = {tag["name"] for tag in na_catalog.tags}
    china = load_catalog(DATA_DIR / "catalog.txt")
    for tag in china.tags:
        if tag["name"] in na_names:
            continue
        dimensions = [(item["key"], item["label"]) for item in tag["dimensions"]]
        row = conn.execute("SELECT id FROM tags WHERE name = ?", (tag["name"],)).fetchone()
        if row is None:
            _insert_tag(conn, tag["name"], "catalog", dimensions, "", "cn")
            continue
        conn.execute(
            "UPDATE tags SET region = 'cn', source = 'catalog' WHERE id = ?",
            (row["id"],),
        )
        conn.execute("DELETE FROM tag_dimensions WHERE tag_id = ?", (row["id"],))
        conn.executemany(
            "INSERT INTO tag_dimensions (tag_id, dimension_key, dimension_label) VALUES (?, ?, ?)",
            [(row["id"], key, label) for key, label in dimensions],
        )
    rows = conn.execute("SELECT id, name FROM tags WHERE region != 'cn'").fetchall()
    for row in rows:
        if row["name"] not in na_names:
            conn.execute("UPDATE tags SET region = 'cn' WHERE id = ?", (row["id"],))


def _sync_spots(conn: sqlite3.Connection) -> None:
    spots = json.loads(SPOTS_PATH.read_text(encoding="utf-8"))
    wanted = {spot["spot_id"] for spot in spots}
    for spot in spots:
        _upsert_spot(conn, spot, catalog=True)
    obsolete = [
        row["spot_id"]
        for row in conn.execute("SELECT spot_id FROM spots WHERE catalog_spot = 1").fetchall()
        if row["spot_id"] not in wanted
    ]
    _drop_spot_dependents(conn, obsolete)
    if obsolete:
        marks = ",".join("?" for _ in obsolete)
        conn.execute(f"DELETE FROM spots WHERE spot_id IN ({marks})", obsolete)


def _upsert_spot(conn: sqlite3.Connection, spot: dict, *, catalog: bool = True) -> None:
    full_name = spot["full_name"].strip()
    blind_name = spot["blind_name"].strip()
    assert_blind_name(full_name, blind_name)
    fields = dict(spot)
    for field in TEXT_FIELDS:
        fields[field] = redact_full_name(fields.get(field), full_name)
    previous = conn.execute("SELECT full_name FROM spots WHERE spot_id = ?", (spot["spot_id"],)).fetchone()
    if previous is not None and previous["full_name"] != full_name:
        _drop_spot_dependents(conn, [spot["spot_id"]])
    payload = (
        full_name,
        blind_name,
        spot["province"],
        spot["city"],
        spot["location"]["lat"],
        spot["location"]["lng"],
        fields["description"],
        fields["summary_100w"],
        spot.get("image_url"),
        spot["adult_ticket_price"],
        json.dumps(spot["mock_weather"], ensure_ascii=False),
        fields.get("events_and_discounts"),
        fields.get("ai_strategy"),
        fields.get("tag_interpretation"),
        1 if catalog else 0,
        spot["spot_id"],
    )
    if previous is None:
        conn.execute(
            """
            INSERT INTO spots (
                spot_id, full_name, blind_name, province, city, lat, lng,
                description, summary_100w, image_url, adult_ticket_price,
                mock_weather_json, events_and_discounts, ai_strategy, tag_interpretation,
                catalog_spot
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (spot["spot_id"], *payload[:-1]),
        )
    else:
        conn.execute(
            """
            UPDATE spots SET
                full_name = ?, blind_name = ?, province = ?, city = ?, lat = ?, lng = ?,
                description = ?, summary_100w = ?, image_url = ?, adult_ticket_price = ?,
                mock_weather_json = ?, events_and_discounts = ?, ai_strategy = ?, tag_interpretation = ?,
                catalog_spot = ?
            WHERE spot_id = ?
            """,
            payload,
        )
    conn.execute("DELETE FROM spot_tags WHERE spot_id = ?", (spot["spot_id"],))
    for position, link in enumerate(spot["tags"]):
        strength = link["type"]
        if strength not in STRENGTH_WEIGHT:
            raise ValueError(f"{spot['spot_id']} 的标签强度无效：{strength}")
        name = link["name"].strip()
        row = conn.execute("SELECT id FROM tags WHERE name = ? AND region = 'na'", (name,)).fetchone()
        if row is None:
            raise ValueError(f"{spot['spot_id']} 使用了本版本不调用的标签：{name}")
        conn.execute(
            """
            INSERT INTO spot_tags (spot_id, tag_id, strength, weight, position)
            VALUES (?, ?, ?, ?, ?)
            """,
            (spot["spot_id"], row["id"], strength, STRENGTH_WEIGHT[strength], position),
        )


def _drop_spot_dependents(conn: sqlite3.Connection, spot_ids: list[str]) -> None:
    if not spot_ids:
        return
    marks = ",".join("?" for _ in spot_ids)
    conn.execute(
        f"DELETE FROM plan_shares WHERE plan_id IN (SELECT id FROM trip_plans WHERE spot_id IN ({marks}))",
        spot_ids,
    )
    for table in ("trip_plans", "reviews", "user_wishlists", "time_capsules", "spot_tags"):
        conn.execute(f"DELETE FROM {table} WHERE spot_id IN ({marks})", spot_ids)


def main() -> None:
    reset = "--reset" in sys.argv
    path = DEFAULT_DB_PATH
    for arg in sys.argv[1:]:
        if arg != "--reset":
            path = Path(arg)
    conn = connect(path)
    init_schema(conn)
    result = seed(conn, reset=reset)
    print(json.dumps({"database": str(path), **result}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
