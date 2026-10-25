// Builder chatter: short in-character chat lines from the builders ("<Name> Tests are green again!"),
// in every builder mode. Lines are templates from the locale catalogs (`chatter.<key>.<n>`, a few
// variants each); no LLM, zero tokens. Strictly rate-limited so the chat stays readable:
//   - one global gap between any two lines (frequency setting: rare / normal / often),
//   - a cooldown per builder and a longer one per builder and line kind,
//   - the same text is never repeated within a while,
//   - quiet hours at night when the world follows the real clock (only urgent lines),
//   - nothing is said while nobody is in the game.
//
// API for every mode (fast mannequins, realistic bots, the wild colony):
//   say(session, key, params?, { priority? })   -> true when the line was said
//   registerSpeaker((session, text, line) => bool)  a backend that can speak for its builder itself (a bot
//                                                     player's own chat) returns true; else the bridge
//                                                     sends `<Name> text` with tellraw
//   new Chatter({ send, now, online, frequency, quiet })  a standalone instance (e.g. the wild server)
import { t, has } from '../i18n.mjs';

export const FREQUENCIES = {
  // banter: minimum time between two lines of small talk (weather, the hour, Swiss jokes) in the whole town
  rare: { gap: 90000, perBuilder: 10 * 60000, perKind: 45 * 60000, banter: Infinity },
  normal: { gap: 40000, perBuilder: 5 * 60000, perKind: 20 * 60000, banter: 15 * 60000 },
  often: { gap: 15000, perBuilder: 2 * 60000, perKind: 8 * 60000, banter: 5 * 60000 },
};
const REPEAT_MS = 15 * 60000; // the same text is not said again within this time

/** Variants of a line: chatter.<key>.1, .2, … (as many as the catalog has). */
function variants(key) {
  const out = [];
  for (let n = 1; n <= 12 && has(`chatter.${key}.${n}`); n++) out.push(`chatter.${key}.${n}`);
  return out;
}

export class Chatter {
  /**
   * @param o.send (speaker, text, line) => void|Promise   how a line reaches the players
   * @param o.now () => Date                               the clock (real time, debug offset)
   * @param o.online () => boolean                         somebody is there to read it
   * @param o.frequency () => 'rare'|'normal'|'often'
   * @param o.quiet () => boolean                          quiet hours: only urgent lines (priority >= 3)
   */
  constructor({ send, now = () => new Date(), online = () => true, frequency = () => 'normal', quiet = () => false }) {
    Object.assign(this, { send, now, online, frequency, quiet });
    this.lastAt = 0;
    this.byBuilder = new Map(); // speaker id -> last line time
    this.byKind = new Map(); // `${id}:${key}` -> last time
    this.texts = new Map(); // text -> last time
    this.seq = 0;
  }

  get f() {
    return FREQUENCIES[this.frequency()] ?? FREQUENCIES.normal;
  }

  /**
   * Says a line for `speaker` ({ id, name }) if the limits allow it. priority: 1 small talk, 2 work news,
   * 3 urgent (it needs you). Higher priorities wait a shorter global gap; 3 also speaks in quiet hours.
   */
  say(speaker, key, params = {}, { priority = 2 } = {}) {
    if (!speaker?.id || !this.online()) return false;
    if (this.quiet() && priority < 3) return false;
    const now = Date.now();
    const f = this.f;
    const gap = priority >= 3 ? f.gap / 4 : priority === 2 ? f.gap : f.gap * 2;
    if (now - this.lastAt < gap) return false;
    if (now - (this.byBuilder.get(speaker.id) ?? 0) < (priority >= 3 ? f.perBuilder / 4 : f.perBuilder)) return false;
    const kindKey = `${speaker.id}:${key}`;
    if (now - (this.byKind.get(kindKey) ?? 0) < (priority >= 3 ? f.perKind / 4 : f.perKind)) return false;
    const keys = variants(key);
    if (!keys.length) return false;
    // A variant not said recently (by anybody).
    const start = (this.seq++ * 7 + speaker.id.length) % keys.length;
    let text = null;
    for (let k = 0; k < keys.length && !text; k++) {
      const candidate = t(keys[(start + k) % keys.length], { ...params, name: speaker.name });
      if (now - (this.texts.get(candidate) ?? 0) > REPEAT_MS) text = candidate;
    }
    if (!text) return false;
    this.lastAt = now;
    this.byBuilder.set(speaker.id, now);
    this.byKind.set(kindKey, now);
    this.texts.set(text, now);
    if (this.texts.size > 300) for (const [k, at] of this.texts) if (now - at > REPEAT_MS) this.texts.delete(k);
    if (this.byKind.size > 2000) this.byKind.clear();
    Promise.resolve(this.send(speaker, text, { key, priority })).catch(() => {});
    return true;
  }
}

// ------------------------------------------------------------------ the bridge's instance

const speakers = []; // backends that speak for their own builders (bot chat)
/** A backend registers (session, text, line) => true when it said the line itself. */
export function registerSpeaker(fn) {
  if (typeof fn === 'function' && !speakers.includes(fn)) speakers.push(fn);
  return () => speakers.splice(speakers.indexOf(fn), 1);
}

let instance = null;
let bound = null; // ctx

/** Says a chat line for a builder (any mode). No-op until the feature is on and set up. */
export function say(session, key, params = {}, opts = {}) {
  if (!instance || !bound?.on('chatter') || !session || session.retired) return false;
  return instance.say(session, key, params, opts);
}

function bind(ctx) {
  bound = ctx;
  instance ??= new Chatter({
    send: async (s, text, line) => {
      for (const fn of speakers) {
        try {
          if (fn(s, text, line)) return;
        } catch {}
      }
      // Formatted like a player's chat message: <Name> text
      await ctx.tellraw('@a', [{ text: '<' }, { text: ctx.cleanText(s.name, 26), color: 'white' }, { text: `> ${text}` }]);
    },
    now: () => ctx.now(),
    online: () => ctx.players().length > 0,
    frequency: () => ctx.config.chatterFrequency,
    quiet: () => {
      const h = ctx.now().getHours();
      return (h >= 22 || h < 7) && ctx.on('realTime');
    },
  });
}

// ------------------------------------------------------------------ what builders talk about

const near = (a, b) => a && b && Math.abs(a[0] - b[0]) <= 1 && Math.abs(a[1] - b[1]) <= 1;
const siteCell = (ctx, s) => ctx.siteOf(s.at)?.plot?.cell ?? null;

const chatter = {
  id: 'chatter',
  group: 'builders',
  label: 'Builders chat',
  description: 'Builders now and then say a short line in the chat, like players: starting a house, waiting for your permission, red or green tests, a commit, a finished house, a coffee break, greeting each other. Rate-limited; quiet at night with real time.',
  presets: [],
  setup(ctx) {
    bind(ctx);
  },
  onEnable(ctx) {
    bind(ctx);
  },
  onEvent(ctx, s, ev, { late } = {}) {
    if (late) return;
    const r = ctx.rt(s);
    const k = ev.kinds ?? [];
    if (ev.kind === 'PermissionRequest' || (ev.kind === 'Notification' && ev.ntype === 'permission_prompt')) say(s, 'wait.permission', {}, { priority: 3 });
    else if (ev.kind === 'Notification' && (ev.ntype === 'elicitation_dialog' || ev.ntype === 'agent_needs_input')) say(s, 'wait.question', {}, { priority: 3 });
    else if (ev.kind === 'PostToolUseFailure' && k.includes('test')) say(s, (s.testFailStreak ?? 0) >= 3 ? 'tests.failAgain' : 'tests.fail');
    else if (ev.kind === 'PostToolUse' && ev.ok && k.includes('test') && (s.testPrevStreak ?? 0) >= 1) say(s, 'tests.green');
    else if (ev.kind === 'PostToolUse' && ev.ok && k.includes('pr')) say(s, 'pr');
    else if (ev.kind === 'PostToolUse' && ev.ok && k.includes('push')) say(s, 'push');
    else if (ev.kind === 'PostToolUse' && ev.ok && k.includes('commit')) say(s, 'commit');
    else if (ev.kind === 'SubagentStart' && r.agents?.size === 1) say(s, 'apprentice', {}, { priority: 1 });
    else if (ev.kind === 'PreCompact') say(s, 'compact', {}, { priority: 1 });
    else if (ev.kind === 'StopFailure' && (ev.error === 'rate_limit' || ev.error === 'overloaded')) say(s, 'limit');
  },
  onWork(ctx, s, site) {
    const r = ctx.rt(s);
    if (r.chatSite === site.key) return;
    r.chatSite = site.key;
    if (!s.active || site.rec.placed > 5) return;
    if (site.kind === 'house') say(s, 'start.house', { what: site.label });
    else if (site.kind === 'public') say(s, 'start.public', { what: site.label });
  },
  onFinish(ctx, s, plot, { firstTime }) {
    if (plot.type === 'park') return;
    const what = ctx.siteOf(`plot:${plot.key}`)?.label ?? '';
    if (plot.public) say(s, 'finish.public', { what });
    else if (firstTime) say(s, 'finish.house', { what });
    else say(s, 'finish.stage', { what, stage: plot.stage });
  },
  onTick(ctx, now) {
    if (now < (chatter.next ?? 0)) return;
    chatter.next = now + 15000;
    const sessions = ctx.sessions().filter((s) => s.at);
    const hour = ctx.now().getHours();
    for (const s of sessions) {
      const r = ctx.rt(s);
      // Helping the renovation crew.
      if (s.pose === 'renovating' && r.chatPose !== 'renovating') say(s, 'renovate', {}, { priority: 1 });
      if (r.feier && r.chatPose !== 'feierabend') say(s, 'feierabend', {}, { priority: 1 });
      r.chatPose = r.feier ? 'feierabend' : s.pose;
    }
    // Two awake builders working next to each other greet once in a while (greetings count as small talk).
    const f = FREQUENCIES[ctx.config.chatterFrequency] ?? FREQUENCIES.normal;
    const awake = sessions.filter((s) => !String(s.pose).includes('sleeping'));
    for (let i = 0; i < awake.length && now - (chatter.banterAt ?? 0) >= f.banter / 2; i++)
      for (let j = i + 1; j < awake.length; j++) {
        const [a, b] = [awake[i], awake[j]];
        if (!near(siteCell(ctx, a), siteCell(ctx, b))) continue;
        const pair = [a.id, b.id].sort().join(':');
        chatter.greeted ??= new Map();
        if (now - (chatter.greeted.get(pair) ?? 0) < 2 * 3600000) continue;
        if (say(a, 'greet', { other: ctx.cleanText(b.name, 24) }, { priority: 1 })) {
          chatter.greeted.set(pair, now);
          chatter.banterAt = now;
        }
      }
    // Weather, the hour, small talk: one awake builder, rarely.
    if (!awake.length || now - (chatter.banterAt ?? 0) < f.banter || Math.random() > 0.3) return;
    const s = awake[Math.floor(Math.random() * awake.length)];
    const key = ctx.weather.base === 'rain' ? 'rain' : hour >= 6 && hour < 9 ? 'morning' : hour >= 18 && hour < 22 ? 'evening' : 'banter';
    if (say(s, key, {}, { priority: 1 })) chatter.banterAt = now;
  },
};

export const CHATTER_PARAMS = [
  { key: 'chatterFrequency', label: 'Builder chat', description: 'How often builders say something in the chat.', options: [['rare', 'Rare'], ['normal', 'Normal'], ['often', 'Often']] },
];

export default chatter;
