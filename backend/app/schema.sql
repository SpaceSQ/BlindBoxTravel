-- 盲盒旅游：标签词表、景点、景点-标签权重、解锁行程

CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    name_en TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL CHECK (source IN ('catalog', 'spot')),
    region TEXT NOT NULL DEFAULT 'na',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 同一标签可属于多个维度（如「赶海」同时在气象与体验中出现）
CREATE TABLE IF NOT EXISTS tag_dimensions (
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    dimension_key TEXT NOT NULL,
    dimension_label TEXT NOT NULL,
    PRIMARY KEY (tag_id, dimension_key)
);

CREATE TABLE IF NOT EXISTS spots (
    spot_id TEXT PRIMARY KEY,
    full_name TEXT NOT NULL,
    blind_name TEXT NOT NULL,
    province TEXT NOT NULL,
    city TEXT NOT NULL,
    lat REAL NOT NULL CHECK (lat BETWEEN -90 AND 90),
    lng REAL NOT NULL CHECK (lng BETWEEN -180 AND 180),
    description TEXT NOT NULL,
    summary_100w TEXT NOT NULL,
    image_url TEXT,
    adult_ticket_price INTEGER NOT NULL CHECK (adult_ticket_price >= 0),
    mock_weather_json TEXT NOT NULL,
    events_and_discounts TEXT,
    ai_strategy TEXT,
    tag_interpretation TEXT,
    catalog_spot INTEGER NOT NULL DEFAULT 0
);

-- strength：强标签决定核心特征，弱标签补充特征
-- weight：强 3 / 弱 1，供匹配打分
CREATE TABLE IF NOT EXISTS spot_tags (
    spot_id TEXT NOT NULL REFERENCES spots(spot_id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags(id),
    strength TEXT NOT NULL CHECK (strength IN ('strong', 'weak')),
    weight REAL NOT NULL CHECK (weight > 0),
    position INTEGER NOT NULL,
    PRIMARY KEY (spot_id, tag_id)
);

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    nickname TEXT NOT NULL DEFAULT '',
    unlock_count INTEGER NOT NULL DEFAULT 0,
    is_vip INTEGER NOT NULL DEFAULT 0,
    vip_expires_at TEXT,
    apple_sub TEXT,
    google_sub TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS trip_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    unlock_token TEXT NOT NULL UNIQUE,
    spot_id TEXT NOT NULL REFERENCES spots(spot_id),
    client_id TEXT NOT NULL DEFAULT '',
    user_id INTEGER REFERENCES users(id),
    plan_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS plan_shares (
    token TEXT PRIMARY KEY,
    plan_id INTEGER NOT NULL REFERENCES trip_plans(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    spot_id TEXT NOT NULL REFERENCES spots(spot_id),
    client_id TEXT NOT NULL DEFAULT '',
    user_id INTEGER REFERENCES users(id),
    rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS purchase_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    plan_code TEXT NOT NULL,
    title TEXT NOT NULL,
    amount_yuan INTEGER NOT NULL,
    vip_expires_at TEXT NOT NULL,
    product_id TEXT NOT NULL DEFAULT '',
    store_transaction_id TEXT NOT NULL DEFAULT '',
    purchased_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS time_capsules (
    capsule_id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    spot_id TEXT NOT NULL REFERENCES spots(spot_id),
    image_url TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS user_wishlists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    spot_id TEXT NOT NULL REFERENCES spots(spot_id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (user_id, spot_id)
);

-- 大模型使用方。只记录由哪家公司提供，不存放密钥或接口地址。
CREATE TABLE IF NOT EXISTS llm_providers (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    company TEXT NOT NULL,
    service TEXT NOT NULL DEFAULT 'llm',
    user_supplies_key INTEGER NOT NULL DEFAULT 0 CHECK (user_supplies_key = 0),
    credential_source TEXT NOT NULL DEFAULT 'server' CHECK (credential_source = 'server'),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tag_dimensions_key ON tag_dimensions(dimension_key);
CREATE INDEX IF NOT EXISTS idx_spot_tags_tag ON spot_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_trip_plans_spot ON trip_plans(spot_id);
CREATE INDEX IF NOT EXISTS idx_reviews_spot ON reviews(spot_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_purchases_user ON purchase_history(user_id);
CREATE INDEX IF NOT EXISTS idx_wishlists_user ON user_wishlists(user_id);
CREATE INDEX IF NOT EXISTS idx_capsules_spot ON time_capsules(spot_id);
