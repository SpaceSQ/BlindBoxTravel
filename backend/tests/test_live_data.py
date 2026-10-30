"""大模型标签数量和天气格式化。"""

import urllib.error

from app.intent import limit_llm_tags
from app.weather import (
    WAITING_FOR_KEY,
    WEATHER_UNAVAILABLE,
    WeatherError,
    fetch_spot_weather,
    format_air,
    format_daily,
)


def test_llm_tags_stay_between_three_and_five():
    assert limit_llm_tags(["a", "b", "c", "d", "e", "f"], ["z"]) == ["a", "b", "c", "d", "e"]
    assert limit_llm_tags(["异星感"], ["异星感", "露营", "废土风", "自驾"]) == ["异星感", "露营", "废土风"]
    assert limit_llm_tags(["露营", "异星感", "废土风", "自驾"], ["辣"]) == ["露营", "异星感", "废土风", "自驾"]


def test_daily_forecast_splits_day_and_night_and_keeps_all_day_precip():
    forecast = format_daily(
        {
            "code": "200",
            "daily": [
                {
                    "tempMax": "12",
                    "tempMin": "-1",
                    "textDay": "多云",
                    "textNight": "晴",
                    "uvIndex": "3",
                    "precip": "1.2",
                    "windDirDay": "东北风",
                    "windScaleDay": "1-2",
                    "windDirNight": "北风",
                    "windScaleNight": "3-4",
                }
            ],
            "refer": {"sources": ["https://developer.qweather.com/attribution.html"]},
        }
    )
    assert forecast["temp_max"] == "54"
    assert forecast["temp_min"] == "30"
    assert forecast["uv_index"] == "3"
    assert forecast["precip_scope"] == "all_day"
    assert forecast["day"]["text"] == "多云"
    assert forecast["day"]["precip"] == "1.2"
    assert forecast["day"]["pop"] is None
    assert forecast["night"]["text"] == "晴"
    assert forecast["night"]["wind_dir"] == "北风"
    assert forecast["night"]["wind_scale"] == "3-4"
    assert forecast["night"]["precip"] == "1.2"


def test_daily_forecast_uses_split_precip_when_present():
    forecast = format_daily(
        {
            "daily": [
                {
                    "tempMax": "20",
                    "tempMin": "10",
                    "textDay": "小雨",
                    "textNight": "阴",
                    "uvIndex": "2",
                    "popDay": "80",
                    "popNight": "20",
                    "precipDay": "4.0",
                    "precipNight": "0.2",
                    "windDirDay": "东风",
                    "windScaleDay": "2",
                    "windDirNight": "东风",
                    "windScaleNight": "1",
                }
            ]
        }
    )
    assert forecast["precip_scope"] == "split"
    assert forecast["day"]["pop"] == "80"
    assert forecast["night"]["precip"] == "0.2"


def test_air_prefers_the_local_index_and_legacy_daily():
    current = format_air(
        {
            "days": [
                {
                    "indexes": [
                        {"code": "qaqi", "aqiDisplay": "1.0", "category": "Excellent"},
                        {"code": "cn-mee", "aqiDisplay": "46", "category": "优"},
                    ]
                }
            ]
        },
        "北京",
    )
    assert current["aqi"] == "46"
    assert current["category"] == "Excellent"
    assert current["city_name"] == "北京"

    legacy = format_air({"code": "200", "daily": [{"aqi": "88", "category": "良"}]}, "乌兰察布")
    assert legacy["aqi"] == "88"
    assert legacy["category"] == "Good"


def test_missing_weather_key_does_not_call_the_network(monkeypatch):
    monkeypatch.setenv("QWEATHER_API_KEY", "")
    monkeypatch.setenv("QWEATHER_API_HOST", "example.qweatherapi.com")

    def explode(*_args, **_kwargs):
        raise AssertionError("没有密钥时不应该请求和风天气")

    monkeypatch.setattr("app.weather.urllib.request.urlopen", explode)
    weather = fetch_spot_weather(41.52, 113.11)
    assert weather["status"] == "unavailable"
    assert weather["message"] == WAITING_FOR_KEY
    assert "temp_max" not in weather


def test_fetch_resolves_city_then_loads_forecast_and_air(monkeypatch):
    monkeypatch.setenv("QWEATHER_API_KEY", "test-key")
    monkeypatch.setenv("QWEATHER_API_HOST", "example.qweatherapi.com")
    responses = [
        {
            "code": "200",
            "location": [
                {
                    "name": "察右后旗",
                    "id": "101080607",
                    "lat": "41.52",
                    "lon": "113.11",
                    "adm2": "乌兰察布",
                    "adm1": "内蒙古",
                }
            ],
        },
        {
            "code": "200",
            "location": [
                {
                    "name": "乌兰察布",
                    "id": "101080600",
                    "lat": "41.03",
                    "lon": "113.11",
                    "adm2": "乌兰察布",
                    "adm1": "内蒙古",
                }
            ],
        },
        {
            "code": "200",
            "daily": [
                {
                    "tempMax": "26",
                    "tempMin": "8",
                    "textDay": "晴",
                    "textNight": "晴",
                    "uvIndex": "6",
                    "precip": "0.0",
                    "windDirDay": "西北风",
                    "windScaleDay": "3-4",
                    "windDirNight": "北风",
                    "windScaleNight": "1-2",
                }
            ],
            "refer": {"sources": ["https://developer.qweather.com/attribution.html"]},
        },
        {
            "metadata": {"attributions": ["https://developer.qweather.com/attribution.html"]},
            "days": [
                {
                    "indexes": [
                        {"code": "qaqi", "aqiDisplay": "2", "category": "Good"},
                        {"code": "cn-mee", "aqiDisplay": "55", "category": "良"},
                    ]
                }
            ],
        },
    ]
    calls: list[str] = []

    def fake(url: str, key: str):
        assert key == "test-key"
        calls.append(url)
        return responses.pop(0)

    monkeypatch.setattr("app.weather._get_json", fake)
    weather = fetch_spot_weather(41.523, 113.1118)
    assert weather["status"] == "ok"
    assert weather["location_id"] == "101080607"
    assert weather["city_id"] == "101080600"
    assert weather["city_name"] == "乌兰察布"
    assert weather["temp_max"] == "79"
    assert weather["temp_min"] == "46"
    assert weather["precip_unit"] == "mm"
    assert weather["day"]["precip"] == "0.0"
    assert weather["day"]["period"] == "07:00-19:00"
    assert weather["day"]["wind_dir"] == "西北风"
    assert weather["night"]["period"] == "19:00-07:00 next day"
    assert weather["air"]["aqi"] == "55"
    assert weather["air"]["category"] == "Good"
    assert "/geo/v2/city/lookup" in calls[0]
    assert "113.11%2C41.52" in calls[0]
    assert "101080607" in calls[2]
    assert "/v7/weather/3d" in calls[2]
    assert calls[3].endswith("/airquality/v1/daily/41.03/113.11?lang=en")


def test_us_forecast_converts_celsius_and_keeps_precip_in_millimeters(monkeypatch):
    monkeypatch.setenv("QWEATHER_API_KEY", "test-key")
    monkeypatch.setenv("QWEATHER_API_HOST", "example.qweatherapi.com")
    calls: list[str] = []

    def fake(url: str, key: str):
        assert key == "test-key"
        calls.append(url)
        lookups = [item for item in calls if "city/lookup" in item]
        if "city/lookup" in url and len(lookups) == 1:
            return {
                "code": "200",
                "location": [
                    {
                        "name": "Yellowstone",
                        "id": "US123",
                        "lat": "44.55",
                        "lon": "-110.26",
                        "adm2": "Park County",
                        "adm1": "Wyoming",
                    }
                ],
            }
        if "city/lookup" in url:
            raise WeatherError("未找到地级市")
        if "/v7/weather/3d" in url:
            return {
                "code": "200",
                "daily": [
                    {
                        "tempMax": "10",
                        "tempMin": "0",
                        "textDay": "Drizzle",
                        "textNight": "Rain",
                        "uvIndex": "4",
                        "precip": "2.54",
                        "windDirDay": "SW",
                        "windScaleDay": "3",
                        "windDirNight": "SW",
                        "windScaleNight": "2",
                    }
                ],
            }
        return {
            "days": [{"indexes": [{"code": "us-epa", "aqiDisplay": "42", "category": "Good"}]}],
        }

    monkeypatch.setattr("app.weather._get_json", fake)
    weather = fetch_spot_weather(44.549906, -110.260925)
    assert weather["status"] == "ok"
    assert weather["source"] == "qweather"
    assert weather["temp_max"] == "50"
    assert weather["temp_min"] == "32"
    assert weather["precip_unit"] == "mm"
    assert weather["day"]["precip"] == "2.54"
    assert weather["city_name"] == "Yellowstone"
    assert calls[-1].endswith("/airquality/v1/daily/44.55/-110.26?lang=en")


def test_http_failure_returns_unavailable_without_raising(monkeypatch):
    monkeypatch.setenv("QWEATHER_API_KEY", "test-key")
    monkeypatch.setenv("QWEATHER_API_HOST", "example.qweatherapi.com")

    def down(*_args, **_kwargs):
        raise urllib.error.URLError("down")

    monkeypatch.setattr("app.weather.urllib.request.urlopen", down)
    weather = fetch_spot_weather(41.52, 113.11)
    assert weather == {"status": "unavailable", "message": WEATHER_UNAVAILABLE}
