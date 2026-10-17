# How the risk model works

A thermometer tells you the temperature right now. ShelfSense keeps a running total instead, and uses it to answer one question for each item: how much of its shelf life is left, given everything the fridge has been through since the item went in?

## The shelf-life clock

Every item starts with a normal shelf life from the USDA's FoodKeeper data, which assumes a fridge at 40°F:

- Raw chicken: 1 to 2 days
- Milk: 5 to 7 days (FoodKeeper only says "use-by date" for plain milk, so we borrowed its figure for opened shelf-stable milk)
- Leafy greens: 3 to 7 days
- Strawberries: 2 to 3 days

We use the middle of each range.

The dashboard records when each item was added to the fridge. The engine ignores sensor readings from before that time. If the item predates the available sensor history, it reports the unobserved period as a data gap instead of treating it as measured exposure.

Think of each item as having a clock. At 40°F it runs at normal speed, so an hour in the fridge uses an hour of shelf life. Colder, the clock slows down. Warmer, it speeds up. The score on the dashboard is how much of the normal shelf life is left, out of 100. However cold the fridge is, we never promise more than the top of the USDA range.

## How much faster when it's warm

The speed-up comes from the Ratkowsky model, a standard formula in food microbiology for how fast bacteria and mold grow at a given temperature. All it needs is the coldest temperature the food's main spoiler can grow at:

- Chicken and milk spoil because of bacteria called pseudomonads, which can grow down to about -7.75°C (18°F).
- For leafy greens we track Listeria, which grows down to about -1.5°C (29°F).
- Strawberries go bad from gray mold, which grows down to about -2°C (28°F).
- Whole produce and other refrigerated food use broad fallback profiles marked as estimates because one value cannot represent every food in those groups.

For example, chicken at 50°F spoils about twice as fast as it does at 40°F, so an hour at 50°F costs roughly two hours of shelf life.

## Food warms slower than air

When the lid opens, the air inside heats up quickly but a full jug of milk doesn't. The model estimates each food's own temperature, which trails the air by about an hour for milk, 40 minutes for chicken, 20 minutes for strawberries and 15 minutes for greens. A quick peek barely moves the score. Leaving the lid open does.

These delays are our own estimates. Once the hardware arrives we plan to measure the real number by putting a sensor inside a milk jug.

## Humidity

Humidity only matters for food that's open to the air. Chicken and milk are sealed, so the model ignores it for them.

Leafy greens wilt in dry air. USDA Agriculture Handbook 66 recommends at least 95% humidity for spinach and lettuce. Below that, our model ages greens 25% faster for every 10 points of missing humidity. A typical fridge sits well below 95%, which is why bagged greens last longer. If you mark greens as bagged, humidity is ignored.

Strawberries do best at 90 to 95% humidity, and they age a little faster outside that range. Their bigger problem is water condensing on them, because wet fruit is where mold takes off. That happens when warm, humid air meets cold fruit, like right after the lid opens. The model catches it by checking whether the air's dew point is above the fruit's temperature. While the berries are wet, their clock runs twice as fast. Greens get a smaller penalty for condensation.

The humidity penalties are our own numbers. We couldn't find a published model that converts humidity into lost shelf life for home storage, so we chose values that seemed reasonable and marked them in the code as estimates.

## The 2-hour rule

USDA says perishable food shouldn't spend more than 2 hours above 40°F, or 1 hour if it's above 90°F. We apply this on top of the clock. Once chicken, milk or greens add up 2 hours above 40°F, they're marked Discard no matter what the clock says. This counts the food's estimated temperature, not the air's.

Greens are included because the FDA Food Code treats cut leafy greens as food that needs temperature control. We don't apply the rule to whole strawberries, which aren't one of the foods these rules name.

## What the statuses mean

- Good: at least half of the normal shelf life is left.
- Use soon: less than half is left.
- At risk: less than a fifth is left.
- Expired: the clock has run out.
- Discard: the item broke the 2-hour rule.

The half and fifth cut-offs are our choice.

## What it can't do

The sensors measure the air, not the food, and nothing here detects bacteria. ShelfSense estimates risk from storage conditions. It can't tell you for certain that food is safe, so when in doubt, follow USDA guidance.

If a sensor goes quiet, the model assumes conditions stayed the same as the last reading and reports how long the gap was.

## Sources

- USDA FSIS FoodKeeper data: refrigerator storage times
- USDA FSIS, "Danger Zone (40°F - 140°F)": the 40°F limit and the 2-hour and 1-hour rules
- FDA Food Code: cut leafy greens as a temperature-controlled food
- USDA Agriculture Handbook 66, The Commercial Storage of Fruits, Vegetables, and Florist and Nursery Stocks: storage humidity for produce
- Ratkowsky et al. (1982), Journal of Bacteriology 149(1):1-5: the square-root growth model
- Neumeyer, Ross & McMeekin (1997), International Journal of Food Microbiology 38:45-54: minimum growth temperature of spoilage pseudomonads
- Food Science and Technology Research 24(6):1021 (2018): Listeria growth temperature range
- Bugwood Wiki, Botrytis cinerea: gray mold growth temperature

Every number above is also cited, or marked as our estimate, in `profiles.py`.
