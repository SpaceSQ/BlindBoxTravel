"""大模型由 ROBOTZERO 提供。客户端拿不到密钥，推荐也不要求用户填写。"""

import json

NEW_YORK = {"lat": 40.7128, "lng": -74.006}
QUERY = "a national park lake within 2000 miles"
SERVER_KEY = "test-server-key"
SERVER_BASE = "https://llm.example/v1"
USER_KEY = "sk-user-pasted-key"


def _assert_no_credential(body: str) -> None:
    folded = body.casefold()
    for token in (
        "api_key",
        "base_url",
        "openai_api_key",
        "llm_api_key",
        "authorization",
        "bearer ",
        "sk-",
        SERVER_KEY,
        SERVER_BASE,
        USER_KEY,
        "llm.example",
        "deepseek",
    ):
        assert token.casefold() not in folded


def _recommend(client, **extra):
    payload = {"query": QUERY, "origin": NEW_YORK, "max_distance_mi": 3000, **extra}
    return client.post("/api/recommend", json=payload)


def test_robotzero_is_stored_and_recommend_needs_no_user_key(client):
    conn = client.app.state.db
    row = conn.execute(
        "SELECT company, service, user_supplies_key, credential_source FROM llm_providers WHERE id = 1"
    ).fetchone()
    assert row["company"] == "ROBOTZERO"
    assert row["service"] == "llm"
    assert row["user_supplies_key"] == 0
    assert row["credential_source"] == "server"
    columns = {item["name"] for item in conn.execute("PRAGMA table_info(llm_providers)")}
    assert columns.isdisjoint({"api_key", "base_url", "token", "secret"})

    meta = client.get("/api/meta")
    assert meta.status_code == 200
    assert meta.json()["llm"] == {"company": "ROBOTZERO", "service": "llm", "user_supplies_key": False}
    _assert_no_credential(meta.text)

    response = _recommend(client, api_key=USER_KEY, openai_api_key=USER_KEY)
    assert response.status_code == 200
    body = response.json()
    assert body["parser"] == "keyword"
    assert body["parsed_tags"] == ["国家公园", "湖泊"]
    assert body["llm"] == {"company": "ROBOTZERO", "service": "llm", "user_supplies_key": False}
    _assert_no_credential(response.text)


def test_server_credential_parses_intent_without_echoing_it(client, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", SERVER_KEY)
    monkeypatch.setenv("LLM_API_KEY", "")
    monkeypatch.setenv("OPENAI_BASE_URL", SERVER_BASE)
    monkeypatch.setenv("OPENAI_MODEL", "test-model")
    captured: dict = {}

    class _Response:
        def read(self):
            content = json.dumps({"tags": ["国家公园", "湖泊", "雪山"], "max_distance_mi": 3000})
            return json.dumps({"choices": [{"message": {"content": content}}]}).encode()

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

    def fake_urlopen(request, timeout=20):
        captured["url"] = request.full_url
        captured["authorization"] = request.get_header("Authorization")
        captured["model"] = json.loads(request.data.decode())["model"]
        return _Response()

    monkeypatch.setattr("app.intent.urllib.request.urlopen", fake_urlopen)
    response = _recommend(client)
    assert response.status_code == 200
    body = response.json()
    assert body["parser"] == "llm"
    assert body["parsed_tags"] == ["国家公园", "湖泊", "雪山"]
    assert body["llm"]["company"] == "ROBOTZERO"
    assert captured["url"] == f"{SERVER_BASE}/chat/completions"
    assert captured["authorization"] == f"Bearer {SERVER_KEY}"
    assert captured["model"] == "test-model"
    assert "test-model" not in response.text
    _assert_no_credential(response.text)


def test_without_provider_record_intent_stays_on_keywords(client, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", SERVER_KEY)
    monkeypatch.setenv("OPENAI_BASE_URL", SERVER_BASE)
    client.app.state.db.execute("DELETE FROM llm_providers")
    client.app.state.db.commit()

    def explode(*_args, **_kwargs):
        raise AssertionError("没有 ROBOTZERO 记录时不应该请求模型")

    monkeypatch.setattr("app.intent.urllib.request.urlopen", explode)
    response = _recommend(client)
    assert response.status_code == 200
    assert response.json()["parser"] == "keyword"
    assert response.json()["llm"]["company"] is None
    _assert_no_credential(response.text)
