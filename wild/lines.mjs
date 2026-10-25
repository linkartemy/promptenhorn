// Templated colony chat. No LLM: each line key has numbered variants in the locale catalogs
// (locales/<lang>.json: "wild.say.<key>.1", ".2", …; English with a little Swiss-German flavour).
// Rate limits: a global gap between any two lines, a per-colonist gap, per-key cooldowns; urgent lines
// (help, creeper, death) skip the per-colonist gap and use a shorter global gap.
import { t, language } from '../bridge/i18n.mjs';

const variantCache = new Map(); // "lang:key" -> number of variants
function variants(key) {
  const ck = `${language()}:${key}`;
  if (!variantCache.has(ck)) {
    let n = 0;
    while (n < 12 && t(`wild.say.${key}.${n + 1}`) !== `wild.say.${key}.${n + 1}`) n++;
    variantCache.set(ck, n);
  }
  return variantCache.get(ck);
}

/** Localized item / mob names (fall back to the id with spaces). */
export const itemName = (id) => {
  const s = t(`wild.item.${id}`);
  return s === `wild.item.${id}` ? id.replace(/_/g, ' ') : s;
};
export const mobName = (id) => {
  const s = t(`wild.mob.${id}`);
  return s === `wild.mob.${id}` ? id.replace(/_/g, ' ') : s;
};

export class Chatter {
  constructor({ globalGapMs = 4000, colonistGapMs = 15000, send }) {
    this.globalGapMs = globalGapMs;
    this.colonistGapMs = colonistGapMs;
    this.send = send; // (colonist, text) => void
    this.lastAny = 0;
    this.lastBy = new Map();
    this.lastKey = new Map();
    this.recent = [];
    this.sent = 0;
    this.dropped = 0;
  }

  /** Returns the line sent, or null when rate-limited. */
  say(colonist, key, vars = {}, { urgent = false, keyCooldownMs = 20000 } = {}) {
    if (this.enabled === false) return null; // chatter switched off in the settings
    const n = variants(key);
    if (!n) return null;
    const now = Date.now();
    const kk = `${colonist?.name}:${key}`;
    if (now - (this.lastKey.get(kk) ?? 0) < (urgent ? 4000 : keyCooldownMs)) return this.#drop();
    if (now - this.lastAny < (urgent ? 1000 : this.globalGapMs)) return this.#drop();
    if (!urgent && now - (this.lastBy.get(colonist?.name) ?? 0) < this.colonistGapMs) return this.#drop();
    const text = t(`wild.say.${key}.${1 + Math.floor(Math.random() * n)}`, vars);
    this.lastAny = now;
    this.lastBy.set(colonist?.name, now);
    this.lastKey.set(kk, now);
    this.recent.push({ t: now, who: colonist?.name ?? 'Märt', text });
    if (this.recent.length > 60) this.recent.shift();
    this.sent++;
    this.send(colonist, text);
    return text;
  }

  #drop() {
    this.dropped++;
    return null;
  }
}
