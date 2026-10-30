"""校验 Sign in with Apple 的 identity token，取出稳定的用户标识。"""

from __future__ import annotations

import os

import jwt
from jwt import PyJWKClient

from app.env import load_env

_APPLE_KEYS = "https://appleid.apple.com/auth/keys"
_APPLE_ISSUER = "https://appleid.apple.com"
_DEFAULT_BUNDLE = "com.blindboxtravel.app"
_jwks = PyJWKClient(_APPLE_KEYS)


def apple_audience() -> str:
    load_env()
    return os.environ.get("APPLE_BUNDLE_ID", "").strip() or _DEFAULT_BUNDLE


def verify_apple_identity(identity_token: str, audience: str) -> str:
    signing_key = _jwks.get_signing_key_from_jwt(identity_token)
    payload = jwt.decode(
        identity_token,
        signing_key.key,
        algorithms=["RS256"],
        audience=audience,
        issuer=_APPLE_ISSUER,
    )
    subject = payload.get("sub")
    if not isinstance(subject, str) or not subject.strip():
        raise jwt.InvalidTokenError("苹果登录凭证缺少用户标识")
    return subject.strip()
