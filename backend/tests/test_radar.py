"""雷达池和心愿单。"""

from app.blind import mask_name
from tests.conftest import register

CLIENT_PHONE = "13800138111"
OTHER_PHONE = "13800138222"


def _unlock(client, headers, spot_id="SP001"):
    response = client.post(
        f"/api/spots/{spot_id}/unlock",
        headers=headers,
        json={
            "depart_date": "2026-10-08",
            "days": 1,
            "companions": 2,
            "transport": "自驾",
            "itinerary": "看火山",
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def _assert_blind_card(card: dict) -> None:
    assert card["unlocked"] is False
    assert "full_name" not in card
    assert "adult_ticket_price" not in card
    assert card["display_name"] == mask_name("Turbid Lake Trail")
    assert "Turbid Lake Trail" not in card["display_name"]
    assert isinstance(card["strong_tags"], list) and card["strong_tags"]
    strong = {tag["name"] for tag in card["tags"] if tag["strength"] == "strong"}
    assert set(card["strong_tags"]) == strong
    image = card["image_url"]
    assert image is None or isinstance(image, str)


def test_radar_stays_blind_and_prefers_intent(client):
    anonymous = client.get("/api/radar/spots", params={"limit": 15})
    assert anonymous.status_code == 200
    body = anonymous.json()
    assert body["parsed_tags"] == []
    assert 1 <= len(body["spots"]) <= 15
    for card in body["spots"]:
        _assert_blind_card(card)
    assert "Turbid Lake Trail" not in anonymous.text

    matched = client.get("/api/radar/spots", params={"limit": 15, "query": "国家公园"})
    assert matched.status_code == 200
    ranked = matched.json()
    assert "国家公园" in ranked["parsed_tags"]
    assert ranked["spots"][0]["spot_id"] == "SP001"
    assert ranked["spots"][0]["match_score"] > 0
    assert "国家公园" in ranked["spots"][0]["strong_tags"]


def test_wishlist_is_private_and_leaves_the_radar(client):
    headers, _user = register(client, CLIENT_PHONE)
    other_headers, _other = register(client, OTHER_PHONE, nickname="乙")

    denied = client.post("/api/wishlists", json={"spot_id": "SP001"})
    assert denied.status_code == 401

    saved = client.post("/api/wishlists", headers=headers, json={"spot_id": "SP001"})
    assert saved.status_code == 200, saved.text
    assert saved.json()["created"] is True
    _assert_blind_card(saved.json()["spot"])

    again = client.post("/api/wishlists", headers=headers, json={"spot_id": "SP001"})
    assert again.status_code == 200
    assert again.json()["created"] is False

    missing = client.post("/api/wishlists", headers=headers, json={"spot_id": "NOPE"})
    assert missing.status_code == 404

    mine = client.get("/api/wishlists", headers=headers)
    assert [item["spot_id"] for item in mine.json()["spots"]] == ["SP001"]
    assert client.get("/api/wishlists", headers=other_headers).json()["spots"] == []

    radar = client.get("/api/radar/spots", headers=headers, params={"limit": 15})
    assert "SP001" not in {item["spot_id"] for item in radar.json()["spots"]}
    other_radar = client.get("/api/radar/spots", headers=other_headers, params={"limit": 15})
    assert "SP001" in {item["spot_id"] for item in other_radar.json()["spots"]}

    excluded = client.get("/api/radar/spots", params={"exclude": "SP001"})
    ids = {item["spot_id"] for item in excluded.json()["spots"]}
    assert "SP001" not in ids


def test_home_sentence_and_uuid_spot_id_pass_radar(client):
    sentence = "Natural . There is a river,and I can do some camping here."
    assert len(sentence) > 32
    opened = client.get("/api/radar/spots", params={"limit": 15, "query": sentence})
    assert opened.status_code == 200, opened.text
    spots = opened.json()["spots"]
    assert spots
    ids = [item["spot_id"] for item in spots]
    assert len(ids) == len(set(ids))
    assert all(item["image_url"] for item in spots)

    headers, _user = register(client, "13800138333")
    spot_id = "23ed0d5e-3d2b-5045-9f1c-5e045bfdde1c"
    assert len(spot_id) == 36
    saved = client.post("/api/wishlists", headers=headers, json={"spot_id": spot_id})
    assert saved.status_code == 404
    assert "at most 32" not in saved.text

    from app.main import _exclude_ids

    assert _exclude_ids(f"SP001,{spot_id}") == ["SP001", spot_id]


def test_radar_skips_spots_without_a_usable_photo(client):
    conn = client.app.state.db
    conn.execute("UPDATE spots SET image_url = NULL WHERE spot_id = 'SP001'")
    conn.commit()
    blank = client.get("/api/radar/spots", params={"limit": 15})
    assert blank.status_code == 200
    assert blank.json()["spots"] == []

    conn.execute(
        "UPDATE spots SET image_url = ? WHERE spot_id = 'SP001'",
        ("https://upload.wikimedia.org/wikipedia/commons/6/6a/Wukoki_Ruin.tif",),
    )
    conn.commit()
    scanned = client.get("/api/radar/spots", params={"limit": 15})
    assert scanned.status_code == 200
    assert scanned.json()["spots"] == []


def test_unlocked_spot_leaves_radar_and_wishlist(client):
    headers, _user = register(client, CLIENT_PHONE)
    client.post("/api/wishlists", headers=headers, json={"spot_id": "SP001"})
    assert client.get("/api/wishlists", headers=headers).json()["spots"][0]["spot_id"] == "SP001"

    _unlock(client, headers, "SP001")
    revealed = client.post("/api/wishlists", headers=headers, json={"spot_id": "SP001"})
    assert revealed.status_code == 409

    assert client.get("/api/wishlists", headers=headers).json()["spots"] == []
    radar = client.get("/api/radar/spots", headers=headers, params={"limit": 15})
    assert "SP001" not in {item["spot_id"] for item in radar.json()["spots"]}
