"""Bayesian freshness estimate: how much shelf life an item has left.

There is no labeled dataset of household food with temperature histories
and spoilage outcomes to train on, so this is a probabilistic model built on
published food-science kinetics that updates on each item's own checks.
Its unknowns per item are:

  L   shelf life in equivalent hours at 40°F. Prior from the printed date
      when there is one, otherwise from USDA FoodKeeper.
  a   share of that life already used when the item was logged.
  θ   the profile's temperature sensitivity (Ratkowsky Tmin or Arrhenius Ea).
  Tg  temperature during time the sensors did not see.
  m   how fast this item loses water, relative to the profile's coefficient.

The model enumerates a grid of combinations (quantiles of each prior),
replays the sensor history for each (engine.simulate), and weights each
combination by its prior probability times the likelihood of every
freshness check on the item. A "fair" photo on day 2 pulls weight towards
short shelf lives; a "fresh" one towards long. The weighted set gives the
remaining shelf life as a distribution: median, a 10th-90th percentile
range, the chance the item is already past its best, and a survival curve.

At any moment an item is used up by `f = max(a + E/L, W/limit)`: aging from
temperature, or water loss for produce, whichever is further along.
Shelf life ends at f = 1.
"""

import math
from dataclasses import dataclass, field
from statistics import NormalDist

from .engine import (
    TWO_HOUR_LIMIT_H, Check, Excursion, Item, Reading, Trace, per_minute, simulate,
)
from .profiles import HOME_FRIDGE_C, HOME_FRIDGE_SD_C, OBSERVED_SD_C, PROFILES, Profile

_N = NormalDist()

STAGES = ('fresh', 'good', 'fair', 'poor', 'spoiled')

# Three-point Gauss-Hermite rule for a normal parameter: offsets in SDs, weights.
_GH3 = ((-math.sqrt(3), 1 / 6), (0.0, 2 / 3), (math.sqrt(3), 1 / 6))
_L_QUANTILES = 24
# Transpiration varies item to item. Water loss alone sets how long unbagged
# produce lasts, and one check can pin it down, so it gets a finer grid than
# the 3-point scenarios; otherwise the posterior collapses onto one point.
WATER_MULTIPLIER_SD = 0.4  # log-scale spread. OUR ESTIMATE.
_M_QUANTILES = 9

# How a printed date maps to the median of the item's remaining shelf life,
# and how far either side the truth may fall (log-scale SD). OUR ESTIMATES,
# anchored as noted.
#   use_by:  the manufacturer's last date for peak quality; FSIS says follow it.
#   best_by: quality only; tested products often stay acceptable past it
#            (e.g. milk labeled 8 days still fine at 9-10; yogurt labeled 28
#            days still fine at 33), so the median sits 15% later.
#   sell_by: for the store; FSIS says use the FoodKeeper times after it.
DATE_RULES = {
    'use_by': (1.0, 0.15),
    'expires': (1.0, 0.15),
    'best_by': (1.15, 0.25),
}
SELL_BY_SD = 0.3

# Prior on the share of shelf life used before logging (a). FoodKeeper times
# count from purchase and a date already encodes age, so this mostly stays at
# zero; the tail lets a poor rating at logging mean "bought old" rather than
# only "the rating was wrong". OUR ESTIMATE.
AGE_PRIOR_NO_DATE = ((0.0, 0.82), (0.25, 0.10), (0.5, 0.05), (0.75, 0.03))
AGE_PRIOR_WITH_DATE = ((0.0, 0.90), (0.25, 0.06), (0.5, 0.03), (0.75, 0.01))

# Observation model: share of shelf life used -> expected stage index
# (0 fresh ... 4 spoiled). For 'microbial' foods odour precedes visible slime
# by about a log of growth, so the visible stages come late. OUR ESTIMATE.
VISUAL_CURVES = {
    'appearance': ((0.0, 0.35, 0.70, 0.95, 1.20), (0, 1, 2, 3, 4)),
    'microbial': ((0.0, 0.60, 1.00, 1.25, 1.50), (0, 1, 2, 3, 4)),
}
# Spread of a rating around the expected stage, in stages. OUR ESTIMATE.
MANUAL_SD = 0.7
PHOTO_SD = 0.9  # at full confidence; widens as the model's confidence drops
MICROBIAL_SD_SCALE = 1.3  # appearance says less about meat and dairy
OUTLIER_SHARE = 0.05  # a rating can simply be wrong; keeps one bad photo from dominating

HORIZON_H = 60 * 24  # remaining life is reported up to 60 days
# The survival curve is smoothed by ±10% in time, so a handful of grid points
# reads as a distribution rather than a staircase. Display only.
SURVIVAL_SMOOTHING = 0.1

# Status cut-offs on the median share of shelf life used. OUR ESTIMATE.
USE_SOON_AT = 0.5
AT_RISK_AT = 0.8
AT_RISK_PROBABILITY = 0.2
EXPIRED_PROBABILITY = 0.5


@dataclass
class Assessment:
    item: Item
    profile: Profile
    score: int  # 0-100: expected share of shelf life left
    status: str  # 'good', 'use_soon', 'at_risk', 'expired' or 'discard'
    remaining_hours: float  # median
    remaining_low: float  # 10th percentile
    remaining_high: float  # 90th percentile
    p_spoiled: float  # probability the item is already past its best
    equivalent_hours: float  # most likely scenario: equivalent hours at 40°F used
    elapsed_hours: float
    danger_zone_hours: float  # weighted: hours above 90°F count double
    food_temp_c: float | None
    limiting: str  # 'temperature', 'water' or 'date': what ends shelf life first
    water_loss_pct: float | None
    water_limit_pct: float | None
    baseline: dict  # where the prior came from
    checks_used: int
    checks_shift_hours: float  # how much the checks moved the median
    survival: list[tuple[float, float]]  # (hours from now, chance still good)
    loss_by_cause: dict[str, float] = field(default_factory=dict)  # extra hours by cause
    excursions: list[Excursion] = field(default_factory=list)  # largest first
    condensation_minutes: float = 0.0
    gap_hours: float = 0.0


def _gh(mu: float, sd: float) -> list[tuple[float, float]]:
    return [(mu + z * sd, w) for z, w in _GH3]


def _lognormal_quantiles(median_h: float, sd: float) -> list[float]:
    mu = math.log(max(median_h, 0.5))
    return [math.exp(mu + sd * _N.inv_cdf((k + 0.5) / _L_QUANTILES)) for k in range(_L_QUANTILES)]


def _foodkeeper_prior(profile: Profile) -> tuple[float, float]:
    lo, hi = profile.shelf_life_days
    sd = max(math.log(hi / lo) / (2 * 1.2816), 0.2)  # range as 10th-90th percentile
    return profile.shelf_life_hours, sd


def shelf_life_prior(item: Item, profile: Profile) -> tuple[list[float], dict, float | None]:
    """Quantiles of L in equivalent hours, a description, and a hard cut-off time."""
    fk_median, fk_sd = _foodkeeper_prior(profile)
    if item.expires_at is None:
        baseline = {'source': 'foodkeeper', 'hours': fk_median, 'days': list(profile.shelf_life_days)}
        return _lognormal_quantiles(fk_median, fk_sd), baseline, None

    to_date_h = max((item.expires_at - item.added_at) / 3600, 1.0)
    kind = item.date_kind or 'expires'
    if kind == 'sell_by':
        median, sd = to_date_h + fk_median, SELL_BY_SD
    else:
        factor, sd = DATE_RULES.get(kind, DATE_RULES['expires'])
        median = to_date_h * factor
    quantiles = _lognormal_quantiles(median, sd)
    if not item.packaged:
        # Opened: no longer than an opened item of this kind keeps.
        fk = _lognormal_quantiles(fk_median, fk_sd)
        quantiles = [min(d, f) for d, f in zip(quantiles, fk)]
    # FSIS: follow a use-by date on perishable, TCS foods.
    cutoff = item.expires_at if kind == 'use_by' and profile.two_hour_rule else None
    return quantiles, {'source': 'date', 'kind': kind, 'hours': median}, cutoff


def _expected_stage(used: float, curve: str) -> float:
    xs, ys = VISUAL_CURVES[curve]
    if used <= xs[0]:
        return ys[0]
    for (x0, y0), (x1, y1) in zip(zip(xs, ys), zip(xs[1:], ys[1:])):
        if used <= x1:
            return y0 + (y1 - y0) * (used - x0) / (x1 - x0)
    return ys[-1]


def _check_sd(check: Check, profile: Profile) -> float:
    if check.source == 'photo':
        sd = PHOTO_SD / math.sqrt(max(check.confidence if check.confidence is not None else 0.6, 0.3))
    else:
        sd = MANUAL_SD
    return sd * (MICROBIAL_SD_SCALE if profile.visual == 'microbial' else 1.0)


def rating_likelihood(stage: int, expected: float, sd: float) -> float:
    """Ordered-probit chance of a rating, mixed with a small chance of error."""
    lo = -math.inf if stage == 0 else stage - 0.5
    hi = math.inf if stage == len(STAGES) - 1 else stage + 0.5
    p = _N.cdf((hi - expected) / sd) - _N.cdf((lo - expected) / sd)
    return (1 - OUTLIER_SHARE) * p + OUTLIER_SHARE / len(STAGES)


def _gap_temperature(readings: list[Reading], start: float, now: float) -> tuple[float, float]:
    seen = [r.temp_c for r in readings if start <= r.t <= now]
    if len(seen) >= 60:  # an hour of per-minute readings
        return sum(seen) / len(seen), OBSERVED_SD_C
    return HOME_FRIDGE_C, HOME_FRIDGE_SD_C


def _weighted_quantile(pairs: list[tuple[float, float]], q: float) -> float:
    """Interpolated weighted quantile: each value sits at the middle of its
    weight, so small shifts in weight move the result smoothly."""
    pairs = sorted(pairs)
    total = sum(w for _, w in pairs)
    acc = 0.0
    prev_value = prev_position = None
    for value, w in pairs:
        position = (acc + w / 2) / total
        if position >= q:
            if prev_value is None or position == prev_position:
                return value
            return prev_value + (value - prev_value) * (q - prev_position) / (position - prev_position)
        prev_value, prev_position = value, position
        acc += w
    return pairs[-1][0]


def assess(item: Item, readings: list[Reading], now: float) -> Assessment:
    """Estimate one item's remaining shelf life from its zone's readings."""
    profile = PROFILES[item.profile]
    readings = per_minute(readings)
    elapsed_h = max(now - item.added_at, 0) / 3600

    quantiles, baseline, cutoff = shelf_life_prior(item, profile)
    age_prior = AGE_PRIOR_WITH_DATE if item.expires_at is not None else AGE_PRIOR_NO_DATE
    k = profile.kinetics
    gap_mu, gap_sd = _gap_temperature(readings, item.added_at, now)

    central = simulate(item, readings, now, k.value, gap_mu)
    scenarios: list[tuple[Trace, float]] = []
    for theta, w_theta in _gh(k.value, k.sd):
        gaps = _gh(gap_mu, gap_sd) if central.gap_hours > 0.01 else [(gap_mu, 1.0)]
        for gap_c, w_gap in gaps:
            trace = central if (theta == k.value and gap_c == gap_mu) else simulate(item, readings, now, theta, gap_c)
            scenarios.append((trace, w_theta * w_gap))
    water_multipliers = (
        [(math.exp(WATER_MULTIPLIER_SD * _N.inv_cdf((k + 0.5) / _M_QUANTILES)), 1 / _M_QUANTILES) for k in range(_M_QUANTILES)]
        if profile.water else [(1.0, 1.0)]
    )
    limit = profile.water.limit_pct if profile.water else None

    checks = sorted((c for c in item.checks if c.freshness in STAGES and c.t <= now), key=lambda c: c.t)
    check_stages = [STAGES.index(c.freshness) for c in checks]
    check_sds = [_check_sd(c, profile) for c in checks]

    particles = []  # (posterior weight, prior weight, used now, remaining h, limiting)
    for trace, w_scenario in scenarios:
        e_now, w_now = trace.at(now)
        at_checks = [trace.at(max(c.t, item.added_at)) for c in checks]
        for multiplier, w_m in water_multipliers:
            water_now = multiplier * w_now / limit if limit else 0.0
            water_checks = [multiplier * w / limit if limit else 0.0 for _, w in at_checks]
            water_rate = multiplier * trace.future_water_pct_h
            for life in quantiles:
                for age, w_age in age_prior:
                    prior = w_scenario * w_m * w_age / _L_QUANTILES
                    likelihood = 1.0
                    for (e_check, _), water_check, stage, sd in zip(at_checks, water_checks, check_stages, check_sds):
                        used_then = max(age + e_check / life, water_check)
                        likelihood *= rating_likelihood(stage, _expected_stage(used_then, profile.visual), sd)

                    aging_used = age + e_now / life
                    used = max(aging_used, water_now)
                    aging_left = (1 - aging_used) * life / trace.future_rate if trace.future_rate > 1e-9 else HORIZON_H
                    water_left = (1 - water_now) * limit / water_rate if limit and water_rate > 1e-12 else HORIZON_H
                    remaining, limiting = (aging_left, 'temperature') if aging_left <= water_left else (water_left, 'water')
                    if cutoff is not None and (cutoff - now) / 3600 < remaining:
                        remaining, limiting = (cutoff - now) / 3600, 'date'
                        used = max(used, 1.0) if now >= cutoff else used
                    remaining = min(max(remaining, 0.0), HORIZON_H)
                    particles.append((prior * likelihood, prior, used, remaining, limiting))

    total = sum(p[0] for p in particles) or 1.0
    weights = [p[0] / total for p in particles]
    prior_total = sum(p[1] for p in particles)

    remaining = [(p[3], w) for p, w in zip(particles, weights)]
    median = _weighted_quantile(remaining, 0.5)
    p10 = _weighted_quantile(remaining, 0.1)
    p90 = _weighted_quantile(remaining, 0.9)
    prior_median = _weighted_quantile([(p[3], p[1] / prior_total) for p in particles], 0.5)
    p_spoiled = sum(w for p, w in zip(particles, weights) if p[2] >= 1 or p[3] <= 0)
    used_median = _weighted_quantile([(p[2], w) for p, w in zip(particles, weights)], 0.5)
    score = round(100 * sum(w * min(max(1 - p[2], 0.0), 1.0) for p, w in zip(particles, weights)))

    limiting_weight: dict[str, float] = {}
    for p, w in zip(particles, weights):
        limiting_weight[p[4]] = limiting_weight.get(p[4], 0) + w
    limiting = max(limiting_weight, key=limiting_weight.get)

    horizon = max(p90 * 1.4, 24.0)
    distinct: dict[float, float] = {}
    for value, w in remaining:
        if value > 0:
            key = round(value, 2)
            distinct[key] = distinct.get(key, 0) + w
    survival = [(0.0, round(1 - p_spoiled, 4))] + [
        (round(h, 2), round(sum(
            w * _N.cdf(math.log(value / h) / SURVIVAL_SMOOTHING) for value, w in distinct.items()
        ), 4))
        for h in (horizon * i / 24 for i in range(1, 25))
    ]

    if profile.two_hour_rule and central.danger_zone_hours >= TWO_HOUR_LIMIT_H:
        status = 'discard'
    elif p_spoiled >= EXPIRED_PROBABILITY:
        status = 'expired'
    elif used_median >= AT_RISK_AT or p_spoiled >= AT_RISK_PROBABILITY:
        status = 'at_risk'
    elif used_median >= USE_SOON_AT:
        status = 'use_soon'
    else:
        status = 'good'

    e_central, w_central = central.at(now)
    return Assessment(
        item=item,
        profile=profile,
        score=max(0, min(100, score)),
        status=status,
        remaining_hours=median,
        remaining_low=p10,
        remaining_high=p90,
        p_spoiled=p_spoiled,
        equivalent_hours=e_central,
        elapsed_hours=elapsed_h,
        danger_zone_hours=central.danger_zone_hours,
        food_temp_c=central.food_temp_c,
        limiting=limiting,
        water_loss_pct=w_central if profile.water else None,
        water_limit_pct=limit,
        baseline=baseline,
        checks_used=len(checks),
        checks_shift_hours=median - prior_median,
        survival=survival,
        loss_by_cause=central.loss_by_cause,
        excursions=central.excursions,
        condensation_minutes=central.condensation_minutes,
        gap_hours=central.gap_hours,
    )
