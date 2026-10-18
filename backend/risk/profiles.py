"""Food profiles: the per-food constants the freshness model runs on.

Every number is either sourced (tag in brackets) or marked OUR ESTIMATE.
Sources:
  [FK]    USDA FSIS FoodKeeper data (v128). Refrigerator storage times, which
          assume a fridge at 40°F (4.4°C).
  [FSIS]  USDA FSIS, "Danger Zone (40°F - 140°F)": the 2-hour and 1-hour rules.
          USDA FSIS, "Food Product Dating": follow a use-by date; with a
          sell-by date or none, use the FoodKeeper times.
  [FC]    FDA Food Code: cut leafy greens are Time/Temperature Control for
          Safety (TCS) food.
  [NRM97] Neumeyer, Ross & McMeekin (1997), Int. J. Food Microbiol. 38:45-54:
          spoilage pseudomonads have a notional Tmin of -7.75°C whatever food
          they come from.
  [GM16]  Ghollasi-Mood et al. (2016), Iranian J. Vet. Sci. Technol.: sensory
          shelf life of chicken at 0, 4, 10 and 15°C (320, 220, 120, 72 h; the
          abstract lists them in reverse). A square-root fit gives Tmin ≈ -13°C.
  [UMN]   "Monitoring shelf life of pasteurized whole milk under refrigerated
          storage" (Univ. of Minnesota): 30, 24 and 12 days at 5, 7 and 10°C.
          A square-root fit gives Tmin ≈ -4°C.
  [FCL]   Sensory shelf life of fresh-cut Iceberg, Romaine and chicory at
          2-20°C (phtnet.org wv211): first-order loss of general appearance
          with Arrhenius activation energies of 65.7-71.1 kJ/mol.
  [DER16] Derossi et al. (2016), J. Food Eng.: fresh-cut lettuce shelf life of
          12.4, 10.4 and 3.7 days at 0, 5 and 15°C.
  [WFLO]  WFLO Commodity Storage Manual, Strawberries (2018): 5-10 days at 0°C
          and 90-95% RH; at 10°C, a third of the life at 0°C.
  [ASH]   ASHRAE Refrigeration Handbook, "Thermal Properties of Foods",
          Table 11 (Sastry et al. 1978): transpiration coefficients in
          ng/(kg·s·Pa). Lettuce 7400, celery 1760, carrots 1207, peaches 572,
          cabbage 223, tomatoes 140, apples 42.
  [ROB]   Robinson et al. (1975), via Kays & Paull (2004) and Thompson et al.
          (2008): maximum water loss before produce is unsaleable. Spinach 3%,
          strawberries 6%, carrots 8%, celery 10%. UC Davis postharvest notes:
          romaine is marketable to 5%, and losses over 5% cause visible
          shrivel in most produce.
  [HOME]  Household fridge surveys: mean 5.1 ± 2.8°C (Poland, 2023),
          5.2 ± 2.5°C (New Zealand), 5.3°C (England, 2015).
"""

import math
from dataclasses import dataclass

REFERENCE_TEMP_C = (40 - 32) / 1.8  # 4.44°C: the fridge temperature FoodKeeper times assume [FK]
_GAS_CONSTANT = 8.314  # J/(mol·K)
_KELVIN = 273.15

# What we assume for time the sensors did not see [HOME]. When a zone has an
# hour or more of its own history, its observed mean replaces the survey mean.
HOME_FRIDGE_C = 5.0
HOME_FRIDGE_SD_C = 2.5
OBSERVED_SD_C = 1.0  # OUR ESTIMATE: spread around a zone's own observed mean
HOME_FRIDGE_RH = 65.0  # OUR ESTIMATE: no household survey of fridge humidity was found

# ASHRAE coefficients were measured in commercial storage with forced air.
# A home fridge has still air, so moisture leaves more slowly. OUR ESTIMATE.
HOUSEHOLD_AIRFLOW_FACTOR = 0.25
# Relative humidity inside a closed produce bag. OUR ESTIMATE.
BAG_RH = 95.0


@dataclass(frozen=True)
class Kinetics:
    """How fast the food ages at a given temperature, relative to 40°F.

    ratkowsky: ((T - Tmin) / (Tref - Tmin))². The square-root model of
               microbial growth, for food that spoils from bacteria.
    arrhenius: exp(Ea/R × (1/Tref - 1/T)). Fits measured quality loss of
               produce, which slows down more gently in the cold than
               pathogen growth limits would suggest [FCL, DER16, WFLO].
    `value` is Tmin (°C) or Ea (kJ/mol); `sd` is its uncertainty, which the
    freshness model spreads over three scenarios.
    """
    model: str
    value: float
    sd: float

    def rate(self, food_c: float, value: float | None = None) -> float:
        v = self.value if value is None else value
        if self.model == "ratkowsky":
            if food_c <= v:
                return 0.0
            return ((food_c - v) / (REFERENCE_TEMP_C - v)) ** 2
        ea = v * 1000 / _GAS_CONSTANT
        return math.exp(ea * (1 / (REFERENCE_TEMP_C + _KELVIN) - 1 / (food_c + _KELVIN)))


@dataclass(frozen=True)
class WaterLoss:
    """Transpiration: weight loss rate = coefficient × vapour pressure deficit."""
    coefficient: float  # ng/(kg·s·Pa), already scaled for still household air
    limit_pct: float  # weight loss at which the food is no longer acceptable


@dataclass(frozen=True)
class Profile:
    id: str
    label: str
    limited_by: str  # what ends shelf life at fridge temperatures
    kinetics: Kinetics
    shelf_life_days: tuple[float, float]  # (min, max) at 40°F [FK]
    two_hour_rule: bool  # subject to the USDA/FDA time-out-of-refrigeration limit
    # Time constant (minutes) for the food's own temperature to follow the air.
    # OUR ESTIMATE from typical package sizes.
    thermal_lag_min: float
    water: WaterLoss | None  # None: sealed or not prone to wilting
    # Multiplier on aging while water condenses on the food. OUR ESTIMATE.
    condensation_multiplier: float
    # How visible spoilage relates to used shelf life. 'appearance': quality
    # loss is what you see (produce). 'microbial': odour comes first and
    # visible slime about a log of growth later, so photos say little until
    # late (meat-hygiene references). Used to weigh photo and manual checks.
    visual: str

    @property
    def shelf_life_hours(self) -> float:
        """Median of the FoodKeeper range, read as a 10th-90th percentile span."""
        lo, hi = self.shelf_life_days
        return math.sqrt(lo * hi) * 24

    @property
    def max_shelf_life_hours(self) -> float:
        return self.shelf_life_days[1] * 24


def _water(ashrae_coefficient: float, limit_pct: float) -> WaterLoss:
    return WaterLoss(ashrae_coefficient * HOUSEHOLD_AIRFLOW_FACTOR, limit_pct)


PROFILES: dict[str, Profile] = {
    'poultry': Profile(
        id='poultry',
        label='Raw poultry',
        limited_by='Spoilage pseudomonads',
        # Tmin -7.75°C [NRM97]. The ±3°C spread (scenarios at ±5.2°C) covers
        # the chicken [GM16] and milk [UMN] fits.
        kinetics=Kinetics('ratkowsky', -7.75, 3.0),
        shelf_life_days=(1, 2),  # [FK] chicken and turkey, whole, parts or ground
        two_hour_rule=True,  # [FSIS] poultry is named explicitly
        thermal_lag_min=40,
        water=None,  # sold sealed
        condensation_multiplier=1.0,
        visual='microbial',
    ),
    'dairy': Profile(
        id='dairy',
        label='Milk',
        limited_by='Spoilage pseudomonads',
        kinetics=Kinetics('ratkowsky', -7.75, 3.0),  # [NRM97] strains isolated from milk
        # [FK] plain milk says "use the package date". 5-7 days matches its
        # entries for opened lactose-free and shelf-stable milk, and is used
        # when there is no printed date.
        shelf_life_days=(5, 7),
        two_hour_rule=True,  # [FSIS] perishable dairy
        thermal_lag_min=60,  # a full jug changes temperature slowly
        water=None,
        condensation_multiplier=1.0,
        visual='microbial',
    ),
    'greens': Profile(
        id='greens',
        label='Leafy greens',
        limited_by='Wilting, yellowing and decay',
        kinetics=Kinetics('arrhenius', 70.0, 5.0),  # [FCL] 65.7-71.1 kJ/mol
        shelf_life_days=(3, 7),  # [FK] lettuce, leaf / spinach
        two_hour_rule=True,  # [FC] cut leafy greens are TCS
        thermal_lag_min=15,  # light, loose leaves
        water=_water(7400, 4.0),  # [ASH] lettuce; [ROB] spinach 3%, romaine 5%
        condensation_multiplier=1.3,
        visual='appearance',
    ),
    'berries': Profile(
        id='berries',
        label='Strawberries',
        limited_by='Gray mold and softening',
        # [WFLO] a third of the life at 10°C vs 0°C, so Q10 ≈ 3 and Ea ≈ 70.6 kJ/mol.
        kinetics=Kinetics('arrhenius', 70.6, 10.0),
        shelf_life_days=(2, 3),  # [FK] strawberries
        two_hour_rule=False,  # whole fruit is not a TCS food
        thermal_lag_min=20,
        # ASHRAE has no strawberry entry; the peach average stands in for a
        # thin-skinned fruit. OUR ESTIMATE. Limit 6% [ROB].
        water=_water(572, 6.0),
        condensation_multiplier=2.0,  # free water is what mold spores need
        visual='appearance',
    ),
    'produce': Profile(
        id='produce',
        label='Whole produce',
        limited_by='Ripening, softening and water loss',
        # OUR ESTIMATE: respiration rises 2-4x per 10°C [WFLO], so Q10 ≈ 2.5.
        kinetics=Kinetics('arrhenius', 60.0, 12.0),
        # OUR ESTIMATE: a broad range spanning [FK] broccoli (3-5 d),
        # cucumbers (4-6 d), head lettuce (7-14 d) and carrots (14-21 d).
        shelf_life_days=(5, 14),
        two_hour_rule=False,
        thermal_lag_min=30,
        # OUR ESTIMATE: between tomatoes (140) and carrots (1207) [ASH], with
        # visible shrivel above 5-6% loss [ROB].
        water=_water(500, 6.0),
        condensation_multiplier=1.0,
        visual='appearance',
    ),
    'other': Profile(
        id='other',
        label='Other refrigerated food',
        limited_by='Mixed spoilage organisms',
        kinetics=Kinetics('ratkowsky', -7.75, 3.0),  # OUR ESTIMATE: as for pseudomonads, wider
        # [FK] leftovers, soups and stews 3-4 days; store-sliced deli meat 3-5 days.
        shelf_life_days=(3, 5),
        two_hour_rule=True,
        thermal_lag_min=40,
        water=None,
        condensation_multiplier=1.0,
        visual='microbial',
    ),
}
