"""读取标签、景点和已解锁的行程。"""

from __future__ import annotations

import json
import random
import secrets
import sqlite3
from collections import defaultdict
from datetime import datetime, timedelta

from app.constants import LLM_PROVIDER_COMPANY


def list_tag_names(conn: sqlite3.Connection) -> list[str]:
    rows = conn.execute("SELECT name FROM tags WHERE region = 'na' ORDER BY id").fetchall()
    return [row["name"] for row in rows]


def list_tag_aliases(conn: sqlite3.Connection) -> dict[str, str]:
    """英文说法映射回中文主键，供英文句子命中标签。"""
    rows = conn.execute(
        "SELECT name, name_en FROM tags WHERE region = 'na' AND name_en != ''"
    ).fetchall()
    return {row["name_en"]: row["name"] for row in rows}


def list_tags(conn: sqlite3.Connection, dimension: str | None = None) -> list[dict]:
    sql = """
        SELECT t.id, t.name, t.name_en, t.source, d.dimension_key, d.dimension_label
        FROM tags t
        JOIN tag_dimensions d ON d.tag_id = t.id
        WHERE t.region = 'na'
    """
    params: tuple = ()
    if dimension:
        sql += " AND t.id IN (SELECT tag_id FROM tag_dimensions WHERE dimension_key = ?)"
        params = (dimension,)
    sql += " ORDER BY t.id, d.dimension_key"
    rows = conn.execute(sql, params).fetchall()
    grouped: dict[int, dict] = {}
    for row in rows:
        item = grouped.get(row["id"])
        if item is None:
            item = {
                "id": row["id"],
                "name": row["name"],
                "name_en": row["name_en"],
                "source": row["source"],
                "dimensions": [],
            }
            grouped[row["id"]] = item
        item["dimensions"].append({"key": row["dimension_key"], "label": row["dimension_label"]})
    return list(grouped.values())


def tag_stats(conn: sqlite3.Connection) -> dict:
    total = conn.execute("SELECT COUNT(*) AS n FROM tags WHERE region = 'na'").fetchone()["n"]
    catalog = conn.execute(
        "SELECT COUNT(*) AS n FROM tags WHERE region = 'na' AND source = 'catalog'"
    ).fetchone()["n"]
    custom = conn.execute(
        "SELECT COUNT(*) AS n FROM tags WHERE region = 'na' AND source = 'spot'"
    ).fetchone()["n"]
    china = conn.execute("SELECT COUNT(*) AS n FROM tags WHERE region = 'cn'").fetchone()["n"]
    dim_rows = conn.execute(
        """
        SELECT d.dimension_key, d.dimension_label, COUNT(*) AS n
        FROM tag_dimensions d
        JOIN tags t ON t.id = d.tag_id
        WHERE t.region = 'na'
        GROUP BY d.dimension_key, d.dimension_label
        ORDER BY d.dimension_key
        """
    ).fetchall()
    return {
        "tag_count": total,
        "catalog_tag_count": catalog,
        "custom_tag_count": custom,
        "china_tag_count": china,
        "dimensions": [
            {"key": row["dimension_key"], "label": row["dimension_label"], "tag_count": row["n"]}
            for row in dim_rows
        ],
    }


def list_spots(conn: sqlite3.Connection) -> list[dict]:
    spot_rows = conn.execute("SELECT * FROM spots ORDER BY spot_id").fetchall()
    link_rows = conn.execute(
        """
        SELECT st.spot_id, t.name, t.name_en, st.strength, st.weight, st.position
        FROM spot_tags st
        JOIN tags t ON t.id = st.tag_id
        ORDER BY st.spot_id, st.position
        """
    ).fetchall()
    tags: dict[str, list[dict]] = defaultdict(list)
    for row in link_rows:
        tags[row["spot_id"]].append(
            {
                "name": row["name"],
                "name_en": row["name_en"],
                "strength": row["strength"],
                "weight": row["weight"],
            }
        )
    spots: list[dict] = []
    for row in spot_rows:
        spots.append(
            {
                "spot_id": row["spot_id"],
                "full_name": row["full_name"],
                "blind_name": row["blind_name"],
                "province": row["province"],
                "city": row["city"],
                "lat": row["lat"],
                "lng": row["lng"],
                "description": row["description"],
                "summary_100w": row["summary_100w"],
                "image_url": row["image_url"],
                "adult_ticket_price": row["adult_ticket_price"],
                "mock_weather": json.loads(row["mock_weather_json"]),
                "events_and_discounts": row["events_and_discounts"],
                "ai_strategy": row["ai_strategy"],
                "tag_interpretation": row["tag_interpretation"],
                "tags": tags.get(row["spot_id"], []),
            }
        )
    return spots


def get_spot(conn: sqlite3.Connection, spot_id: str) -> dict | None:
    for spot in list_spots(conn):
        if spot["spot_id"] == spot_id:
            return spot
    return None


def save_trip_plan(
    conn: sqlite3.Connection,
    token: str,
    spot_id: str,
    user_id: int,
    plan: dict,
    *,
    count_unlock: bool,
) -> int:
    cursor = conn.execute(
        "INSERT INTO trip_plans (unlock_token, spot_id, client_id, user_id, plan_json) VALUES (?, ?, '', ?, ?)",
        (token, spot_id, user_id, json.dumps(plan, ensure_ascii=False)),
    )
    if count_unlock:
        conn.execute("UPDATE users SET unlock_count = unlock_count + 1 WHERE id = ?", (user_id,))
    conn.commit()
    return int(cursor.lastrowid)


def _plan_view(row: sqlite3.Row) -> dict:
    plan = json.loads(row["plan_json"])
    itinerary = plan.get("itinerary")
    if not isinstance(itinerary, str):
        itinerary = plan.get("note") if isinstance(plan.get("note"), str) else ""
    from app.present import single_image

    return {
        "id": row["id"],
        "spot_id": row["spot_id"],
        "unlock_token": row["unlock_token"],
        "full_name": row["full_name"],
        "province": row["province"],
        "city": row["city"],
        "image_url": single_image(row["image_url"]),
        "depart_date": plan.get("depart_date"),
        "companions": plan.get("companions"),
        "transport": plan.get("transport"),
        "days": plan.get("days") or 1,
        "itinerary": itinerary,
        "created_at": row["created_at"],
    }


_PLAN_SQL = """
    SELECT p.id, p.unlock_token, p.spot_id, p.user_id, p.plan_json, p.created_at,
           s.full_name, s.province, s.city, s.image_url
    FROM trip_plans p
    JOIN spots s ON s.spot_id = p.spot_id
"""


def list_plans(conn: sqlite3.Connection, user_id: int) -> list[dict]:
    rows = conn.execute(
        _PLAN_SQL + " WHERE p.user_id = ? ORDER BY p.id DESC",
        (user_id,),
    ).fetchall()
    return [_plan_view(row) for row in rows]


def get_plan(conn: sqlite3.Connection, plan_id: int, user_id: int) -> dict | None:
    row = conn.execute(_PLAN_SQL + " WHERE p.id = ? AND p.user_id = ?", (plan_id, user_id)).fetchone()
    if row is None:
        return None
    return _plan_view(row)


def update_plan(
    conn: sqlite3.Connection,
    plan_id: int,
    user_id: int,
    *,
    depart_date: str,
    days: int,
    companions: int,
    transport: str,
    itinerary: str,
) -> dict | None:
    row = conn.execute(
        "SELECT id, plan_json FROM trip_plans WHERE id = ? AND user_id = ?",
        (plan_id, user_id),
    ).fetchone()
    if row is None:
        return None
    plan = json.loads(row["plan_json"])
    plan["depart_date"] = depart_date
    plan["days"] = days
    plan["companions"] = companions
    plan["transport"] = transport
    plan["itinerary"] = itinerary
    conn.execute(
        "UPDATE trip_plans SET plan_json = ? WHERE id = ? AND user_id = ?",
        (json.dumps(plan, ensure_ascii=False), plan_id, user_id),
    )
    conn.commit()
    return get_plan(conn, plan_id, user_id)


def delete_plan(conn: sqlite3.Connection, plan_id: int, user_id: int) -> bool:
    cursor = conn.execute("DELETE FROM trip_plans WHERE id = ? AND user_id = ?", (plan_id, user_id))
    conn.commit()
    return cursor.rowcount > 0


def user_unlocked_spot(conn: sqlite3.Connection, spot_id: str, user_id: int) -> bool:
    row = conn.execute(
        "SELECT 1 FROM trip_plans WHERE spot_id = ? AND user_id = ? LIMIT 1",
        (spot_id, user_id),
    ).fetchone()
    return row is not None


def ensure_share(conn: sqlite3.Connection, plan_id: int, user_id: int) -> str | None:
    owned = conn.execute(
        "SELECT id FROM trip_plans WHERE id = ? AND user_id = ?",
        (plan_id, user_id),
    ).fetchone()
    if owned is None:
        return None
    existing = conn.execute("SELECT token FROM plan_shares WHERE plan_id = ?", (plan_id,)).fetchone()
    if existing is not None:
        return existing["token"]
    token = secrets.token_hex(4)
    conn.execute("INSERT INTO plan_shares (token, plan_id) VALUES (?, ?)", (token, plan_id))
    conn.commit()
    return token


def import_share(conn: sqlite3.Connection, token: str, user_id: int) -> dict | None:
    row = conn.execute(
        """
        SELECT p.spot_id, p.plan_json
        FROM plan_shares s
        JOIN trip_plans p ON p.id = s.plan_id
        WHERE s.token = ?
        """,
        (token,),
    ).fetchone()
    if row is None:
        return None
    plan = json.loads(row["plan_json"])
    unlock_token = secrets.token_urlsafe(24)
    plan_id = save_trip_plan(conn, unlock_token, row["spot_id"], user_id, plan, count_unlock=False)
    return get_plan(conn, plan_id, user_id)


def spot_heat(conn: sqlite3.Connection, spot_id: str) -> list[dict]:
    rows = conn.execute("SELECT plan_json FROM trip_plans WHERE spot_id = ?", (spot_id,)).fetchall()
    counts: dict[str, int] = {}
    for row in rows:
        plan = json.loads(row["plan_json"])
        try:
            start = datetime.strptime(str(plan.get("depart_date")), "%Y-%m-%d").date()
        except ValueError:
            continue
        days = plan.get("days") if isinstance(plan.get("days"), int) else 1
        people = plan.get("companions") if isinstance(plan.get("companions"), int) else 1
        for offset in range(max(1, min(days, 60))):
            key = (start + timedelta(days=offset)).isoformat()
            counts[key] = counts.get(key, 0) + max(1, min(people, 30))
    return [{"date": day, "people": counts[day]} for day in sorted(counts)]


def add_review(conn: sqlite3.Connection, spot_id: str, user_id: int, rating: int, content: str) -> dict:
    cursor = conn.execute(
        "INSERT INTO reviews (spot_id, client_id, user_id, rating, content) VALUES (?, '', ?, ?, ?)",
        (spot_id, user_id, rating, content),
    )
    conn.commit()
    row = conn.execute(
        "SELECT id, spot_id, rating, content, created_at FROM reviews WHERE id = ?",
        (cursor.lastrowid,),
    ).fetchone()
    return dict(row)


def list_reviews(conn: sqlite3.Connection, spot_id: str) -> list[dict]:
    rows = conn.execute(
        "SELECT id, spot_id, rating, content, created_at FROM reviews WHERE spot_id = ? ORDER BY id DESC",
        (spot_id,),
    ).fetchall()
    return [dict(row) for row in rows]


def _blocked_spot_ids(conn: sqlite3.Connection, user_id: int | None, exclude_ids: list[str]) -> set[str]:
    blocked = set(exclude_ids)
    if user_id is None:
        return blocked
    unlocked = conn.execute("SELECT DISTINCT spot_id FROM trip_plans WHERE user_id = ?", (user_id,)).fetchall()
    wished = conn.execute("SELECT spot_id FROM user_wishlists WHERE user_id = ?", (user_id,)).fetchall()
    blocked.update(row["spot_id"] for row in unlocked)
    blocked.update(row["spot_id"] for row in wished)
    return blocked


def _intent_score(spot: dict, wanted: set[str]) -> int:
    if not wanted:
        return 0
    score = 0
    for tag in spot["tags"]:
        if tag["name"] in wanted:
            score += 3 if tag["strength"] == "strong" else 1
    return score


def radar_spots(
    conn: sqlite3.Connection,
    user_id: int | None,
    limit: int,
    preferred_tags: list[str],
    exclude_ids: list[str],
) -> list[dict]:
    from app.present import radar_card, usable_image_url

    blocked = _blocked_spot_ids(conn, user_id, exclude_ids)
    candidates = []
    seen: set[str] = set()
    for spot in list_spots(conn):
        spot_id = spot["spot_id"]
        if spot_id in blocked or spot_id in seen or usable_image_url(spot.get("image_url")) is None:
            continue
        seen.add(spot_id)
        candidates.append(spot)
    wanted = set(preferred_tags)
    rng = random.Random()
    if wanted and any(_intent_score(spot, wanted) > 0 for spot in candidates):
        candidates.sort(key=lambda spot: (-_intent_score(spot, wanted), rng.random()))
    else:
        rng.shuffle(candidates)
    return [radar_card(spot, _intent_score(spot, wanted)) for spot in candidates[:limit]]


def add_wishlist(conn: sqlite3.Connection, user_id: int, spot_id: str) -> bool:
    try:
        conn.execute("INSERT INTO user_wishlists (user_id, spot_id) VALUES (?, ?)", (user_id, spot_id))
    except sqlite3.IntegrityError:
        return False
    conn.commit()
    return True


def list_wishlists(conn: sqlite3.Connection, user_id: int) -> list[dict]:
    from app.present import radar_card

    rows = conn.execute(
        """
        SELECT spot_id FROM user_wishlists
        WHERE user_id = ?
          AND spot_id NOT IN (SELECT spot_id FROM trip_plans WHERE user_id = ?)
        ORDER BY id DESC
        """,
        (user_id, user_id),
    ).fetchall()
    cards: list[dict] = []
    for row in rows:
        spot = get_spot(conn, row["spot_id"])
        if spot is not None:
            cards.append(radar_card(spot, 0))
    return cards


def save_capsule(
    conn: sqlite3.Connection,
    capsule_id: str,
    user_id: int,
    spot_id: str,
    image_url: str,
    content: str,
) -> dict:
    conn.execute(
        """
        INSERT INTO time_capsules (capsule_id, user_id, spot_id, image_url, content)
        VALUES (?, ?, ?, ?, ?)
        """,
        (capsule_id, user_id, spot_id, image_url, content),
    )
    conn.commit()
    row = conn.execute(
        """
        SELECT c.capsule_id, c.image_url, c.content, c.created_at, u.nickname
        FROM time_capsules c
        JOIN users u ON u.id = c.user_id
        WHERE c.capsule_id = ?
        """,
        (capsule_id,),
    ).fetchone()
    return _capsule_view(row)


def list_capsules(conn: sqlite3.Connection, spot_id: str) -> list[dict]:
    rows = conn.execute(
        """
        SELECT c.capsule_id, c.image_url, c.content, c.created_at, u.nickname
        FROM time_capsules c
        JOIN users u ON u.id = c.user_id
        WHERE c.spot_id = ?
        ORDER BY c.created_at DESC, c.capsule_id DESC
        """,
        (spot_id,),
    ).fetchall()
    return [_capsule_view(row) for row in rows]


def _capsule_view(row: sqlite3.Row) -> dict:
    nickname = (row["nickname"] or "").strip() or "Traveler"
    return {
        "capsule_id": row["capsule_id"],
        "image_url": row["image_url"],
        "content": row["content"],
        "created_at": row["created_at"],
        "author": nickname,
    }


def ensure_llm_provider(conn: sqlite3.Connection) -> None:
    """写入 ROBOTZERO 提供方。表里不放密钥。"""
    conn.execute(
        """
        INSERT INTO llm_providers (id, company, service, user_supplies_key, credential_source)
        VALUES (1, ?, 'llm', 0, 'server')
        ON CONFLICT(id) DO UPDATE SET
            company = excluded.company,
            service = 'llm',
            user_supplies_key = 0,
            credential_source = 'server'
        """,
        (LLM_PROVIDER_COMPANY,),
    )


def get_llm_provider(conn: sqlite3.Connection) -> dict | None:
    row = conn.execute(
        """
        SELECT company, service, user_supplies_key, credential_source
        FROM llm_providers
        WHERE id = 1
        """
    ).fetchone()
    if row is None:
        return None
    return {
        "company": row["company"],
        "service": row["service"],
        "user_supplies_key": bool(row["user_supplies_key"]),
        "credential_source": row["credential_source"],
    }


def public_llm_provider(conn: sqlite3.Connection) -> dict:
    """给客户端的提供方说明。只含公司名，不含密钥、接口地址或模型名。"""
    provider = get_llm_provider(conn)
    return {
        "company": provider["company"] if provider else None,
        "service": "llm",
        "user_supplies_key": False,
    }


def find_unlock(conn: sqlite3.Connection, token: str) -> sqlite3.Row | None:
    return conn.execute(
        "SELECT unlock_token, spot_id, plan_json, created_at FROM trip_plans WHERE unlock_token = ?",
        (token,),
    ).fetchone()
