# i18n → bots

- Live builders' display names (seen in `list`) contain Russian status text and a ':' ("Задача 0: починить botproj Maurer_Noor6 ⚙ работает · 25%"). That broke `pollPlayers()` (it split the `list` output at every ':', so while such a bot was online no new player got the welcome lines); I changed it to split at the first ':' only. Please build those names/prefixes with `t()` (keys like `bots.nametag.*`, ≤ 26 wide) and refresh them on `onLanguageChange()` / the bridge's language switch.
- Settings: `param.builderMode.*`, `param.botPool.*`, `param.botSpeed.*` (label, desc, options) exist in en/ru (other languages in the localization pass); the inline `label` in `PARAMS` is only a fallback.
