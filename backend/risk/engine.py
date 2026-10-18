"""Exposure simulation: what the fridge has done to one item so far.

The item's shelf life is measured in "equivalent hours at 40°F". Replaying
the zone's readings since the item went in, each interval adds

    E += dt × rate(food temperature) × condensation multiplier

where rate is 1 at 40°F (profiles.Kinetics). The food's own temperature
lags the air (first-order, per-profile time constant), so a brief lid
opening warms the air far more than the food. For produce, the same replay
tracks transpiration:

    W += dt × coefficient × vapour pressure deficit     (% of weight lost)

Time without readings (before the sensor history starts, or a gap longer
than MAX_GAP_S) is filled with an assumed temperature: the zone's own
observed mean when there is one, otherwise a typical home fridge. Which
value to assume is a scenario chosen by the freshness model, which runs
this simulation several times and combines the results (freshness.py).

Inputs are plain numbers: timestamps in epoch seconds, temperatures in °C,
humidity in % RH. Nothing here touches the web layer or the database.
"""

import math
from bisect import bisect_right
from dataclasses import dataclass, field

from .profiles import BAG_RH, HOME_FRIDGE_RH, PROFILES, Profile

# The 2-hour rule counts food time above 41°F (5°C), the FDA Food Code
# cold-holding limit, rather than exactly 40°F: a fridge cycling a fraction of
# a degree around 40°F is within sensor accuracy (SHT31: ±0.3°C) and is not the
# failed-fridge or out-of-the-fridge case the rule is about [FSIS]. Warmth
# below this still ages the food through the clock above.
DANGER_ZONE_C = 5.0
HOT_DAY_C = (90 - 32) / 1.8  # above 90°F the 2-hour limit becomes 1 hour [FSIS]
TWO_HOUR_LIMIT_H = 2.0

# Readings further apart than this are a sensor gap: the last reading is held
# for this long, then the scenario's assumed temperature takes over.
MAX_GAP_S = 10 * 60

# An interval only counts toward an excursion when it ages the food at least
# this much faster than 40°F would. Excursions closer together than
# EXCURSION_MERGE_S are one event (e.g. condensation as warm air first hits
# cold food, then the warming itself).
EXCURSION_RATE = 1.2
EXCURSION_MERGE_S = 5 * 60

# Future conditions are taken from this much recent history.
RECENT_S = 2 * 3600

BUCKET_S = 60  # readings are averaged per minute before simulating


@dataclass(frozen=True)
class Reading:
    t: float  # epoch seconds
    temp_c: float
    humidity: float  # % RH


@dataclass(frozen=True)
class Check:
    """A freshness observation: a photo rated by the vision model, or a person."""
    t: float
    freshness: str  # 'fresh', 'good', 'fair', 'poor' or 'spoiled'
    source: str = 'manual'  # 'photo' or 'manual'
    confidence: float | None = None


@dataclass(frozen=True)
class Item:
    id: str
    name: str
    profile: str
    zone: str
    added_at: float  # epoch seconds
    packaged: bool = False  # sealed or bagged: produce keeps its moisture
    expires_at: float | None = None  # end of the printed date's day, epoch seconds
    date_kind: str | None = None  # 'use_by', 'best_by', 'sell_by' or 'expires'
    checks: tuple[Check, ...] = ()


@dataclass
class Excursion:
    start: float
    end: float
    extra_hours: float  # shelf life lost beyond what 40°F storage would cost
    peak_air_c: float
    cause: str  # 'temperature' or 'condensation', whichever cost more
    temperature_hours: float = 0.0
    condensation_hours: float = 0.0


@dataclass
class Trace:
    """One scenario's replay, as cumulative totals at each breakpoint."""
    times: list[float]
    eq_hours: list[float]  # cumulative equivalent hours at 40°F
    water_pct: list[float]  # cumulative % weight lost (household coefficient)
    future_rate: float  # aging rate expected from now on
    future_water_pct_h: float  # % weight lost per hour from now on
    food_temp_c: float | None
    danger_zone_hours: float = 0.0  # observed time only; hours above 90°F count double
    condensation_minutes: float = 0.0
    gap_hours: float = 0.0
    loss_by_cause: dict[str, float] = field(default_factory=dict)
    excursions: list[Excursion] = field(default_factory=list)

    def at(self, t: float) -> tuple[float, float]:
        """(equivalent hours, water %) accumulated by time t."""
        i = bisect_right(self.times, t) - 1
        if i < 0:
            return 0.0, 0.0
        if i >= len(self.times) - 1:
            return self.eq_hours[-1], self.water_pct[-1]
        t0, t1 = self.times[i], self.times[i + 1]
        share = (t - t0) / (t1 - t0) if t1 > t0 else 0.0
        return (
            self.eq_hours[i] + share * (self.eq_hours[i + 1] - self.eq_hours[i]),
            self.water_pct[i] + share * (self.water_pct[i + 1] - self.water_pct[i]),
        )


def temperature_factor(food_c: float, profile: Profile) -> float:
    return profile.kinetics.rate(food_c)


def saturation_pressure_pa(temp_c: float) -> float:
    """Magnus formula with Sonntag (1990) constants, valid -45°C to 60°C."""
    return 611.2 * math.exp(17.62 * temp_c / (243.12 + temp_c))


def dew_point_c(air_c: float, humidity: float) -> float:
    b, c = 17.62, 243.12
    gamma = math.log(max(humidity, 0.1) / 100) + b * air_c / (c + air_c)
    return c * gamma / (b - gamma)


def vapour_pressure_deficit_pa(food_c: float, air_c: float, humidity: float, packaged: bool) -> float:
    """Drive for water to leave the food. A bag keeps its own humid air."""
    if packaged:
        return saturation_pressure_pa(food_c) * (1 - BAG_RH / 100)
    return max(saturation_pressure_pa(food_c) - humidity / 100 * saturation_pressure_pa(air_c), 0.0)


def per_minute(readings: list[Reading]) -> list[Reading]:
    """Average readings into one-minute buckets, sorted by time."""
    buckets: dict[int, list[Reading]] = {}
    for r in readings:
        buckets.setdefault(int(r.t // BUCKET_S), []).append(r)
    out = []
    for key in sorted(buckets):
        group = buckets[key]
        n = len(group)
        out.append(Reading(
            sum(r.t for r in group) / n,
            sum(r.temp_c for r in group) / n,
            sum(r.humidity for r in group) / n,
        ))
    return out


def _segments(readings: list[Reading], start: float, now: float, gap_c: float):
    """(t0, t1, air °C, RH %, observed) pieces covering start..now."""
    rs = [r for r in readings if start <= r.t <= now]
    if not rs:
        if now > start:
            yield start, now, gap_c, HOME_FRIDGE_RH, False
        return
    if rs[0].t > start:
        yield start, rs[0].t, gap_c, HOME_FRIDGE_RH, False
    for prev, cur in zip(rs, rs[1:]):
        dt = cur.t - prev.t
        if dt <= MAX_GAP_S:
            yield prev.t, cur.t, (prev.temp_c + cur.temp_c) / 2, (prev.humidity + cur.humidity) / 2, True
        else:
            yield prev.t, prev.t + MAX_GAP_S, prev.temp_c, prev.humidity, True
            yield prev.t + MAX_GAP_S, cur.t, gap_c, prev.humidity, False
    last = rs[-1]
    if now - last.t <= MAX_GAP_S:
        yield last.t, now, last.temp_c, last.humidity, True
    else:
        yield last.t, last.t + MAX_GAP_S, last.temp_c, last.humidity, True
        yield last.t + MAX_GAP_S, now, gap_c, last.humidity, False


def simulate(item: Item, readings: list[Reading], now: float, kinetic_value: float, gap_c: float) -> Trace:
    """Replay one scenario. `readings` should be sorted (see per_minute)."""
    profile = PROFILES[item.profile]
    kinetics = profile.kinetics
    water = profile.water
    start = item.added_at

    times, eq, wl = [start], [0.0], [0.0]
    e_total = w_total = 0.0
    danger_h = condensation_min = gap_h = 0.0
    loss: dict[str, float] = {}
    excursions: list[Excursion] = []
    current: Excursion | None = None
    food_c: float | None = None

    for t0, t1, air_c, humidity, observed in _segments(readings, start, now, gap_c):
        dt_s = t1 - t0
        if dt_s <= 0:
            continue
        dt_h = dt_s / 3600
        food_c = air_c if food_c is None else food_c + (air_c - food_c) * (1 - math.exp(-dt_s / 60 / profile.thermal_lag_min))

        rate = kinetics.rate(food_c, kinetic_value)
        condensing = dew_point_c(air_c, humidity) > food_c
        multiplier = profile.condensation_multiplier if condensing else 1.0
        e_total += rate * multiplier * dt_h
        if water is not None:
            vpd = 0.0 if condensing else vapour_pressure_deficit_pa(food_c, air_c, humidity, item.packaged)
            w_total += water.coefficient * 1e-12 * vpd * dt_s * 100  # ng→kg, then %

        times.append(t1)
        eq.append(e_total)
        wl.append(w_total)

        if not observed:
            gap_h += dt_h
            current = None
            continue
        if condensing:
            condensation_min += dt_s / 60
        if food_c > DANGER_ZONE_C:
            danger_h += dt_h * (2 if food_c > HOT_DAY_C else 1)

        temp_extra = max(rate - 1, 0) * dt_h
        cond_extra = rate * (multiplier - 1) * dt_h
        if temp_extra > 0:
            loss['temperature'] = loss.get('temperature', 0) + temp_extra
        if cond_extra > 0:
            loss['condensation'] = loss.get('condensation', 0) + cond_extra

        if rate * multiplier >= EXCURSION_RATE:
            if current is None or t0 - current.end > EXCURSION_MERGE_S:
                current = Excursion(t0, t1, 0.0, air_c, 'temperature')
                excursions.append(current)
            current.end = t1
            current.extra_hours += temp_extra + cond_extra
            current.temperature_hours += temp_extra
            current.condensation_hours += cond_extra
            current.cause = 'temperature' if current.temperature_hours >= current.condensation_hours else 'condensation'
            current.peak_air_c = max(current.peak_air_c, air_c)

    # Expect the recent conditions to continue.
    recent = [r for r in readings if now - RECENT_S <= r.t <= now]
    future_c = sum(r.temp_c for r in recent) / len(recent) if recent else gap_c
    future_rh = sum(r.humidity for r in recent) / len(recent) if recent else HOME_FRIDGE_RH
    future_water = 0.0
    if water is not None:
        future_water = water.coefficient * 1e-12 * vapour_pressure_deficit_pa(future_c, future_c, future_rh, item.packaged) * 3600 * 100

    return Trace(
        times=times,
        eq_hours=eq,
        water_pct=wl,
        future_rate=kinetics.rate(future_c, kinetic_value),
        future_water_pct_h=future_water,
        food_temp_c=food_c,
        danger_zone_hours=danger_h,
        condensation_minutes=condensation_min,
        gap_hours=gap_h,
        loss_by_cause=loss,
        excursions=sorted(excursions, key=lambda e: e.extra_hours, reverse=True),
    )
