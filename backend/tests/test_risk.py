import pytest

from risk import PROFILES, REFERENCE_TEMP_C, Item, Reading, assess, dew_point_c, recommend, temperature_factor

HOUR = 3600
MIN = 60
T0 = 1_700_000_000.0


def f_to_c(f):
    return (f - 32) / 1.8


def series(segments, step=MIN, start=T0):
    """segments: [(hours, temp_c, humidity)] played back to back, one reading per step."""
    readings, t = [], start
    for hours, temp_c, humidity in segments:
        for _ in range(int(hours * HOUR / step)):
            readings.append(Reading(t, temp_c, humidity))
            t += step
    return readings


def item(profile, packaged=False, zone='mid'):
    return Item(id=profile, name=PROFILES[profile].label, profile=profile, zone=zone, added_at=T0, packaged=packaged)


def test_temperature_factor_is_one_at_reference():
    for profile in PROFILES.values():
        assert temperature_factor(REFERENCE_TEMP_C, profile) == pytest.approx(1.0)


def test_temperature_factor_matches_ratkowsky():
    # Pseudomonads, Tmin -7.75°C, at 10°C: ((10 + 7.75) / (4.44 + 7.75))^2
    expected = ((10 + 7.75) / (REFERENCE_TEMP_C + 7.75)) ** 2
    assert temperature_factor(10, PROFILES['poultry']) == pytest.approx(expected)
    assert expected == pytest.approx(2.12, abs=0.01)
    assert temperature_factor(-10, PROFILES['poultry']) == 0


def test_dew_point_known_value():
    # 20°C at 50% RH has a dew point of about 9.3°C.
    assert dew_point_c(20, 50) == pytest.approx(9.3, abs=0.1)


def test_steady_40f_ages_at_one_hour_per_hour():
    readings = series([(12, REFERENCE_TEMP_C, 70)])
    a = assess(item('poultry'), readings, now=readings[-1].t)
    assert a.equivalent_hours == pytest.approx(a.elapsed_hours, rel=0.01)
    # Poultry baseline is 1.5 days (FoodKeeper 1-2): 12 h used leaves 24 h.
    assert a.remaining_hours == pytest.approx(24, abs=0.5)
    assert a.status == 'good'


def test_colder_storage_lasts_longer_but_not_past_usda_max():
    readings = series([(30, f_to_c(34), 70)])
    a = assess(item('poultry'), readings, now=readings[-1].t)
    assert a.equivalent_hours < 0.75 * a.elapsed_hours
    # Capped by the 2-day upper bound: 48 h minus 30 h elapsed.
    assert a.remaining_hours == pytest.approx(18, abs=0.5)


def test_brief_lid_opening_does_not_trigger_two_hour_rule():
    readings = series([(1, f_to_c(37), 70), (0.25, f_to_c(55), 75), (2, f_to_c(37), 70)])
    a = assess(item('dairy'), readings, now=readings[-1].t)
    assert a.danger_zone_hours < 0.5
    assert a.status != 'discard'


def test_long_warm_spell_triggers_two_hour_rule():
    readings = series([(1, f_to_c(37), 70), (4, f_to_c(60), 75)])
    a = assess(item('poultry'), readings, now=readings[-1].t)
    assert a.danger_zone_hours >= 2
    assert a.status == 'discard'


def test_strawberries_are_not_subject_to_two_hour_rule():
    readings = series([(1, f_to_c(37), 92), (4, f_to_c(60), 92)])
    a = assess(item('berries'), readings, now=readings[-1].t)
    assert a.danger_zone_hours >= 2
    assert a.status != 'discard'


def test_dry_air_wilts_open_greens_but_not_bagged_ones():
    readings = series([(24, REFERENCE_TEMP_C, 55)])
    open_greens = assess(item('greens'), readings, now=readings[-1].t)
    bagged = assess(item('greens', packaged=True), readings, now=readings[-1].t)
    assert bagged.equivalent_hours == pytest.approx(24, rel=0.01)
    # 40 points below the 95% band at 0.25 per 10 points: twice as fast.
    assert open_greens.equivalent_hours == pytest.approx(48, rel=0.02)
    assert open_greens.loss_by_cause['dry air'] == pytest.approx(24, rel=0.02)


def test_humidity_is_ignored_for_poultry():
    dry = series([(12, REFERENCE_TEMP_C, 30)])
    humid = series([(12, REFERENCE_TEMP_C, 95)])
    assert assess(item('poultry'), dry, now=dry[-1].t).equivalent_hours == pytest.approx(
        assess(item('poultry'), humid, now=humid[-1].t).equivalent_hours
    )


def test_warm_humid_air_condenses_on_cold_berries():
    readings = series([(2, f_to_c(34), 92), (0.5, f_to_c(60), 80)])
    a = assess(item('berries'), readings, now=readings[-1].t)
    assert a.condensation_minutes > 0
    assert a.loss_by_cause.get('condensation', 0) > 0


def test_excursions_are_reported_largest_first():
    readings = series([
        (1, f_to_c(37), 70), (0.5, f_to_c(48), 70),
        (2, f_to_c(37), 70), (1.5, f_to_c(52), 70),
        (1, f_to_c(37), 70),
    ])
    # Bagged greens follow the air within minutes, so both warm spells register.
    a = assess(item('greens', packaged=True), readings, now=readings[-1].t)
    assert len(a.excursions) == 2
    assert a.excursions[0].extra_hours > a.excursions[1].extra_hours
    assert a.excursions[0].start > a.excursions[1].start  # the later, longer one


def test_full_milk_jug_rides_out_a_short_spike():
    readings = series([(1, f_to_c(37), 70), (0.5, f_to_c(48), 70), (2, f_to_c(37), 70)])
    a = assess(item('dairy'), readings, now=readings[-1].t)
    assert a.food_temp_c < REFERENCE_TEMP_C
    assert a.excursions == []


def test_sensor_gap_is_reported():
    readings = series([(1, REFERENCE_TEMP_C, 70)]) + series([(1, REFERENCE_TEMP_C, 70)], start=T0 + 4 * HOUR)
    a = assess(item('dairy'), readings, now=readings[-1].t)
    assert a.gap_hours == pytest.approx(3 - 10 / 60, abs=0.05)


def test_recommendations():
    warm = series([(1, f_to_c(37), 70), (4, f_to_c(60), 75)])
    dry = series([(30, REFERENCE_TEMP_C, 55)])
    assessments = [
        assess(item('poultry', zone='top'), warm, now=warm[-1].t),
        assess(item('greens', zone='mid'), dry, now=dry[-1].t),
    ]
    recs = recommend(assessments, {'top': f_to_c(40), 'mid': f_to_c(38), 'bottom': f_to_c(35)})
    titles = [r.title for r in recs]
    assert 'Discard the raw poultry' in titles
    assert 'Bag the leafy greens or move them to the crisper' in titles
    assert 'Check the door seal' in titles
