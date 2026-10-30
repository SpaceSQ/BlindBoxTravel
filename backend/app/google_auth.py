"""校验 Sign in with Google 的 ID token，取出稳定的用户标识。"""

from __future__ import annotations

import os

import jwt
from jwt import PyJWKClient

from app.env import load_env

_GOOGLE_CERTS = "https://www.googleapis.com/oauth2/v3/certs"
_GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"]
_jwks = PyJWKClient(_GOOGLE_CERTS)


def google_audiences() -> list[str]:
    load_env()
    raw = os.environ.get("GOOGLE_CLIENT_IDS", "")
    return [item.strip() for item in raw.split(",") if item.strip()]


def verify_google_identity(identity_token: str, audiences: list[str]) -> tuple[str, str]:
    if not audiences:
        raise jwt.InvalidTokenError("Google sign-in isn't configured")
    signing_key = _jwks.get_signing_key_from_jwt(identity_token)
    payload = jwt.decode(
        identity_token,
        signing_key.key,
        algorithms=["RS256"],
        audience=audiences,
        issuer=_GOOGLE_ISSUERS,
    )
    subject = payload.get("sub")
    if not isinstance(subject, str) or not subject.strip():
        raise jwt.InvalidTokenError("Google sign-in is missing a user id")
    name = payload.get("name") or payload.get("given_name") or ""
    if not isinstance(name, str):
        name = ""
    return subject.strip(), name.strip()
