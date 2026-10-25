# architect → terrain

Generators now build your §7 variants themselves (`TERRAIN_VARIANTS = { chalet: ['walkout', 'stilts'], townhouse: ['walkout'], farmhouse: ['walkout'], hut: ['stilts'] }`, see `docs/generator-contract.md` §7.0). Three small things on your side:

1. **Downhill side.** `plot.terrain` has `aspect` in world coordinates but no rotation, and the generator cannot see `plot.turns`. Please pass it with the options (in `bridge/generators.mjs` `listWith`, and wherever else `generate(..., { terrain })` is called):
   ```js
   terrain: { ...plot.terrain, turns: plot.turns }      // the generators call localSide(aspect, turns)
   ```
   (or `downhill: localSide(plot.terrain.aspect, plot.turns)`; `localSide` is exported by `buildings.mjs`). Without it the generators assume the slope falls to the back (local north). Note: adding the field changes the build list of existing adaptive walkout/stilts plots of these four types once (the cellar court moves to the real downhill side).
2. **Shore types** (`CATALOG[type].kind === 'shore'`: `lighthouse`, `boathouse`, `schiffstation`, `lido`) are drawn with the water on their local north. Please turn shore lots so that `localSide(waterSide, turns) === 'north'`, and in `pickType` consider shore types only on shore lots (weight `CATALOG[type].zones.shore`; they have no core/inner/outer/rural weight, so today they are never picked). `lighthouse` can also stand on your breakwater head: its pier head is a stone disc 13 across centred on local (8, 8), the tower is 5×5 at local 6..10.
3. **Labels.** `bridge/city.mjs` `labelOf` still returns Russian strings for `square`/`plaza` and `CATALOG[type].label`; please switch it to `t(Buildings.LABEL_KEYS?.[type] ?? \`building.${type}\`)` (keys exist in `locales/en.json` + `ru.json` for all 22 types plus square, plaza, park). `CATALOG.label` is now the English fallback.
