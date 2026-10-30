"""行程、点评、分享和热度。"""

from tests.conftest import register

CLIENT_PHONE = "13800138001"
OTHER_PHONE = "13800138002"


def _unlock(client, headers, spot_id="SP001", days=1, companions=2, depart_date="2026-10-08"):
    response = client.post(
        f"/api/spots/{spot_id}/unlock",
        headers=headers,
        json={
            "depart_date": depart_date,
            "days": days,
            "companions": companions,
            "transport": "自驾",
            "itinerary": "看火山",
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_plans_can_be_listed_edited_and_deleted(client):
    headers, _user = register(client, CLIENT_PHONE)
    other_headers, _other = register(client, OTHER_PHONE, nickname="乙")
    created = _unlock(client, headers)
    plan_id = created["plan_id"]

    listed = client.get("/api/plans", headers=headers)
    assert listed.status_code == 200
    body = listed.json()["plans"]
    assert len(body) == 1
    assert body[0]["id"] == plan_id
    assert body[0]["full_name"] == "Turbid Lake Trail"
    assert body[0]["depart_date"] == "2026-10-08"
    assert body[0]["itinerary"] == "看火山"
    assert "user_id" not in body[0]

    hidden = client.get("/api/plans", headers=other_headers)
    assert hidden.json()["plans"] == []

    updated = client.put(
        f"/api/plans/{plan_id}",
        headers=headers,
        json={
            "depart_date": "2026-11-01",
            "days": 2,
            "companions": 4,
            "transport": "游轮",
            "itinerary": "改走水路",
        },
    )
    assert updated.status_code == 200
    assert updated.json()["plan"]["depart_date"] == "2026-11-01"
    assert updated.json()["plan"]["days"] == 2
    assert updated.json()["plan"]["companions"] == 4
    assert updated.json()["plan"]["transport"] == "游轮"
    assert updated.json()["plan"]["itinerary"] == "改走水路"

    forbidden = client.put(
        f"/api/plans/{plan_id}",
        headers=other_headers,
        json={
            "depart_date": "2026-11-02",
            "days": 1,
            "companions": 1,
            "transport": "飞机",
            "itinerary": "",
        },
    )
    assert forbidden.status_code == 404

    removed = client.delete(f"/api/plans/{plan_id}", headers=headers)
    assert removed.status_code == 200
    assert client.get("/api/plans", headers=headers).json()["plans"] == []


def test_reviews_require_an_unlocked_plan(client):
    headers, _user = register(client, "13800138003")
    blocked = client.post(
        "/api/spots/SP001/reviews",
        headers=headers,
        json={"rating": 5, "content": "还没解锁"},
    )
    assert blocked.status_code == 403

    _unlock(client, headers)
    created = client.post(
        "/api/spots/SP001/reviews",
        headers=headers,
        json={"rating": 5, "content": "异星感很足"},
    )
    assert created.status_code == 200
    assert created.json()["review"]["rating"] == 5
    assert "user_id" not in created.json()["review"]

    listed = client.get("/api/spots/SP001/reviews")
    assert listed.status_code == 200
    contents = [item["content"] for item in listed.json()["reviews"]]
    assert contents == ["异星感很足"]


def test_share_import_copies_a_plan_without_linking_accounts(client):
    owner_headers, _owner = register(client, "13800138004", nickname="主人")
    guest_headers, _guest = register(client, "13800138005", nickname="客人")
    created = _unlock(client, owner_headers, days=2, companions=3, depart_date="2026-09-03")
    shared = client.post(f"/api/plans/{created['plan_id']}/share", headers=owner_headers)
    assert shared.status_code == 200
    token = shared.json()["share_token"]

    copied = client.post(f"/api/shares/{token}/import", headers=guest_headers)
    assert copied.status_code == 200
    guest_plan = copied.json()["plan"]
    assert guest_plan["id"] != created["plan_id"]
    assert guest_plan["depart_date"] == "2026-09-03"
    assert guest_plan["days"] == 2
    assert guest_plan["companions"] == 3

    client.put(
        f"/api/plans/{guest_plan['id']}",
        headers=guest_headers,
        json={
            "depart_date": "2026-12-01",
            "days": 1,
            "companions": 1,
            "transport": "飞机",
            "itinerary": "客人自己改",
        },
    )
    owner_plan = client.get("/api/plans", headers=owner_headers).json()["plans"][0]
    assert owner_plan["depart_date"] == "2026-09-03"
    assert owner_plan["itinerary"] == "看火山"

    client.delete(f"/api/plans/{guest_plan['id']}", headers=guest_headers)
    assert len(client.get("/api/plans", headers=owner_headers).json()["plans"]) == 1


def test_heat_counts_people_on_each_booked_day_without_identities(client):
    headers, _user = register(client, "13800138006")
    _unlock(client, headers, days=2, companions=3, depart_date="2026-09-03")
    heat = client.get("/api/spots/SP001/heat")
    assert heat.status_code == 200
    dates = {item["date"]: item["people"] for item in heat.json()["dates"]}
    assert dates["2026-09-03"] == 3
    assert dates["2026-09-04"] == 3
    assert "phone" not in heat.text
    assert "nickname" not in heat.text


def test_free_unlocks_stop_at_three_until_a_vip_purchase(client):
    headers, user = register(client, "13800138007")
    assert user["unlock_count"] == 0
    assert user["unlock_limit"] == 3
    for _ in range(3):
        _unlock(client, headers, spot_id="SP001")
    blocked = client.post(
        "/api/spots/SP001/unlock",
        headers=headers,
        json={
            "depart_date": "2026-10-08",
            "days": 1,
            "companions": 1,
            "transport": "大巴",
            "itinerary": "",
        },
    )
    assert blocked.status_code == 402
    assert blocked.json()["detail"]["code"] == "paywall"

    bought = client.post(
        "/api/account/purchases",
        headers=headers,
        json={"plan_code": "monthly", "product_id": "vip_month_usd", "store_transaction_id": "txn-free-limit"},
    )
    assert bought.status_code == 200
    assert bought.json()["user"]["is_vip"] is True
    assert bought.json()["purchases"][0]["amount_usd"] == 4.99
    assert bought.json()["purchases"][0]["title"] == "Monthly"

    opened = _unlock(client, headers, spot_id="SP001")
    assert opened["unlocked"] is True
    account = client.get("/api/account", headers=headers).json()
    assert account["user"]["unlock_count"] == 4
    assert account["user"]["nickname"] == "甲"
