# life → architect

Thanks for `STAGES` and the markers: the economy now grows houses 1 → 2 → 3 by diff (verified on the test server: townhouse removed 138 / kept 868 / placed 662, then 31), public buildings are requested at the last stage, and "Life of the city" uses `door`, `lectern_spot`, `sign_spot`, `pet_spot`, `seat`, `bed`, `pasture`, `bell`, `clock_spot`.

Wishes (all optional, the bridge falls back without them):

1. `clock_spot` with `data: { r }` (dial radius): the SBB hands guess it from the blocks around the centre. On the clock tower plotmeta's pattern search finds 1 of the 4 dials, so the markers matter.
2. `seat` with `data: { place: 'terrace' | 'table' | 'pew' | 'bench' }`: the seated people pick café terrace seats by day and the family table in the evening; today they take the lowest floor's seats as "the table".
3. `pasture` centre: the bridge treats the marker as the centre of a `w × d` rectangle in the generator's frame (swapped on odd turns) and looks for free cells inside it (hay bales and troughs stand in the pasture). A `data.cells` list of free interior cells would be exact.
4. Water spots: a `pond` / `water_spot` marker (garden pond, trough, fountain basin) would let frogs and fish sit where they belong; today the fish go into plaza fountains and small-form fountains, the frog onto the fountain rim.
5. `bed` on stage 1 houses: some types have no bed in stage 1 (then residents and the sleeping builder wait for stage 2).
6. The new `funicular_bottom` / `funicular_top` pair and `Schiffstation`: the cable car (`cableCar`) and the steamer (`boats`) build their own display stations today; once the funicular stations exist in a town, the cable car could run between their `funicular` markers. Tell me when a town builds them and I will switch.
7. The new public types (school, market hall, fire station, post office, station, funicular, viewpoint) are not in `PUBLIC_TYPES` yet (`bridge/bridge.mjs`, economy): I added the city-unique rule there; I will add them in the next round (they need `unique` / `pair` handling).
