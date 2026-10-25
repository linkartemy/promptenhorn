// The local settings page (served by the bridge at http://127.0.0.1:7777/). Plain HTML + a little
// script, no dependencies; it talks to /api/settings (same origin) and /api/chronicle.
// Rendered in the configured language: static texts through t(), the script gets the `settings.*`
// strings as JSON (switching the language reloads the page).
import { t, strings, htmlLang, LANGUAGES } from './i18n.mjs';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// JSON inside <script>: no "</script>" or "<!--" can end the element early.
const scriptJson = (v) => JSON.stringify(v).replace(/</g, '\\u003c');

export const settingsPage = (lang) => `<!doctype html>
<html lang="${htmlLang(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(t('settings.title', {}, lang))}</title>
<style>
  :root { --bg:#f6f4ef; --card:#fff; --ink:#1f2328; --muted:#6b7280; --line:#e5e1d8; --accent:#c8102e; --ok:#1a7f37; --chip:#f0ede6; color-scheme: light; }
  @media (prefers-color-scheme: dark) { :root { --bg:#16181d; --card:#1f232a; --ink:#e8e6e1; --muted:#9aa1ab; --line:#2e333b; --accent:#ff4d5e; --ok:#3fb950; --chip:#2a2f37; color-scheme: dark; } }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 920px; margin: 0 auto; padding: 28px 18px 60px; }
  h1 { font-size: 26px; margin: 0 0 4px; } h1 span { color: var(--accent); }
  .top { display: flex; gap: 14px; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; }
  .lang { display: flex; gap: 8px; align-items: center; color: var(--muted); font-size: 13.5px; margin-top: 4px; }
  h2 { font-size: 17px; margin: 30px 0 10px; }
  .sub { color: var(--muted); margin: 0 0 18px; }
  .presets { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; }
  .preset { text-align: left; border: 2px solid var(--line); background: var(--card); color: inherit; border-radius: 12px; padding: 12px 14px; cursor: pointer; font: inherit; }
  .preset b { display: block; font-size: 16px; margin-bottom: 2px; }
  .preset small { color: var(--muted); }
  .preset.on { border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent); }
  .group { background: var(--card); border: 1px solid var(--line); border-radius: 12px; margin-bottom: 12px; overflow: hidden; }
  .group h3 { margin: 0; padding: 10px 14px; font-size: 14px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); border-bottom: 1px solid var(--line); }
  .row { display: flex; gap: 14px; align-items: flex-start; padding: 10px 14px; border-top: 1px solid var(--line); }
  .row:first-of-type { border-top: 0; }
  .row .txt { flex: 1; min-width: 0; } .row .txt b { font-weight: 600; } .row .txt p { margin: 2px 0 0; color: var(--muted); font-size: 13.5px; }
  .tag { font-size: 11px; padding: 1px 6px; border-radius: 99px; background: var(--chip); color: var(--muted); margin-left: 6px; vertical-align: 1px; }
  .tag.mod { color: var(--accent); } .tag.opt { color: #b45309; }
  .switch { position: relative; width: 44px; height: 26px; flex: none; margin-top: 2px; }
  .switch input { opacity: 0; width: 0; height: 0; }
  .switch span { position: absolute; inset: 0; background: var(--line); border-radius: 99px; transition: .15s; cursor: pointer; }
  .switch span::before { content: ""; position: absolute; width: 20px; height: 20px; left: 3px; top: 3px; background: #fff; border-radius: 50%; transition: .15s; box-shadow: 0 1px 2px #0003; }
  .switch input:checked + span { background: var(--ok); } .switch input:checked + span::before { transform: translateX(18px); }
  .switch input:focus-visible + span { outline: 2px solid var(--accent); outline-offset: 2px; }
  input[type=number], select, input[type=search] { font: inherit; padding: 5px 8px; border: 1px solid var(--line); border-radius: 8px; background: var(--card); color: inherit; }
  input[type=number] { width: 90px; }
  button.link { border: 0; background: none; color: var(--accent); cursor: pointer; font: inherit; padding: 0; }
  .bar { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin-bottom: 10px; }
  .toast { position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%); background: var(--ink); color: var(--bg); padding: 8px 14px; border-radius: 10px; opacity: 0; transition: opacity .2s; pointer-events: none; }
  .toast.show { opacity: .92; }
  .scroll { overflow-x: auto; background: var(--card); border: 1px solid var(--line); border-radius: 12px; }
  table { border-collapse: collapse; width: 100%; font-size: 13.5px; }
  th, td { text-align: left; padding: 7px 10px; border-top: 1px solid var(--line); vertical-align: top; }
  th { color: var(--muted); font-weight: 600; border-top: 0; white-space: nowrap; }
  td small { color: var(--muted); }
  footer { margin-top: 26px; color: var(--muted); font-size: 13px; }
  code { background: var(--chip); padding: 1px 5px; border-radius: 5px; }
</style>
</head>
<body>
<main>
  <div class="top">
    <h1>Promptenhorn <span>⛰</span></h1>
    <label class="lang" title="${esc(t('settings.languageHint', {}, lang))}">${esc(t('settings.language', {}, lang))}
      <select id="language" aria-label="${esc(t('settings.language', {}, lang))}">${Object.entries(LANGUAGES).map(([code, name]) => `<option value="${code}" lang="${htmlLang(code)}"${code === lang ? ' selected' : ''}>${esc(name)}</option>`).join('')}</select>
    </label>
  </div>
  <p class="sub"><a href="/map" style="color:var(--accent)">${esc(t('settings.mapLink', {}, lang))}</a></p>
  <p class="sub">${esc(t('settings.intro', {}, lang)).replace('{file}', '<code>config.json</code>')}</p>

  <h2>${esc(t('settings.presets', {}, lang))}</h2>
  <div class="presets" id="presets"></div>

  <h2>${esc(t('settings.params', {}, lang))}</h2>
  <div class="group" id="params"></div>

  <h2>${esc(t('settings.features', {}, lang))}</h2>
  <div id="groups"></div>
  <p><button class="link" id="reset">${esc(t('settings.reset', {}, lang))}</button></p>

  <h2>${esc(t('settings.chronicle', {}, lang))}</h2>
  <div class="bar">
    <select id="project" aria-label="${esc(t('settings.col.project', {}, lang))}"><option value="">${esc(t('settings.allProjects', {}, lang))}</option></select>
    <input type="search" id="q" placeholder="${esc(t('settings.search', {}, lang))}" aria-label="${esc(t('settings.search', {}, lang))}">
    <select id="player" title="${esc(t('settings.playerTitle', {}, lang))}" aria-label="${esc(t('settings.playerTitle', {}, lang))}"></select>
  </div>
  <div class="scroll"><table><thead><tr><th>${esc(t('settings.col.building', {}, lang))}</th><th>${esc(t('settings.col.project', {}, lang))}</th><th>${esc(t('settings.col.builders', {}, lang))}</th><th>${esc(t('settings.col.when', {}, lang))}</th><th></th></tr></thead><tbody id="chron"></tbody></table></div>

  <footer>${esc(t('settings.footer', {}, lang)).replace('{commands}', `<code>node configure.mjs basic</code>, <code>node configure.mjs tests off</code>, <code>node configure.mjs language ${lang}</code>, <code>node configure.mjs list</code>`)}</footer>
</main>
<div class="toast" id="toast"></div>
<script>
const LANG = ${scriptJson(htmlLang(lang))};
const L = ${scriptJson(strings(['settings.'], lang))};
const plural = new Intl.PluralRules(LANG);
// t() of the page: same catalog keys and {name} placeholders as bridge/i18n.mjs, plurals via p.count.
function tr(key, p = {}) {
  let s = typeof p.count === 'number' ? L[key + '.' + plural.select(p.count)] ?? L[key + '.other'] ?? L[key] : L[key];
  if (s == null) s = key;
  return s.replace(/\\{(\\w+)\\}/g, (m, k) => (p[k] != null ? String(p[k]) : m));
}
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
let data = null;
let chron = [];

function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 1600); }

async function api(path, body) {
  const res = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || res.statusText);
  return json;
}

function render() {
  $('#presets').innerHTML = Object.entries(data.presets).map(([id, p]) =>
    '<button class="preset' + (id === data.preset ? ' on' : '') + '" data-preset="' + id + '"><b>' + esc(p.label) + '</b><small>' + esc(p.description) + ' · ' + esc(tr('settings.featureCount', { count: p.features.length })) + '</small></button>').join('');
  $('#params').innerHTML = data.params.map((p) => '<div class="row"><div class="txt"><b>' + esc(p.label) + '</b><p>' + esc(p.description) + '</p></div>' +
    (p.options ? '<select data-param="' + p.key + '">' + p.options.map(([v, l]) => '<option value="' + esc(v) + '"' + (v === p.value ? ' selected' : '') + '>' + esc(l) + '</option>').join('') + '</select>'
      : '<input type="number" data-param="' + p.key + '" min="' + p.min + '" max="' + p.max + '" step="' + (p.step || 1) + '" value="' + esc(p.value) + '">') + '</div>').join('');
  const groups = {};
  for (const f of data.features) (groups[f.group] ??= []).push(f);
  $('#groups').innerHTML = Object.entries(groups).map(([g, list]) => '<div class="group"><h3>' + esc(g) + '</h3>' + list.map((f) =>
    '<div class="row"><div class="txt"><b>' + esc(f.label) + '</b>' + (f.optIn ? '<span class="tag opt">' + esc(tr('settings.tag.privacy')) + '</span>' : '') + (f.experimental ? '<span class="tag">' + esc(tr('settings.tag.experimental')) + '</span>' : '') + (f.overridden ? '<span class="tag mod">' + esc(tr('settings.tag.changed')) + '</span>' : '') +
    '<p>' + esc(f.description) + '</p></div><label class="switch" title="' + esc(f.id) + '"><input type="checkbox" data-feature="' + f.id + '"' + (f.on ? ' checked' : '') + '><span></span></label></div>').join('') + '</div>').join('');
}

async function load() {
  data = await api('/api/settings');
  render();
  loadChronicle();
}

document.addEventListener('click', async (e) => {
  const p = e.target.closest('[data-preset]');
  if (p) { data = await api('/api/settings', { preset: p.dataset.preset }); render(); toast(tr('settings.toast.preset', { name: data.presets[data.preset].label })); }
  const tp = e.target.closest('[data-tp]');
  if (tp) {
    try { const r = await api('/api/teleport', { key: tp.dataset.tp, player: $('#player').value }); toast(tr('settings.toast.teleport', { player: r.player })); }
    catch (err) { toast(err.message); }
  }
});
document.addEventListener('change', async (e) => {
  const f = e.target.dataset.feature;
  const p = e.target.dataset.param;
  try {
    if (f) { data = await api('/api/settings', { features: { [f]: e.target.checked } }); render(); toast(tr(e.target.checked ? 'settings.toast.on' : 'settings.toast.off', { name: data.features.find((x) => x.id === f).label })); }
    if (p) { data = await api('/api/settings', { params: { [p]: e.target.value } }); render(); toast(tr('settings.toast.saved')); }
    if (e.target.id === 'language') { await api('/api/settings', { language: e.target.value }); location.reload(); return; }
  } catch (err) { toast(err.message); load(); }
  if (e.target.id === 'project') renderChronicle();
});
$('#q').addEventListener('input', () => renderChronicle());
$('#reset').addEventListener('click', async () => {
  const features = Object.fromEntries(data.features.filter((f) => f.overridden).map((f) => [f.id, null]));
  data = await api('/api/settings', { features }); render(); toast(tr('settings.toast.reset'));
});

async function loadChronicle() {
  try {
    const r = await api('/api/chronicle');
    chron = r.records;
    $('#player').innerHTML = r.players.length ? r.players.map((n) => '<option>' + esc(n) + '</option>').join('') : '<option value="">' + esc(tr('settings.noPlayers')) + '</option>';
    const projects = [...new Set(chron.map((x) => x.district).filter(Boolean))].sort();
    const cur = $('#project').value;
    $('#project').innerHTML = '<option value="">' + esc(tr('settings.allProjects')) + '</option>' + projects.map((p) => '<option' + (p === cur ? ' selected' : '') + '>' + esc(p) + '</option>').join('');
    renderChronicle();
  } catch { $('#chron').innerHTML = '<tr><td colspan="5"><small>' + esc(tr('settings.chronicleUnavailable')) + '</small></td></tr>'; }
}

function renderChronicle() {
  const proj = $('#project').value;
  const q = $('#q').value.trim().toLowerCase();
  const fmt = (ms) => (ms ? new Date(ms).toLocaleString(LANG, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
  const rows = chron.filter((r) => (!proj || r.district === proj) && (!q || (r.label + ' ' + r.contributors.map((c) => c.name).join(' ')).toLowerCase().includes(q))).slice(0, 300);
  $('#chron').innerHTML = rows.map((r) => '<tr><td><b>' + esc(r.label) + '</b><br><small>' + esc(r.done ? tr('settings.done') : tr('settings.building', { pct: r.pct })) + (r.stage ? ', ' + esc(tr('settings.stage', { stage: r.stage })) : '') + '</small></td><td>' + esc(r.district) + '</td><td>' +
    r.contributors.slice(0, 3).map((c) => esc(c.name) + ' <small>' + esc(tr('settings.contrib', { blocks: c.blocks, minutes: c.minutes })) + (c.commits ? ', ' + esc(tr('settings.commits', { count: c.commits })) : '') + '</small>').join('<br>') + '</td><td><small>' + fmt(r.start) + (r.end ? '<br>→ ' + fmt(r.end) : '') + '</small></td><td><button class="link" data-tp="' + esc(r.key) + '">' + esc(tr('settings.teleport')) + '</button></td></tr>').join('') ||
    '<tr><td colspan="5"><small>' + esc(tr('settings.empty')) + '</small></td></tr>';
}

load().catch((err) => { document.body.insertAdjacentHTML('afterbegin', '<p style="padding:12px;color:#c8102e">' + esc(tr('settings.offline', { error: err.message })) + '</p>'); });
setInterval(loadChronicle, 15000);
</script>
</body>
</html>
`;
