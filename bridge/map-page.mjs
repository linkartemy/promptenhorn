// Live web map of the city (served by the bridge at http://127.0.0.1:7777/map): plots, districts and
// the builders as moving dots, straight from bridge state — no region files, no client mods.
// The page polls GET /api/map (pure state read, no RCON); the only RCON calls are teleport / follow
// clicks (POST /api/map/tp). Same guards as the settings page: Host must be this bridge, POST needs
// JSON and our own Origin (or none, for local tools), Sec-Fetch-Site must not be cross-site.
import { PLOT } from './terrain.mjs';

const VERB = { read: 'читает', edit: 'правит', bash: 'запускает команды', web: 'ищет в сети', agent: 'с подмастерьями', plan: 'планирует', mcp: 'инструменты', other: 'работает' };
const RECENT_MS = 90000; // a tool category older than this no longer describes what the chat does
const NAME = /^\w{1,16}$/;

export class MapPage {
  /**
   * @param {object} d from the bridge: state(), config, rt(s), siteOf(key), labelOf(type), cmd(command),
   *   players() -> online names, builderSel(s), gens, renovator, log
   */
  constructor(d) {
    this.d = d;
    this.lastTp = 0;
  }

  get state() {
    return this.d.state();
  }

  #renovation() {
    const st = this.state.renovation;
    if (!st) return null;
    const job = this.d.renovator.job;
    const pct = job && job.key === st.key ? Math.floor((100 * st.idx) / Math.max(1, job.ops.length)) : null;
    return { key: st.key, kind: st.kind, pct };
  }

  #builder(s, now, renov) {
    const { config, rt, siteOf } = this.d;
    const r = rt(s);
    const w = r.waiting?.kind;
    const silentMin = (now - s.lastEvent) / 60000;
    const sleeping = !s.active && (String(s.pose).includes('sleeping') || silentMin > config.sleepAfterMinutes);
    const st = w === 'permission' || w === 'question' ? 'waiting' : s.active ? 'working' : sleeping ? 'sleeping' : 'idle';
    const helping = this.d.renovator.helping(s);
    let activity;
    if (w === 'permission') activity = 'ждёт твоего разрешения' + (r.waiting.tool ? ` (${r.waiting.tool})` : '');
    else if (w === 'question') activity = 'ждёт ответа на вопрос';
    else if (now < (r.limitUntil ?? 0)) activity = 'лимит API, пауза';
    else if (now < (r.compactUntil ?? 0)) activity = 'перекур: сжимает память';
    else if (s.active && s.planMode) activity = 'планирует, стройка ждёт плана';
    else if (s.active) {
      const verb = VERB[r.toolCat] && now - (r.toolAt ?? 0) < RECENT_MS ? VERB[r.toolCat] : VERB.other;
      activity = verb + (r.agents?.size ? ` · подмастерьев: ${r.agents.size}` : '');
    } else if (helping) activity = 'помогает с ремонтом';
    else if (sleeping) activity = 'спит';
    else if (w === 'idle') activity = 'ждёт задачу';
    else activity = 'отдыхает';

    // Where the entity actually is: the last block it walked to (tracked by the bridge), the lot being
    // renovated when it helps the crew, else the front of the site it stands at.
    const at = siteOf(s.at);
    let pos = null;
    if (at) {
      const rp = helping && renov ? this.state.plots[renov.key] : null;
      if (rp) pos = [rp.x0 + PLOT / 2, rp.y + 1, rp.z0 + PLOT / 2];
      else if (r.pos && r.posAt === s.at) pos = r.pos;
      else pos = [at.front[0] + 0.5, at.front[1], at.front[2] + 0.5];
    }
    const job = siteOf(s.job) ?? at;
    const pctOf = (rec) => (rec ? (rec.done ? 100 : Math.min(100, Math.floor((100 * rec.placed) / Math.max(1, rec.total)))) : null);
    const home = s.plotKey ? this.state.plots[s.plotKey] : null;
    return {
      id: s.id,
      name: s.name,
      district: s.districtName,
      state: st,
      waitKind: w ?? null,
      waitSince: r.waiting?.since ?? null,
      activity,
      pos: pos && pos.map((v) => Math.round(v * 10) / 10),
      site: job ? { key: job.key, label: job.label, pct: pctOf(job.rec) } : null,
      home: home && (!job || job.key !== `plot:${home.key}`) ? { label: this.d.labelOf(home.type), pct: pctOf(home), stage: home.stage ?? null } : null,
      lastEvent: s.lastEvent,
      model: s.model ?? null,
    };
  }

  snapshot() {
    const { state, d } = this;
    const now = Date.now();
    const renov = this.#renovation();
    const plots = Object.values(state.plots).map((p) => {
      const site = d.siteOf(`plot:${p.key}`);
      return {
        key: p.key, cell: p.cell, x: p.x0, z: p.z0, y: p.y, type: p.type, zone: p.zone,
        label: site?.label ?? d.labelOf(p.type), district: p.district ?? null, public: !!p.public,
        done: !!p.done, everDone: !!p.everDone, stage: p.stage ?? null,
        pct: p.done ? 100 : Math.min(100, Math.floor((100 * (p.placed ?? 0)) / Math.max(1, p.total ?? 1))),
        outdated: !!p.done && p.type !== 'park' && p.gen !== d.gens.current,
        renovating: renov?.key === p.key ? (renov.pct ?? 0) : null,
        builder: p.sessionId && !p.done ? state.sessions[p.sessionId]?.name ?? null : null,
      };
    });
    const objs = Object.values(state.objects ?? {});
    const objects = objs
      .filter((o) => o.plotKey || o.kind === 'summit' || objs.length < 1500)
      .slice(-1500)
      .map((o) => ({ id: o.id, type: o.type, kind: o.kind, x: o.x0, z: o.z0, size: o.type === 'summit' ? 5 : o.type === 'lamp' ? 1 : 3, done: !!o.done, pct: o.done ? 100 : Math.floor((100 * o.placed) / Math.max(1, o.total)), label: d.siteOf(`obj:${o.id}`)?.label ?? o.type }));
    const districts = Object.values(state.districts).map((x) => ({ key: x.key, name: x.name, index: x.index, seed: x.seed, cells: x.cells, done: x.buildingsDone ?? 0, started: x.buildingsStarted ?? 0, pending: !!x.pending }));
    const builders = Object.values(state.sessions).filter((s) => !s.retired).map((s) => this.#builder(s, now, renov));
    return {
      now,
      connected: d.connected(),
      city: state.city ? { name: state.city.name ?? d.config.cityName, cx: state.city.cx, cz: state.city.cz, baseY: state.city.baseY, pending: !!state.city.pending } : null,
      plotSize: PLOT,
      plots, objects, districts, builders,
      renovation: renov,
      players: d.players(),
    };
  }

  /** POST /api/map/tp: {sessionId, mode: 'tp'|'follow', player?} or {plot, player?}. */
  async teleport(body) {
    const { cmd, siteOf, builderSel, log } = this.d;
    const now = Date.now();
    if (now - this.lastTp < 400) throw Object.assign(new Error('Слишком часто, подожди секунду'), { code: 429 });
    this.lastTp = now;
    if (!this.d.connected()) throw new Error('Сервер Minecraft не подключён');
    const players = this.d.players();
    if (!players.length) throw new Error('В игре никого нет: зайди на сервер, и телепорт заработает');
    const asked = typeof body?.player === 'string' ? body.player : '';
    const player = players.includes(asked) ? asked : players.length === 1 ? players[0] : null;
    if (!player || !NAME.test(player)) throw new Error('Выбери игрока');
    const leaveCamera = () => cmd(`execute as ${player} run spectate`).catch(() => ''); // stops a previous «follow»; harmless otherwise

    if (typeof body?.plot === 'string') {
      const site = siteOf(`plot:${body.plot}`);
      if (!site) throw new Error('Нет такого участка');
      const [x, y, z] = site.front;
      const [hx, hz] = site.look;
      const yaw = Math.round((Math.atan2(-(hx - x), hz - z) * 180) / Math.PI);
      await leaveCamera();
      await cmd(`tp ${player} ${x + 0.5} ${y} ${z + 0.5} ${yaw} 10`);
      return { ok: true, player, target: site.label };
    }

    const s = typeof body?.sessionId === 'string' && Object.hasOwn(this.state.sessions, body.sessionId) ? this.state.sessions[body.sessionId] : null;
    if (!s || s.retired) throw new Error('Нет такого строителя');
    const site = siteOf(s.at);
    if (!site) throw new Error(`${s.name} ещё не вышел на участок`);
    const sel = builderSel(s);
    const mode = body.mode === 'follow' ? 'follow' : 'tp';
    await leaveCamera();
    let out = await cmd(`tp ${player} ${sel}`);
    if (!/teleported/i.test(out)) {
      const [x, y, z] = site.front; // entity not found (being re-summoned): its site's front will do
      out = await cmd(`tp ${player} ${x + 0.5} ${y} ${z + 0.5}`);
      if (mode === 'follow') throw new Error(`${s.name} сейчас не на месте, перенёс к участку`);
    }
    if (mode === 'follow') {
      await cmd(`gamemode spectator ${player}`);
      const sp = await cmd(`spectate ${sel} ${player}`);
      if (/no entity|not found|error|unknown/i.test(sp)) log(`map follow: ${sp}`);
      const hint = [
        { text: '' },
        { text: '◉ Следишь за ', color: 'gray' },
        { text: s.name, color: 'yellow' },
        { text: '. Shift — выйти из камеры. ', color: 'gray' },
        { text: '[в творческий]', color: 'aqua', click_event: { action: 'run_command', command: '/gamemode creative' }, hover_event: { action: 'show_text', value: '/gamemode creative' } },
      ];
      await cmd(`tellraw ${player} ${JSON.stringify(hint)}`);
    }
    return { ok: true, player, target: s.name, mode };
  }

  /** HTTP handler for /map, /api/map, /api/map/tp. Returns true when it handled the request. */
  handle(req, res, port) {
    const url = req.url.split('?')[0];
    if (url !== '/map' && url !== '/api/map' && url !== '/api/map/tp') return false;
    const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
    const deny = (code) => {
      res.writeHead(code).end();
      req.resume();
      return true;
    };
    if (!hosts.includes(String(req.headers.host))) return deny(403); // DNS rebinding
    const security = { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
    const json = (code, body) => {
      res.writeHead(code, { ...security, 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(body));
    };
    if (req.method === 'GET' && url === '/map') {
      res.writeHead(200, { ...security, 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'" });
      res.end(mapPage());
      return true;
    }
    if (req.method === 'GET' && url === '/api/map') {
      try {
        json(200, this.snapshot());
      } catch (err) {
        json(500, { error: err.message });
      }
      return true;
    }
    if (req.method !== 'POST' || url !== '/api/map/tp') return deny(405);
    const origin = req.headers.origin;
    const fetchSite = req.headers['sec-fetch-site'];
    const sameOrigin = !origin || hosts.some((h) => origin === `http://${h}`);
    if (!sameOrigin || (fetchSite && !['same-origin', 'none'].includes(fetchSite)) || !String(req.headers['content-type']).startsWith('application/json')) return deny(403);
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (c) => {
      body += c;
      if (body.length > 4096) req.destroy();
    });
    req.on('end', async () => {
      try {
        json(200, await this.teleport(JSON.parse(body || '{}')));
      } catch (err) {
        json(err.code === 429 ? 429 : 400, { error: err.message });
      }
    });
    return true;
  }
}

// ------------------------------------------------------------------ the page

// Runs in the browser (serialized with Function#toString, so it can use template literals freely).
function client() {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const TYPES = {
    square: ['Главная площадь', '#d6a84a'],
    plaza: ['Площадь квартала', '#e3c77e'],
    park: ['Парк', '#6fae5a'],
    chalet: ['Шале', '#9b5a33'],
    townhouse: ['Дом в старом городе', '#d9825b'],
    cafe: ['Кондитерская', '#e07aa0'],
    church: ['Церковь', '#8a73c9'],
    clocktower: ['Часовая башня', '#3f7cc0'],
    hotel: ['Гранд-отель', '#2a9686'],
    modern: ['Современный дом', '#7c8a99'],
    apartment: ['Кооперативный дом', '#c9a22a'],
    farmhouse: ['Эмментальская ферма', '#7d9a2d'],
    hut: ['Альпийская хижина', '#8b6d5f'],
  };
  const STATES = {
    waiting: ['ждёт тебя', '#e5243b'],
    working: ['работает', '#1fa64a'],
    idle: ['отдыхает', '#f0b90b'],
    sleeping: ['спит', '#8a8f98'],
  };
  const ORDER = { waiting: 0, working: 1, idle: 2, sleeping: 3 };
  const OBJ = { linden: '#3f8f3a', fir: '#2a6b3d', bench: '#8a5a2b', flowerbed: '#d0569a', lamp: '#f2c94c', well: '#7d8a99', fountain: '#4aa3df', bikestand: '#9aa3ad', summit: '#c8102e' };

  const cv = $('#map');
  const g = cv.getContext('2d');
  const tip = $('#tip');
  let data = null;
  let byCell = new Map();
  let view = null; // { s: px per block, tx, ty }
  let W = 0;
  let H = 0;
  let dpr = 1;
  let hover = null; // { kind: 'plot'|'builder', item }
  let selected = null; // builder id
  let player = '';
  const dots = new Map(); // builder id -> { x, z } shown position (eased toward the polled one)
  let theme = {};
  let failures = 0;

  function readTheme() {
    const cs = getComputedStyle(document.documentElement);
    for (const k of ['ground', 'street', 'rural', 'ink', 'muted', 'card', 'halo', 'gold']) theme[k] = cs.getPropertyValue('--map-' + k).trim() || cs.getPropertyValue('--' + k).trim();
    draw();
  }
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', readTheme);

  function toast(t) {
    const el = $('#toast');
    el.textContent = t;
    el.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => el.classList.remove('show'), 2400);
  }

  async function api(path, body) {
    const res = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || res.statusText);
    return json;
  }

  // --- geometry
  const toScreen = (x, z) => [x * view.s + view.tx, z * view.s + view.ty];
  const toWorld = (sx, sy) => [(sx - view.tx) / view.s, (sy - view.ty) / view.s];

  function bounds() {
    if (!data?.plots.length) return data?.city ? { x1: data.city.cx - 40, z1: data.city.cz - 40, x2: data.city.cx + 40, z2: data.city.cz + 40 } : { x1: -40, z1: -40, x2: 40, z2: 40 };
    const P = data.plotSize;
    const b = { x1: Infinity, z1: Infinity, x2: -Infinity, z2: -Infinity };
    for (const p of data.plots) {
      b.x1 = Math.min(b.x1, p.x);
      b.z1 = Math.min(b.z1, p.z);
      b.x2 = Math.max(b.x2, p.x + P);
      b.z2 = Math.max(b.z2, p.z + P);
    }
    return b;
  }

  function fit() {
    const b = bounds();
    const pad = 40;
    const s = Math.min((W - pad * 2) / Math.max(1, b.x2 - b.x1), (H - pad * 2) / Math.max(1, b.z2 - b.z1));
    const sc = Math.max(0.3, Math.min(14, s));
    view = { s: sc, tx: W / 2 - ((b.x1 + b.x2) / 2) * sc, ty: H / 2 - ((b.z1 + b.z2) / 2) * sc };
    draw();
  }

  function zoomAt(sx, sy, f) {
    const [wx, wz] = toWorld(sx, sy);
    view.s = Math.max(0.3, Math.min(30, view.s * f));
    view.tx = sx - wx * view.s;
    view.ty = sy - wz * view.s;
    draw();
  }

  function centreOn(x, z, minScale = 4) {
    view.s = Math.max(view.s, minScale);
    view.tx = W / 2 - x * view.s;
    view.ty = H / 2 - z * view.s;
    draw();
  }

  // --- drawing
  function districtColor(index) {
    const h = (index * 137.508 + 20) % 360;
    return `hsl(${h} 62% 45%)`;
  }
  const typeColor = (t) => (TYPES[t] ? TYPES[t][1] : '#9aa0a6');

  function hatch(x, y, w, h, color) {
    g.save();
    g.beginPath();
    g.rect(x, y, w, h);
    g.clip();
    g.strokeStyle = color;
    g.lineWidth = Math.max(1, view.s * 0.45);
    const step = Math.max(5, view.s * 2.2);
    for (let k = -h; k < w; k += step) {
      g.beginPath();
      g.moveTo(x + k, y + h);
      g.lineTo(x + k + h, y);
      g.stroke();
    }
    g.restore();
  }

  let rafPending = false;
  function draw() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(frame);
  }

  let lastFrame = performance.now();
  function frame(t) {
    rafPending = false;
    const dt = Math.min(0.1, (t - lastFrame) / 1000);
    lastFrame = t;
    if (!view || !W) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = theme.ground;
    g.fillRect(0, 0, W, H);
    if (!data) return;
    const P = data.plotSize;
    const s = view.s;
    const dMap = new Map(data.districts.map((d) => [d.key, d]));

    // plots
    for (const p of data.plots) {
      const [x, y] = toScreen(p.x, p.z);
      const w = P * s;
      if (x > W || y > H || x + w < 0 || y + w < 0) continue;
      const d = dMap.get(p.district);
      g.fillStyle = p.zone === 'outer' || p.zone === 'rural' ? theme.rural : theme.street;
      g.fillRect(x, y, w, w);
      if (d) {
        g.globalAlpha = 0.16;
        g.fillStyle = districtColor(d.index);
        g.fillRect(x, y, w, w);
        g.globalAlpha = 1;
      }
      const open = p.type === 'square' || p.type === 'plaza' || p.type === 'park';
      const inset = open ? 2 : 3.5;
      const [bx, by] = toScreen(p.x + inset, p.z + inset);
      const bw = (P - inset * 2) * s;
      const col = typeColor(p.type);
      if (p.done) {
        g.fillStyle = col;
        g.fillRect(bx, by, bw, bw);
      } else {
        g.globalAlpha = 0.28;
        g.fillStyle = col;
        g.fillRect(bx, by, bw, bw);
        g.globalAlpha = 1;
        const fh = (bw * p.pct) / 100;
        g.fillStyle = col;
        g.fillRect(bx, by + bw - fh, bw, fh);
        g.setLineDash([Math.max(2, s), Math.max(2, s)]);
        g.strokeStyle = col;
        g.lineWidth = Math.max(1, s * 0.3);
        g.strokeRect(bx + 0.5, by + 0.5, bw - 1, bw - 1);
        g.setLineDash([]);
        // progress ring
        if (s >= 1.6) {
          const r = Math.min(bw * 0.28, 22);
          const cx = bx + bw / 2;
          const cy = by + bw / 2;
          g.lineWidth = Math.max(2, r * 0.28);
          g.strokeStyle = theme.card;
          g.beginPath();
          g.arc(cx, cy, r, 0, Math.PI * 2);
          g.stroke();
          g.strokeStyle = theme.ink;
          g.beginPath();
          g.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * p.pct) / 100);
          g.stroke();
          if (r >= 11) {
            g.fillStyle = theme.ink;
            g.font = `600 ${Math.round(r * 0.62)}px system-ui, sans-serif`;
            g.textAlign = 'center';
            g.textBaseline = 'middle';
            g.fillText(p.pct + '%', cx, cy + 0.5);
          }
        }
      }
      if (p.renovating != null) hatch(bx, by, bw, bw, 'rgba(20,90,200,.55)');
      else if (p.outdated) {
        g.fillStyle = 'rgba(20,90,200,.6)';
        g.beginPath();
        g.moveTo(bx + bw, by);
        g.lineTo(bx + bw, by + Math.min(bw * 0.3, 14));
        g.lineTo(bx + bw - Math.min(bw * 0.3, 14), by);
        g.fill();
      }
      if (p.public && !open) {
        g.strokeStyle = theme.gold;
        g.lineWidth = Math.max(1.5, s * 0.4);
        g.strokeRect(bx, by, bw, bw);
      }
      if (hover?.kind === 'plot' && hover.item.key === p.key) {
        g.strokeStyle = theme.ink;
        g.lineWidth = 2;
        g.strokeRect(x + 1, y + 1, w - 2, w - 2);
      }
      if (s >= 5 && !open) {
        g.fillStyle = theme.ink;
        g.font = `${Math.round(Math.min(13, s * 1.3))}px system-ui, sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'top';
        g.fillText(TYPES[p.type]?.[0] ?? p.label, x + w / 2, y + 2 + s * 0.2, w - 6);
      }
    }

    // small forms, trees, the summit
    for (const o of data.objects) {
      const [x, y] = toScreen(o.x, o.z);
      const w = Math.max(2, o.size * s);
      if (x > W || y > H || x + w < 0 || y + w < 0) continue;
      g.globalAlpha = o.done ? 1 : 0.45;
      g.fillStyle = OBJ[o.type] ?? '#888';
      if (o.type === 'linden' || o.type === 'fir' || o.type === 'fountain' || o.type === 'well') {
        g.beginPath();
        g.arc(x + w / 2, y + w / 2, w / 2, 0, Math.PI * 2);
        g.fill();
      } else g.fillRect(x, y, w, w);
      g.globalAlpha = 1;
    }

    // district outlines
    g.lineCap = 'round';
    for (const d of data.districts) {
      const own = new Set(d.cells);
      g.strokeStyle = districtColor(d.index);
      g.lineWidth = Math.max(2, Math.min(5, s * 0.5));
      g.beginPath();
      for (const key of d.cells) {
        const p = byCell.get(key);
        if (!p) continue;
        const [i, j] = p.cell;
        const [x, y] = toScreen(p.x, p.z);
        const w = P * s;
        if (!own.has(`${i},${j - 1}`)) { g.moveTo(x, y); g.lineTo(x + w, y); }
        if (!own.has(`${i},${j + 1}`)) { g.moveTo(x, y + w); g.lineTo(x + w, y + w); }
        if (!own.has(`${i - 1},${j}`)) { g.moveTo(x, y); g.lineTo(x, y + w); }
        if (!own.has(`${i + 1},${j}`)) { g.moveTo(x + w, y); g.lineTo(x + w, y + w); }
      }
      g.stroke();
    }

    // names: districts at their plazas, the city at the square
    const label = (text, x, y, size, color, weight = 700) => {
      g.font = `${weight} ${size}px system-ui, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineJoin = 'round';
      g.lineWidth = Math.max(3, size / 4);
      g.strokeStyle = theme.halo;
      g.strokeText(text, x, y);
      g.fillStyle = color;
      g.fillText(text, x, y);
    };
    for (const d of data.districts) {
      const p = byCell.get(`${d.seed[0]},${d.seed[1]}`);
      if (!p) continue;
      const [x, y] = toScreen(p.x + P / 2, p.z + P / 2);
      label(d.name, x, y, Math.round(Math.max(12, Math.min(22, s * 2.2))), districtColor(d.index));
    }
    if (data.city) {
      const sq = byCell.get('0,0');
      const [x, y] = toScreen(sq ? sq.x + P / 2 : data.city.cx, sq ? sq.z + P / 2 : data.city.cz);
      label(data.city.name, x, y, Math.round(Math.max(16, Math.min(34, s * 3.2))), theme.gold, 800);
    }

    // builders
    let moving = false;
    let pulsing = false;
    const pulse = (t / 1000) % 1.2 / 1.2;
    const list = data.builders.filter((b) => b.pos).sort((a, b) => ORDER[b.state] - ORDER[a.state]); // waiting drawn last (on top)
    for (const b of list) {
      let dot = dots.get(b.id);
      const [tx, tz] = [b.pos[0], b.pos[2]];
      if (!dot || Math.hypot(dot.x - tx, dot.z - tz) > 80) dots.set(b.id, (dot = { x: tx, z: tz }));
      const k = Math.min(1, dt * 5);
      dot.x += (tx - dot.x) * k;
      dot.z += (tz - dot.z) * k;
      if (Math.hypot(dot.x - tx, dot.z - tz) > 0.05) moving = true;
      const [x, y] = toScreen(dot.x, dot.z);
      b._sx = x;
      b._sy = y;
      if (x < -60 || y < -30 || x > W + 60 || y > H + 30) continue;
      const r = Math.max(5, Math.min(11, s * 0.9));
      const color = STATES[b.state][1];
      if (b.state === 'waiting') {
        pulsing = true;
        g.strokeStyle = color;
        g.globalAlpha = 1 - pulse;
        g.lineWidth = 3;
        g.beginPath();
        g.arc(x, y, r + 3 + pulse * 16, 0, Math.PI * 2);
        g.stroke();
        g.globalAlpha = 1;
      }
      g.fillStyle = color;
      g.strokeStyle = selected === b.id || (hover?.kind === 'builder' && hover.item.id === b.id) ? theme.ink : '#fff';
      g.lineWidth = selected === b.id ? 3 : 2;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      if (b.state === 'sleeping') {
        g.fillStyle = '#fff';
        g.font = `700 ${Math.round(r * 1.1)}px system-ui, sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('z', x, y + 0.5);
      }
      // name pill
      const name = b.name.length > 24 ? b.name.slice(0, 23) + '…' : b.name;
      g.font = '600 12px system-ui, sans-serif';
      const tw = g.measureText(name).width;
      const lx = x + r + 5;
      g.globalAlpha = 0.88;
      g.fillStyle = theme.card;
      g.beginPath();
      g.roundRect(lx - 4, y - 9, tw + 8, 18, 6);
      g.fill();
      g.globalAlpha = 1;
      g.fillStyle = b.state === 'waiting' ? color : theme.ink;
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      g.fillText(name, lx, y + 0.5);
    }
    if (moving || pulsing) draw();
  }

  // --- side list, banner, players
  function fmtAgo(ms) {
    const m = Math.floor(ms / 60000);
    if (m < 1) return 'только что';
    if (m < 60) return m + ' мин';
    const h = Math.floor(m / 60);
    return h < 48 ? h + ' ч' : Math.floor(h / 24) + ' д';
  }

  function sorted() {
    return [...data.builders].sort((a, b) => ORDER[a.state] - ORDER[b.state] || (a.pos ? 0 : 1) - (b.pos ? 0 : 1) || (a.state === 'waiting' ? (a.waitSince ?? 0) - (b.waitSince ?? 0) : b.lastEvent - a.lastEvent));
  }

  function siteText(b) {
    if (!b.site) return 'ищет участок';
    return esc(b.site.label) + (b.site.pct != null ? ' · ' + b.site.pct + '%' : '');
  }

  // The list is patched, not rebuilt: a button replaced between mousedown and mouseup loses the click.
  const setHtml = (el, html) => {
    if (el._html !== html) {
      el._html = html;
      el.innerHTML = html;
    }
  };
  function renderList() {
    const items = sorted();
    $('#count').textContent = items.length ? `(${items.length})` : '';
    const ul = $('#builders');
    const rows = new Map([...ul.querySelectorAll('li.b')].map((li) => [li.dataset.id, li]));
    ul.querySelector('li.empty')?.remove();
    let prev = null;
    for (const b of items) {
      let li = rows.get(b.id);
      rows.delete(b.id);
      if (!li) {
        li = document.createElement('li');
        li.dataset.id = b.id;
        li.innerHTML = '<div class="info"></div><div class="btns"></div>';
      }
      const color = STATES[b.state][1];
      const wait = b.state === 'waiting' && b.waitSince ? ` · ${fmtAgo(data.now - b.waitSince)}` : '';
      li.className = `b ${b.state}${selected === b.id ? ' sel' : ''}`;
      setHtml(li.firstChild, `<div class="bh"><span class="dot" style="background:${color}"></span><button class="name link" data-centre="${esc(b.id)}" title="Показать на карте">${esc(b.name)}</button></div>
        <div class="meta">${esc(b.district)} · ${siteText(b)}</div>
        <div class="act" style="color:${b.state === 'waiting' ? color : 'inherit'}">${esc(b.activity)}${wait}${b.state !== 'waiting' ? ' · ' + fmtAgo(data.now - b.lastEvent) : ''}</div>`);
      setHtml(li.lastChild, b.pos ? `<button data-tp="${esc(b.id)}">Телепорт</button><button data-follow="${esc(b.id)}">Следить</button>` : '<small>между участками — телепорт, когда выйдет на стройку</small>');
      const want = prev ? prev.nextSibling : ul.firstChild;
      if (want !== li) ul.insertBefore(li, want); // move only when the order really changed
      prev = li;
    }
    for (const li of rows.values()) li.remove();
    if (!items.length) ul.innerHTML = '<li class="empty">Пока ни одного строителя. Начни чат с Claude — появится здесь.</li>';

    const waiting = items.filter((b) => b.state === 'waiting');
    const banner = $('#banner');
    banner.hidden = !waiting.length;
    if (waiting.length) {
      const first = waiting.find((b) => b.pos);
      setHtml(banner, `<span class="pulse"></span><b>Ждёт тебя:</b> ${waiting.slice(0, 3).map((b) => `<span class="who"><button class="link" data-centre="${esc(b.id)}">${esc(b.name)}</button> <small>${b.waitKind === 'question' ? 'вопрос' : 'разрешение'}, ${fmtAgo(data.now - (b.waitSince ?? data.now))}</small></span>`).join('')}${waiting.length > 3 ? `<small>и ещё ${waiting.length - 3}</small>` : ''}${first ? `<button class="go" data-tp="${esc(first.id)}" title="${esc(first.name)}">Телепорт</button>` : ''}`);
    }
    document.title = (waiting.length ? `(${waiting.length}) ждёт · ` : '') + 'Карта — ' + (data.city?.name ?? 'Promptenhorn');

    const ps = data.players;
    if (!ps.includes(player)) player = ps[0] ?? '';
    const pl = $('#player');
    if (ps.length > 1) setHtml(pl, `Игрок: <select id="psel">${ps.map((n) => `<option>${esc(n)}</option>`).join('')}</select>`);
    else if (ps.length === 1) setHtml(pl, `Игрок: <b>${esc(ps[0])}</b>`);
    else setHtml(pl, '<span class="hint">В игре никого нет — зайди на сервер, чтобы телепортироваться.</span>');
    const sel = $('#psel');
    if (sel && sel.value !== player) sel.value = player;

    const st = $('#status');
    if (!data.connected) st.textContent = 'Сервер Minecraft не подключён — карта по последнему состоянию';
    else if (!data.city) st.textContent = 'Город ещё не основан: начни чат с Claude';
    else {
      const done = data.plots.filter((p) => p.done && !['square', 'plaza', 'park'].includes(p.type)).length;
      const building = data.plots.filter((p) => !p.done).length;
      st.textContent = `${data.districts.length} кварт. · ${done} зданий готово · ${building} строится` + (data.renovation ? ` · ремонт ${data.renovation.pct ?? 0}%` : '');
    }
  }

  function renderLegend() {
    $('#legend-types').innerHTML = Object.entries(TYPES).map(([, [l, c]]) => `<li><i style="background:${c}"></i>${esc(l)}</li>`).join('');
    $('#legend-states').innerHTML = Object.entries(STATES).map(([k, [l, c]]) => `<li><i class="round${k === 'waiting' ? ' pulse-i' : ''}" style="background:${c}"></i>${esc(l)}</li>`).join('');
  }

  async function poll() {
    try {
      const next = await api('/api/map');
      const first = !data;
      data = next;
      byCell = new Map(data.plots.map((p) => [`${p.cell[0]},${p.cell[1]}`, p]));
      for (const id of [...dots.keys()]) if (!data.builders.some((b) => b.id === id && b.pos)) dots.delete(id);
      if (hover?.kind === 'plot') hover.item = byCell.get(hover.item.key.replace(/^plot:/, '')) ?? hover.item;
      if (hover?.kind === 'builder') hover.item = data.builders.find((b) => b.id === hover.item.id) ?? hover.item;
      failures = 0;
      $('#offline').hidden = true;
      if (first) fit();
      renderList();
      if (hover) showTip(hover, lastMouse[0], lastMouse[1]);
      draw();
    } catch (err) {
      failures++;
      if (failures >= 2) {
        $('#offline').hidden = false;
        $('#offline').textContent = 'Мост не отвечает: ' + err.message;
      }
    } finally {
      setTimeout(poll, document.hidden ? 5000 : 1000);
    }
  }

  // --- actions
  async function teleport(body, what) {
    try {
      const r = await api('/api/map/tp', { ...body, player });
      toast((r.mode === 'follow' ? 'Следишь за ' : 'Телепорт к ') + r.target + ' → ' + r.player);
    } catch (err) {
      toast(err.message);
    }
  }

  document.addEventListener('click', (e) => {
    const tp = e.target.closest('[data-tp]');
    if (tp) return teleport({ sessionId: tp.dataset.tp, mode: 'tp' });
    const fl = e.target.closest('[data-follow]');
    if (fl) return teleport({ sessionId: fl.dataset.follow, mode: 'follow' });
    const c = e.target.closest('[data-centre]');
    if (c) {
      const b = data?.builders.find((x) => x.id === c.dataset.centre);
      selected = b?.id ?? null;
      if (b?.pos) centreOn(b.pos[0], b.pos[2]);
      renderList();
    }
  });
  document.addEventListener('change', (e) => {
    if (e.target.id === 'psel') player = e.target.value;
  });
  $('#fit').addEventListener('click', fit);
  $('#zin').addEventListener('click', () => zoomAt(W / 2, H / 2, 1.4));
  $('#zout').addEventListener('click', () => zoomAt(W / 2, H / 2, 1 / 1.4));
  $('#legend-toggle').addEventListener('click', () => {
    const closed = $('#legend').classList.toggle('closed');
    try {
      localStorage.setItem('alps-map-legend', closed ? 'closed' : 'open');
    } catch {}
  });
  addEventListener('keydown', (e) => {
    if (e.target.closest('input,select,textarea')) return;
    if (e.key === '+' || e.key === '=') zoomAt(W / 2, H / 2, 1.4);
    else if (e.key === '-') zoomAt(W / 2, H / 2, 1 / 1.4);
    else if (e.key === '0') fit();
  });

  // --- hover & tooltip
  function hit(sx, sy) {
    if (!data || !view) return null;
    let best = null;
    for (const b of data.builders) {
      if (!b.pos || b._sx == null) continue;
      const d = Math.hypot(b._sx - sx, b._sy - sy);
      if (d < 14 && (!best || d < best.d)) best = { d, b };
    }
    if (best) return { kind: 'builder', item: best.b };
    const [wx, wz] = toWorld(sx, sy);
    if (!data.city) return null;
    const P = data.plotSize;
    const i = Math.floor((wx - (data.city.cx - 10)) / P);
    const j = Math.floor((wz - (data.city.cz - 10)) / P);
    const p = byCell.get(`${i},${j}`);
    return p ? { kind: 'plot', item: p } : null;
  }

  function showTip(h, sx, sy) {
    if (!h) {
      tip.hidden = true;
      return;
    }
    let html;
    if (h.kind === 'builder') {
      const b = h.item;
      html = `<b>${esc(b.name)}</b><span class="st" style="color:${STATES[b.state][1]}">● ${STATES[b.state][0]}</span><br>
        Квартал: ${esc(b.district)}<br>Стройка: ${siteText(b)}${b.home ? `<br>Свой дом: ${esc(b.home.label)} · ${b.home.pct}%` : ''}<br>
        Сейчас: ${esc(b.activity)}<br><small>последнее событие ${fmtAgo(data.now - b.lastEvent)} назад${b.model ? ' · ' + esc(b.model) : ''}</small>`;
    } else {
      const p = h.item;
      const d = data.districts.find((x) => x.key === p.district);
      const state = p.renovating != null ? `ремонт ${p.renovating}%` : p.done ? (p.outdated ? 'готово, ждёт ремонта' : 'готово') : `строится ${p.pct}%`;
      html = `<b>${esc(p.label)}</b><br>${d ? 'Квартал: ' + esc(d.name) + '<br>' : ''}${esc(state)}${p.stage && !['square', 'plaza', 'park'].includes(p.type) && !p.public ? ` · этап ${p.stage}` : ''}${p.builder ? '<br>Строит: ' + esc(p.builder) : ''}<br><small>клик — телепорт к фасаду</small>`;
    }
    tip.innerHTML = html;
    tip.hidden = false;
    const r = cv.getBoundingClientRect();
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    let x = sx + 14;
    let y = sy + 14;
    if (x + tw > r.width - 4) x = sx - tw - 14;
    if (y + th > r.height - 4) y = sy - th - 14;
    tip.style.left = Math.max(4, x) + 'px';
    tip.style.top = Math.max(4, y) + 'px';
  }

  // --- pan & zoom (mouse wheel, drag, pinch)
  const pointers = new Map();
  let drag = null;
  let lastMouse = [0, 0];
  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = cv.getBoundingClientRect();
    zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0015)));
  }, { passive: false });
  cv.addEventListener('pointerdown', (e) => {
    cv.setPointerCapture(e.pointerId);
    const r = cv.getBoundingClientRect();
    pointers.set(e.pointerId, [e.clientX - r.left, e.clientY - r.top]);
    if (pointers.size === 1) drag = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty, moved: 0 };
    else drag = { pinch: true, moved: 99 };
  });
  cv.addEventListener('pointermove', (e) => {
    const r = cv.getBoundingClientRect();
    const sx = e.clientX - r.left;
    const sy = e.clientY - r.top;
    lastMouse = [sx, sy];
    if (pointers.has(e.pointerId)) {
      const prev = pointers.get(e.pointerId);
      if (pointers.size === 2) {
        const other = [...pointers.entries()].find(([id]) => id !== e.pointerId)[1];
        const d0 = Math.hypot(prev[0] - other[0], prev[1] - other[1]);
        const d1 = Math.hypot(sx - other[0], sy - other[1]);
        pointers.set(e.pointerId, [sx, sy]);
        if (d0 > 0) zoomAt((sx + other[0]) / 2, (sy + other[1]) / 2, d1 / d0);
        return;
      }
      pointers.set(e.pointerId, [sx, sy]);
    }
    if (drag && !drag.pinch && pointers.size === 1) {
      drag.moved = Math.max(drag.moved, Math.hypot(e.clientX - drag.x, e.clientY - drag.y));
      view.tx = drag.tx + (e.clientX - drag.x);
      view.ty = drag.ty + (e.clientY - drag.y);
      cv.style.cursor = 'grabbing';
      tip.hidden = true;
      draw();
      return;
    }
    const h = hit(sx, sy);
    const same = h && hover && h.kind === hover.kind && (h.item.key ?? h.item.id) === (hover.item.key ?? hover.item.id);
    if (!same) {
      hover = h;
      draw();
    }
    cv.style.cursor = h ? 'pointer' : 'grab';
    showTip(h, sx, sy);
  });
  const up = (e) => {
    const was = pointers.has(e.pointerId);
    pointers.delete(e.pointerId);
    if (!was || pointers.size) return;
    const d = drag;
    drag = null;
    cv.style.cursor = 'grab';
    if (!d || d.moved > 4 || e.type === 'pointercancel') return;
    const r = cv.getBoundingClientRect();
    const h = hit(e.clientX - r.left, e.clientY - r.top);
    if (!h) return;
    if (h.kind === 'builder') {
      selected = h.item.id;
      renderList();
      document.querySelector(`li.b[data-id="${CSS.escape(h.item.id)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      draw();
    } else teleport({ plot: h.item.key });
  };
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', up);
  cv.addEventListener('pointerleave', () => {
    if (pointers.size) return;
    hover = null;
    tip.hidden = true;
    draw();
  });

  function resize() {
    const r = cv.parentElement.getBoundingClientRect();
    const oldW = W;
    const oldH = H;
    W = Math.max(1, Math.floor(r.width));
    H = Math.max(1, Math.floor(r.height));
    dpr = devicePixelRatio || 1;
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    cv.style.width = W + 'px';
    cv.style.height = H + 'px';
    if (view && oldW) {
      view.tx += (W - oldW) / 2;
      view.ty += (H - oldH) / 2;
    }
    if (!view) view = { s: 2, tx: W / 2, ty: H / 2 };
    draw();
  }
  new ResizeObserver(resize).observe(cv.parentElement);
  resize();
  readTheme();
  renderLegend();
  let legendOpen = null;
  try {
    legendOpen = localStorage.getItem('alps-map-legend');
  } catch {}
  if (legendOpen ? legendOpen === 'closed' : cv.parentElement.getBoundingClientRect().height < 820) $('#legend').classList.add('closed');
  poll();
}

export const mapPage = () => `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Карта — Promptenhorn</title>
<style>
  :root { --bg:#f6f4ef; --card:#fff; --ink:#1f2328; --muted:#6b7280; --line:#e5e1d8; --accent:#c8102e; --ok:#1a7f37; --chip:#f0ede6;
    --map-ground:#e4ecd9; --map-street:#cdc8bd; --map-rural:#d6c7a3; --map-halo:rgba(255,255,255,.9); --map-gold:#9a6b00; color-scheme: light; }
  @media (prefers-color-scheme: dark) { :root { --bg:#16181d; --card:#1f232a; --ink:#e8e6e1; --muted:#9aa1ab; --line:#2e333b; --accent:#ff4d5e; --ok:#3fb950; --chip:#2a2f37;
    --map-ground:#1a221b; --map-street:#3b3e44; --map-rural:#4a4332; --map-halo:rgba(10,12,16,.9); --map-gold:#f2c14e; color-scheme: dark; } }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 14px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; display: flex; flex-direction: column; }
  header { display: flex; align-items: center; gap: 14px; padding: 8px 14px; border-bottom: 1px solid var(--line); background: var(--card); flex-wrap: wrap; }
  header h1 { font-size: 18px; margin: 0; } header h1 span { color: var(--accent); }
  header #status { color: var(--muted); font-size: 13px; flex: 1; min-width: 200px; }
  header a { color: var(--accent); text-decoration: none; font-size: 13px; }
  .wrap { flex: 1; display: flex; min-height: 0; }
  .stage { position: relative; flex: 1; min-width: 0; overflow: hidden; }
  canvas { display: block; cursor: grab; touch-action: none; }
  aside { width: 330px; flex: none; border-left: 1px solid var(--line); background: var(--card); display: flex; flex-direction: column; min-height: 0; }
  aside h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); margin: 0; padding: 10px 14px 6px; }
  #player { padding: 0 14px 10px; border-bottom: 1px solid var(--line); font-size: 13px; }
  #player .hint { color: var(--muted); }
  select { font: inherit; padding: 3px 6px; border: 1px solid var(--line); border-radius: 8px; background: var(--card); color: inherit; }
  #builders { list-style: none; margin: 0; padding: 0; overflow-y: auto; flex: 1; }
  li.b { padding: 9px 14px; border-bottom: 1px solid var(--line); }
  li.b.sel { background: var(--chip); }
  li.b.waiting { background: color-mix(in srgb, var(--accent) 9%, transparent); }
  li.empty { padding: 14px; color: var(--muted); }
  .bh { display: flex; align-items: center; gap: 8px; }
  .dot { width: 11px; height: 11px; border-radius: 50%; flex: none; box-shadow: 0 0 0 2px var(--card), 0 0 0 3px var(--line); }
  li.waiting .dot { animation: pulse 1.2s infinite; }
  .name { font-weight: 600; color: var(--ink) !important; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
  .meta, .act { font-size: 12.5px; color: var(--muted); margin-left: 19px; }
  .act { color: var(--ink); }
  .btns { margin: 6px 0 0 19px; display: flex; gap: 6px; }
  .btns small { color: var(--muted); }
  button { font: inherit; cursor: pointer; }
  .btns button, .ctl button, .go { border: 1px solid var(--line); background: var(--card); color: var(--ink); border-radius: 8px; padding: 3px 10px; font-size: 13px; }
  .btns button:hover, .ctl button:hover { border-color: var(--accent); }
  button.link { border: 0; background: none; color: var(--accent); padding: 0; }
  .ctl { position: absolute; right: 12px; top: 12px; display: flex; flex-direction: column; gap: 6px; }
  .ctl button { width: 36px; height: 34px; padding: 0; font-size: 18px; box-shadow: 0 1px 3px #0002; }
  .ctl button#fit { font-size: 15px; }
  #banner { position: absolute; left: 50%; top: 12px; transform: translateX(-50%); max-width: calc(100% - 90px); background: var(--accent); color: #fff; padding: 7px 12px; border-radius: 10px; box-shadow: 0 3px 12px #0003; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; z-index: 2; }
  #banner button.link { color: #fff; text-decoration: underline; font-weight: 600; text-align: left; }
  #banner small { opacity: .85; }
  #banner .who { display: inline-flex; gap: 5px; align-items: baseline; padding: 0 6px; border-left: 1px solid #fff5; } #banner b + .who { border-left: 0; padding-left: 0; }
  #banner .go { border-color: #fff8; background: #fff; color: var(--accent); font-weight: 600; margin-left: 4px; }
  .pulse { width: 10px; height: 10px; border-radius: 50%; background: #fff; animation: pulse 1.2s infinite; }
  @keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(229,36,59,.7); } 70% { box-shadow: 0 0 0 9px rgba(229,36,59,0); } 100% { box-shadow: 0 0 0 0 rgba(229,36,59,0); } }
  #offline { position: absolute; left: 12px; right: 60px; bottom: 12px; background: var(--ink); color: var(--bg); padding: 8px 12px; border-radius: 10px; }
  #tip { position: absolute; pointer-events: none; background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 8px 10px; box-shadow: 0 4px 16px #0003; font-size: 13px; max-width: 280px; z-index: 3; }
  #tip .st { margin-left: 8px; font-size: 12px; }
  #tip small { color: var(--muted); }
  #legend { position: absolute; left: 12px; bottom: 12px; background: color-mix(in srgb, var(--card) 92%, transparent); border: 1px solid var(--line); border-radius: 10px; padding: 8px 10px; font-size: 12px; max-height: calc(100% - 24px); overflow-y: auto; }
  #legend.closed ul, #legend.closed .extra { display: none; }
  #legend button::after { content: " ▾"; } #legend.closed button::after { content: " ▸"; }
  #legend button { border: 0; background: none; color: var(--muted); padding: 0; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; font-size: 11px; }
  #legend ul { list-style: none; margin: 6px 0 4px; padding: 0; columns: 2; column-gap: 14px; }
  #legend li { display: flex; align-items: center; gap: 6px; white-space: nowrap; break-inside: avoid; line-height: 1.7; }
  #legend i { width: 12px; height: 12px; border-radius: 3px; display: inline-block; flex: none; }
  #legend i.round { border-radius: 50%; }
  #legend i.pulse-i { animation: pulse 1.2s infinite; }
  #legend .extra { display: flex; gap: 12px; flex-wrap: wrap; color: var(--muted); }
  #legend .extra span { display: inline-flex; align-items: center; gap: 5px; }
  .sw { width: 14px; height: 12px; border-radius: 3px; display: inline-block; }
  .sw.build { background: linear-gradient(to top, #d9825b 45%, #d9825b44 45%); outline: 1px dashed #d9825b; }
  .sw.ren { background: repeating-linear-gradient(135deg, #d9825b 0 3px, rgba(20,90,200,.7) 3px 5px); }
  .sw.old { background: linear-gradient(225deg, rgba(20,90,200,.8) 30%, #d9825b 30%); }
  .sw.pub { background: #d9825b; outline: 2px solid var(--map-gold); }
  .toast { position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%); background: var(--ink); color: var(--bg); padding: 8px 14px; border-radius: 10px; opacity: 0; transition: opacity .2s; pointer-events: none; z-index: 5; }
  .toast.show { opacity: .94; }
  @media (max-width: 760px) {
    .wrap { flex-direction: column; }
    .stage { flex: none; height: 62vh; }
    aside { width: auto; border-left: 0; border-top: 1px solid var(--line); flex: 1; }
    #legend ul { columns: 1; }
    #banner { left: 10px; right: 58px; transform: none; max-width: none; }
  }
</style>
</head>
<body>
<header>
  <h1>Promptenhorn <span>⛰</span> карта</h1>
  <div id="status">Загрузка…</div>
  <a href="/">Настройки</a>
</header>
<div class="wrap">
  <div class="stage">
    <canvas id="map" aria-label="Карта города"></canvas>
    <div id="banner" hidden></div>
    <div class="ctl">
      <button id="zin" title="Приблизить (+)">+</button>
      <button id="zout" title="Отдалить (−)">−</button>
      <button id="fit" title="Весь город (0)">⤢</button>
    </div>
    <div id="legend">
      <button id="legend-toggle">Легенда</button>
      <ul id="legend-types"></ul>
      <div class="extra">
        <span><i class="sw build"></i>строится (заливка = %)</span>
        <span><i class="sw ren"></i>ремонт</span>
        <span><i class="sw old"></i>ждёт ремонта</span>
        <span><i class="sw pub"></i>для квартала</span>
      </div>
      <ul id="legend-states"></ul>
    </div>
    <div id="tip" hidden></div>
    <div id="offline" hidden></div>
  </div>
  <aside>
    <h2>Строители <span id="count"></span></h2>
    <div id="player"></div>
    <ul id="builders"></ul>
  </aside>
</div>
<div class="toast" id="toast"></div>
<script>(${client.toString()})();</script>
</body>
</html>
`;
