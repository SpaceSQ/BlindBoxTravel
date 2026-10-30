import pytest
from fastapi.testclient import TestClient

from app.main import create_app


def register(client, phone="13800138000", password="pass1234", nickname="甲"):
    response = client.post(
        "/api/auth/register",
        json={"phone": phone, "password": password, "nickname": nickname},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    return {"Authorization": f"Bearer {body['token']}"}, body["user"]


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "")
    monkeypatch.setenv("LLM_API_KEY", "")
    monkeypatch.setenv("QWEATHER_API_KEY", "")
    monkeypatch.setenv("QWEATHER_API_HOST", "")
    app = create_app(tmp_path / "test.sqlite")
    with TestClient(app) as test_client:
        yield test_client
