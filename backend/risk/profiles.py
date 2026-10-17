"""Food profiles: the per-food constants the risk engine runs on.

Every number is either sourced (citation next to it) or marked OUR ESTIMATE.
Sources:
  [FK]    USDA FSIS FoodKeeper dataset (FoodKeeper-Data.xls, 2021 export),
          refrigerator storage times. Times assume a fridge at 40°F (4.4°C).
  [FSIS]  USDA FSIS, "Danger Zone (40°F - 140°F)": keep cold food at or below
          40°F; never leave food out of refrigeration over 2 hours, or 1 hour
          above 90°F.
  [FC]    FDA Food Code (2009 onward): cut leafy greens are a Time/Temperature
          Control for Safety (TCS) food.
  [HB66]  USDA Agriculture Handbook 66, "The Commercial Storage of Fruits,
          Vegetables, and Florist and Nursery Stocks" (2016): recommended
          storage relative humidity.
  [NRM97] Neumeyer, Ross & McMeekin (1997), Int. J. Food Microbiol. 38:45-54,
          and the associated UTas thesis: notional Tmin of psychrotrophic
          spoilage pseudomonads is 265.4 K +/- 0.7 (-7.75°C), regardless of
          the food the strain came from.
  [LM]    Listeria monocytogenes grows from about -1.5°C (cited in Food Sci.
          Technol. Res. 24(6):1021, 2018).
  [BC]    Botrytis cinerea (gray mold) grows from about -2°C (28°F) and rots
          stored fruit at 32°F (Bugwood Wiki, Botrytis cinerea).
"""

from dataclasses import dataclass

REFERENCE_TEMP_C = (40 - 32) / 1.8  # 4.44°C: the fridge temperature FoodKeeper times assume [FK]


@dataclass(frozen=True)
class HumidityBand:
    low: float  # % RH; below this the food dries or wilts
    high: float  # % RH; above this surface moisture matters
    # How much faster quality is lost per 10 points of RH outside the band.
    # OUR ESTIMATE: no published model maps RH deficit to shelf-life loss for
    # household storage, so these are tuned to be plausible, not measured.
    dry_rate_per_10pts: float
    wet_rate_per_10pts: float
    # Multiplier while water condenses on the food. OUR ESTIMATE.
    condensation_multiplier: float


@dataclass(frozen=True)
class Profile:
    id: str
    label: str
    organism: str  # what limits shelf life at fridge temperatures
    t_min_c: float  # Ratkowsky notional minimum growth temperature
    shelf_life_days: tuple[float, float]  # (min, max) at the reference temperature [FK]
    two_hour_rule: bool  # subject to the USDA/FDA time-out-of-refrigeration limit
    # Time constant (minutes) for the food's own temperature to follow the air.
    # OUR ESTIMATE from typical package sizes; replace with a measured value
    # (probe in a milk jug during a lid-open test) once the hardware is here.
    thermal_lag_min: float
    humidity: HumidityBand | None  # None: sealed or insensitive, RH ignored

    @property
    def shelf_life_hours(self) -> float:
        lo, hi = self.shelf_life_days
        return (lo + hi) / 2 * 24

    @property
    def max_shelf_life_hours(self) -> float:
        return self.shelf_life_days[1] * 24


PROFILES: dict[str, Profile] = {
    'poultry': Profile(
        id='poultry',
        label='Raw poultry',
        organism='Spoilage pseudomonads',
        t_min_c=-7.75,  # [NRM97]
        shelf_life_days=(1, 2),  # [FK] chicken/turkey, whole, parts or ground
        two_hour_rule=True,  # [FSIS] poultry is named explicitly
        thermal_lag_min=40,
        humidity=None,  # sold sealed; RH does not change its spoilage
    ),
    'dairy': Profile(
        id='dairy',
        label='Milk',
        organism='Spoilage pseudomonads',
        t_min_c=-7.75,  # [NRM97] strains isolated from milk
        # [FK] plain milk only says "package use-by date"; 7 days after opening
        # matches its entries for lactose-free (1 week) and shelf-stable
        # (5-7 days) milk once opened.
        shelf_life_days=(5, 7),
        two_hour_rule=True,  # [FSIS] perishable dairy
        thermal_lag_min=60,  # a full jug changes temperature slowly
        humidity=None,
    ),
    'greens': Profile(
        id='greens',
        label='Leafy greens',
        organism='Listeria monocytogenes',
        t_min_c=-1.5,  # [LM]
        shelf_life_days=(3, 7),  # [FK] lettuce, leaf / spinach
        two_hour_rule=True,  # [FC] cut leafy greens are TCS
        thermal_lag_min=15,  # light, loose leaves
        humidity=HumidityBand(
            low=95,  # [HB66] spinach 95-100%, lettuce 98-100%
            high=100,
            dry_rate_per_10pts=0.25,
            wet_rate_per_10pts=0,
            condensation_multiplier=1.3,
        ),
    ),
    'berries': Profile(
        id='berries',
        label='Strawberries',
        organism='Botrytis cinerea (gray mold)',
        t_min_c=-2.0,  # [BC]
        shelf_life_days=(2, 3),  # [FK] strawberries and raspberries
        two_hour_rule=False,  # whole fruit is not a TCS food
        thermal_lag_min=20,
        humidity=HumidityBand(
            low=90,  # [HB66] strawberries 90-95%
            high=95,
            dry_rate_per_10pts=0.1,
            wet_rate_per_10pts=0.2,
            condensation_multiplier=2.0,  # free water is what mold spores need
        ),
    ),
    # OUR ESTIMATE: a broad profile for intact, non-leafy produce such as
    # onions, carrots, cucumbers, tomatoes, and cauliflower. Storage life
    # varies substantially by crop and preparation; users should prefer a
    # specific profile when one is available.
    'produce': Profile(
        id='produce',
        label='Whole produce',
        organism='Mixed postharvest spoilage organisms',
        t_min_c=-2.0,
        shelf_life_days=(5, 14),
        two_hour_rule=False,
        thermal_lag_min=30,
        humidity=None,
    ),
    # OUR ESTIMATE: catch-all for refrigerated foods without a dedicated
    # profile. This should not replace the package's date or handling advice.
    'other': Profile(
        id='other',
        label='Other refrigerated food',
        organism='Mixed spoilage organisms',
        t_min_c=-7.75,
        shelf_life_days=(3, 7),
        two_hour_rule=True,
        thermal_lag_min=40,
        humidity=None,
    ),
}
