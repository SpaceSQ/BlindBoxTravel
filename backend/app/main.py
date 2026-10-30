"""盲盒旅游推荐接口。

未解锁的列表和详情只返回 blind_name，不返回 full_name 和 adult_ticket_price。
提交行程计划后发放解锁凭证，详情改为全名、票价，并打开点评。
"""

from __future__ import annotations

import os
import re
import secrets
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Literal

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Query, UploadFile
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator

from app.accounts import (
    FREE_UNLOCK_LIMIT,
    PHONE_PATTERN,
    VIP_PLANS,
    authenticate,
    create_user,
    delete_user,
    list_purchases,
    dev_login_allowed,
    login_dev_user,
    login_with_apple,
    login_with_google,
    public_user,
    purchase_vip,
    update_nickname,
    user_from_token,
    vip_active,
)
from app.apple_auth import apple_audience, verify_apple_identity
from app.google_auth import google_audiences, verify_google_identity
from app.catalog import load_catalog
from app.constants import DISTANCE_OPTIONS_MI
from app.db import DEFAULT_DB_PATH, connect, init_schema
from app.geo import haversine_km, miles_to_km
from app.intent import parse_intent
from app.present import present_spot, radar_card
from app.recommend import recommend_spots, spots_within_distance
from app.repo import (
    add_review,
    add_wishlist,
    delete_plan,
    ensure_share,
    find_unlock,
    get_spot,
    list_capsules,
    list_plans,
    list_reviews,
    list_spots,
    list_tag_aliases,
    list_tag_names,
    list_tags,
    list_wishlists,
    public_llm_provider,
    radar_spots,
    import_share,
    save_capsule,
    save_trip_plan,
    spot_heat,
    tag_stats,
    update_plan,
    user_unlocked_spot,
)
from app.env import load_env
from app.seed import seed
from app.weather import resolve_spot_weather

_SECRET_KEYS = ("full_name", "adult_ticket_price")
CAPSULE_RADIUS_KM = 5
_MAX_CAPSULE_BYTES = 6 * 1024 * 1024


class Origin(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)


class RecommendRequest(BaseModel):
    query: str = Field(min_length=1, max_length=500)
    origin: Origin
    max_distance_mi: int | None = None


_TRANSPORT_ALIASES = {
    "自驾": "自驾",
    "drive": "自驾",
    "高铁": "高铁",
    "train": "高铁",
    "飞机": "飞机",
    "flight": "飞机",
    "大巴": "大巴",
    "coach": "大巴",
    "bus": "大巴",
    "游轮": "游轮",
    "cruise": "游轮",
}


def _check_date(value: str) -> str:
    try:
        datetime.strptime(value, "%Y-%m-%d")
    except ValueError as exc:
        raise ValueError("depart_date must be YYYY-MM-DD") from exc
    return value


def _check_transport(value: str) -> str:
    cleaned = value.strip()
    normalized = _TRANSPORT_ALIASES.get(cleaned) or _TRANSPORT_ALIASES.get(cleaned.lower())
    if normalized is None:
        raise ValueError("transport must be Drive, Train, Flight, Bus, or Cruise")
    return normalized


class TripPlanRequest(BaseModel):
    depart_date: str
    days: int = Field(default=1, ge=1, le=60)
    companions: int = Field(ge=1, le=30)
    transport: str
    itinerary: str = Field(default="", max_length=500)
    budget: int | None = Field(default=None, ge=0)

    @field_validator("depart_date")
    @classmethod
    def check_date(cls, value: str) -> str:
        return _check_date(value)

    @field_validator("transport")
    @classmethod
    def check_transport(cls, value: str) -> str:
        return _check_transport(value)


class PlanUpdateRequest(BaseModel):
    depart_date: str
    days: int = Field(default=1, ge=1, le=60)
    companions: int = Field(ge=1, le=30)
    transport: str
    itinerary: str = Field(default="", max_length=500)

    @field_validator("depart_date")
    @classmethod
    def check_date(cls, value: str) -> str:
        return _check_date(value)

    @field_validator("transport")
    @classmethod
    def check_transport(cls, value: str) -> str:
        return _check_transport(value)


class ReviewRequest(BaseModel):
    rating: int = Field(ge=1, le=5)
    content: str = Field(min_length=1, max_length=500)


class RegisterRequest(BaseModel):
    phone: str = Field(pattern=PHONE_PATTERN)
    password: str = Field(min_length=6, max_length=64)
    nickname: str = Field(default="", max_length=20)


class LoginRequest(BaseModel):
    phone: str = Field(pattern=PHONE_PATTERN)
    password: str = Field(min_length=6, max_length=64)


class ProfileRequest(BaseModel):
    nickname: str = Field(min_length=1, max_length=20)


class PurchaseRequest(BaseModel):
    plan_code: Literal["monthly", "quarterly", "yearly"]
    product_id: str = Field(min_length=1, max_length=64)
    store_transaction_id: str = Field(min_length=4, max_length=128)


class AppleLoginRequest(BaseModel):
    identity_token: str = Field(min_length=10, max_length=8000)
    nickname: str = Field(default="", max_length=40)


class GoogleLoginRequest(BaseModel):
    identity_token: str = Field(min_length=10, max_length=8000)
    nickname: str = Field(default="", max_length=40)


class WishlistRequest(BaseModel):
    spot_id: str = Field(min_length=1, max_length=64)


_SPOT_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def _exclude_ids(raw: str) -> list[str]:
    ids: list[str] = []
    for part in raw.split(","):
        item = part.strip()
        if _SPOT_ID.fullmatch(item) and item not in ids:
            ids.append(item)
        if len(ids) >= 80:
            break
    return ids


def _distance_error(value: int) -> HTTPException:
    return HTTPException(
        status_code=422,
        detail={
            "message": "max_distance_mi must be one of the mile filters",
            "allowed_mi": list(DISTANCE_OPTIONS_MI),
            "received": value,
        },
    )


def require_distance_option(value: int) -> int:
    if value not in DISTANCE_OPTIONS_MI:
        raise _distance_error(value)
    return value


def create_app(db_path: str | Path | None = None) -> FastAPI:
    load_env()
    path = Path(db_path or os.environ.get("DATABASE_PATH") or DEFAULT_DB_PATH)
    conn = connect(path)
    init_schema(conn)
    seed(conn)

    app = FastAPI(
        title="Mystery Getaway",
        summary="Turn a vague idea into tags, then recommend a mystery within the mile range you picked.",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.state.db = conn

    def require_user(authorization: str | None = Header(default=None)) -> sqlite3.Row:
        if not authorization or not authorization.lower().startswith("bearer "):
            raise HTTPException(status_code=401, detail="Sign in to continue")
        token = authorization.split(" ", 1)[1].strip()
        user = user_from_token(conn, token)
        if user is None:
            raise HTTPException(status_code=401, detail="Your session expired. Sign in again.")
        return user

    def optional_user(authorization: str | None = Header(default=None)) -> sqlite3.Row | None:
        if not authorization or not authorization.lower().startswith("bearer "):
            return None
        token = authorization.split(" ", 1)[1].strip()
        user = user_from_token(conn, token)
        if user is None:
            raise HTTPException(status_code=401, detail="Your session expired. Sign in again.")
        return user

    @app.post("/api/auth/register")
    def register(body: RegisterRequest) -> dict:
        nickname = body.nickname.strip() or body.phone[-4:]
        try:
            token, user = create_user(conn, body.phone, body.password, nickname)
        except sqlite3.IntegrityError as exc:
            raise HTTPException(status_code=409, detail="That phone number is already registered") from exc
        return {"token": token, "user": public_user(user)}

    @app.post("/api/auth/login")
    def login(body: LoginRequest) -> dict:
        found = authenticate(conn, body.phone, body.password)
        if found is None:
            raise HTTPException(status_code=401, detail="Phone number or password is incorrect")
        token, user = found
        return {"token": token, "user": public_user(user)}

    @app.post("/api/auth/dev")
    def dev_login() -> dict:
        if not dev_login_allowed():
            raise HTTPException(status_code=403, detail="Dev login is disabled")
        token, user = login_dev_user(conn)
        return {"token": token, "user": public_user(user)}

    @app.post("/api/auth/apple")
    def apple_login(body: AppleLoginRequest) -> dict:
        import jwt

        try:
            subject = verify_apple_identity(body.identity_token, apple_audience())
        except jwt.PyJWTError as exc:
            raise HTTPException(status_code=401, detail="Apple couldn't verify this sign-in") from exc
        except Exception as exc:
            raise HTTPException(status_code=401, detail="Apple sign-in is unavailable right now") from exc
        token, user = login_with_apple(conn, subject, body.nickname)
        return {"token": token, "user": public_user(user)}

    @app.post("/api/auth/google")
    def google_login(body: GoogleLoginRequest) -> dict:
        import jwt

        try:
            subject, suggested_name = verify_google_identity(body.identity_token, google_audiences())
        except jwt.PyJWTError as exc:
            raise HTTPException(status_code=401, detail="Google couldn't verify this sign-in") from exc
        except Exception as exc:
            raise HTTPException(status_code=401, detail="Google sign-in is unavailable right now") from exc
        token, user = login_with_google(conn, subject, body.nickname or suggested_name)
        return {"token": token, "user": public_user(user)}

    @app.get("/api/account")
    def account(user: sqlite3.Row = Depends(require_user)) -> dict:
        return {"user": public_user(user), "purchases": list_purchases(conn, user["id"]), "plans": VIP_PLANS}

    @app.patch("/api/account")
    def edit_account(body: ProfileRequest, user: sqlite3.Row = Depends(require_user)) -> dict:
        updated = update_nickname(conn, user["id"], body.nickname.strip())
        return {"user": public_user(updated)}

    @app.post("/api/account/purchases")
    def buy_vip(body: PurchaseRequest, user: sqlite3.Row = Depends(require_user)) -> dict:
        try:
            updated = purchase_vip(
                conn,
                user,
                body.plan_code,
                body.product_id,
                body.store_transaction_id.strip(),
            )
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        return {"user": public_user(updated), "purchases": list_purchases(conn, updated["id"])}

    @app.delete("/api/account")
    def remove_account(user: sqlite3.Row = Depends(require_user)) -> dict:
        delete_user(conn, user["id"])
        return {"deleted": True}

    @app.get("/api/health")
    def health() -> dict:
        return {"ok": True}

    @app.get("/api/meta")
    def meta() -> dict:
        catalog = load_catalog()
        stats = tag_stats(conn)
        stats["spot_count"] = conn.execute("SELECT COUNT(*) AS n FROM spots").fetchone()["n"]
        stats["distance_options_mi"] = list(DISTANCE_OPTIONS_MI)
        stats["catalog_audit"] = {
            "declared_total": catalog.declared_total,
            "parsed_entries": catalog.parsed_total,
            "unique_names": len(catalog.tags),
            "cross_dimension_names": catalog.cross_dimension_names,
            "dimensions": [
                {
                    "key": item.key,
                    "label": item.label,
                    "declared": item.declared,
                    "parsed": item.parsed,
                }
                for item in catalog.dimensions
            ],
        }
        stats["weights"] = {"strong": 3, "weak": 1}
        stats["blind_visible_chars"] = 2
        stats["llm"] = public_llm_provider(conn)
        return stats

    @app.get("/api/tags")
    def tags(dimension: str | None = None) -> dict:
        return {"tags": list_tags(conn, dimension)}

    @app.get("/api/spots")
    def spots(
        origin_lat: float = Query(ge=-90, le=90),
        origin_lng: float = Query(ge=-180, le=180),
        max_distance_mi: int = Query(),
    ) -> dict:
        require_distance_option(max_distance_mi)
        nearby = spots_within_distance(
            list_spots(conn),
            origin_lat=origin_lat,
            origin_lng=origin_lng,
            max_distance_km=miles_to_km(max_distance_mi),
        )
        return {
            "max_distance_mi": max_distance_mi,
            "distance_options_mi": list(DISTANCE_OPTIONS_MI),
            "spots": [present_spot(spot, unlocked=False, distance_km=distance) for spot, distance in nearby],
        }

    @app.get("/api/spots/{spot_id}")
    def spot_detail(
        spot_id: str,
        unlock_token: str | None = None,
        origin_lat: float | None = Query(default=None, ge=-90, le=90),
        origin_lng: float | None = Query(default=None, ge=-180, le=180),
    ) -> dict:
        spot = get_spot(conn, spot_id)
        if spot is None:
            raise HTTPException(status_code=404, detail="That spot doesn't exist")
        unlocked = _token_unlocks(conn, unlock_token, spot_id)
        distance = None
        if origin_lat is not None and origin_lng is not None:
            distance = haversine_km(origin_lat, origin_lng, spot["lat"], spot["lng"])
        payload = present_spot(spot, unlocked=unlocked, distance_km=distance, detail=True)
        payload.pop("mock_weather", None)
        payload["weather"] = resolve_spot_weather(spot["lat"], spot["lng"], spot.get("mock_weather"))
        _guard_locked_payload(payload)
        return {"spot": payload}

    @app.post("/api/recommend")
    def recommend(body: RecommendRequest) -> dict:
        if body.max_distance_mi is not None:
            require_distance_option(body.max_distance_mi)
        parsed = parse_intent(body.query, _tag_names(conn), _tag_aliases(conn), conn)
        applied = body.max_distance_mi if body.max_distance_mi is not None else parsed.max_distance_mi
        if applied is None:
            raise HTTPException(
                status_code=422,
                detail={
                    "message": "Pick a distance, or say how many miles you want to travel",
                    "allowed_mi": list(DISTANCE_OPTIONS_MI),
                },
            )
        if body.max_distance_mi is None:
            applied = require_distance_option(applied)
        ranked = recommend_spots(
            list_spots(conn),
            requested_tags=parsed.tags,
            origin_lat=body.origin.lat,
            origin_lng=body.origin.lng,
            max_distance_km=miles_to_km(applied),
        )
        spots_payload = [
            present_spot(item.spot, unlocked=False, distance_km=item.distance_km, scored=item, detail=True)
            for item in ranked
        ]
        for item in spots_payload:
            _guard_locked_payload(item)
        return {
            "query": body.query,
            "parser": parsed.parser,
            "parsed_tags": parsed.tags,
            "parsed_max_distance_mi": parsed.max_distance_mi,
            "max_distance_mi": applied,
            "origin": {"lat": body.origin.lat, "lng": body.origin.lng},
            "distance_options_mi": list(DISTANCE_OPTIONS_MI),
            "llm": public_llm_provider(conn),
            "spots": spots_payload,
        }

    @app.post("/api/spots/{spot_id}/unlock")
    def unlock(spot_id: str, body: TripPlanRequest, user: sqlite3.Row = Depends(require_user)) -> dict:
        spot = get_spot(conn, spot_id)
        if spot is None:
            raise HTTPException(status_code=404, detail="That spot doesn't exist")
        if not vip_active(user) and user["unlock_count"] >= FREE_UNLOCK_LIMIT:
            raise HTTPException(
                status_code=402,
                detail={"code": "paywall", "message": "You've used your free unlocks"},
            )
        token = secrets.token_urlsafe(24)
        plan = body.model_dump()
        plan["itinerary"] = body.itinerary.strip()
        plan_id = save_trip_plan(conn, token, spot_id, user["id"], plan, count_unlock=True)
        payload = present_spot(spot, unlocked=True, detail=True)
        return {
            "plan_id": plan_id,
            "unlock_token": token,
            "unlocked": True,
            "plan": plan,
            "spot": payload,
        }

    @app.get("/api/radar/spots")
    def radar(
        limit: int = Query(default=15, ge=1, le=30),
        query: str = Query(default="", max_length=500),
        exclude: str = Query(default=""),
        user: sqlite3.Row | None = Depends(optional_user),
    ) -> dict:
        text = query.strip()
        tags = parse_intent(text, _tag_names(conn), _tag_aliases(conn), conn).tags if text else []
        cards = radar_spots(
            conn,
            user["id"] if user is not None else None,
            limit,
            tags,
            _exclude_ids(exclude),
        )
        for card in cards:
            _guard_locked_payload(card)
        return {"spots": cards, "parsed_tags": tags}

    @app.post("/api/wishlists")
    def save_wish(body: WishlistRequest, user: sqlite3.Row = Depends(require_user)) -> dict:
        spot = get_spot(conn, body.spot_id)
        if spot is None:
            raise HTTPException(status_code=404, detail="That spot doesn't exist")
        if user_unlocked_spot(conn, body.spot_id, user["id"]):
            raise HTTPException(status_code=409, detail="This mystery is already unlocked")
        created = add_wishlist(conn, user["id"], body.spot_id)
        card = radar_card(spot, 0)
        _guard_locked_payload(card)
        return {"created": created, "spot": card}

    @app.get("/api/wishlists")
    def wishes(user: sqlite3.Row = Depends(require_user)) -> dict:
        cards = list_wishlists(conn, user["id"])
        for card in cards:
            _guard_locked_payload(card)
        return {"spots": cards}

    @app.get("/api/spots/{spot_id}/heat")
    def heat(spot_id: str) -> dict:
        if get_spot(conn, spot_id) is None:
            raise HTTPException(status_code=404, detail="That spot doesn't exist")
        return {"dates": spot_heat(conn, spot_id)}

    @app.get("/api/plans")
    def plans(user: sqlite3.Row = Depends(require_user)) -> dict:
        return {"plans": list_plans(conn, user["id"])}

    @app.put("/api/plans/{plan_id}")
    def change_plan(plan_id: int, body: PlanUpdateRequest, user: sqlite3.Row = Depends(require_user)) -> dict:
        updated = update_plan(
            conn,
            plan_id,
            user["id"],
            depart_date=body.depart_date,
            days=body.days,
            companions=body.companions,
            transport=body.transport,
            itinerary=body.itinerary.strip(),
        )
        if updated is None:
            raise HTTPException(status_code=404, detail="That trip doesn't exist")
        return {"plan": updated}

    @app.delete("/api/plans/{plan_id}")
    def remove_plan(plan_id: int, user: sqlite3.Row = Depends(require_user)) -> dict:
        if not delete_plan(conn, plan_id, user["id"]):
            raise HTTPException(status_code=404, detail="That trip doesn't exist")
        return {"deleted": True}

    @app.post("/api/plans/{plan_id}/share")
    def share_plan(plan_id: int, user: sqlite3.Row = Depends(require_user)) -> dict:
        token = ensure_share(conn, plan_id, user["id"])
        if token is None:
            raise HTTPException(status_code=404, detail="That trip doesn't exist")
        return {"share_token": token}

    @app.post("/api/shares/{token}/import")
    def copy_share(token: str, user: sqlite3.Row = Depends(require_user)) -> dict:
        copied = import_share(conn, token, user["id"])
        if copied is None:
            raise HTTPException(status_code=404, detail="That share code isn't valid")
        return {"plan": copied}

    @app.get("/api/spots/{spot_id}/reviews")
    def reviews(spot_id: str) -> dict:
        if get_spot(conn, spot_id) is None:
            raise HTTPException(status_code=404, detail="That spot doesn't exist")
        return {"reviews": list_reviews(conn, spot_id)}

    @app.post("/api/spots/{spot_id}/reviews")
    def create_review(spot_id: str, body: ReviewRequest, user: sqlite3.Row = Depends(require_user)) -> dict:
        if get_spot(conn, spot_id) is None:
            raise HTTPException(status_code=404, detail="That spot doesn't exist")
        if not user_unlocked_spot(conn, spot_id, user["id"]):
            raise HTTPException(status_code=403, detail="Unlock this mystery before leaving a review")
        content = body.content.strip()
        if not content:
            raise HTTPException(status_code=422, detail="Write a few words before submitting")
        review = add_review(conn, spot_id, user["id"], body.rating, content)
        return {"review": review}

    @app.get("/api/spots/{spot_id}/capsules")
    def capsules(spot_id: str, user: sqlite3.Row = Depends(require_user)) -> dict:
        if get_spot(conn, spot_id) is None:
            raise HTTPException(status_code=404, detail="That spot doesn't exist")
        if not user_unlocked_spot(conn, spot_id, user["id"]):
            raise HTTPException(status_code=403, detail="Unlock this mystery to see time capsules")
        return {"capsules": list_capsules(conn, spot_id)}

    @app.post("/api/spots/{spot_id}/capsules")
    async def create_capsule(
        spot_id: str,
        content: str = Form(),
        lat: float = Form(ge=-90, le=90),
        lng: float = Form(ge=-180, le=180),
        image: UploadFile = File(),
        user: sqlite3.Row = Depends(require_user),
    ) -> dict:
        spot = get_spot(conn, spot_id)
        if spot is None:
            raise HTTPException(status_code=404, detail="That spot doesn't exist")
        if not user_unlocked_spot(conn, spot_id, user["id"]):
            raise HTTPException(status_code=403, detail="Unlock this mystery before leaving a time capsule")
        text = content.strip()
        if not text or len(text) > 50:
            raise HTTPException(status_code=422, detail="Keep the note to 50 characters")
        distance = haversine_km(lat, lng, spot["lat"], spot["lng"])
        if distance >= CAPSULE_RADIUS_KM:
            raise HTTPException(status_code=403, detail="You need to be within 3.1 miles of the spot to leave a time capsule")
        raw = await image.read()
        if not raw or len(raw) > _MAX_CAPSULE_BYTES:
            raise HTTPException(status_code=422, detail="Use a camera photo under 6MB")
        suffix = _photo_suffix(raw)
        capsule_id = secrets.token_hex(8)
        filename = f"{capsule_id}{suffix}"
        (capsule_dir / filename).write_bytes(raw)
        card = save_capsule(conn, capsule_id, user["id"], spot_id, f"/media/capsules/{filename}", text)
        return {"capsule": card}

    media_root = Path(path).resolve().parent / "media"
    capsule_dir = media_root / "capsules"
    capsule_dir.mkdir(parents=True, exist_ok=True)
    app.mount("/media", StaticFiles(directory=media_root), name="media")

    return app


def _tag_names(conn) -> list[str]:
    return list_tag_names(conn)


def _tag_aliases(conn) -> dict[str, str]:
    return list_tag_aliases(conn)


def _token_unlocks(conn, token: str | None, spot_id: str) -> bool:
    if not token:
        return False
    row = find_unlock(conn, token)
    if row is None or row["spot_id"] != spot_id:
        raise HTTPException(status_code=403, detail="That unlock token isn't valid")
    return True


def _photo_suffix(raw: bytes) -> str:
    if raw.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if raw.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    raise HTTPException(status_code=422, detail="Use a photo taken with the camera")


def _guard_locked_payload(payload: dict) -> None:
    """未解锁响应里不允许出现全名和票价字段。"""
    if payload.get("unlocked"):
        return
    for key in _SECRET_KEYS:
        if key in payload:
            raise RuntimeError(f"未解锁结果泄漏了 {key}")


app = create_app()
