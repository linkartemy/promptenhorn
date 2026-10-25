// The local settings page (served by the bridge at http://127.0.0.1:7777/). Plain HTML + a little
// script, no dependencies; it talks to /api/settings (same origin) and /api/chronicle.
export const settingsPage = () => `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Promptenhorn — настройки</title>
<style>
  :root { --bg:#f6f4ef; --card:#fff; --ink:#1f2328; --muted:#6b7280; --line:#e5e1d8; --accent:#c8102e; --ok:#1a7f37; --chip:#f0ede6; color-scheme: light; }
  @media (prefers-color-scheme: dark) { :root { --bg:#16181d; --card:#1f232a; --ink:#e8e6e1; --muted:#9aa1ab; --line:#2e333b; --accent:#ff4d5e; --ok:#3fb950; --chip:#2a2f37; color-scheme: dark; } }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 920px; margin: 0 auto; padding: 28px 18px 60px; }
  h1 { font-size: 26px; margin: 0 0 4px; } h1 span { color: var(--accent); }
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
  <h1>Promptenhorn <span>⛰</span></h1>
  <p class="sub">Что показывать в мире. Меняется сразу, без перезапуска; сохраняется в <code>config.json</code>.</p>

  <h2>Пресет</h2>
  <div class="presets" id="presets"></div>

  <h2>Параметры</h2>
  <div class="group" id="params"></div>

  <h2>Функции</h2>
  <div id="groups"></div>
  <p><button class="link" id="reset">Сбросить ручные изменения к пресету</button></p>

  <h2>Летопись города</h2>
  <div class="bar">
    <select id="project"><option value="">Все проекты</option></select>
    <input type="search" id="q" placeholder="Поиск по чату или зданию">
    <select id="player" title="Кого телепортировать"></select>
  </div>
  <div class="scroll"><table><thead><tr><th>Постройка</th><th>Проект</th><th>Строили</th><th>Когда</th><th></th></tr></thead><tbody id="chron"></tbody></table></div>

  <footer>То же из терминала: <code>node configure.mjs basic</code>, <code>node configure.mjs tests off</code>, <code>node configure.mjs list</code>.</footer>
</main>
<div class="toast" id="toast"></div>
<script>
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
    '<button class="preset' + (id === data.preset ? ' on' : '') + '" data-preset="' + id + '"><b>' + esc(p.label) + '</b><small>' + esc(p.description) + ' · ' + p.features.length + ' функций</small></button>').join('');
  $('#params').innerHTML = data.params.map((p) => '<div class="row"><div class="txt"><b>' + esc(p.label) + '</b><p>' + esc(p.description) + '</p></div>' +
    (p.options ? '<select data-param="' + p.key + '">' + p.options.map(([v, l]) => '<option value="' + esc(v) + '"' + (v === p.value ? ' selected' : '') + '>' + esc(l) + '</option>').join('') + '</select>'
      : '<input type="number" data-param="' + p.key + '" min="' + p.min + '" max="' + p.max + '" step="' + (p.step || 1) + '" value="' + esc(p.value) + '">') + '</div>').join('');
  const groups = {};
  for (const f of data.features) (groups[f.group] ??= []).push(f);
  $('#groups').innerHTML = Object.entries(groups).map(([g, list]) => '<div class="group"><h3>' + esc(g) + '</h3>' + list.map((f) =>
    '<div class="row"><div class="txt"><b>' + esc(f.label) + '</b>' + (f.optIn ? '<span class="tag opt">приватность</span>' : '') + (f.experimental ? '<span class="tag">экспериментально</span>' : '') + (f.overridden ? '<span class="tag mod">изменено</span>' : '') +
    '<p>' + esc(f.description) + '</p></div><label class="switch" title="' + esc(f.id) + '"><input type="checkbox" data-feature="' + f.id + '"' + (f.on ? ' checked' : '') + '><span></span></label></div>').join('') + '</div>').join('');
}

async function load() {
  data = await api('/api/settings');
  render();
  loadChronicle();
}

document.addEventListener('click', async (e) => {
  const p = e.target.closest('[data-preset]');
  if (p) { data = await api('/api/settings', { preset: p.dataset.preset }); render(); toast('Пресет: ' + data.presets[data.preset].label); }
  const tp = e.target.closest('[data-tp]');
  if (tp) {
    try { const r = await api('/api/teleport', { key: tp.dataset.tp, player: $('#player').value }); toast('Телепорт: ' + r.player); }
    catch (err) { toast(err.message); }
  }
});
document.addEventListener('change', async (e) => {
  const f = e.target.dataset.feature;
  const p = e.target.dataset.param;
  try {
    if (f) { data = await api('/api/settings', { features: { [f]: e.target.checked } }); render(); toast((e.target.checked ? 'Включено: ' : 'Выключено: ') + data.features.find((x) => x.id === f).label); }
    if (p) { data = await api('/api/settings', { params: { [p]: e.target.value } }); render(); toast('Сохранено'); }
  } catch (err) { toast(err.message); load(); }
  if (e.target.id === 'project') renderChronicle();
});
$('#q').addEventListener('input', () => renderChronicle());
$('#reset').addEventListener('click', async () => {
  const features = Object.fromEntries(data.features.filter((f) => f.overridden).map((f) => [f.id, null]));
  data = await api('/api/settings', { features }); render(); toast('Сброшено к пресету');
});

async function loadChronicle() {
  try {
    const r = await api('/api/chronicle');
    chron = r.records;
    $('#player').innerHTML = r.players.length ? r.players.map((n) => '<option>' + esc(n) + '</option>').join('') : '<option value="">нет игроков в игре</option>';
    const projects = [...new Set(chron.map((x) => x.district).filter(Boolean))].sort();
    const cur = $('#project').value;
    $('#project').innerHTML = '<option value="">Все проекты</option>' + projects.map((p) => '<option' + (p === cur ? ' selected' : '') + '>' + esc(p) + '</option>').join('');
    renderChronicle();
  } catch { $('#chron').innerHTML = '<tr><td colspan="5"><small>Летопись недоступна</small></td></tr>'; }
}

function renderChronicle() {
  const proj = $('#project').value;
  const q = $('#q').value.trim().toLowerCase();
  const fmt = (ms) => (ms ? new Date(ms).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
  const rows = chron.filter((r) => (!proj || r.district === proj) && (!q || (r.label + ' ' + r.contributors.map((c) => c.name).join(' ')).toLowerCase().includes(q))).slice(0, 300);
  $('#chron').innerHTML = rows.map((r) => '<tr><td><b>' + esc(r.label) + '</b><br><small>' + (r.done ? 'готово' : 'строится ' + r.pct + '%') + (r.stage ? ', этап ' + r.stage : '') + '</small></td><td>' + esc(r.district) + '</td><td>' +
    r.contributors.slice(0, 3).map((c) => esc(c.name) + ' <small>' + c.blocks + ' бл., ' + c.minutes + ' мин' + (c.commits ? ', ' + c.commits + ' коммит.' : '') + '</small>').join('<br>') + '</td><td><small>' + fmt(r.start) + (r.end ? '<br>→ ' + fmt(r.end) : '') + '</small></td><td><button class="link" data-tp="' + esc(r.key) + '">телепорт</button></td></tr>').join('') ||
    '<tr><td colspan="5"><small>Пока пусто</small></td></tr>';
}

load().catch((err) => { document.body.insertAdjacentHTML('afterbegin', '<p style="padding:12px;color:#c8102e">Мост не отвечает: ' + esc(err.message) + '</p>'); });
setInterval(loadChronicle, 15000);
</script>
</body>
</html>
`;
