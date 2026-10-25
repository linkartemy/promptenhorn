// Idea 1 — "the builder is calling you": while a chat waits for a permission or an answer, its builder
// stops working, a red "!" floats over its head, it bobs (crouch/stand), one bell rings and a red bossbar
// names the chat. Idle prompts ("Claude is waiting for your next message") get a quieter yellow bar.
const WAIT_MAX_MS = 30 * 60000; // a prompt nobody answered for this long is probably stale
const BOB_MS = 120000; // stop bobbing after two minutes (the bar stays)

const short = (s) => s.id.slice(0, 8).toLowerCase().replace(/[^a-z0-9_.-]/g, '_');
const markTag = (s) => `alps_mark_${short(s)}`;
const barId = (s, kind) => `alps:${kind}_${short(s)}`;

function urgent(ctx, s) {
  const w = ctx.rt(s).waiting;
  if (w && Date.now() - w.since > WAIT_MAX_MS) ctx.rt(s).waiting = null;
  const cur = ctx.rt(s).waiting;
  return cur && (cur.kind === 'permission' || cur.kind === 'question') ? cur : null;
}

async function removeBars(ctx, prefix) {
  const out = await ctx.cmd('bossbar list');
  for (const id of out.match(/alps:[a-z0-9_.-]+/g) ?? []) if (id.startsWith(`alps:${prefix}`)) await ctx.cmd(`bossbar remove ${id}`);
}

async function hide(ctx, s) {
  const r = ctx.rt(s);
  if (!r.callout) return;
  r.callout = null;
  await ctx.cmd(`kill @e[type=minecraft:text_display,tag=${markTag(s)}]`);
  await ctx.cmd(`bossbar remove ${barId(s, 'wait')}`);
  await ctx.cmd(`data merge entity ${ctx.builderSel(s)} {pose:"standing"}`);
  // s.pose stays as the build loop set it: it re-applies a different pose itself when needed.
}

async function show(ctx, s, w, site) {
  const r = ctx.rt(s);
  const sel = ctx.builderSel(s);
  const text = w.kind === 'question' ? `Задаёт вопрос: ${s.name}` : `Ждёт разрешения: ${s.name}`;
  r.callout = { kind: w.kind, at: Date.now(), next: 0, crouch: false, bar: 0 };
  // The "!" rides the builder, so it follows it without any further commands.
  await ctx.cmd(`execute at ${sel} run summon minecraft:text_display ~ ~2 ~ {Tags:["alps","alps_mark","${markTag(s)}"],billboard:"center",text:{text:"!",color:"red",bold:true},transformation:{left_rotation:[0f,0f,0f,1f],right_rotation:[0f,0f,0f,1f],translation:[0f,0.9f,0f],scale:[2.5f,2.5f,2.5f]}}`);
  await ctx.cmd(`ride @e[type=minecraft:text_display,tag=${markTag(s)},limit=1] mount ${sel}`);
  await ctx.cmd(`bossbar add ${barId(s, 'wait')} ${ctx.textJson(text)}`);
  await ctx.cmd(`bossbar set ${barId(s, 'wait')} name ${ctx.textJson(text)}`);
  await ctx.cmd(`bossbar set ${barId(s, 'wait')} color red`);
  await ctx.cmd(`bossbar set ${barId(s, 'wait')} max 1`);
  await ctx.cmd(`bossbar set ${barId(s, 'wait')} value 1`);
  await ctx.cmd(`bossbar set ${barId(s, 'wait')} players @a`);
  if (Date.now() - (r.bellAt ?? 0) > 60000) {
    r.bellAt = Date.now(); // one bell per episode, never a carillon
    await ctx.cmd(`execute at ${sel} run playsound minecraft:block.bell.use player @a ~ ~ ~ 2 1`);
    const [x, y, z] = site?.front ?? [0, 0, 0];
    await ctx.tellraw('@a', [
      { text: '⌛ ', color: 'red' }, { text: s.name, color: 'yellow' },
      { text: w.kind === 'question' ? ' задаёт тебе вопрос' : ' ждёт твоего разрешения' },
      ...(site ? [{ text: '  [телепорт]', color: 'aqua', click_event: { action: 'run_command', command: `/tp @s ${x + 0.5} ${y} ${z + 2.5}` } }] : []),
    ]);
  }
}

const callout = {
  id: 'callout',
  group: 'Работа Claude',
  label: 'Строитель зовёт тебя',
  description: 'Когда чат ждёт разрешения или ответа: красный «!» над головой, один удар колокола, красная полоса сверху. Стройка на паузе.',
  presets: ['basic'],
  async setup(ctx) {
    await ctx.cmd('kill @e[type=minecraft:text_display,tag=alps_mark]');
    await removeBars(ctx, 'wait_');
    for (const s of ctx.sessions()) ctx.rt(s).callout = null;
  },
  canBuild(ctx, s) {
    return !urgent(ctx, s);
  },
  async onWork(ctx, s, site) {
    const r = ctx.rt(s);
    const w = urgent(ctx, s);
    if (!w) return hide(ctx, s);
    if (!r.callout || r.callout.kind !== w.kind) {
      if (r.callout) await hide(ctx, s);
      return show(ctx, s, w, site);
    }
    const now = Date.now();
    if (now - r.callout.at < BOB_MS && now > r.callout.next) {
      r.callout.next = now + 1000;
      r.callout.crouch = !r.callout.crouch;
      ctx.fx.push(`data merge entity ${ctx.builderSel(s)} {pose:"${r.callout.crouch ? 'crouching' : 'standing'}"}`, { key: `pose:${s.id}` });
    }
    if (now > r.callout.bar) {
      r.callout.bar = now + 10000; // players who joined meanwhile see the bar too
      ctx.fx.push(`bossbar set ${barId(s, 'wait')} players @a`, { key: `bar:${s.id}` });
    }
  },
  async onRetire(ctx, s) {
    await hide(ctx, s);
  },
  async onFinish(ctx, s) {
    await hide(ctx, s); // the builder is about to move: the mark would fall off
  },
  async onBuilderLeave(ctx, s) {
    await hide(ctx, s);
  },
  async onDisable(ctx) {
    for (const s of ctx.sessions()) await hide(ctx, s);
    await ctx.cmd('kill @e[type=minecraft:text_display,tag=alps_mark]');
    await removeBars(ctx, 'wait_');
  },
};

// One combined yellow bar for every chat that waits for its next task (ten idle chats must not stack
// ten bars on the screen): "Ждёт следующей задачи: A" / "Ждут задачу: A, B и ещё 3".
const IDLE_BAR = 'alps:idle_all';
let idleShown = null; // text currently on the bar (null = no bar)
let idleNext = 0;
let idlePlayersAt = 0;

function idleText(ctx) {
  const names = [];
  for (const s of ctx.sessions()) {
    const r = ctx.rt(s);
    if (r.waiting && Date.now() - r.waiting.since > WAIT_MAX_MS) r.waiting = null;
    if (r.waiting?.kind === 'idle' && !s.active) names.push(ctx.cleanText(s.name, 22));
  }
  if (!names.length) return null;
  if (names.length === 1) return `Ждёт следующей задачи: ${names[0]}`;
  const shown = names.slice(0, 2).join(', ');
  return `Ждут задачу: ${shown}${names.length > 2 ? ` и ещё ${names.length - 2}` : ''}`;
}

const idleCallout = {
  id: 'idleCallout',
  group: 'Работа Claude',
  label: 'Жёлтая полоса «ждёт задачу»',
  description: 'Чаты, которые закончили и ждут твоего следующего сообщения: одна тихая жёлтая полоса на всех, без звука. Пропадает со следующим сообщением.',
  presets: [],
  async setup(ctx) {
    await removeBars(ctx, 'idle_'); // also the per-chat bars of older versions
    idleShown = null;
    idleNext = 0;
  },
  onTick(ctx, now) {
    if (now < idleNext) return;
    idleNext = now + 1000;
    const text = idleText(ctx);
    if (text === idleShown) {
      if (text && now - idlePlayersAt > 10000) {
        idlePlayersAt = now; // players who joined meanwhile see the bar too
        ctx.fx.push(`bossbar set ${IDLE_BAR} players @a`, { key: 'idlebar:players' });
      }
      return;
    }
    const had = idleShown;
    idleShown = text;
    idlePlayersAt = now;
    if (!text) return ctx.fx.push(`bossbar remove ${IDLE_BAR}`, { key: 'idlebar' });
    const json = ctx.textJson(text);
    ctx.fx.push(had ? [`bossbar set ${IDLE_BAR} name ${json}`] : [`bossbar add ${IDLE_BAR} ${json}`, `bossbar set ${IDLE_BAR} name ${json}`, `bossbar set ${IDLE_BAR} color yellow`, `bossbar set ${IDLE_BAR} style notched_6`, `bossbar set ${IDLE_BAR} players @a`], { key: 'idlebar' });
  },
  async onDisable(ctx) {
    idleShown = null;
    await removeBars(ctx, 'idle_');
  },
};

export default [callout, idleCallout];
