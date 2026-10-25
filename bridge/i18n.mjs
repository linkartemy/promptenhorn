// Localization: every user-visible string (in-game chat, sidebar, nametags, dialogs, books, the settings
// page, the map page, the CLI) goes through t(). Catalogs live in locales/<lang>.json as flat
// "module.key": "text with {params}" maps. English is the source language and the fallback.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LOCALES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'locales');

/** Supported languages: code -> native name (shown in the language picker). */
export const LANGUAGES = {
  en: 'English',
  ru: 'Русский',
  es: 'Español',
  de: 'Deutsch',
  fr: 'Français',
  it: 'Italiano',
  pt: 'Português',
  zh: '中文',
  ja: '日本語',
};
export const DEFAULT_LANGUAGE = 'en';

const catalogs = new Map(); // lang -> { key: text }
let current = DEFAULT_LANGUAGE;

function catalog(lang) {
  if (!catalogs.has(lang)) {
    let data = {};
    try {
      data = JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, `${lang}.json`), 'utf8'));
    } catch {
      // Missing or broken catalog: fall back to English for every key.
    }
    catalogs.set(lang, data);
  }
  return catalogs.get(lang);
}

/** Switches the language used by t() (unknown codes fall back to English). Returns the active code. */
export function setLanguage(lang) {
  const before = current;
  current = Object.hasOwn(LANGUAGES, lang) ? lang : DEFAULT_LANGUAGE;
  if (current !== before) {
    for (const fn of listeners) {
      try {
        fn(current, before);
      } catch {
        // A broken listener must not stop the switch (or the others).
      }
    }
  }
  return current;
}

const listeners = new Set();
/** Calls fn(lang, previous) after every actual language switch (e.g. to refresh cached in-game texts). */
export function onLanguageChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const language = () => current;

/** Forgets loaded catalogs, so edited locale files are picked up (e.g. after a settings reload). */
export function reloadCatalogs() {
  catalogs.clear();
}

const plural = new Map();
function pluralCategory(lang, count) {
  if (!plural.has(lang)) plural.set(lang, new Intl.PluralRules(lang));
  return plural.get(lang).select(count);
}

/**
 * Translates `key`, filling `{name}` placeholders from `params`.
 * If params.count is a number, a plural form `key.<category>` (one/few/many/other, per Intl.PluralRules)
 * is preferred when the catalog has it. Missing keys fall back to English, then to the key itself.
 */
export function t(key, params = {}, lang = current) {
  const lookup = (l) => {
    const c = catalog(l);
    if (typeof params.count === 'number') {
      const form = c[`${key}.${pluralCategory(l, params.count)}`] ?? c[`${key}.other`];
      if (form != null) return form;
    }
    return c[key];
  };
  const text = lookup(lang) ?? lookup(DEFAULT_LANGUAGE) ?? key;
  return fill(text, params);
}

const fill = (text, params) => text.replace(/\{(\w+)\}/g, (m, name) => (params[name] != null ? String(params[name]) : m));

/**
 * t() for Minecraft text components (tellraw, signs): returns [{text}, …] in the translated word order.
 * A param given as an object ({text, color, click_event…}) becomes its own component; plain params are
 * filled in as text.  tParts('bridge.done.house', { name: { text: s.name, color: 'yellow' }, what })
 */
export function tParts(key, params = {}, lang = current) {
  const plain = {};
  const parts = {};
  for (const [k, v] of Object.entries(params)) (v && typeof v === 'object' ? parts : plain)[k] = v;
  const text = t(key, plain, lang);
  const out = [];
  let last = 0;
  for (const m of text.matchAll(/\{(\w+)\}/g)) {
    const part = parts[m[1]];
    if (!part) continue;
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    out.push({ ...part, text: String(part.text ?? '') });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

/** True when `key` (or a plural form of it) exists in the language's catalog or in English. */
export function has(key, lang = current) {
  const known = (l) => {
    const c = catalog(l);
    return c[key] != null || c[`${key}.other`] != null;
  };
  return known(lang) || known(DEFAULT_LANGUAGE);
}

/**
 * Like t(), but returns `fallback` (with params filled) when the key exists in no catalog. For texts
 * whose owner still keeps an inline label (feature metadata, building types) while keys are added.
 */
export function tOr(key, fallback, params = {}, lang = current) {
  return has(key, lang) ? t(key, params, lang) : fill(String(fallback ?? key), params);
}

/**
 * Every key starting with one of `prefixes`, translated into `lang` (English where missing), raw
 * (placeholders unfilled): handed to the browser pages, which fill them with their own small t().
 */
export function strings(prefixes, lang = current) {
  const out = {};
  for (const l of [DEFAULT_LANGUAGE, lang]) {
    for (const [k, v] of Object.entries(catalog(l))) if (prefixes.some((p) => k.startsWith(p))) out[k] = v;
  }
  return out;
}

/** BCP 47 tag for the html lang attribute and Intl formatting (zh -> zh-Hans). */
export const htmlLang = (lang = current) => (lang === 'zh' ? 'zh-Hans' : lang);
