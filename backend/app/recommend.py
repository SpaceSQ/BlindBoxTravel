"""标签匹配 + 距离筛选。"""

from __future__ import annotations

from dataclasses import dataclass

from app.geo import haversine_km

# 强标签命中即可入选；否则至少命中一半请求标签，才算「匹配度高」。
MIN_MATCH_RATIO = 0.5


@dataclass
class TagHit:
    name: str
    strength: str
    weight: float


@dataclass
class ScoredSpot:
    spot: dict
    distance_km: float
    hits: list[TagHit]
    match_score: float
    match_ratio: float

    @property
    def strong_hits(self) -> int:
        return sum(1 for hit in self.hits if hit.strength == "strong")


def score_spot(requested: list[str], spot_tags: list[dict]) -> tuple[list[TagHit], float, float, bool]:
    if not requested:
        return [], 0.0, 0.0, False
    by_name = {item["name"]: item for item in spot_tags}
    hits = [
        TagHit(name=name, strength=by_name[name]["strength"], weight=float(by_name[name]["weight"]))
        for name in requested
        if name in by_name
    ]
    if not hits:
        return [], 0.0, 0.0, False
    ratio = len(hits) / len(requested)
    score = sum(hit.weight for hit in hits)
    accepted = any(hit.strength == "strong" for hit in hits) or ratio >= MIN_MATCH_RATIO
    return hits, score, ratio, accepted


def recommend_spots(
    spots: list[dict],
    *,
    requested_tags: list[str],
    origin_lat: float,
    origin_lng: float,
    max_distance_km: float,
) -> list[ScoredSpot]:
    ranked: list[ScoredSpot] = []
    for spot in spots:
        distance = haversine_km(origin_lat, origin_lng, spot["lat"], spot["lng"])
        if distance > max_distance_km:
            continue
        hits, score, ratio, accepted = score_spot(requested_tags, spot["tags"])
        if not accepted:
            continue
        ranked.append(
            ScoredSpot(
                spot=spot,
                distance_km=distance,
                hits=hits,
                match_score=score,
                match_ratio=ratio,
            )
        )
    ranked.sort(key=lambda item: (-item.strong_hits, -item.match_score, item.distance_km, item.spot["spot_id"]))
    return ranked


def spots_within_distance(
    spots: list[dict],
    *,
    origin_lat: float,
    origin_lng: float,
    max_distance_km: float,
) -> list[tuple[dict, float]]:
    nearby: list[tuple[dict, float]] = []
    for spot in spots:
        distance = haversine_km(origin_lat, origin_lng, spot["lat"], spot["lng"])
        if distance <= max_distance_km:
            nearby.append((spot, distance))
    nearby.sort(key=lambda item: (item[1], item[0]["spot_id"]))
    return nearby
