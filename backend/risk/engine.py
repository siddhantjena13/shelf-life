"""Cumulative-exposure risk engine.

Each item carries a spoilage clock measured in "equivalent hours at 40°F".
Every interval between readings advances it by

    dt × temperature_factor × humidity_factor

temperature_factor is the Ratkowsky square-root model's growth rate at the
food's temperature relative to the reference:

    ((T_food - T_min) / (T_ref - T_min))²

so the clock runs at 1× at 40°F, slower when colder and faster when warmer.
The food's own temperature lags the air (first-order, profile time constant),
so a brief lid opening warms the air far more than the food.

Inputs are plain numbers: timestamps in epoch seconds, temperatures in °C,
humidity in % RH. Nothing here touches the web layer or the database.
"""

import math
from dataclasses import dataclass, field

from .profiles import PROFILES, REFERENCE_TEMP_C, Profile

DANGER_ZONE_C = REFERENCE_TEMP_C  # above 40°F [FSIS]
HOT_DAY_C = (90 - 32) / 1.8  # above 90°F the 2-hour limit becomes 1 hour [FSIS]
TWO_HOUR_LIMIT_H = 2.0

# Readings further apart than this are a sensor gap. The last reading is held
# across the gap (the best guess available) and the gap is reported.
MAX_GAP_S = 10 * 60

# An interval only counts toward an excursion when it ages the food at least
# this much faster than 40°F would.
EXCURSION_RATE = 1.2

# Remaining-fraction cut-offs for status. OUR ESTIMATE.
USE_SOON_BELOW = 0.5
AT_RISK_BELOW = 0.2


@dataclass(frozen=True)
class Reading:
    t: float  # epoch seconds
    temp_c: float
    humidity: float  # % RH


@dataclass(frozen=True)
class Item:
    id: str
    name: str
    profile: str
    zone: str
    added_at: float  # epoch seconds
    packaged: bool = False  # sealed or bagged: humidity is ignored


@dataclass
class Excursion:
    start: float
    end: float
    extra_hours: float  # shelf life lost beyond what 40°F storage would cost
    peak_air_c: float
    cause: str  # 'temperature', 'dry air', 'humid air' or 'condensation'


@dataclass
class Assessment:
    item: Item
    profile: Profile
    score: int  # 0-100, share of the baseline shelf life left
    status: str  # 'good', 'use_soon', 'at_risk', 'expired' or 'discard'
    remaining_hours: float
    equivalent_hours: float  # clock: equivalent hours at 40°F consumed
    elapsed_hours: float
    danger_zone_hours: float  # weighted: hours above 90°F count double
    food_temp_c: float | None  # estimated current temperature of the food
    loss_by_cause: dict[str, float] = field(default_factory=dict)  # extra hours by cause
    excursions: list[Excursion] = field(default_factory=list)  # largest first
    condensation_minutes: float = 0.0
    gap_hours: float = 0.0


def temperature_factor(food_c: float, profile: Profile) -> float:
    if food_c <= profile.t_min_c:
        return 0.0
    return ((food_c - profile.t_min_c) / (REFERENCE_TEMP_C - profile.t_min_c)) ** 2


def dew_point_c(air_c: float, humidity: float) -> float:
    """Magnus formula with Sonntag (1990) constants, valid -45°C to 60°C."""
    b, c = 17.62, 243.12
    gamma = math.log(max(humidity, 0.1) / 100) + b * air_c / (c + air_c)
    return c * gamma / (b - gamma)


def humidity_factor(air_c: float, humidity: float, food_c: float, profile: Profile, packaged: bool) -> tuple[float, str | None]:
    band = profile.humidity
    if band is None or packaged:
        return 1.0, None
    if dew_point_c(air_c, humidity) > food_c:
        return band.condensation_multiplier, 'condensation'
    if humidity < band.low:
        return 1 + band.dry_rate_per_10pts * (band.low - humidity) / 10, 'dry air'
    if humidity > band.high:
        return 1 + band.wet_rate_per_10pts * (humidity - band.high) / 10, 'humid air'
    return 1.0, None


def assess(item: Item, readings: list[Reading], now: float) -> Assessment:
    """Score one item from the readings of the zone it is stored in."""
    profile = PROFILES[item.profile]
    readings = sorted((r for r in readings if r.t >= item.added_at), key=lambda r: r.t)

    clock_h = 0.0
    danger_h = 0.0
    # If the item predates the available sensor history, report the unknown
    # interval instead of implying we observed its entire storage period.
    gap_h = max(
        ((readings[0].t if readings else now) - item.added_at) / 3600,
        0.0,
    )
    condensation_min = 0.0
    loss_by_cause: dict[str, float] = {}
    excursions: list[Excursion] = []
    current: Excursion | None = None
    food_c = readings[0].temp_c if readings else None

    for prev, cur in zip(readings, readings[1:]):
        dt_s = cur.t - prev.t
        if dt_s > MAX_GAP_S:
            gap_h += (dt_s - MAX_GAP_S) / 3600
        dt_h = dt_s / 3600
        air_c = (prev.temp_c + cur.temp_c) / 2
        humidity = (prev.humidity + cur.humidity) / 2

        food_c += (air_c - food_c) * (1 - math.exp(-dt_s / 60 / profile.thermal_lag_min))

        t_factor = temperature_factor(food_c, profile)
        h_factor, h_cause = humidity_factor(air_c, humidity, food_c, profile, item.packaged)
        rate = t_factor * h_factor
        clock_h += rate * dt_h

        if h_cause == 'condensation':
            condensation_min += dt_s / 60
        if food_c > DANGER_ZONE_C:
            danger_h += dt_h * (2 if food_c > HOT_DAY_C else 1)

        # Attribute time lost beyond 40°F storage to whichever factor drove it.
        temp_extra = max(t_factor - 1, 0) * dt_h
        hum_extra = t_factor * (h_factor - 1) * dt_h
        if temp_extra > 0:
            loss_by_cause['temperature'] = loss_by_cause.get('temperature', 0) + temp_extra
        if hum_extra > 0:
            loss_by_cause[h_cause] = loss_by_cause.get(h_cause, 0) + hum_extra

        if rate >= EXCURSION_RATE:
            cause = 'temperature' if temp_extra >= hum_extra else h_cause
            if current is None:
                current = Excursion(prev.t, cur.t, 0.0, max(prev.temp_c, cur.temp_c), cause)
                excursions.append(current)
            current.end = cur.t
            current.extra_hours += temp_extra + hum_extra
            current.peak_air_c = max(current.peak_air_c, cur.temp_c)
        else:
            current = None

    elapsed_h = max(now - item.added_at, 0) / 3600
    remaining_h = min(
        profile.shelf_life_hours - clock_h,
        profile.max_shelf_life_hours - elapsed_h,  # never promise more than USDA's upper bound
    )
    fraction = remaining_h / profile.shelf_life_hours

    if profile.two_hour_rule and danger_h >= TWO_HOUR_LIMIT_H:
        status = 'discard'
    elif remaining_h <= 0:
        status = 'expired'
    elif fraction < AT_RISK_BELOW:
        status = 'at_risk'
    elif fraction < USE_SOON_BELOW:
        status = 'use_soon'
    else:
        status = 'good'

    return Assessment(
        item=item,
        profile=profile,
        score=max(0, min(100, round(fraction * 100))),
        status=status,
        remaining_hours=max(remaining_h, 0.0),
        equivalent_hours=clock_h,
        elapsed_hours=elapsed_h,
        danger_zone_hours=danger_h,
        food_temp_c=food_c,
        loss_by_cause=loss_by_cause,
        excursions=sorted(excursions, key=lambda e: e.extra_hours, reverse=True),
        condensation_minutes=condensation_min,
        gap_hours=gap_h,
    )
