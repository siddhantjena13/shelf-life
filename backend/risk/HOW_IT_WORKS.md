# How the freshness model works

A thermometer tells you the temperature right now. ShelfLife answers a different question for each item: how much of its shelf life is left, given what the label says, everything the fridge has been through since the item went in, and how the food has looked whenever someone checked it?

The answer is a range, not a single number: "about 2 days left, likely 1 to 3, with a 5% chance it's already past its best." The range is honest about what sensors and photos can and can't tell you.

## Why it isn't a trained classifier

No public dataset pairs household food with its temperature history and when it actually spoiled, so there is nothing to train a classic model on. Instead, ShelfLife uses the approach food-science research uses for dynamic shelf-life prediction. Published kinetic models describe how fast each kind of food deteriorates at a given temperature and humidity. Bayesian updating then lets each item's own freshness checks correct the estimate.

## The pieces

### 1. A starting shelf life

- **Printed date.** If the item has one, it sets the starting point.
  - **Use-by** is taken at face value. For perishable foods (poultry, dairy, leafy greens, leftovers), the estimate never goes past it, because USDA says to follow it.
  - **Best-by** is a quality date. Tested products often stay acceptable past it: milk labeled for 8 days was still fine at 9 to 10, and yogurt labeled for 28 days at 33. So the middle estimate sits 15% past the date.
  - **Sell-by** is for the store. USDA says to then use the FoodKeeper times, so those are added to the date.
- **No date.** USDA FoodKeeper's refrigerator range for the food type is the starting point. The range is read as "most items fall between these": for raw chicken that's 1 to 2 days, and for leaf lettuce and spinach 3 to 7.
- **Opened.** An opened item (not marked sealed) keeps no longer than FoodKeeper allows, whatever the label says.

These times assume a fridge at 40°F (4.4°C). Everything below adjusts for how the real fridge compares.

### 2. Temperature: the aging clock

Each item has a clock measured in "equivalent hours at 40°F". Colder makes it run slower and warmer makes it run faster. How much faster depends on what spoils the food:

- **Raw poultry, dairy and leftovers** spoil from bacteria, mainly pseudomonads. The Ratkowsky square-root model describes their growth rate: `((T − Tmin) / (40°F − Tmin))²`, with Tmin = −7.75°C. Raw chicken at 50°F ages about twice as fast as at 40°F.
- **Leafy greens, strawberries and other produce** decline in appearance, texture and water content. Measured shelf lives follow an Arrhenius curve with an activation energy of about 70 kJ/mol, which is roughly 2.8x faster per 10°C.
  - This fits fresh-cut lettuce data: 10.4 days at 5°C versus 3.7 at 15°C.
  - It fits the strawberry storage rule that fruit at 10°C keeps a third as long as at 0°C.
  - The previous version used pathogen growth limits here. Those claimed 0°C would keep greens 15x longer than 40°F; the measured figure is closer to 1.6x.

The food's own temperature lags the air. A full milk jug trails by about an hour, and loose greens by about 15 minutes. A quick peek with the lid open barely moves the clock; leaving it open does.

### 3. Humidity: water loss

Produce wilts as it loses water. The model tracks it directly:

```
weight lost per hour = transpiration coefficient × vapour-pressure deficit
```

- **Coefficients** come from the ASHRAE handbook (lettuce 7400 ng/(kg·s·Pa)).
- **Still air.** They are scaled down by 4 for a home fridge's still air. That factor is our estimate.
- **Limits.** Produce is considered wilted at about 3 to 5% weight loss for greens, 6% for strawberries, and 8 to 10% for carrots and celery.
- **Bags.** A sealed or bagged item keeps its own humid air.

Unbagged spinach in a fridge at 55% humidity reaches its limit in about a day. Bagged greens take about 6 days, which matches FoodKeeper's 3-to-7-day range without being tuned to it.

When warm, humid air meets cold food (right after the lid opens), water condenses on it. That speeds up mold, so the clock runs 2x faster for berries and 1.3x for greens while they are wet.

### 4. Freshness checks: learning from each item

Every photo check (rated by Perceptron) or manual rating is evidence.

- **What the model asks.** For each possible version of the item, how likely is this rating at this point in its life?
  - A "fair" photo on day 2 favours versions with a short shelf life.
  - A "fresh" one favours long ones.
- **Food type matters.** Visible spoilage comes late for meat and dairy, because off-odour precedes visible slime. So a "looks good" photo of chicken says much less than one of spinach.
- **Trust.** Unsure photos count for less than confident ones or manual ratings.
- **Wrong ratings.** Any single rating has a 5% chance of simply being wrong, so one bad photo can't take over the estimate.

### 5. Putting it together

The unknowns for each item are:

- its true shelf life
- how much of it was used before it was logged
- how temperature-sensitive this food really is
- the temperature during time the sensors didn't see
- for produce, how fast it loses water

The model enumerates about 3,000 combinations, replays the sensor history for each, and weights each one by its prior probability times how well it explains every check. The result:

- **Remaining shelf life:** a median and a likely range (10th to 90th percentile).
- **Chance it's past its best:** the share of weight on combinations that are already used up.
- **Survival curve:** the chance it's still good at each point in the coming days.
- **Limiting factor:** whether temperature, water loss or the use-by date ends its life first.

An item takes about 10 ms to assess.

## Unobserved time

If the item predates the sensor history, or a sensor goes quiet for more than 10 minutes, the model doesn't pretend to know what happened.

- **With an hour or more of history**, it assumes the zone's own observed average, ±1°C.
- **Otherwise**, it assumes a typical home fridge: 5.0 ± 2.5°C, from household surveys in Poland, New Zealand and England, which put the mean at 5.1 to 5.3°C.

Either way, the range widens to show the uncertainty.

## The 2-hour rule

USDA says perishable food shouldn't spend more than 2 hours above 40°F, or 1 hour above 90°F. Once poultry, dairy, leftovers or cut greens add up 2 hours above 41°F in observed time, they're marked Discard, whatever the estimate says. This counts the food's estimated temperature, not the air's.

The line sits at 41°F (5°C), the FDA Food Code's cold-holding limit, rather than exactly 40°F. A fridge that cycles a fraction of a degree around 40°F is within the sensor's accuracy (±0.3°C) and isn't the broken-fridge or left-out case the rule is about. Mild warmth below 41°F still counts against the aging clock.

## What the statuses mean

- **Good:** under half of the shelf life is used.
- **Use soon:** half or more is used.
- **At risk:** 80% or more is used, or there's at least a 20% chance it's past its best.
- **Expired:** more likely past its best than not, or past its use-by date.
- **Discard:** it broke the 2-hour rule.

The cut-offs are our choice.

## How the model was checked

`tests/test_freshness.py` checks the model against the measurements its constants come from:

- **Lettuce:** the 5°C → 15°C shelf-life ratio matches Derossi et al. (2016) within 10%.
- **Strawberries:** they keep a third as long at 10°C as at 0°C (WFLO).
- **Temperature sensitivity:** square-root fits to published chicken (−12.9°C) and milk (−3.0°C) data fall inside the model's modelled spread for Tmin.
- **Bagged greens:** they reach their wilting limit on FoodKeeper's timescale.

## What it can't do

The sensors measure air, not food, and nothing here detects bacteria. Photos show surfaces, not smells or pathogens. ShelfLife estimates quality from storage conditions and observations. It can't tell you food is safe, so when in doubt, follow USDA guidance.

## Known gaps

- **Early warm spells.** Brief warming early in storage can shorten meat shelf life by more than its share of time (by up to 30% in one pork and poultry study), because it cuts short the bacteria's lag phase. The model treats all time alike, so it underestimates that effect.
- **Our estimates.** The household airflow factor, the photo-reliability numbers and the how-it-looks-versus-how-used curves are our own estimates. Real outcomes from this app (marked used or tossed, with their final checks) are the data that could calibrate them.

## Sources

- USDA FSIS FoodKeeper data (v128): refrigerator storage times
- USDA FSIS, "Food Product Dating" and "Danger Zone (40°F - 140°F)"
- FDA Food Code: cut leafy greens as a temperature-controlled food
- Ratkowsky et al. (1982), J. Bacteriology 149(1):1-5: the square-root growth model
- Neumeyer, Ross & McMeekin (1997), Int. J. Food Microbiol. 38:45-54: Tmin of spoilage pseudomonads
- Ghollasi-Mood et al. (2016), Iranian J. Vet. Sci. Technol.: chicken sensory shelf life at 0-15°C, Pseudomonas at 7.5 log at end of shelf life
- "Monitoring shelf life of pasteurized whole milk under refrigerated storage" (Univ. of Minnesota): 30, 24 and 12 days at 5, 7 and 10°C
- Sensory shelf life of fresh-cut Iceberg, Romaine and chicory, 2-20°C (phtnet.org): activation energies 65.7-71.1 kJ/mol
- Derossi et al. (2016), J. Food Engineering: fresh-cut lettuce shelf life at 0, 5 and 15°C
- WFLO Commodity Storage Manual, Strawberries (2018)
- ASHRAE Refrigeration Handbook, "Thermal Properties of Foods", Table 11 (Sastry et al. 1978): transpiration coefficients
- Robinson et al. (1975), via Kays & Paull (2004): maximum permissible water loss; UC Davis postharvest notes on weight loss and visual quality
- Household fridge temperature surveys: Poland (2023), New Zealand (2004-05), England (2015)
- Bruckner, Albrecht, Petersen & Kreyenschmidt, Int. J. Food Sci. Technol. 47(8): early temperature upshifts and pork/poultry shelf life
- Swedish best-before testing examples (SLU student thesis, 2012): milk and yogurt quality after the date

Every number is also cited, or marked as our estimate, in `profiles.py` and `freshness.py`.
