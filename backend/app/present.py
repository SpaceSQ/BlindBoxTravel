"""对外只露出盲盒形态。未解锁时不返回全名、票价和精确坐标。"""

from __future__ import annotations

from app.blind import redact_full_name
from app.geo import km_to_miles
from app.recommend import ScoredSpot

_NARRATIVE = ("description", "summary_100w", "events_and_discounts", "ai_strategy", "tag_interpretation")
_DETAIL_FIELDS = ("events_and_discounts", "ai_strategy", "tag_interpretation")


def _number(value: float) -> int | float:
    if float(value).is_integer():
        return int(value)
    return round(value, 2)


_UNUSABLE_IMAGE_SUFFIX = (".pdf", ".svg", ".tif", ".tiff", ".html", ".htm")


def single_image(value: object) -> str | None:
    """每个景点只对外露出一张图。"""
    if isinstance(value, list):
        value = next((item for item in value if isinstance(item, str) and item.strip()), None)
    if not isinstance(value, str):
        return None
    text = value.strip()
    return text or None


def usable_image_url(value: object) -> str | None:
    """雷达只收下能直接打开的照片。空地址、示例域名和文档扫描件都不算。"""
    text = single_image(value)
    if text is None:
        return None
    lowered = text.lower()
    if not lowered.startswith(("http://", "https://")):
        return None
    if "example.com" in lowered:
        return None
    path = lowered.split("?", 1)[0]
    if path.endswith(_UNUSABLE_IMAGE_SUFFIX):
        return None
    return text


def present_spot(
    spot: dict,
    *,
    unlocked: bool,
    distance_km: float | None = None,
    scored: ScoredSpot | None = None,
    detail: bool = False,
) -> dict:
    full_name = spot["full_name"]
    payload: dict = {
        "spot_id": spot["spot_id"],
        "display_name": full_name if unlocked else spot["blind_name"],
        "unlocked": unlocked,
        "can_review": unlocked,
        "province": spot["province"],
        "city": spot["city"],
        "summary_100w": redact_full_name(spot["summary_100w"], full_name),
        "description": redact_full_name(spot["description"], full_name),
        "image_url": single_image(spot.get("image_url")),
        "tags": [_public_tag(tag) for tag in spot["tags"]],
    }
    if distance_km is not None:
        payload["distance_mi"] = round(km_to_miles(distance_km), 1)
    if scored is not None:
        by_name = {tag["name"]: tag for tag in spot["tags"]}
        payload["matched_tags"] = [
            _public_tag({**by_name.get(hit.name, {}), "name": hit.name, "strength": hit.strength, "weight": hit.weight})
            for hit in scored.hits
        ]
        payload["match_score"] = _number(scored.match_score)
        payload["match_ratio"] = round(scored.match_ratio, 2)
    if detail or unlocked:
        for key in _DETAIL_FIELDS:
            value = spot.get(key)
            if key in _NARRATIVE and isinstance(value, str):
                value = redact_full_name(value, full_name)
            payload[key] = value
    if unlocked:
        payload["full_name"] = full_name
        payload["adult_ticket_price"] = spot["adult_ticket_price"]
        payload["location"] = {"lat": spot["lat"], "lng": spot["lng"]}
    return payload


def _public_tag(tag: dict) -> dict:
    return {
        "name": tag["name"],
        "name_en": tag.get("name_en") or "",
        "strength": tag["strength"],
        "weight": _number(tag["weight"]),
    }


def radar_card(spot: dict, match_score: int = 0) -> dict:
    """雷达和心愿单只给未解锁卡片：一张图、强标签、两字盲盒名。"""
    payload = present_spot(spot, unlocked=False)
    payload["strong_tags"] = [tag["name"] for tag in spot["tags"] if tag["strength"] == "strong"]
    payload["match_score"] = match_score
    return payload
