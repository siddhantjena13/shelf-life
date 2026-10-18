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


def item(profile, packaged=False, zone='mid', **extra):
    return Item(id=profile, name=PROFILES[profile].label, profile=profile, zone=zone, added_at=T0, packaged=packaged, **extra)


def test_temperature_factor_is_one_at_reference():
    for profile in PROFILES.values():
        assert temperature_factor(REFERENCE_TEMP_C, profile) == pytest.approx(1.0)


def test_temperature_factor_matches_ratkowsky():
    # Pseudomonads, Tmin -7.75°C, at 10°C: ((10 + 7.75) / (4.44 + 7.75))^2
    expected = ((10 + 7.75) / (REFERENCE_TEMP_C + 7.75)) ** 2
    assert temperature_factor(10, PROFILES['poultry']) == pytest.approx(expected)
    assert expected == pytest.approx(2.12, abs=0.01)
    assert temperature_factor(-10, PROFILES['poultry']) == 0


def test_produce_slows_gently_in_the_cold():
    # Arrhenius, Ea 70 kJ/mol: 0°C keeps greens about 1.6x longer than 40°F,
    # where a pathogen growth limit would claim about 15x.
    assert 1 / temperature_factor(0, PROFILES['greens']) == pytest.approx(1.6, abs=0.15)


def test_dew_point_known_value():
    # 20°C at 50% RH has a dew point of about 9.3°C.
    assert dew_point_c(20, 50) == pytest.approx(9.3, abs=0.1)


def test_steady_40f_ages_at_one_hour_per_hour():
    readings = series([(12, REFERENCE_TEMP_C, 70)])
    a = assess(item('poultry'), readings, now=readings[-1].t)
    assert a.equivalent_hours == pytest.approx(a.elapsed_hours, rel=0.01)
    # FoodKeeper 1-2 days, median about 34 h: roughly 22 h left after 12 h.
    assert 15 < a.remaining_hours < 23
    assert a.remaining_low < a.remaining_hours < a.remaining_high
    assert a.status == 'good'


def test_colder_storage_lasts_longer():
    cold = series([(12, f_to_c(34), 70)])
    ref = series([(12, REFERENCE_TEMP_C, 70)])
    cold_a = assess(item('poultry'), cold, now=cold[-1].t)
    ref_a = assess(item('poultry'), ref, now=ref[-1].t)
    assert cold_a.equivalent_hours < 0.75 * cold_a.elapsed_hours
    assert cold_a.remaining_hours > ref_a.remaining_hours


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
    # The same temperature history ages both alike; only water loss differs.
    assert open_greens.equivalent_hours == pytest.approx(bagged.equivalent_hours)
    assert open_greens.water_loss_pct > 5 * bagged.water_loss_pct
    assert open_greens.water_loss_pct > open_greens.water_limit_pct
    assert open_greens.limiting == 'water'
    assert open_greens.status in ('at_risk', 'expired')
    assert bagged.status == 'good'


def test_humidity_is_ignored_for_poultry():
    dry = series([(12, REFERENCE_TEMP_C, 30)])
    humid = series([(12, REFERENCE_TEMP_C, 95)])
    dry_a = assess(item('poultry'), dry, now=dry[-1].t)
    humid_a = assess(item('poultry'), humid, now=humid[-1].t)
    assert dry_a.equivalent_hours == pytest.approx(humid_a.equivalent_hours)
    assert dry_a.water_loss_pct is None


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
    dry = series([(12, REFERENCE_TEMP_C, 55)])
    assessments = [
        assess(item('poultry', zone='top'), warm, now=warm[-1].t),
        assess(item('greens', zone='mid'), dry, now=dry[-1].t),
    ]
    recs = recommend(assessments, {'top': f_to_c(40), 'mid': f_to_c(38), 'bottom': f_to_c(35)})
    titles = [r.title for r in recs]
    assert 'Discard the raw poultry' in titles
    assert 'Bag the leafy greens or move them to the crisper' in titles
    assert 'Check the door seal' in titles


def test_fridge_cycling_just_above_40f_is_not_a_discard():
    # Food hovering at 40.5°F for hours is within sensor accuracy of 40°F;
    # it ages a little faster but is not the 2-hour rule's case.
    readings = series([(6, f_to_c(40.5), 70)])
    a = assess(item('dairy'), readings, now=readings[-1].t)
    assert a.danger_zone_hours == 0
    assert a.status != 'discard'
    assert a.equivalent_hours > a.elapsed_hours
