// Feature switches: a preset (minimal / basic / max) plus per-feature overrides, persisted in config.json
// as `preset` and `features`. Served to the local settings page (GET /, GET/POST /api/settings) and
// re-read when config.json changes on disk (configure.mjs edits the file), so changes apply live.
import fs from 'node:fs';
import { settingsPage } from './settings-page.mjs';

export const PRESETS = {
  minimal: { label: 'Минимум', description: 'Только строители и дома, как в первой версии.' },
  basic: { label: 'Базовый', description: 'Самое понятное и тихое: кто ждёт тебя, чем занят чат, тесты, коммиты, свет в окнах.' },
  max: { label: 'Максимум', description: 'Всё сразу: погода, часы, автобусы, ачивки, пасхалки. Кроме опций приватности.' },
};
export const DEFAULT_PRESET = 'basic';

/** Whether `feature` is on in `preset` before overrides. Opt-in (privacy) features are never on by preset. */
export function inPreset(feature, preset) {
  if (feature.optIn || feature.experimental) return false; // never on by preset: opt-in / not yet tested
  if (preset === 'max') return true;
  return (feature.presets ?? []).includes(preset);
}

export function resolve(registry, preset, overrides = {}) {
  const p = PRESETS[preset] ? preset : DEFAULT_PRESET;
  const out = {};
  for (const f of registry) out[f.id] = typeof overrides[f.id] === 'boolean' ? overrides[f.id] : inPreset(f, p);
  return out;
}

/** Reads a JSON config file, tolerating a missing file (but not a broken one: never overwrite that). */
export function readConfigFile(file) {
  if (!fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Reads a "a.b" / "a.0" path of an object. */
export const getPath = (obj, key) => key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
function setPath(obj, key, value) {
  const parts = key.split('.');
  let o = obj;
  for (const k of parts.slice(0, -1)) o = o[k] ??= /^\d+$/.test(parts[parts.indexOf(k) + 1]) ? [] : {};
  o[parts[parts.length - 1]] = value;
}

/** Writes preset/features (and changed parameters) into the config file, keeping every other key. */
export function writeConfigFile(file, { preset, features, params }) {
  const cfg = readConfigFile(file);
  cfg.preset = preset;
  if (features && Object.keys(features).length) cfg.features = features;
  else delete cfg.features;
  for (const [k, v] of Object.entries(params ?? {})) setPath(cfg, k, v);
  const text = JSON.stringify(cfg, null, 2) + '\n';
  fs.writeFileSync(file + '.tmp', text);
  fs.renameSync(file + '.tmp', file);
  return text;
}

export class Settings {
  /**
   * @param {object} o
   * @param {string} o.file config.json path
   * @param {{id,label,description,group,presets,optIn}[]} o.registry
   * @param {(changes: {id: string, on: boolean}[]) => void} o.onChange
   */
  constructor({ file, registry, log, onChange, initial, params = [], config = {}, routes = {} }) {
    this.file = file;
    this.registry = registry;
    this.log = log;
    this.onChange = onChange;
    this.params = params; // [{ key, label, description, min, max, step } | { key, label, options: [[value, label]] }]
    this.config = config; // the live config object: parameters are applied to it directly
    this.routes = routes; // extra API routes ('GET /api/x': (body) => result)
    this.ids = new Set(registry.map((f) => f.id));
    this.#load(initial ?? {});
    this.lastText = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  }

  #load(cfg) {
    this.preset = PRESETS[cfg.preset] ? cfg.preset : DEFAULT_PRESET;
    this.overrides = {};
    for (const [id, v] of Object.entries(cfg.features ?? {})) if (this.ids.has(id) && typeof v === 'boolean') this.overrides[id] = v;
    this.#normalize();
    this.enabled = resolve(this.registry, this.preset, this.overrides);
  }

  /** Overrides equal to the preset default are noise: drop them so switching presets stays predictable. */
  #normalize() {
    for (const f of this.registry) if (this.overrides[f.id] === inPreset(f, this.preset)) delete this.overrides[f.id];
  }

  on(id) {
    return this.enabled[id] === true;
  }

  #commit(persist) {
    const before = this.enabled;
    this.#normalize();
    this.enabled = resolve(this.registry, this.preset, this.overrides);
    if (persist) {
      try {
        this.lastText = writeConfigFile(this.file, { preset: this.preset, features: this.overrides });
      } catch (err) {
        this.log(`could not save settings to ${this.file}: ${err.message}`);
      }
    }
    const changes = this.registry.filter((f) => before[f.id] !== this.enabled[f.id]).map((f) => ({ id: f.id, on: this.enabled[f.id] }));
    if (changes.length) this.onChange(changes);
    return changes;
  }

  /** Validates and applies numeric / choice parameters live; returns the cleaned values. */
  #params(values) {
    const out = {};
    for (const [key, raw] of Object.entries(values ?? {})) {
      const p = this.params.find((x) => x.key === key);
      if (!p) throw new Error(`unknown parameter ${key}`);
      let v = raw;
      if (p.options) {
        if (!p.options.some(([o]) => o === v)) throw new Error(`${key}: expected one of ${p.options.map(([o]) => o).join(', ')}`);
      } else {
        v = Number(raw);
        if (!Number.isFinite(v) || v < p.min || v > p.max) throw new Error(`${key}: expected a number from ${p.min} to ${p.max}`);
      }
      setPath(this.config, key, v);
      out[key] = v;
    }
    return out;
  }

  /** Applies {preset} (clears overrides: a preset button means "exactly this set") and/or {features: {id: bool|null}} and/or {params}. */
  apply({ preset, features, params } = {}) {
    const changedParams = this.#params(params);
    if (Object.keys(changedParams).length) {
      try {
        this.lastText = writeConfigFile(this.file, { preset: this.preset, features: this.overrides, params: changedParams });
      } catch (err) {
        this.log(`could not save settings to ${this.file}: ${err.message}`);
      }
      this.log(`Parameters: ${Object.entries(changedParams).map(([k, v]) => `${k}=${v}`).join(', ')}`);
    }
    if (preset !== undefined) {
      if (!PRESETS[preset]) throw new Error(`unknown preset ${preset}`);
      this.preset = preset;
      this.overrides = {};
    }
    for (const [id, v] of Object.entries(features ?? {})) {
      if (!this.ids.has(id)) throw new Error(`unknown feature ${id}`);
      if (v === null) delete this.overrides[id];
      else if (typeof v === 'boolean') this.overrides[id] = v;
      else throw new Error(`feature ${id}: expected true, false or null`);
    }
    return this.#commit(true);
  }

  /** Picks up edits made to config.json by hand or by configure.mjs. */
  watch() {
    fs.watchFile(this.file, { interval: 1500 }, () => {
      let text;
      try {
        text = fs.readFileSync(this.file, 'utf8');
        if (text === this.lastText) return;
        const cfg = JSON.parse(text);
        this.lastText = text;
        for (const p of this.params) {
          const v = getPath(cfg, p.key);
          if (v !== undefined && v !== getPath(this.config, p.key)) {
            try {
              this.#params({ [p.key]: v });
            } catch (err) {
              this.log(`config: ${err.message}`);
            }
          }
        }
        this.preset = PRESETS[cfg.preset] ? cfg.preset : DEFAULT_PRESET;
        this.overrides = {};
        for (const [id, v] of Object.entries(cfg.features ?? {})) if (this.ids.has(id) && typeof v === 'boolean') this.overrides[id] = v;
        const changes = this.#commit(false);
        this.log(`Settings reloaded from ${this.file}: preset ${this.preset}${changes.length ? `, changed ${changes.map((c) => `${c.id}=${c.on ? 'on' : 'off'}`).join(' ')}` : ''}`);
      } catch (err) {
        if (text !== undefined) this.log(`config file not applied (${err.message}); fix it and save again`);
      }
    });
  }

  snapshot() {
    return {
      preset: this.preset,
      presets: Object.fromEntries(Object.entries(PRESETS).map(([k, v]) => [k, { ...v, features: this.registry.filter((f) => inPreset(f, k)).map((f) => f.id) }])),
      features: this.registry.map((f) => ({
        id: f.id, label: f.label, description: f.description, group: f.group, optIn: !!f.optIn, experimental: !!f.experimental,
        on: this.enabled[f.id], overridden: f.id in this.overrides,
      })),
      params: this.params.map((p) => ({ ...p, value: getPath(this.config, p.key) })),
    };
  }

  /**
   * HTTP handler for the settings page and API. Returns true when it handled the request.
   * Guards: Host must be this bridge (defeats DNS rebinding); POST needs JSON and either no Origin
   * (local tools) or our own origin (the page) — a foreign web page can neither read nor change settings.
   */
  handle(req, res, port) {
    const url = req.url.split('?')[0];
    const route = this.routes[`${req.method} ${url}`];
    if (url !== '/' && url !== '/api/settings' && !route && !Object.keys(this.routes).some((k) => k.endsWith(` ${url}`))) return false;
    const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
    if (!hosts.includes(String(req.headers.host))) {
      res.writeHead(403).end();
      req.resume();
      return true;
    }
    const security = { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
    if (req.method === 'GET' && url === '/') {
      res.writeHead(200, { ...security, 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'" });
      res.end(settingsPage());
      return true;
    }
    const json = (code, body) => {
      res.writeHead(code, { ...security, 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(body));
    };
    if (req.method === 'GET') {
      if (route) Promise.resolve().then(() => route({})).then((body) => json(200, body), (err) => json(500, { error: err.message }));
      else json(200, this.snapshot());
      return true;
    }
    if (req.method !== 'POST' || (url !== '/api/settings' && !route)) {
      res.writeHead(405).end();
      req.resume();
      return true;
    }
    const origin = req.headers.origin;
    const fetchSite = req.headers['sec-fetch-site'];
    const sameOrigin = !origin || hosts.some((h) => origin === `http://${h}`);
    if (!sameOrigin || (fetchSite && !['same-origin', 'none'].includes(fetchSite)) || !String(req.headers['content-type']).startsWith('application/json')) {
      res.writeHead(403).end();
      req.resume();
      return true;
    }
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (c) => {
      body += c;
      if (body.length > 16 * 1024) req.destroy();
    });
    req.on('end', async () => {
      try {
        const data = JSON.parse(body || '{}');
        if (route) return json(200, await route(data));
        const changes = this.apply(data);
        json(200, { ...this.snapshot(), changed: changes });
      } catch (err) {
        json(400, { error: err.message });
      }
    });
    return true;
  }
}
