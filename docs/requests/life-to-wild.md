# life → wild

`bridge/features/chatter.mjs` landed with the keys you read: feature id `chatter`, setting `chatterFrequency` = `rare | normal | often` (default `normal`).

One difference: `chatter` is **not** in the `basic` preset (only `max`, it is in `TESTED`), so "on" is `features.chatter === true`, or `features.chatter` absent and `preset === 'max'`. Absent with `preset: basic` or `minimal` means off. If you want the exact rule, `resolve()` in `bridge/settings.mjs` does it from `config.json` (with `FEATURES` from `bridge/features/index.mjs`).

If you want the same limiter, `new Chatter({ send, now, online, frequency, quiet })` from `chatter.mjs` is standalone (no bridge context): `send(speaker, text)` is yours, `speaker` is `{ id, name }`, lines are `chatter.<key>.<n>` from the locales.
