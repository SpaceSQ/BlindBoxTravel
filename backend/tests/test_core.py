"""核心推荐链路：入库、意图、距离、脱敏、解锁。"""

import random

import pytest

from app.blind import mask_name, visible_chars
from app.catalog import CATALOG_PATH, load_catalog
from app.geo import haversine_km, km_to_miles
from app.intent import extract_distance_mi, extract_tags
from tests.conftest import register

BEIJING = {"lat": 39.9042, "lng": 116.4074}
NEW_YORK = {"lat": 40.7128, "lng": -74.006}
LAKE = (44.549906, -110.260925)
FULL_NAMES = ("Turbid Lake Trail",)
EXAMPLE = "a national park lake within 2000 miles"


def _assert_blind(body: str) -> None:
    for name in FULL_NAMES:
        assert name not in body
    assert "full_name" not in body
    assert "adult_ticket_price" not in body


def test_catalog_counts_follow_the_pasted_lists():
    catalog = load_catalog()
    parsed = {item.key: item.parsed for item in catalog.dimensions}
    declared = {item.key: item.declared for item in catalog.dimensions}
    assert declared == {
        "emotion": 94,
        "weather": 72,
        "terrain": 80,
        "food": 82,
        "culture": 72,
        "experience": 106,
        "audience": 76,
    }
    assert parsed == declared
    assert catalog.declared_total == 582
    assert catalog.parsed_total == 582
    assert len(catalog.tags) == 580
    assert catalog.cross_dimension_names == ["探险", "穷游"]
    by_name = {tag["name"]: tag for tag in catalog.tags}
    assert by_name["数字戒断"]["name_en"] == "Digital detox"
    assert by_name["走66号公路"]["name_en"] == "Route 66"
    assert by_name["精酿啤酒"]["name_en"] == "Craft beer"


def test_seed_tables_tags_and_spots(client):
    meta = client.get("/api/meta").json()
    na = {tag["name"] for tag in load_catalog().tags}
    china = {tag["name"] for tag in load_catalog(CATALOG_PATH).tags}
    assert meta["catalog_tag_count"] == 580
    assert meta["custom_tag_count"] == 0
    assert meta["tag_count"] == 580
    assert meta["china_tag_count"] == len(china - na)
    assert meta["spot_count"] == 1
    assert meta["distance_options_mi"] == [100, 250, 500, 1000, 3000]
    assert meta["catalog_audit"]["unique_names"] == 580

    tags = client.get("/api/tags").json()["tags"]
    by_name = {item["name"]: item for item in tags}
    assert {dim["key"] for dim in by_name["探险"]["dimensions"]} == {"emotion", "experience"}
    assert "异星感" not in by_name
    assert "嗦粉" not in by_name
    assert by_name["雪山"]["source"] == "catalog"
    assert by_name["雪山"]["name_en"] == "Snow peaks"
    assert by_name["清真"]["name_en"] == "Halal"
    assert by_name["国家公园"]["name_en"] == "National park"


def test_haversine_orders_known_cities():
    beijing = (39.9042, 116.4074)
    tianjin = (39.0842, 117.2010)
    shanghai = (31.2304, 121.4737)
    assert haversine_km(*beijing, *beijing) == 0
    assert haversine_km(*beijing, *shanghai) == pytest.approx(haversine_km(*shanghai, *beijing))
    assert haversine_km(*beijing, *tianjin) < haversine_km(*beijing, *shanghai)
    assert 1050 < haversine_km(*beijing, *shanghai) < 1100


def test_mask_keeps_two_characters():
    masked = mask_name("长沙橘子洲头", random.Random(7))
    shown = visible_chars(masked)
    assert len(shown) == 2
    assert all(ch in "长沙橘子洲头" for ch in shown)
    assert "*" in masked


def test_english_mask_keeps_initials_and_a_few_consonants():
    masked = mask_name("Turbid Lake Trail")
    assert masked == "T**b** L*k* Tr**l"
    assert mask_name("Turbid Lake Trail") == masked
    words = list(zip("Turbid Lake Trail".split(), masked.split()))
    for source, shown in words:
        assert shown[0] == source[0]
        assert len(shown) == len(source)
        assert shown.count("*") >= 1
    assert mask_name("Lake") == "L*k*"


def test_keyword_parser_reads_example_sentence(client):
    names = [item["name"] for item in client.get("/api/tags").json()["tags"]]
    aliases = {item["name_en"]: item["name"] for item in client.get("/api/tags").json()["tags"] if item["name_en"]}
    assert extract_tags(EXAMPLE, names, aliases) == ["国家公园", "湖泊"]
    assert extract_distance_mi(EXAMPLE) == 3000
    assert extract_distance_mi("想去看雪山，1500公里") == 1000
    assert extract_distance_mi("五百公里以内走走") == 500
    assert extract_distance_mi("within 200 miles") == 250
    assert extract_tags("亲子游", names) == ["亲子游"]
    assert "亲子" not in extract_tags("亲子游", names)
    assert extract_tags("a restorative digital detox near Route 66", names, aliases) == [
        "治愈",
        "数字戒断",
        "走66号公路",
    ]


def test_recommend_yellowstone_from_new_york(client):
    response = client.post(
        "/api/recommend",
        json={"query": EXAMPLE, "origin": NEW_YORK, "max_distance_mi": 3000},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["parser"] == "keyword"
    assert body["parsed_tags"] == ["国家公园", "湖泊"]
    assert body["max_distance_mi"] == 3000
    assert [item["spot_id"] for item in body["spots"]] == ["SP001"]
    spot = body["spots"][0]
    assert spot["display_name"] == "T**b** L*k* Tr**l"
    assert spot["unlocked"] is False
    assert spot["can_review"] is False
    assert spot["province"] == "Wyoming"
    assert spot["city"] == "Yellowstone National Park"
    miles = km_to_miles(haversine_km(NEW_YORK["lat"], NEW_YORK["lng"], *LAKE))
    assert 1000 < miles < 3000
    assert spot["distance_mi"] == pytest.approx(miles, abs=0.1)
    assert {item["name"] for item in spot["matched_tags"]} == {"国家公园", "湖泊"}
    assert spot["match_score"] == 6
    assert "location" not in spot
    assert "hydrothermal" in spot["description"]
    assert spot["image_url"].startswith("https://upload.wikimedia.org/")
    _assert_blind(response.text)


def test_distance_bucket_excludes_far_spots(client):
    far = client.post(
        "/api/recommend",
        json={"query": "national park lake", "origin": NEW_YORK, "max_distance_mi": 1000},
    )
    assert far.status_code == 200
    assert far.json()["spots"] == []

    near = client.post(
        "/api/recommend",
        json={"query": "national park lake", "origin": NEW_YORK, "max_distance_mi": 3000},
    )
    assert near.status_code == 200
    spots = near.json()["spots"]
    assert [item["spot_id"] for item in spots] == ["SP001"]
    assert spots[0]["display_name"] == "T**b** L*k* Tr**l"
    assert "adult_ticket_price" not in near.text
    _assert_blind(near.text)


def test_explicit_distance_overrides_the_sentence(client):
    response = client.post(
        "/api/recommend",
        json={"query": "红色旅游，6000公里内", "origin": BEIJING, "max_distance_mi": 100},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["parsed_max_distance_mi"] == 3000
    assert body["max_distance_mi"] == 100
    assert body["spots"] == []


def test_invalid_distance_is_rejected(client):
    response = client.post(
        "/api/recommend",
        json={"query": "露营", "origin": BEIJING, "max_distance_mi": 750},
    )
    assert response.status_code == 422
    assert response.json()["detail"]["allowed_mi"] == [100, 250, 500, 1000, 3000]


def test_list_uses_distance_dropdown_and_stays_blind(client):
    response = client.get("/api/spots", params={**_flat_origin(), "max_distance_mi": 1000})
    assert response.status_code == 200
    assert response.json()["spots"] == []

    wider = client.get("/api/spots", params={**_flat_origin(), "max_distance_mi": 3000})
    assert [item["spot_id"] for item in wider.json()["spots"]] == ["SP001"]
    assert wider.json()["spots"][0]["display_name"] == "T**b** L*k* Tr**l"
    _assert_blind(wider.text)


def test_locked_detail_then_unlock_reveals_name_and_price(client):
    locked = client.get("/api/spots/SP001", params=_flat_origin())
    assert locked.status_code == 200
    spot = locked.json()["spot"]
    assert spot["display_name"] == "T**b** L*k* Tr**l"
    assert spot["can_review"] is False
    assert "mock_weather" not in spot
    assert spot["weather"]["status"] == "ok"
    assert spot["weather"]["source"] == "open-meteo"
    assert spot["weather"]["temp_max"] == "51"
    assert spot["weather"]["temp_min"] == "38"
    assert spot["weather"]["precip_unit"] == "in"
    assert "【" not in spot["tag_interpretation"]
    miles = km_to_miles(haversine_km(NEW_YORK["lat"], NEW_YORK["lng"], *LAKE))
    assert spot["distance_mi"] == pytest.approx(miles, abs=0.1)
    _assert_blind(locked.text)

    headers, _user = register(client)
    unlocked = client.post(
        "/api/spots/SP001/unlock",
        headers=headers,
        json={
            "depart_date": "2026-10-10",
            "days": 1,
            "companions": 2,
            "transport": "Drive",
            "itinerary": "Nine Mile Trailhead",
            "budget": 4000,
        },
    )
    assert unlocked.status_code == 200
    revealed = unlocked.json()
    assert revealed["plan"]["transport"] == "自驾"
    assert revealed["unlocked"] is True
    assert revealed["spot"]["full_name"] == "Turbid Lake Trail"
    assert revealed["spot"]["display_name"] == "Turbid Lake Trail"
    assert revealed["spot"]["adult_ticket_price"] == 20
    assert revealed["spot"]["can_review"] is True
    assert revealed["spot"]["location"]["lat"] == pytest.approx(44.549906)

    again = client.get("/api/spots/SP001", params={"unlock_token": revealed["unlock_token"]})
    assert again.json()["spot"]["full_name"] == "Turbid Lake Trail"

    wrong = client.get("/api/spots/SP001", params={"unlock_token": "not-a-real-token"})
    assert wrong.status_code == 403
    assert "Turbid Lake Trail" not in wrong.text


def test_descriptions_keep_region_and_hide_full_name(client):
    response = client.get("/api/spots/SP001")
    spot = response.json()["spot"]
    assert "Yellowstone" in spot["description"]
    assert "Wyoming" in spot["province"]
    assert "Turbid Lake Trail" not in response.text
    assert spot["province"] == "Wyoming"
    assert spot["city"] == "Yellowstone National Park"


def test_us_phone_and_bus_are_accepted(client):
    denied = client.post("/api/auth/register", json={"phone": "555", "password": "pass1234"})
    assert denied.status_code == 422
    created = client.post(
        "/api/auth/register",
        json={"phone": "2125550199", "password": "pass1234", "nickname": "Alex"},
    )
    assert created.status_code == 200, created.text
    assert created.json()["user"]["phone"] == "2125550199"
    headers = {"Authorization": f"Bearer {created.json()['token']}"}
    opened = client.post(
        "/api/spots/SP001/unlock",
        headers=headers,
        json={
            "depart_date": "2026-10-10",
            "days": 1,
            "companions": 1,
            "transport": "Bus",
            "itinerary": "",
        },
    )
    assert opened.status_code == 200, opened.text
    assert opened.json()["plan"]["transport"] == "大巴"


def _flat_origin() -> dict:
    return {"origin_lat": NEW_YORK["lat"], "origin_lng": NEW_YORK["lng"]}
