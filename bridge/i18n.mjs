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
  current = Object.hasOwn(LANGUAGES, lang) ? lang : DEFAULT_LANGUAGE;
  return current;
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
  return text.replace(/\{(\w+)\}/g, (m, name) => (params[name] != null ? String(params[name]) : m));
}
