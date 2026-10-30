"""账号、会话和会员。密码只存盐和摘要。"""

from __future__ import annotations

import calendar
import hashlib
import hmac
import os
import re
import secrets
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

FREE_UNLOCK_LIMIT = 3
VIP_PLANS = {
    "monthly": {"title": "Monthly", "amount_cents": 499, "months": 1, "product_id": "vip_month_usd"},
    "quarterly": {"title": "Quarterly", "amount_cents": 1299, "months": 3, "product_id": "vip_quarter_usd"},
    "yearly": {"title": "Yearly", "amount_cents": 3999, "months": 12, "product_id": "vip_year_usd"},
}

PHONE_PATTERN = r"^(?:1\d{10}|[2-9]\d{9})$"
_PHONE = re.compile(PHONE_PATTERN)


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 120_000)
    return f"{salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    salt_hex, _, digest_hex = stored.partition("$")
    if not salt_hex or not digest_hex:
        return False
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt_hex), 120_000)
    return hmac.compare_digest(digest.hex(), digest_hex)


def add_months(moment: datetime, months: int) -> datetime:
    month_index = moment.month - 1 + months
    year = moment.year + month_index // 12
    month = month_index % 12 + 1
    day = min(moment.day, calendar.monthrange(year, month)[1])
    return moment.replace(year=year, month=month, day=day)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def vip_active(user: sqlite3.Row | dict) -> bool:
    if not user["is_vip"] or not user["vip_expires_at"]:
        return False
    try:
        expires = datetime.strptime(user["vip_expires_at"], "%Y-%m-%d %H:%M:%S")
    except ValueError:
        return False
    return expires > _utcnow()


def sign_in_method(phone: str) -> str:
    value = phone or ""
    if value.startswith("apple:"):
        return "apple"
    if value.startswith("google:"):
        return "google"
    return "phone"


def public_user(user: sqlite3.Row) -> dict:
    active = vip_active(user)
    raw_phone = user["phone"] or ""
    phone = raw_phone if _PHONE.fullmatch(raw_phone) else ""
    return {
        "id": user["id"],
        "phone": phone,
        "sign_in": sign_in_method(raw_phone),
        "nickname": user["nickname"],
        "unlock_count": user["unlock_count"],
        "unlock_limit": FREE_UNLOCK_LIMIT,
        "is_vip": active,
        "vip_expires_at": user["vip_expires_at"] if active else None,
    }


def create_user(conn: sqlite3.Connection, phone: str, password: str, nickname: str) -> tuple[str, sqlite3.Row]:
    conn.execute(
        "INSERT INTO users (phone, password_hash, nickname) VALUES (?, ?, ?)",
        (phone, hash_password(password), nickname),
    )
    user = conn.execute("SELECT * FROM users WHERE phone = ?", (phone,)).fetchone()
    token = _open_session(conn, user["id"])
    conn.commit()
    return token, user


def authenticate(conn: sqlite3.Connection, phone: str, password: str) -> tuple[str, sqlite3.Row] | None:
    user = conn.execute("SELECT * FROM users WHERE phone = ?", (phone,)).fetchone()
    if user is None or not verify_password(password, user["password_hash"]):
        return None
    token = _open_session(conn, user["id"])
    conn.commit()
    return token, user


def user_from_token(conn: sqlite3.Connection, token: str) -> sqlite3.Row | None:
    return conn.execute(
        """
        SELECT u.* FROM sessions s
        JOIN users u ON u.id = s.user_id
        WHERE s.token = ?
        """,
        (token,),
    ).fetchone()


def update_nickname(conn: sqlite3.Connection, user_id: int, nickname: str) -> sqlite3.Row:
    conn.execute("UPDATE users SET nickname = ? WHERE id = ?", (nickname, user_id))
    conn.commit()
    return conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()


def list_purchases(conn: sqlite3.Connection, user_id: int) -> list[dict]:
    rows = conn.execute(
        """
        SELECT id, plan_code, title, amount_yuan, vip_expires_at, purchased_at
        FROM purchase_history WHERE user_id = ? ORDER BY id DESC
        """,
        (user_id,),
    ).fetchall()
    records = []
    for row in rows:
        item = dict(row)
        cents = item.pop("amount_yuan")
        item["amount_usd"] = cents / 100
        records.append(item)
    return records


def purchase_vip(
    conn: sqlite3.Connection,
    user: sqlite3.Row,
    plan_code: str,
    product_id: str,
    store_transaction_id: str,
) -> sqlite3.Row:
    plan = VIP_PLANS[plan_code]
    if product_id != plan["product_id"]:
        raise ValueError("That product doesn't match this plan")
    existing = conn.execute(
        "SELECT user_id FROM purchase_history WHERE store_transaction_id = ?",
        (store_transaction_id,),
    ).fetchone()
    if existing is not None:
        if existing["user_id"] != user["id"]:
            raise ValueError("That store transaction is already tied to another account")
        return conn.execute("SELECT * FROM users WHERE id = ?", (user["id"],)).fetchone()
    now = _utcnow().replace(microsecond=0)
    start = now
    if vip_active(user):
        start = datetime.strptime(user["vip_expires_at"], "%Y-%m-%d %H:%M:%S")
    expires = add_months(start, plan["months"]).strftime("%Y-%m-%d %H:%M:%S")
    conn.execute(
        "UPDATE users SET is_vip = 1, vip_expires_at = ? WHERE id = ?",
        (expires, user["id"]),
    )
    conn.execute(
        """
        INSERT INTO purchase_history (
            user_id, plan_code, title, amount_yuan, vip_expires_at, product_id, store_transaction_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (user["id"], plan_code, plan["title"], plan["amount_cents"], expires, product_id, store_transaction_id),
    )
    conn.commit()
    return conn.execute("SELECT * FROM users WHERE id = ?", (user["id"],)).fetchone()


DEV_PHONE = "2125550199"
DEV_NICKNAME = "Test user"


def dev_login_allowed() -> bool:
    return os.environ.get("ALLOW_DEV_LOGIN", "").strip() == "1"


def login_dev_user(conn: sqlite3.Connection) -> tuple[str, sqlite3.Row]:
    """固定测试号。已存在就接着用，行程和点赞留在同一个账号上。"""
    found = conn.execute("SELECT * FROM users WHERE phone = ?", (DEV_PHONE,)).fetchone()
    if found is None:
        try:
            return create_user(conn, DEV_PHONE, secrets.token_urlsafe(24), DEV_NICKNAME)
        except sqlite3.IntegrityError:
            found = conn.execute("SELECT * FROM users WHERE phone = ?", (DEV_PHONE,)).fetchone()
            if found is None:
                raise
    token = _open_session(conn, found["id"])
    conn.commit()
    return token, found


def login_with_apple(conn: sqlite3.Connection, apple_sub: str, nickname: str) -> tuple[str, sqlite3.Row]:
    found = conn.execute("SELECT * FROM users WHERE apple_sub = ?", (apple_sub,)).fetchone()
    if found is not None:
        token = _open_session(conn, found["id"])
        conn.commit()
        return token, found
    label = nickname.strip()[:20] or "Traveler"
    conn.execute(
        "INSERT INTO users (phone, password_hash, nickname, apple_sub) VALUES (?, ?, ?, ?)",
        (f"apple:{apple_sub}", hash_password(secrets.token_urlsafe(24)), label, apple_sub),
    )
    user = conn.execute("SELECT * FROM users WHERE apple_sub = ?", (apple_sub,)).fetchone()
    token = _open_session(conn, user["id"])
    conn.commit()
    return token, user


def login_with_google(conn: sqlite3.Connection, google_sub: str, nickname: str) -> tuple[str, sqlite3.Row]:
    found = conn.execute("SELECT * FROM users WHERE google_sub = ?", (google_sub,)).fetchone()
    if found is not None:
        token = _open_session(conn, found["id"])
        conn.commit()
        return token, found
    label = nickname.strip()[:20] or "Traveler"
    conn.execute(
        "INSERT INTO users (phone, password_hash, nickname, google_sub) VALUES (?, ?, ?, ?)",
        (f"google:{google_sub}", hash_password(secrets.token_urlsafe(24)), label, google_sub),
    )
    user = conn.execute("SELECT * FROM users WHERE google_sub = ?", (google_sub,)).fetchone()
    token = _open_session(conn, user["id"])
    conn.commit()
    return token, user


def delete_user(conn: sqlite3.Connection, user_id: int) -> None:
    images = conn.execute("SELECT image_url FROM time_capsules WHERE user_id = ?", (user_id,)).fetchall()
    plan_ids = conn.execute("SELECT id FROM trip_plans WHERE user_id = ?", (user_id,)).fetchall()
    for row in plan_ids:
        conn.execute("DELETE FROM plan_shares WHERE plan_id = ?", (row["id"],))
    conn.execute("DELETE FROM trip_plans WHERE user_id = ?", (user_id,))
    conn.execute("DELETE FROM reviews WHERE user_id = ?", (user_id,))
    conn.execute("DELETE FROM purchase_history WHERE user_id = ?", (user_id,))
    conn.execute("DELETE FROM time_capsules WHERE user_id = ?", (user_id,))
    conn.execute("DELETE FROM user_wishlists WHERE user_id = ?", (user_id,))
    conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
    conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
    conn.commit()
    database = conn.execute("PRAGMA database_list").fetchone()
    media = Path(database["file"]).parent / "media" / "capsules"
    for row in images:
        path = media / Path(row["image_url"]).name
        if path.is_file():
            path.unlink()


def _open_session(conn: sqlite3.Connection, user_id: int) -> str:
    token = secrets.token_urlsafe(24)
    conn.execute("INSERT INTO sessions (token, user_id) VALUES (?, ?)", (token, user_id))
    return token
