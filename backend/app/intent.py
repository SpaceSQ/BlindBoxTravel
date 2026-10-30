"""把自然语言收成标签和距离档位。

大模型由 ROBOTZERO 提供。服务器环境变量里有密钥时，把原话发给大模型，
只允许它从 Tags 表里选 3 到 5 个标签。没有服务器密钥或调用失败时，用词表做关键词匹配。
"""

from __future__ import annotations

import json
import os
import re
import sqlite3
import urllib.error
import urllib.request
from dataclasses import dataclass

from app.blind import match_forms
from app.constants import DISTANCE_OPTIONS_MI, LLM_PROVIDER_COMPANY
from app.env import load_env
from app.geo import KM_PER_MILE
from app.repo import get_llm_provider

LLM_TAG_MIN = 3
LLM_TAG_MAX = 5

_MILE_RE = re.compile(r"(\d+(?:\.\d+)?)\s*(?:miles|mile|mi)(?![A-Za-z])", re.IGNORECASE)
_KM_RE = re.compile(r"(\d+(?:\.\d+)?)\s*(?:公里|千米|kilometers?|km)(?!\d)", re.IGNORECASE)
_CN_DISTANCE = (
    ("六千", 6000),
    ("五千", 5000),
    ("四千", 4000),
    ("三千", 3000),
    ("两千", 2000),
    ("二千", 2000),
    ("一千", 1000),
    ("五百", 500),
)


@dataclass
class ParsedIntent:
    tags: list[str]
    max_distance_mi: int | None
    parser: str


@dataclass
class _Lexeme:
    form: str
    canonical: str


def coerce_distance(miles: float) -> int:
    """把口语里的英里数抬到能覆盖它的最小档位，上限 3000。"""
    value = int(round(miles))
    for option in DISTANCE_OPTIONS_MI:
        if value <= option:
            return option
    return DISTANCE_OPTIONS_MI[-1]


def extract_distance_mi(text: str) -> int | None:
    miles = _MILE_RE.search(text)
    if miles:
        return coerce_distance(float(miles.group(1)))
    kilometers = _KM_RE.search(text)
    if kilometers:
        return coerce_distance(float(kilometers.group(1)) / KM_PER_MILE)
    for phrase, km in _CN_DISTANCE:
        if phrase in text and ("公里" in text or "千米" in text or "km" in text.lower()):
            return coerce_distance(km / KM_PER_MILE)
    return None


def _lexemes(tag_names: list[str]) -> list[_Lexeme]:
    items: list[_Lexeme] = []
    seen: set[tuple[str, str]] = set()
    for name in tag_names:
        for form in match_forms(name):
            key = (form.casefold(), name)
            if key in seen:
                continue
            seen.add(key)
            items.append(_Lexeme(form, name))
    items.sort(key=lambda item: len(item.form), reverse=True)
    return items


def _span_ok(folded: str, form: str, start: int, end: int) -> bool:
    """英文标签按词边界匹配，避免 spa 命中 space。"""
    if not form.isascii():
        return True
    before = folded[start - 1] if start else ""
    after = folded[end] if end < len(folded) else ""
    if before.isalnum() or after.isalnum():
        return False
    return True


def extract_tags(text: str, tag_names: list[str], aliases: dict[str, str] | None = None) -> list[str]:
    """按出现顺序抽出标签。短词若被更长的标签整个包住（如「亲子」在「亲子游」里），只保留长词。"""
    folded = text.casefold()
    lexemes = _lexemes(tag_names)
    if aliases:
        seen = {(item.form.casefold(), item.canonical) for item in lexemes}
        for form, canonical in aliases.items():
            key = (form.casefold(), canonical)
            if form and key not in seen:
                lexemes.append(_Lexeme(form, canonical))
                seen.add(key)
        lexemes.sort(key=lambda item: len(item.form), reverse=True)
    matches: list[tuple[int, int, str]] = []
    for lexeme in lexemes:
        form = lexeme.form.casefold()
        if not form:
            continue
        start = 0
        while True:
            index = folded.find(form, start)
            if index < 0:
                break
            end = index + len(form)
            if _span_ok(folded, form, index, end):
                matches.append((index, end, lexeme.canonical))
            start = index + 1
    kept: list[tuple[int, int, str]] = []
    for start, end, name in matches:
        covered = any(
            other_end - other_start > end - start and other_start <= start and other_end >= end
            for other_start, other_end, _other_name in matches
        )
        if not covered:
            kept.append((start, end, name))
    kept.sort()
    ordered: list[str] = []
    for _start, _end, name in kept:
        if name not in ordered:
            ordered.append(name)
    return ordered


def _extract_json_object(text: str) -> dict:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?", "", cleaned).strip()
        cleaned = re.sub(r"```$", "", cleaned).strip()
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("模型没有返回 JSON")
    payload = json.loads(cleaned[start : end + 1])
    if not isinstance(payload, dict):
        raise ValueError("模型返回的不是对象")
    return payload


def _server_provider_ready(conn: sqlite3.Connection | None) -> bool:
    if conn is None:
        return False
    provider = get_llm_provider(conn)
    return (
        provider is not None
        and provider["company"] == LLM_PROVIDER_COMPANY
        and provider["service"] == "llm"
        and provider["user_supplies_key"] is False
        and provider["credential_source"] == "server"
    )


def llm_credentials(conn: sqlite3.Connection | None = None) -> tuple[str, str, str] | None:
    """ROBOTZERO 提供方记录加上服务器环境变量。没有记录或没有密钥时返回空。"""
    load_env()
    if not _server_provider_ready(conn):
        return None
    api_key = os.environ.get("OPENAI_API_KEY", "").strip() or os.environ.get("LLM_API_KEY", "").strip()
    if not api_key:
        return None
    base = (
        os.environ.get("OPENAI_BASE_URL", "").strip()
        or os.environ.get("LLM_BASE_URL", "").strip()
        or "https://api.openai.com/v1"
    ).rstrip("/")
    model = os.environ.get("OPENAI_MODEL", "").strip() or os.environ.get("LLM_MODEL", "").strip() or "gpt-4o-mini"
    return api_key, base, model


def limit_llm_tags(model_tags: list[str], keyword_tags: list[str]) -> list[str]:
    """模型结果最多 5 个；不足 3 个时用原话里命中的标签补足，仍然不发明新词。"""
    chosen: list[str] = []
    for name in model_tags:
        if name not in chosen:
            chosen.append(name)
        if len(chosen) >= LLM_TAG_MAX:
            return chosen
    if len(chosen) >= LLM_TAG_MIN:
        return chosen
    for name in keyword_tags:
        if name not in chosen:
            chosen.append(name)
        if len(chosen) >= LLM_TAG_MIN:
            break
    return chosen[:LLM_TAG_MAX]


def parse_with_llm(
    query: str,
    tag_names: list[str],
    aliases: dict[str, str] | None = None,
    conn: sqlite3.Connection | None = None,
) -> ParsedIntent | None:
    creds = llm_credentials(conn)
    if creds is None:
        return None
    api_key, base, model = creds
    allowed = ", ".join(str(item) for item in DISTANCE_OPTIONS_MI)
    system = (
        "你是盲盒旅游的意图解析器。"
        f"只能从给定标签词表中选出最匹配的 {LLM_TAG_MIN} 到 {LLM_TAG_MAX} 个标签，按相关度从高到低排列。"
        "禁止输出词表以外的词，禁止解释。"
        f"max_distance_mi 只能是这些英里档位之一：{allowed}；"
        "口语里的距离不在档位上时，选能覆盖它的最小档位，超过 3000 则用 3000。"
        "看不出距离就返回 null。只输出 JSON："
        '{"tags":["标签1","标签2","标签3"],"max_distance_mi":null}'
    )
    user = "标签词表：\n" + "、".join(tag_names) + "\n\n用户原话：\n" + query
    body = json.dumps(
        {
            "model": model,
            "temperature": 0,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        }
    ).encode("utf-8")
    request = urllib.request.Request(
        f"{base}/chat/completions",
        data=body,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            raw = json.loads(response.read().decode("utf-8"))
        content = raw["choices"][0]["message"]["content"]
        payload = _extract_json_object(content)
    except (urllib.error.URLError, TimeoutError, KeyError, ValueError, json.JSONDecodeError):
        return None

    known = {name.casefold(): name for name in tag_names}
    for form, canonical in (aliases or {}).items():
        known.setdefault(form.casefold(), canonical)
    tags: list[str] = []
    for item in payload.get("tags") or []:
        if not isinstance(item, str):
            continue
        canonical = known.get(item.strip().casefold())
        if canonical and canonical not in tags:
            tags.append(canonical)
    distance = payload.get("max_distance_mi")
    if distance is None:
        distance = payload.get("max_distance_km")
        if distance is not None:
            try:
                distance = float(distance) / KM_PER_MILE
            except (TypeError, ValueError):
                distance = None
    max_distance: int | None
    if distance is None:
        max_distance = None
    else:
        try:
            max_distance = coerce_distance(float(distance))
        except (TypeError, ValueError):
            max_distance = None
    if not tags:
        return None
    return ParsedIntent(tags=tags, max_distance_mi=max_distance, parser="llm")


def parse_intent(
    query: str,
    tag_names: list[str],
    aliases: dict[str, str] | None = None,
    conn: sqlite3.Connection | None = None,
) -> ParsedIntent:
    keyword_tags = extract_tags(query, tag_names, aliases)
    text_distance = extract_distance_mi(query)
    llm = parse_with_llm(query, tag_names, aliases, conn)
    if llm is not None:
        distance = llm.max_distance_mi if llm.max_distance_mi is not None else text_distance
        return ParsedIntent(tags=limit_llm_tags(llm.tags, keyword_tags), max_distance_mi=distance, parser="llm")
    return ParsedIntent(tags=keyword_tags[:LLM_TAG_MAX], max_distance_mi=text_distance, parser="keyword")
