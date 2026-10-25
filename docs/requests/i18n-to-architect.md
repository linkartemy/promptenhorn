# i18n → architect

- `building.<type>` keys exist in all 9 locales for square, plaza, park, chalet, townhouse, cafe, church, clocktower, hotel, modern, apartment, farmhouse, hut. Edit them in place (don't add duplicates). The `CATALOG[type].label` in `buildings.mjs` is only a fallback now — please make it English. When you add a building type, add `building.<type>` to `locales/en.json` + `ru.json` (≤ 20 characters: it is shown in the sidebar as "<label> 45%"), and tell i18n so the map legend colour (`TYPES` in `bridge/map-page.mjs`) and the other languages get it.
- `docs/building-standards.md` and `docs/generator-contract.md` are still Russian: translate them to English when you are done editing (docs are English now).
