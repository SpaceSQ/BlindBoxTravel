"""和风天气：地点、当天预报、地级市空气质量。

先用 GeoAPI 把经纬度换成景点 Location ID，再查出上级地级市。
每日预报走 /v7/weather/3d。空气质量的 /v7/air/5d 已停服，改用现行
/airquality/v1/daily，坐标取地级市中心。

没有密钥或任一请求失败时，只返回缺省说明，不把异常抛给详情接口。
"""

from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request
from typing import Literal
from urllib.parse import urlencode

from pydantic import BaseModel, Field

from app.env import load_env

WAITING_FOR_KEY = "Add a real weather key to see today's forecast"
WAITING_FOR_HOST = "Add QWEATHER_API_HOST to see today's forecast"
WEATHER_UNAVAILABLE = "Weather is unavailable right now"

DAY_PERIOD = "07:00-19:00"
NIGHT_PERIOD = "19:00-07:00 next day"

_HOST_RE = re.compile(r"^[A-Za-z0-9.-]+$")
_GENERIC_AQI = {"qaqi", "us-epa", "us-epa-nc", "eu-eea"}
_CATEGORY_ZH = {
    "excellent": "Excellent",
    "good": "Good",
    "fair": "Fair",
    "moderate": "Moderate",
    "poor": "Unhealthy for sensitive groups",
    "unhealthy for sensitive groups": "Unhealthy for sensitive groups",
    "unhealthy": "Unhealthy",
    "very unhealthy": "Very unhealthy",
    "hazardous": "Hazardous",
    "优": "Excellent",
    "良": "Good",
    "轻度污染": "Unhealthy for sensitive groups",
    "中度污染": "Unhealthy",
    "重度污染": "Very unhealthy",
    "严重污染": "Hazardous",
}


class WeatherError(Exception):
    pass


class WeatherSlice(BaseModel):
    period: str
    text: str | None = None
    pop: str | None = None
    precip: str | None = None
    wind_dir: str | None = None
    wind_scale: str | None = None


class AirBrief(BaseModel):
    aqi: str | None = None
    category: str | None = None
    city_name: str | None = None


class SpotWeather(BaseModel):
    status: Literal["ok", "unavailable"]
    message: str | None = None
    source: Literal["qweather", "open-meteo"] | None = None
    location_id: str | None = None
    location_name: str | None = None
    city_id: str | None = None
    city_name: str | None = None
    temp_max: str | None = None
    temp_min: str | None = None
    uv_index: str | None = None
    precip_scope: Literal["all_day", "split"] | None = None
    precip_unit: Literal["mm", "in"] = "mm"
    day: WeatherSlice | None = None
    night: WeatherSlice | None = None
    air: AirBrief | None = None
    attributions: list[str] = Field(default_factory=list)


def unavailable(message: str) -> dict:
    return {"status": "unavailable", "message": message}


def public_weather(weather: SpotWeather) -> dict:
    if weather.status != "ok":
        return unavailable(weather.message or WEATHER_UNAVAILABLE)
    return weather.model_dump()


def _text(value: object) -> str | None:
    if value is None or isinstance(value, bool):
        return None
    text = str(value).strip()
    return text or None


def _category(value: object) -> str | None:
    text = _text(value)
    if text is None:
        return None
    return _CATEGORY_ZH.get(text.lower(), text)


def _sources(payload: dict) -> list[str]:
    found: list[str] = []
    refer = payload.get("refer") if isinstance(payload.get("refer"), dict) else {}
    raw = refer.get("sources") if isinstance(refer.get("sources"), list) else []
    metadata = payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {}
    extra = metadata.get("attributions") if isinstance(metadata.get("attributions"), list) else []
    for item in [*raw, *extra]:
        if isinstance(item, str) and item not in found:
            found.append(item)
    return found


def _fahrenheit(value: str | None) -> str | None:
    if value is None:
        return None
    try:
        celsius = float(value)
    except ValueError:
        return value
    return str(round(celsius * 9 / 5 + 32))


def format_daily(payload: dict) -> dict:
    """把 /v7/weather/3d 的当天记录拆成白天和夜间。降水不分昼夜时沿用全天值。"""
    daily = payload.get("daily")
    if not isinstance(daily, list) or not daily or not isinstance(daily[0], dict):
        raise WeatherError("每日预报为空")
    day = daily[0]
    split = any(key in day for key in ("popDay", "popNight", "precipDay", "precipNight"))
    precip = _text(day.get("precip"))
    pop = _text(day.get("pop"))
    return {
        "temp_max": _fahrenheit(_text(day.get("tempMax"))),
        "temp_min": _fahrenheit(_text(day.get("tempMin"))),
        "uv_index": _text(day.get("uvIndex")),
        "precip_scope": "split" if split else "all_day",
        "day": {
            "period": DAY_PERIOD,
            "text": _text(day.get("textDay")),
            "pop": _text(day.get("popDay")) if split else pop,
            "precip": _text(day.get("precipDay")) if split else precip,
            "wind_dir": _text(day.get("windDirDay")),
            "wind_scale": _text(day.get("windScaleDay")),
        },
        "night": {
            "period": NIGHT_PERIOD,
            "text": _text(day.get("textNight")),
            "pop": _text(day.get("popNight")) if split else pop,
            "precip": _text(day.get("precipNight")) if split else precip,
            "wind_dir": _text(day.get("windDirNight")),
            "wind_scale": _text(day.get("windScaleNight")),
        },
        "attributions": _sources(payload),
    }


def _pick_air_index(indexes: list) -> dict:
    local = [
        item
        for item in indexes
        if isinstance(item, dict) and str(item.get("code") or "") not in _GENERIC_AQI
    ]
    pool = local or [item for item in indexes if isinstance(item, dict)]
    if not pool:
        raise WeatherError("空气质量指数为空")
    return pool[0]


def format_air(payload: dict, city_name: str | None) -> dict:
    """兼容现行每日空气质量，以及旧版 /v7/air/5d 的 daily[].aqi。"""
    legacy = payload.get("daily")
    if isinstance(legacy, list) and legacy and isinstance(legacy[0], dict) and "aqi" in legacy[0]:
        row = legacy[0]
        return {
            "aqi": _text(row.get("aqi")),
            "category": _category(row.get("category")),
            "city_name": city_name,
            "attributions": _sources(payload),
        }
    days = payload.get("days")
    if not isinstance(days, list) or not days or not isinstance(days[0], dict):
        raise WeatherError("空气质量预报为空")
    indexes = days[0].get("indexes")
    if not isinstance(indexes, list):
        raise WeatherError("空气质量预报为空")
    chosen = _pick_air_index(indexes)
    aqi = _text(chosen.get("aqiDisplay"))
    if aqi is None and chosen.get("aqi") is not None:
        aqi = _text(chosen.get("aqi"))
    return {
        "aqi": aqi,
        "category": _category(chosen.get("category")),
        "city_name": city_name,
        "attributions": _sources(payload),
    }


def _host() -> str | None:
    host = os.environ.get("QWEATHER_API_HOST", "").strip()
    host = re.sub(r"^https?://", "", host).strip("/")
    if not host or not _HOST_RE.fullmatch(host):
        return None
    return host


def _get_json(url: str, key: str) -> dict:
    request = urllib.request.Request(
        url,
        headers={
            "X-QW-Api-Key": key,
            "Accept": "application/json",
            "Accept-Encoding": "identity",
        },
        method="GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=8) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raise WeatherError(f"和风天气返回 {exc.code}") from exc
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise WeatherError(WEATHER_UNAVAILABLE) from exc
    if not isinstance(payload, dict):
        raise WeatherError(WEATHER_UNAVAILABLE)
    code = payload.get("code")
    if code is not None and str(code) != "200":
        raise WeatherError(f"和风天气状态 {code}")
    return payload


def _lookup_point(host: str, key: str, lat: float, lng: float) -> dict:
    # 和风的 location 参数是经度在前、纬度在后。
    query = urlencode({"location": f"{lng:.2f},{lat:.2f}", "lang": "zh", "number": 1})
    payload = _get_json(f"https://{host}/geo/v2/city/lookup?{query}", key)
    return _first_location(payload)


def _lookup_city(host: str, key: str, name: str, adm1: str | None) -> dict:
    params = {"location": name, "lang": "en", "number": 10}
    if adm1:
        params["adm"] = adm1
    payload = _get_json(f"https://{host}/geo/v2/city/lookup?{urlencode(params)}", key)
    locations = payload.get("location")
    if not isinstance(locations, list):
        raise WeatherError("未找到地级市")
    for item in locations:
        if isinstance(item, dict) and item.get("name") == name and _text(item.get("id")):
            return item
    return _first_location(payload)


def _first_location(payload: dict) -> dict:
    locations = payload.get("location")
    if not isinstance(locations, list) or not locations or not isinstance(locations[0], dict):
        raise WeatherError("未找到地理位置")
    row = locations[0]
    if not _text(row.get("id")):
        raise WeatherError("未找到地理位置")
    return row


def _fetch(lat: float, lng: float) -> SpotWeather:
    load_env()
    key = os.environ.get("QWEATHER_API_KEY", "").strip()
    host = _host()
    if not key:
        return SpotWeather(status="unavailable", message=WAITING_FOR_KEY)
    if not host:
        return SpotWeather(status="unavailable", message=WAITING_FOR_HOST)

    point = _lookup_point(host, key, lat, lng)
    adm2 = _text(point.get("adm2")) or _text(point.get("name")) or ""
    if point.get("name") == adm2:
        city = point
    else:
        try:
            city = _lookup_city(host, key, adm2, _text(point.get("adm1")))
        except WeatherError:
            city = point

    forecast_url = f"https://{host}/v7/weather/3d?{urlencode({'location': point['id'], 'lang': 'en'})}"
    forecast = format_daily(_get_json(forecast_url, key))

    city_lat = _text(city.get("lat"))
    city_lng = _text(city.get("lon"))
    if city_lat is None or city_lng is None:
        raise WeatherError("地级市缺少坐标")
    air_url = f"https://{host}/airquality/v1/daily/{float(city_lat):.2f}/{float(city_lng):.2f}?lang=en"
    air = format_air(_get_json(air_url, key), _text(city.get("name")) or adm2)

    attributions = list(forecast["attributions"])
    for item in air["attributions"]:
        if item not in attributions:
            attributions.append(item)
    return SpotWeather(
        status="ok",
        source="qweather",
        location_id=str(point["id"]),
        location_name=_text(point.get("name")),
        city_id=str(city["id"]),
        city_name=_text(city.get("name")) or adm2,
        temp_max=forecast["temp_max"],
        temp_min=forecast["temp_min"],
        uv_index=forecast["uv_index"],
        precip_scope=forecast["precip_scope"],
        precip_unit="mm",
        day=WeatherSlice.model_validate(forecast["day"]),
        night=WeatherSlice.model_validate(forecast["night"]),
        air=AirBrief.model_validate({key: air[key] for key in ("aqi", "category", "city_name")}),
        attributions=attributions,
    )


def resolve_spot_weather(lat: float, lng: float, snapshot: dict | None) -> dict:
    """有密钥时用实时预报。没有密钥时，用写入景点的检索预报。"""
    live = fetch_spot_weather(lat, lng)
    if live.get("status") == "ok" or not isinstance(snapshot, dict) or snapshot.get("status") != "ok":
        return live
    try:
        return public_weather(SpotWeather.model_validate(snapshot))
    except Exception:
        return live


def fetch_spot_weather(lat: float, lng: float) -> dict:
    try:
        return public_weather(_fetch(lat, lng))
    except WeatherError:
        return unavailable(WEATHER_UNAVAILABLE)
    except Exception as exc:
        if isinstance(exc, AssertionError):
            raise
        return unavailable(WEATHER_UNAVAILABLE)
