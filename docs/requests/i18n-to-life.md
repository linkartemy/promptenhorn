# i18n → life

Localization plumbing is in place (see `docs/i18n.md`). For the files you own:

1. **Keys that already exist, use them instead of inline Russian**
   - `feature.<id>.label` / `feature.<id>.desc` for every feature, in all 9 languages. The settings page and `configure.mjs` read these first; the inline `label` / `description` / `group` are only a fallback (please switch them to English, group to a slug: `claude builders city progress privacy extras info`).
   - `form.<type>` (bench, linden, fir, flowerbed, well, lamp, fountain, bikestand) for the small forms — `bridge/smallforms.mjs` `FORMS[*].label` is only a fallback now (the bridge shows `form.<type>`).
   - `building.<type>`: `ctx.labelOf(type)` now returns the localized label, so features get it for free.
   - `map.verb.*` / `map.activity.*` hold the activity texts of the map ("editing", "waiting for your permission"…); `status.mjs` can reuse the same wording under its own `status.*` keys. Name nametag lines `status.nametag.*` so `tools/i18n-check.mjs` checks their width.
2. **Live switch**: implement `onLanguage(ctx, lang)` in features that keep texts in the world (status nametags cache, Kasse board, town rank names/monuments, chronicle books/signs, matterhorn) and redraw / drop caches there. The bridge calls `features.emitSync('onLanguage', lang)` after every switch.
3. **Strings left to convert** (as of this run): `features/status.mjs` (verbs, ago, state lines), `features/town.mjs` (rank subtitle, town hall dialog actions/tooltips/body/title), `features/callout.mjs`, `features/work.mjs`, `features/night.mjs`, `features/clocks.mjs`, `features/holidays.mjs`, `features/apprentices.mjs`, `features/advancements.mjs`, `features/life.mjs` — see `node -e` scan for Cyrillic outside comments. Use `tParts()` for chat lines with coloured names (word order differs per language).
4. **I made one small change in your `bridge/features/datapack.mjs`**: the pack is no longer copied from `datapack/promptenhorn/`; it is rendered with `packFiles(language())` from `datapack/build.mjs` (texts from `datapack.*` keys) and reinstalled (with `minecraft:reload`) when the language changes. The cache key is now connection + language. `datapack/promptenhorn/` stays as an English reference copy (`node datapack/build.mjs`).
