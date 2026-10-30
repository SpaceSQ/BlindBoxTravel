"""时间胶囊、苹果登录和商店交易入账。"""

from app.geo import haversine_km
from tests.conftest import register

# 1x1 JPEG
JPEG = bytes.fromhex(
    "ffd8ffe000104a46494600010100000100010000ffdb004300080606070605080707070909080a0c140d0c0b0b0c1912130f141d1a1f1e1d1a1c1c20242e2720222c231c1c2837292c30313434341f27393d38323c2e333432ffc0000b080001000101011100ffc4001f0000010501010101010100000000000000000102030405060708090a0bffc400b5100002010303020403050504040000017d01020300041105122131410613516107227114328191a1082342b1c11552d1f02433627282090a161718191a25262728292a3435363738393a434445464748494a535455565758595a636465666768696a737475767778797a838485868788898a92939495969798999aa2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae1e2e3e4e5e6e7e8e9eaf1f2f3f4f5f6f7f8f9faffda00080001000100003f00fbffd9"
)


def _unlock(client, headers, spot_id="SP001"):
    response = client.post(
        f"/api/spots/{spot_id}/unlock",
        headers=headers,
        json={
            "depart_date": "2026-10-08",
            "days": 1,
            "companions": 1,
            "transport": "自驾",
            "itinerary": "到现场",
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_capsule_requires_unlock_and_five_kilometres(client):
    headers, user = register(client, "13800138301", nickname="现场")
    guest_headers, _guest = register(client, "13800138302", nickname="路过")
    opened = _unlock(client, headers)
    spot = opened["spot"]
    lat = spot["location"]["lat"]
    lng = spot["location"]["lng"]

    hidden = client.get(f"/api/spots/{spot['spot_id']}/capsules", headers=guest_headers)
    assert hidden.status_code == 403

    denied = client.post(
        f"/api/spots/{spot['spot_id']}/capsules",
        headers=guest_headers,
        data={"content": "云打卡", "lat": lat, "lng": lng},
        files={"image": ("shot.jpg", JPEG, "image/jpeg")},
    )
    assert denied.status_code == 403

    far = client.post(
        f"/api/spots/{spot['spot_id']}/capsules",
        headers=headers,
        data={"content": "人还在北京", "lat": 39.9, "lng": 116.4},
        files={"image": ("shot.jpg", JPEG, "image/jpeg")},
    )
    assert far.status_code == 403
    assert haversine_km(39.9, 116.4, lat, lng) >= 5

    too_long = client.post(
        f"/api/spots/{spot['spot_id']}/capsules",
        headers=headers,
        data={"content": "字" * 51, "lat": lat, "lng": lng},
        files={"image": ("shot.jpg", JPEG, "image/jpeg")},
    )
    assert too_long.status_code == 422

    not_photo = client.post(
        f"/api/spots/{spot['spot_id']}/capsules",
        headers=headers,
        data={"content": "这不是照片", "lat": lat, "lng": lng},
        files={"image": ("note.txt", b"hello", "text/plain")},
    )
    assert not_photo.status_code == 422

    saved = client.post(
        f"/api/spots/{spot['spot_id']}/capsules",
        headers=headers,
        data={"content": "风从湖面过来", "lat": lat, "lng": lng},
        files={"image": ("shot.jpg", JPEG, "image/jpeg")},
    )
    assert saved.status_code == 200, saved.text
    capsule = saved.json()["capsule"]
    assert capsule["content"] == "风从湖面过来"
    assert capsule["author"] == "现场"
    assert capsule["image_url"].startswith("/media/capsules/")
    assert user["phone"] not in saved.text
    assert "full_name" not in capsule

    listed = client.get(f"/api/spots/{spot['spot_id']}/capsules", headers=headers)
    assert listed.status_code == 200
    assert listed.json()["capsules"][0]["capsule_id"] == capsule["capsule_id"]
    assert "user_id" not in listed.text
    assert user["phone"] not in listed.text

    image = client.get(capsule["image_url"])
    assert image.status_code == 200
    assert image.content.startswith(b"\xff\xd8\xff")


def test_apple_login_is_stable_and_account_can_be_deleted(client, monkeypatch):
    monkeypatch.setattr("app.main.verify_apple_identity", lambda token, audience: "apple-sub-1")
    first = client.post("/api/auth/apple", json={"identity_token": "header.payload.sig", "nickname": "果粉"})
    assert first.status_code == 200, first.text
    assert first.json()["user"]["phone"] == ""
    assert first.json()["user"]["nickname"] == "果粉"
    second = client.post("/api/auth/apple", json={"identity_token": "header.payload.sig", "nickname": "另一个名字"})
    assert second.status_code == 200
    assert second.json()["user"]["id"] == first.json()["user"]["id"]
    assert second.json()["user"]["nickname"] == "果粉"

    headers = {"Authorization": f"Bearer {first.json()['token']}"}
    removed = client.delete("/api/account", headers=headers)
    assert removed.status_code == 200
    assert client.get("/api/account", headers=headers).status_code == 401


def test_google_login_creates_an_account_and_delete_wipes_trips(client, monkeypatch):
    monkeypatch.setattr("app.main.verify_google_identity", lambda token, audiences: ("google-sub-1", "Alex"))
    first = client.post("/api/auth/google", json={"identity_token": "header.payload.sig"})
    assert first.status_code == 200, first.text
    body = first.json()
    assert body["user"]["phone"] == ""
    assert body["user"]["sign_in"] == "google"
    assert body["user"]["nickname"] == "Alex"
    headers = {"Authorization": f"Bearer {body['token']}"}
    second = client.post("/api/auth/google", json={"identity_token": "header.payload.sig", "nickname": "Someone else"})
    assert second.json()["user"]["id"] == body["user"]["id"]
    assert second.json()["user"]["nickname"] == "Alex"

    client.post(
        "/api/spots/SP001/unlock",
        headers=headers,
        json={
            "depart_date": "2026-10-08",
            "days": 1,
            "companions": 1,
            "transport": "Drive",
            "itinerary": "Look around",
        },
    )
    assert client.get("/api/plans", headers=headers).json()["plans"]
    removed = client.delete("/api/account", headers=headers)
    assert removed.status_code == 200
    assert client.get("/api/plans", headers=headers).status_code == 401


def test_store_transaction_grants_vip_once(client):
    headers, _user = register(client, "13800138303")
    payload = {
        "plan_code": "monthly",
        "product_id": "vip_month_usd",
        "store_transaction_id": "txn-apple-1",
    }
    bought = client.post("/api/account/purchases", headers=headers, json=payload)
    assert bought.status_code == 200
    expires = bought.json()["user"]["vip_expires_at"]
    again = client.post("/api/account/purchases", headers=headers, json=payload)
    assert again.status_code == 200
    assert again.json()["user"]["vip_expires_at"] == expires
    assert len(again.json()["purchases"]) == 1

    mismatch = client.post(
        "/api/account/purchases",
        headers=headers,
        json={"plan_code": "yearly", "product_id": "vip_month_usd", "store_transaction_id": "txn-apple-2"},
    )
    assert mismatch.status_code == 422
