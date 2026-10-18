"""The freshness model: printed dates, freshness checks, uncertainty, and
agreement with the published measurements its constants come from."""

import math

import pytest

from risk import PROFILES, REFERENCE_TEMP_C, Check, Item, Reading, assess, saturation_pressure_pa
from risk.freshness import STAGES, _check_sd, _expected_stage, rating_likelihood
from risk.profiles import BAG_RH

HOUR = 3600
DAY = 24 * HOUR
T0 = 1_700_000_000.0


def series(segments, step=60, start=T0):
    readings, t = [], start
    for hours, temp_c, humidity in segments:
        for _ in range(int(hours * HOUR / step)):
            readings.append(Reading(t, temp_c, humidity))
            t += step
    return readings


def item(profile, packaged=True, **extra):
    return Item(id=profile, name=profile, profile=profile, zone='mid', added_at=T0, packaged=packaged, **extra)


FRIDGE_DAY = series([(24, REFERENCE_TEMP_C, 70)])
NOW = FRIDGE_DAY[-1].t


# Printed dates

def test_use_by_date_caps_perishable_food():
    a = assess(item('poultry', expires_at=T0 + 5 * DAY, date_kind='use_by'), FRIDGE_DAY, NOW)
    assert a.remaining_high <= (T0 + 5 * DAY - NOW) / HOUR + 0.01
    assert a.baseline['source'] == 'date'


def test_passed_use_by_date_means_expired():
    a = assess(item('poultry', expires_at=T0 + 20 * HOUR, date_kind='use_by'), FRIDGE_DAY, NOW)
    assert a.status == 'expired'
    assert a.p_spoiled == pytest.approx(1.0)


def test_best_by_date_sets_the_baseline_for_sealed_food():
    a = assess(item('dairy', expires_at=T0 + 10 * DAY, date_kind='best_by'), FRIDGE_DAY, NOW)
    assert a.baseline['hours'] == pytest.approx(10 * 24 * 1.15)
    assert 9 * 24 < a.remaining_hours < 11 * 24


def test_opened_food_keeps_no_longer_than_foodkeeper_allows():
    sealed = assess(item('dairy', expires_at=T0 + 10 * DAY, date_kind='best_by'), FRIDGE_DAY, NOW)
    opened = assess(item('dairy', packaged=False, expires_at=T0 + 10 * DAY, date_kind='best_by'), FRIDGE_DAY, NOW)
    assert opened.remaining_hours < sealed.remaining_hours
    assert opened.remaining_high <= PROFILES['dairy'].max_shelf_life_hours * 1.5


def test_sell_by_date_adds_the_foodkeeper_time():
    a = assess(item('poultry', expires_at=T0 + 2 * DAY, date_kind='sell_by'), FRIDGE_DAY, NOW)
    assert a.baseline['hours'] == pytest.approx(48 + PROFILES['poultry'].shelf_life_hours)


# Freshness checks

def greens_with(*checks):
    return assess(item('greens', checks=tuple(checks)), FRIDGE_DAY, NOW)


def test_checks_move_the_estimate_in_the_direction_they_point():
    none = greens_with()
    fair = greens_with(Check(NOW - 60, 'fair', 'photo', 0.9))
    fresh = greens_with(Check(NOW - 60, 'fresh', 'photo', 0.9))
    assert fair.remaining_hours < none.remaining_hours < fresh.remaining_hours
    assert fair.checks_shift_hours < 0 < fresh.checks_shift_hours


def test_repeated_poor_checks_mark_food_at_risk():
    a = greens_with(Check(T0, 'poor', 'manual'), Check(NOW - 60, 'poor', 'manual'))
    assert a.status in ('at_risk', 'expired')


def test_one_unsure_spoiled_photo_does_not_override_everything():
    a = greens_with(Check(T0, 'spoiled', 'photo', 0.3))
    assert a.status != 'expired'


def test_a_confident_photo_counts_more_than_an_unsure_one():
    sure = greens_with(Check(NOW - 60, 'poor', 'photo', 0.95))
    unsure = greens_with(Check(NOW - 60, 'poor', 'photo', 0.3))
    assert sure.remaining_hours < unsure.remaining_hours


def test_photos_of_meat_say_less_than_photos_of_produce():
    # Raw poultry looks fine until well after it smells off, so a "good"
    # photo barely separates early from late shelf life; for greens it does.
    def separation(profile):
        p = PROFILES[profile]
        sd = _check_sd(Check(0, 'good', 'photo', 0.9), p)
        good = STAGES.index('good')
        early = rating_likelihood(good, _expected_stage(0.3, p.visual), sd)
        late = rating_likelihood(good, _expected_stage(0.9, p.visual), sd)
        return early / late

    assert separation('greens') > 3
    assert separation('poultry') < 1.5


# Uncertainty

def test_unobserved_time_widens_the_range():
    # Three days with no readings at all are filled with the household-survey
    # spread (5 ± 2.5°C), so the estimate should be less certain than three
    # observed days at that same mean temperature.
    now = T0 + 72 * HOUR
    seen = assess(item('produce'), series([(72, 5.0, 70)]), now)
    unseen = assess(item('produce'), [], now)
    assert unseen.gap_hours == pytest.approx(72, abs=0.1)
    assert (unseen.remaining_high - unseen.remaining_low) > 1.1 * (seen.remaining_high - seen.remaining_low)


def test_survival_curve_falls_from_now_on():
    a = greens_with()
    probabilities = [p for _, p in a.survival]
    assert probabilities[0] == pytest.approx(1 - a.p_spoiled, abs=0.02)
    assert all(later <= earlier + 1e-9 for earlier, later in zip(probabilities, probabilities[1:]))
    assert probabilities[-1] < 0.1


# Agreement with the sources (see profiles.py)

def shelf_life_ratio(profile, warm_c, cold_c, value=None):
    k = PROFILES[profile].kinetics
    return k.rate(warm_c, value) / k.rate(cold_c, value)


def test_lettuce_temperature_sensitivity_matches_derossi_2016():
    # 10.4 days at 5°C vs 3.7 days at 15°C [DER16].
    assert shelf_life_ratio('greens', 15, 5) == pytest.approx(10.4 / 3.7, rel=0.1)


def test_strawberries_last_a_third_as_long_at_10c_as_at_0c():
    assert shelf_life_ratio('berries', 10, 0) == pytest.approx(3.0, rel=0.02)  # [WFLO]


def fitted_tmin(temps_c, shelf_lives):
    """Least-squares square-root fit: sqrt(1 / shelf life) is linear in T."""
    ys = [math.sqrt(1 / life) for life in shelf_lives]
    t_mean, y_mean = sum(temps_c) / len(temps_c), sum(ys) / len(ys)
    slope = sum((t - t_mean) * (y - y_mean) for t, y in zip(temps_c, ys)) / sum((t - t_mean) ** 2 for t in temps_c)
    return t_mean - y_mean / slope


@pytest.mark.parametrize(('profile', 'temps', 'lives', 'expected_tmin'), [
    ('poultry', (0, 4, 10, 15), (320, 220, 120, 72), -12.9),  # chicken sensory shelf life, h [GM16]
    ('dairy', (5, 7, 10), (30, 24, 12), -3.0),  # pasteurized whole milk, days [UMN]
])
def test_measured_temperature_dependence_falls_inside_the_modelled_spread(profile, temps, lives, expected_tmin):
    tmin = fitted_tmin(temps, lives)
    assert tmin == pytest.approx(expected_tmin, abs=0.1)
    k = PROFILES[profile].kinetics
    assert k.value - math.sqrt(3) * k.sd <= tmin <= k.value + math.sqrt(3) * k.sd


def test_bagged_greens_wilt_on_the_foodkeeper_timescale():
    # Water loss alone should bring bagged greens to their limit within
    # roughly the 3-7 days FoodKeeper gives leafy greens.
    water = PROFILES['greens'].water
    vpd = saturation_pressure_pa(REFERENCE_TEMP_C) * (1 - BAG_RH / 100)
    days_to_limit = water.limit_pct / (water.coefficient * 1e-12 * vpd * 100) / DAY
    assert 3 <= days_to_limit <= 9


def test_one_check_narrows_the_range_without_collapsing_it():
    # A "fair" rating of unbagged greens pins down how fast they are losing
    # water, but should still leave a real range rather than a single value.
    readings = series([(16, 2.0, 71)])
    a = assess(item('greens', packaged=False, checks=(Check(readings[-1].t, 'fair', 'manual'),)), readings, readings[-1].t)
    assert a.limiting == 'water'
    assert a.remaining_high - a.remaining_low > 0.5 * a.remaining_hours
