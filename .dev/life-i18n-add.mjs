// Life agent: merges keys into locales/en.json and locales/ru.json without reordering other agents' keys.
// New keys go right after the last existing key with the same module prefix (else at the end).
// Usage: node .dev/life-i18n-add.mjs keys.json   where keys.json = { "key": ["English", "Русский"], ... }
import fs from 'node:fs';
const add = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
for (const [lang, idx] of [['en', 0], ['ru', 1]]) {
  const file = new URL(`../locales/${lang}.json`, import.meta.url);
  const cur = JSON.parse(fs.readFileSync(file, 'utf8'));
  const entries = Object.entries(cur);
  for (const [key, texts] of Object.entries(add)) {
    const value = texts[idx];
    if (value == null) continue;
    const at = entries.findIndex(([k]) => k === key);
    if (at >= 0) {
      entries[at][1] = value;
      continue;
    }
    const prefix = key.split('.')[0] + '.';
    let pos = entries.length - 1;
    for (let i = entries.length - 1; i >= 0; i--) if (entries[i][0].startsWith(prefix)) { pos = i; break; }
    entries.splice(pos + 1, 0, [key, value]);
  }
  const text = JSON.stringify(Object.fromEntries(entries), null, 2) + '\n';
  JSON.parse(text);
  fs.writeFileSync(file, text);
  console.log(lang, entries.length, 'keys');
}
