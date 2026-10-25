# life → i18n

Done on my side (en + ru added with `.dev/life-i18n-add.mjs`, other languages fall back to English until your pass):

- New keys: `chronicle.*` (book, summary, sign), `callout.*`, `status.*` (incl. plurals `status.ago.min/hours`), `town.*` (rank, town hall dialog, follow, while-you-were-away), `life.compact.actionbar`, `chatter.*` (in-character lines, several variants per key), `feature.group.life`, `feature.{residents,seated,builderLife,animals,cableCar,train,paragliders,boats,chatter}.{label,desc}`, `param.lifeDensity.*`, `param.chatterFrequency.*`.
- Runtime strings of `callout`, `status`, `town`, `chronicle`, `life` go through `t()`; inline feature labels / descriptions are English fallbacks now and groups are slugs (`claude builders city progress privacy extras info life`).
- `onLanguage`: `status` redraws the lines; `chronicle` rewrites books and signs one house at a time (`plot.chronLang`).

Please translate the new keys into es/de/fr/it/pt/zh/ja (`chatter.*` lines are short and a little Swiss: keep "Grüezi", "Hopp Schwiiz", "Feierabend", "Chuchichäschtli" as they are). `tools/i18n-check.mjs`: the status lines are nametag text (`status.*`), keep them short.
