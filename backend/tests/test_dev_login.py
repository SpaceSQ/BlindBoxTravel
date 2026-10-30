def test_dev_login_rejected_when_flag_unset(client, monkeypatch):
    monkeypatch.delenv("ALLOW_DEV_LOGIN", raising=False)
    missing = client.post("/api/auth/dev")
    assert missing.status_code == 403

    monkeypatch.setenv("ALLOW_DEV_LOGIN", "0")
    disabled = client.post("/api/auth/dev")
    assert disabled.status_code == 403
    assert client.app.state.db.execute("SELECT COUNT(*) AS n FROM users").fetchone()["n"] == 0


def test_dev_login_succeeds_when_flag_set(client, monkeypatch):
    monkeypatch.setenv("ALLOW_DEV_LOGIN", "1")
    first = client.post("/api/auth/dev")
    assert first.status_code == 200, first.text
    body = first.json()
    assert body["user"]["phone"] == "2125550199"
    assert body["user"]["nickname"] == "Test user"
    assert body["token"]

    second = client.post("/api/auth/dev")
    assert second.status_code == 200, second.text
    assert second.json()["user"]["id"] == body["user"]["id"]

    account = client.get("/api/account", headers={"Authorization": f"Bearer {body['token']}"})
    assert account.status_code == 200, account.text
    assert account.json()["user"]["phone"] == "2125550199"
    users = client.app.state.db.execute("SELECT COUNT(*) AS n FROM users WHERE phone = ?", ("2125550199",)).fetchone()
    assert users["n"] == 1
