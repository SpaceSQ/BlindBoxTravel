"""把 na_travel_poi_full.json 脱敏、改写、打标后写入 SQLite。

只读取本地 JSON。简介由大模型根据中文描述、露营和步道信息重写，不访问维基百科。
前 2 个标签记为强标签（权重 3），其余记为弱标签（权重 1）。

先验证前 20 条：

    cd backend
    .venv/bin/python scripts/import_us_spots.py --limit 20

确认后再去掉 --limit，跑完全部 5234 条。并发固定为 8。
每成功写入 10 条，把 name_en 追加进项目根目录的 na_attractions.checkpoint.json。
再次运行会跳过已经记入的景点。
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import random
import re
import ssl
import sys
import uuid
from pathlib import Path

import certifi

BACKEND_ROOT = Path(__file__).resolve().parents[1]
PROJECT_ROOT = BACKEND_ROOT.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.db import DEFAULT_DB_PATH, connect, init_schema  # noqa: E402
from app.env import load_env  # noqa: E402
from app.intent import llm_credentials  # noqa: E402
from app.seed import _upsert_spot, seed  # noqa: E402

DOWNLOADS_SOURCE = Path("/Users/David1/Downloads/na_travel_poi_full.json")
CHECKPOINT_PATH = Path(os.environ.get("US_SPOTS_CHECKPOINT", PROJECT_ROOT / "na_attractions.checkpoint.json"))
CONCURRENCY = 8
CHECKPOINT_EVERY = 10
IMAGE_FALLBACK = "https://source.unsplash.com/random/800x600/?nature,travel"
UNAVAILABLE_WEATHER = {"status": "unavailable", "message": "Weather is unavailable right now"}
SYSTEM_PROMPT = (
    "You are an expert travel copywriter for the 'Mystery Getaway' app. "
    "Input: A JSON object containing Chinese descriptions, trails, and camping info for a North American destination. "
    "Task 1: Write a captivating, vibe-focused 100-word English description that emphasizes escapism, scenery, and activities. "
    "DO NOT mention the exact name of the park/location. "
    "Task 2: Select strictly 3 to 5 tags from the provided [North American V2.0 Tag Library]. "
    'Output MUST be valid JSON: {"description_en": "...", "tags": ["tag1", "tag2", ...]}.'
)
_CONTEXT_LIMIT = 1800


def generate_blind_name(full_name: str) -> str:
    """
    Lossless, deterministic masking algorithm for English POI names.
    Rule: Keep the 1st letter + randomly keep 1 or 2 consonants in the rest of the word. Replace others with '*'.
    """
    # Use the name itself as the random seed to ensure deterministic output across runs.
    # Restore the previous generator state so one name does not change later draws.
    state = random.getstate()
    try:
        random.seed(full_name)

        words = full_name.split(" ")
        blind_words = []
        consonants_set = set("bcdfghjklmnpqrstvwxyzBCDFGHJKLMNPQRSTVWXYZ")

        for word in words:
            if len(word) <= 1:
                blind_words.append(word)
                continue

            first_char = word[0]
            rest = word[1:]

            # Identify indices of consonants in the remainder of the word
            consonants_indices = [i for i, c in enumerate(rest) if c in consonants_set]

            # Decide how many consonants to keep (1 or 2)
            if len(consonants_indices) >= 2:
                keep_count = random.choice([1, 2])
            else:
                keep_count = len(consonants_indices)

            keep_indices = set(random.sample(consonants_indices, keep_count)) if consonants_indices else set()

            # Construct the masked word
            masked_rest = "".join([c if i in keep_indices else "*" for i, c in enumerate(rest)])
            blind_words.append(first_char + masked_rest)

        return " ".join(blind_words)
    finally:
        random.setstate(state)


def resolve_source(explicit: str | None = None) -> Path:
    if explicit:
        return Path(explicit)
    env = os.environ.get("US_SPOTS_SOURCE", "").strip()
    if env:
        return Path(env)
    local = PROJECT_ROOT / "na_travel_poi_full.json"
    if local.exists():
        return local
    return DOWNLOADS_SOURCE


def load_pois(path: Path) -> list[dict]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, list):
        raise ValueError(f"{path} 应是景点数组")
    return payload


def load_checkpoint(path: Path) -> list[str]:
    if not path.exists():
        return []
    payload = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(payload, list):
        return [str(item) for item in payload if str(item).strip()]
    done = payload.get("done", [])
    return [str(item) for item in done if str(item).strip()]


def save_checkpoint(path: Path, names: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(names, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)


def _clip(value: object) -> str:
    text = str(value or "").strip()
    if len(text) <= _CONTEXT_LIMIT:
        return text
    return text[:_CONTEXT_LIMIT]


def prompt_context(poi: dict) -> dict:
    return {
        "description_zh": _clip(poi.get("description_zh")),
        "camping_info": _clip(poi.get("camping_info")),
        "trails_info": _clip(poi.get("trails_info")),
    }


def parse_llm_object(text: str) -> dict:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?", "", cleaned).strip()
        cleaned = re.sub(r"```$", "", cleaned).strip()
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("模型没有返回 JSON 对象")
    payload = json.loads(cleaned[start : end + 1])
    if not isinstance(payload, dict):
        raise ValueError("模型返回的不是对象")
    return payload


def _canonical_tag(raw: str, allowed: set[str], aliases: dict[str, str]) -> str | None:
    text = raw.strip().strip("\"'")
    if not text:
        return None
    candidates = [text]
    if "|" in text:
        candidates.extend(part.strip() for part in text.split("|"))
    for candidate in candidates:
        if candidate in allowed:
            return candidate
        mapped = aliases.get(candidate) or aliases.get(candidate.casefold())
        if mapped in allowed:
            return mapped
    return None


def assign_strengths(raw_names: list[str], allowed: set[str], aliases: dict[str, str] | None = None) -> list[dict]:
    """丢掉词表以外的标签。前 2 个是强标签，后面是弱标签，一共保留 3 到 5 个。"""
    lookup = aliases or {}
    chosen: list[str] = []
    for raw in raw_names:
        name = _canonical_tag(str(raw), allowed, lookup)
        if name and name not in chosen:
            chosen.append(name)
        if len(chosen) == 5:
            break
    if len(chosen) < 3:
        raise ValueError(f"有效标签不足 3 个：{chosen}")
    return [
        {"name": name, "type": "strong" if index < 2 else "weak"}
        for index, name in enumerate(chosen)
    ]


def _words(text: str, limit: int = 100) -> str:
    parts = text.split()
    if len(parts) <= limit:
        return " ".join(parts)
    return " ".join(parts[:limit])


def scrub_names(text: str, full_name: str, name_zh: str) -> str:
    cleaned = text
    for needle in (full_name, name_zh):
        token = needle.strip()
        if len(token) < 2:
            continue
        cleaned = re.sub(re.escape(token), "this destination", cleaned, flags=re.IGNORECASE)
    return cleaned


def ticket_price(value: object) -> int:
    if value is None:
        return 0
    if isinstance(value, str) and value.strip().lower() in {"", "unknown", "null", "n/a", "none"}:
        return 0
    try:
        amount = int(round(float(value)))
    except (TypeError, ValueError):
        return 0
    return max(0, amount)


def image_url(value: object) -> str:
    text = str(value or "").strip()
    return text or IMAGE_FALLBACK


def place_text(value: object, fallback: str) -> str:
    text = str(value or "").strip()
    return text or fallback


def spot_id_for(full_name: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"mystery-getaway:{full_name.casefold()}"))


def build_spot(poi: dict, description_en: str, tags: list[dict]) -> dict:
    full_name = str(poi.get("name_en") or "").strip()
    if not full_name:
        raise ValueError("缺少 name_en")
    try:
        lat = float(poi["lat"])
        lng = float(poi["lon"])
    except (KeyError, TypeError, ValueError) as exc:
        raise ValueError(f"{full_name} 缺少有效坐标") from exc
    province = place_text(poi.get("state_province"), place_text(poi.get("country"), "North America"))
    city = place_text(poi.get("city"), province)
    description = scrub_names(_words(description_en), full_name, str(poi.get("name_zh") or ""))
    if not description:
        raise ValueError(f"{full_name} 的英文简介为空")
    return {
        "spot_id": spot_id_for(full_name),
        "full_name": full_name,
        "blind_name": generate_blind_name(full_name),
        "province": province,
        "city": city,
        "location": {"lat": lat, "lng": lng},
        "description": description,
        "summary_100w": description,
        "image_url": image_url(poi.get("photo_url")),
        "adult_ticket_price": ticket_price(poi.get("fee_amount_usd")),
        "mock_weather": UNAVAILABLE_WEATHER,
        "tags": tags,
    }


async def process_poi_via_llm(session, poi_data: dict, api_key: str, *, base_url: str, model: str, tag_names: list[str]) -> dict:
    """让大模型重写英文简介，并只从北美标签库里选 3 到 5 个标签。"""
    user = {
        "instruction": "Copy 3 to 5 tags exactly from tag_library. Prefer the Chinese tag before the vertical bar.",
        "tag_library": tag_names,
        "destination": prompt_context(poi_data),
    }
    payload = {
        "model": model,
        "temperature": 0.4,
        "max_tokens": 600,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": json.dumps(user, ensure_ascii=False)},
        ],
    }
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    async with session.post(
        f"{base_url.rstrip('/')}/chat/completions",
        json=payload,
        headers=headers,
        timeout=90,
    ) as response:
        body = await response.text()
        if response.status >= 400:
            raise RuntimeError(f"大模型接口返回 {response.status}")
    data = json.loads(body)
    content = data["choices"][0]["message"]["content"]
    parsed = parse_llm_object(content)
    description = str(parsed.get("description_en") or "").strip()
    tags = parsed.get("tags")
    if not description or not isinstance(tags, list):
        raise ValueError("模型结果缺少 description_en 或 tags")
    return {"description_en": description, "tags": [str(item) for item in tags]}


async def import_pois(
    pois: list[dict],
    conn,
    names: list[str],
    aliases: dict[str, str],
    *,
    checkpoint: Path,
    complete,
    concurrency: int = CONCURRENCY,
) -> dict:
    """complete(poi) 返回 {"description_en", "tags"}。写入成功的 name_en 记入断点。"""
    done = load_checkpoint(checkpoint)
    return await _run_import(
        pois,
        conn,
        set(names),
        aliases,
        checkpoint,
        complete,
        concurrency,
        done,
        set(done),
    )


async def _run_import(pois, conn, allowed, aliases, checkpoint, complete, concurrency, done, done_set) -> dict:
    imported = 0
    skipped = 0
    failed: list[str] = []
    written_since_flush = 0
    claimed: set[str] = set()
    lock = asyncio.Lock()
    semaphore = asyncio.Semaphore(concurrency)
    try:
        from tqdm import tqdm
    except ImportError:
        tqdm = None
    progress = tqdm(total=len(pois), desc="import pois") if tqdm else None

    async def handle(poi: dict) -> None:
        nonlocal imported, skipped, written_since_flush
        full_name = str(poi.get("name_en") or "").strip()
        async with lock:
            if full_name and (full_name in done_set or full_name in claimed):
                skipped += 1
                already = True
            elif full_name:
                claimed.add(full_name)
                already = False
            else:
                already = False
        if already:
            if progress:
                progress.update(1)
            return
        try:
            async with semaphore:
                result = await complete(poi)
            tags = assign_strengths(result["tags"], allowed, aliases)
            spot = build_spot(poi, result["description_en"], tags)
            async with lock:
                _upsert_spot(conn, spot, catalog=False)
                conn.commit()
                done.append(spot["full_name"])
                done_set.add(spot["full_name"])
                claimed.discard(spot["full_name"])
                imported += 1
                written_since_flush += 1
                if written_since_flush >= CHECKPOINT_EVERY:
                    save_checkpoint(checkpoint, done)
                    written_since_flush = 0
        except Exception as exc:
            label = full_name or str(poi.get("place_id") or "unknown")
            failed.append(f"{label}: {exc}")
            if full_name:
                async with lock:
                    claimed.discard(full_name)
        if progress:
            progress.update(1)

    await asyncio.gather(*(handle(poi) for poi in pois))
    if written_since_flush:
        save_checkpoint(checkpoint, done)
    if progress:
        progress.close()
    return {"imported": imported, "skipped": skipped, "failed": failed}


def _alias_index(pairs: dict[str, str]) -> dict[str, str]:
    index: dict[str, str] = {}
    for english, chinese in pairs.items():
        text = english.strip()
        if not text:
            continue
        index[text] = chinese
        index[text.casefold()] = chinese
    return index


def run(limit: int | None = None, source: str | None = None) -> dict:
    load_env()
    path = resolve_source(source)
    pois = load_pois(path)
    if limit is not None:
        pois = pois[:limit]
    conn = connect(DEFAULT_DB_PATH)
    conn.execute("PRAGMA busy_timeout = 5000")
    init_schema(conn)
    seed(conn)
    credentials = llm_credentials(conn)
    if credentials is None:
        raise SystemExit("缺少 OPENAI_API_KEY 或 LLM_API_KEY，无法调用大模型。")
    api_key, base_url, model = credentials
    tag_rows = conn.execute(
        "SELECT name, name_en FROM tags WHERE region = 'na' ORDER BY name"
    ).fetchall()
    names = [row["name"] for row in tag_rows]
    aliases = _alias_index({row["name_en"]: row["name"] for row in tag_rows if row["name_en"]})
    library = [
        f"{row['name']} | {row['name_en']}" if row["name_en"] else row["name"]
        for row in tag_rows
    ]

    async def main() -> dict:
        import aiohttp

        timeout = aiohttp.ClientTimeout(total=120)
        connector = aiohttp.TCPConnector(ssl=ssl.create_default_context(cafile=certifi.where()))
        async with aiohttp.ClientSession(timeout=timeout, connector=connector) as session:
            async def complete(poi: dict) -> dict:
                last_error: Exception | None = None
                for attempt in range(5):
                    try:
                        return await process_poi_via_llm(
                            session,
                            poi,
                            api_key,
                            base_url=base_url,
                            model=model,
                            tag_names=library,
                        )
                    except Exception as exc:
                        last_error = exc
                        text = str(exc)
                        transient = any(code in text for code in ("429", "500", "502", "503", "504"))
                        if attempt == 4 or (not transient and attempt >= 1):
                            break
                        await asyncio.sleep((2 ** attempt) if transient else 1)
                assert last_error is not None
                raise last_error

            return await import_pois(
                pois,
                conn,
                names,
                aliases,
                checkpoint=CHECKPOINT_PATH,
                complete=complete,
            )

    return asyncio.run(main())


def main() -> None:
    parser = argparse.ArgumentParser(description="Import North American POIs from the local JSON file.")
    parser.add_argument("--limit", type=int, default=None, help="Only process the first N records.")
    parser.add_argument("--source", default=None, help="Path to na_travel_poi_full.json.")
    args = parser.parse_args()
    summary = run(limit=args.limit, source=args.source)
    print(
        json.dumps(
            {
                "imported": summary["imported"],
                "skipped": summary["skipped"],
                "failed": len(summary["failed"]),
                "failures": summary["failed"][:10],
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
