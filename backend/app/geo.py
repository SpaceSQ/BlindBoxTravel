"""球面距离。"""

import math

EARTH_RADIUS_KM = 6371.0
KM_PER_MILE = 1.609344


def miles_to_km(miles: float) -> float:
    return miles * KM_PER_MILE


def km_to_miles(km: float) -> float:
    return km / KM_PER_MILE


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """两地经纬度的大圆距离，单位公里。"""
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lambda = math.radians(lng2 - lng1)
    a = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return EARTH_RADIUS_KM * c
