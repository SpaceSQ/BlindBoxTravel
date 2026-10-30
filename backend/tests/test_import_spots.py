"""入库脚本的遮罩、打标和断点。不读取全量 JSON，也不调用大模型。"""

import asyncio
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from import_us_spots import (  # noqa: E402
    assign_strengths,
    generate_blind_name,
    import_pois,
    parse_llm_object,
)

from app.blind import assert_blind_name, mask_name  # noqa: E402
from app.db import connect, init_schema  # noqa: E402
from app.seed import seed  # noqa: E402


def test_statue_of_liberty_mask_is_stable():
    masked = generate_blind_name("Statue of Liberty")
    assert masked == "S**t** of L*b****"
    assert generate_blind_name("Statue of Liberty") == masked
    assert mask_name("Statue of Liberty") == masked
    assert_blind_name("Statue of Liberty", masked)
    hyphenated = "Grant-Kohrs Ranch National Historic Site"
    assert_blind_name(hyphenated, generate_blind_name(hyphenated))


def test_llm_object_keeps_first_two_strong():
    payload = parse_llm_object(
        '```json\n{"description_en": "A quiet blue caldera.", "tags": ["国家公园", "Crater lake", "出片", "不存在"]}\n```'
    )
    allowed = {"国家公园", "湖泊", "出片", "火山口湖"}
    chosen = assign_strengths(payload["tags"], allowed, {"crater lake": "火山口湖"})
    assert [item["name"] for item in chosen] == ["国家公园", "火山口湖", "出片"]
    assert [item["type"] for item in chosen] == ["strong", "strong", "weak"]


def test_checkpoint_skips_finished_names_and_keeps_imported_rows(tmp_path, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "")
    monkeypatch.setenv("LLM_API_KEY", "")
    conn = connect(tmp_path / "spots.sqlite")
    init_schema(conn)
    seed(conn)
    names = [row["name"] for row in conn.execute("SELECT name FROM tags WHERE region = 'na'")]
    rows = [
        {
            "name_en": "Crater Lake",
            "name_zh": "火山口湖",
            "lat": 42.94,
            "lon": -122.1,
            "country": "US",
            "state_province": "OR",
            "city": "Klamath",
            "fee_amount_usd": 35,
            "photo_url": "https://example.com/crater.jpg",
            "description_zh": "很深的蓝色湖水",
            "camping_info": "湖边可以过夜",
            "trails_info": "环湖步道",
        },
        {"name_en": "Broken Spot", "lat": "nope", "lon": 1, "description_zh": "x"},
    ]

    async def complete(poi: dict) -> dict:
        if poi["name_en"] != "Crater Lake":
            return {"description_en": "A spare description for a broken row.", "tags": ["国家公园", "湖泊", "出片"]}
        return {
            "description_en": "Crater Lake sits in a quiet caldera. " + ("soft light " * 30),
            "tags": ["国家公园", "湖泊", "火山口湖"],
        }

    checkpoint = tmp_path / "na_attractions.checkpoint.json"
    first = asyncio.run(
        import_pois(rows, conn, names, {}, checkpoint=checkpoint, complete=complete, concurrency=2)
    )
    assert first["imported"] == 1
    assert len(first["failed"]) == 1
    stored = conn.execute(
        """
        SELECT blind_name, adult_ticket_price, image_url, catalog_spot, description, province, city
        FROM spots WHERE full_name = 'Crater Lake'
        """
    ).fetchone()
    assert stored["blind_name"] == generate_blind_name("Crater Lake")
    assert stored["adult_ticket_price"] == 35
    assert stored["image_url"] == "https://example.com/crater.jpg"
    assert stored["catalog_spot"] == 0
    assert stored["province"] == "OR"
    assert stored["city"] == "Klamath"
    assert "Crater Lake" not in stored["description"]
    assert len(stored["description"].split()) <= 100
    links = conn.execute(
        """
        SELECT t.name, st.strength, st.weight
        FROM spot_tags st JOIN tags t ON t.id = st.tag_id
        WHERE st.spot_id = (SELECT spot_id FROM spots WHERE full_name = 'Crater Lake')
        ORDER BY st.position
        """
    ).fetchall()
    assert [(item["name"], item["strength"], item["weight"]) for item in links] == [
        ("国家公园", "strong", 3.0),
        ("湖泊", "strong", 3.0),
        ("火山口湖", "weak", 1.0),
    ]
    assert "Crater Lake" in checkpoint.read_text(encoding="utf-8")

    async def refuse(poi: dict) -> dict:
        if poi["name_en"] == "Crater Lake":
            raise AssertionError("已完成的景点不应再次调用大模型")
        return {"description_en": "A spare description for a broken row.", "tags": ["国家公园", "湖泊", "出片"]}

    second = asyncio.run(
        import_pois(rows, conn, names, {}, checkpoint=checkpoint, complete=refuse, concurrency=2)
    )
    assert second["imported"] == 0
    assert second["skipped"] == 1
    seed(conn)
    assert conn.execute("SELECT 1 FROM spots WHERE full_name = 'Crater Lake'").fetchone() is not None
