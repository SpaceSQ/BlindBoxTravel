"""SQLite 连接与建表。"""

from __future__ import annotations

import sqlite3
from pathlib import Path

SCHEMA_PATH = Path(__file__).resolve().parent / "schema.sql"
DEFAULT_DB_PATH = Path(__file__).resolve().parent / "data" / "blindbox.sqlite"


def connect(path: str | Path) -> sqlite3.Connection:
    db_path = Path(path)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def _column_names(conn: sqlite3.Connection, table: str) -> set[str]:
    return {row["name"] for row in conn.execute(f"PRAGMA table_info({table})")}


def _add_column(conn: sqlite3.Connection, table: str, name: str, definition: str) -> None:
    if name not in _column_names(conn, table):
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {name} {definition}")


def init_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
    _add_column(conn, "trip_plans", "client_id", "TEXT NOT NULL DEFAULT ''")
    _add_column(conn, "trip_plans", "user_id", "INTEGER")
    _add_column(conn, "reviews", "user_id", "INTEGER")
    _add_column(conn, "users", "apple_sub", "TEXT")
    _add_column(conn, "users", "google_sub", "TEXT")
    _add_column(conn, "tags", "name_en", "TEXT NOT NULL DEFAULT ''")
    _add_column(conn, "tags", "region", "TEXT NOT NULL DEFAULT 'na'")
    _add_column(conn, "spots", "catalog_spot", "INTEGER NOT NULL DEFAULT 0")
    _add_column(conn, "purchase_history", "product_id", "TEXT NOT NULL DEFAULT ''")
    _add_column(conn, "purchase_history", "store_transaction_id", "TEXT NOT NULL DEFAULT ''")
    conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_apple_sub ON users(apple_sub) WHERE apple_sub IS NOT NULL")
    conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub ON users(google_sub) WHERE google_sub IS NOT NULL")
    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_purchases_txn ON purchase_history(store_transaction_id) WHERE store_transaction_id != ''"
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_trip_plans_client ON trip_plans(client_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_trip_plans_user ON trip_plans(user_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_reviews_user ON reviews(user_id)")
    conn.commit()
