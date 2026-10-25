// Checks the locale catalogs against locales/en.json (the source of truth):
//   node tools/i18n-check.mjs            all languages      node tools/i18n-check.mjs ja de   only these
//   node tools/i18n-check.mjs --missing  also print the English text of every missing key (to translate)
// Reports per language: missing and extra keys, plural forms the language needs (Intl.PluralRules),
// placeholder mismatches ({name} sets must match English), duplicate keys in the raw file, and
// sidebar / nametag texts too wide for the Minecraft sidebar. Exits 1 when anything is wrong.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LANGUAGES, DEFAULT_LANGUAGE } from '../bridge/i18n.mjs';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'locales');
const args = process.argv.slice(2);
const showMissing = args.includes('--missing');
const only = args.filter((a) => !a.startsWith('--'));

// Texts shown in the sidebar or above heads: width in "Latin characters" (CJK and other wide glyphs
// count double in Minecraft's font). Building and form labels get " 100%" appended in the sidebar.
const SIDEBAR = [
  [/^building\./, 20],
  [/^form\./, 20],
  [/^bridge\.(site\.summit|score\.searching|chat\.unnamed)$/, 26],
  [/\.(sidebar|nametag)(\.|$)|\.short$/, 26], // convention for other modules' sidebar / nametag keys
];
const PLURAL_FORMS = new Set(['zero', 'one', 'two', 'few', 'many', 'other']);

const wide = (ch) => /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(ch);
const width = (s) => [...s].reduce((w, ch) => w + (wide(ch) ? 2 : 1), 0);
const placeholders = (s) => new Set([...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
const fmtSet = (s) => `{${[...s].sort().join('}, {')}}`;

function load(lang) {
  const file = path.join(DIR, `${lang}.json`);
  if (!fs.existsSync(file)) return { missingFile: true, data: {}, dups: [] };
  const text = fs.readFileSync(file, 'utf8');
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    return { error: err.message, data: {}, dups: [] };
  }
  const seen = new Set();
  const dups = [];
  for (const m of text.matchAll(/^\s*"((?:[^"\\]|\\.)*)"\s*:/gm)) {
    if (seen.has(m[1])) dups.push(m[1]);
    seen.add(m[1]);
  }
  return { data, dups };
}

/** Plural categories a language actually uses for whole numbers 0..1000 (e.g. ru: one/few/many). */
function neededForms(lang) {
  const rules = new Intl.PluralRules(lang);
  const out = new Set(['other']);
  for (let n = 0; n <= 1000; n++) out.add(rules.select(n));
  return out;
}

const en = load(DEFAULT_LANGUAGE);
if (en.error || en.missingFile) {
  console.error(`locales/en.json: ${en.error ?? 'missing'}`);
  process.exit(1);
}
// Plural groups: "x.one" + "x.other" in English -> the base "x" is plural, its forms vary per language.
const pluralBase = new Set();
for (const k of Object.keys(en.data)) {
  const i = k.lastIndexOf('.');
  if (i > 0 && PLURAL_FORMS.has(k.slice(i + 1)) && Object.hasOwn(en.data, `${k.slice(0, i)}.one`) && Object.hasOwn(en.data, `${k.slice(0, i)}.other`)) pluralBase.add(k.slice(0, i));
}
const baseOf = (k) => {
  const i = k.lastIndexOf('.');
  return i > 0 && PLURAL_FORMS.has(k.slice(i + 1)) && pluralBase.has(k.slice(0, i)) ? k.slice(0, i) : null;
};
const simpleKeys = Object.keys(en.data).filter((k) => !baseOf(k));

let failed = false;
const rows = [];
const langs = only.length ? only : Object.keys(LANGUAGES);
for (const lang of langs) {
  if (!Object.hasOwn(LANGUAGES, lang)) {
    console.log(`\n${lang}: not a supported language (${Object.keys(LANGUAGES).join(', ')})`);
    failed = true;
    continue;
  }
  const cat = lang === DEFAULT_LANGUAGE ? en : load(lang);
  const problems = [];
  if (cat.error) problems.push(`invalid JSON: ${cat.error}`);
  if (cat.missingFile) problems.push('no catalog file');
  const d = cat.data;
  const forms = neededForms(lang);
  const missing = [];
  const extra = [];
  const mismatch = [];
  const long = [];
  for (const k of simpleKeys) if (!Object.hasOwn(d, k)) missing.push(k);
  for (const base of pluralBase) for (const f of forms) if (!Object.hasOwn(d, `${base}.${f}`)) missing.push(`${base}.${f}`);
  for (const [k, v] of Object.entries(d)) {
    const base = baseOf(k);
    if (base) {
      const form = k.slice(base.length + 1);
      if (!forms.has(form)) extra.push(`${k} (${lang} has no "${form}" plural form)`);
    } else if (!Object.hasOwn(en.data, k)) {
      extra.push(k);
      continue;
    }
    if (typeof v !== 'string') {
      mismatch.push(`${k}: not a string`);
      continue;
    }
    // Placeholders: same set as English; a plural "one"/"zero"/"two" form may spell the number out.
    const ref = placeholders(base ? en.data[`${base}.other`] : en.data[k]);
    const got = placeholders(v);
    if (base && ['one', 'zero', 'two'].includes(k.slice(base.length + 1))) got.add('count');
    if (base && !ref.has('count')) got.delete('count');
    if (!sameSet(ref, got)) mismatch.push(`${k}: ${fmtSet(got)} vs English ${fmtSet(ref)}`);
    const rule = SIDEBAR.find(([re]) => re.test(k));
    if (rule) {
      const shown = v.replace(/\{id\}/g, 'abcd').replace(/\{\w+\}/g, 'xxxxxxxx');
      if (width(shown) > rule[1]) long.push(`${k}: "${v}" is ${width(shown)} wide (max ${rule[1]})`);
    }
  }
  for (const k of cat.dups) problems.push(`duplicate key ${k}`);
  if (missing.length) problems.push(`${missing.length} missing:\n      ${missing.map((k) => (showMissing ? `${k} = ${JSON.stringify(en.data[k] ?? en.data[`${baseOf(k) ?? k}.other`] ?? en.data[`${k.replace(/\.\w+$/, '')}.other`])}` : k)).join('\n      ')}`);
  if (extra.length) problems.push(`${extra.length} extra:\n      ${extra.join('\n      ')}`);
  if (mismatch.length) problems.push(`${mismatch.length} placeholder mismatches:\n      ${mismatch.join('\n      ')}`);
  if (long.length) problems.push(`${long.length} too wide for the sidebar:\n      ${long.join('\n      ')}`);
  const total = simpleKeys.length + [...pluralBase].length;
  const have = simpleKeys.filter((k) => Object.hasOwn(d, k)).length + [...pluralBase].filter((b) => [...forms].every((f) => Object.hasOwn(d, `${b}.${f}`))).length;
  rows.push([lang, LANGUAGES[lang], Object.keys(d).length, `${have}/${total}`, `${((100 * have) / Math.max(1, total)).toFixed(1)}%`, problems.length ? 'FAIL' : 'ok']);
  if (problems.length) {
    failed = true;
    console.log(`\n${lang} (${LANGUAGES[lang]}):\n  - ${problems.join('\n  - ')}`);
  }
}

console.log(`\n${'lang'.padEnd(6)}${'name'.padEnd(12)}${'keys'.padStart(6)}  ${'texts'.padStart(11)}  ${'cover'.padStart(6)}  check`);
const pad = (s, n) => s + ' '.repeat(Math.max(0, n - width(s)));
for (const [l, n, k, h, c, s] of rows) console.log(`${l.padEnd(6)}${pad(n, 12)}${String(k).padStart(6)}  ${h.padStart(11)}  ${c.padStart(6)}  ${s}`);
console.log(`\nEnglish: ${Object.keys(en.data).length} keys (${simpleKeys.length} texts + ${pluralBase.size} plural groups).`);
process.exit(failed ? 1 : 0);
