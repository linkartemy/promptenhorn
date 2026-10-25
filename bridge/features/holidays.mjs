// Idea 28 — holidays by the real calendar. 1 August (Swiss National Day): Swiss flags over the main
// square and every district plaza, signal bonfires on the peaks, a firework show at 21:00.
// 24–26 December: it rains in the valley and snows on the mountains. Everything placed is tracked in
// state and removed when the day is over; flags are display entities that a periodic sweep removes
// even if their chunk was unloaded at the end of the holiday.
import { fxTagsSnbt } from '../fx.mjs';

const SWISS = '[{pattern:"minecraft:straight_cross",color:"white"},{pattern:"minecraft:border",color:"red"}]';

function holidayOf(date) {
  const m = date.getMonth();
  const d = date.getDate();
  if (m === 7 && d === 1) return `aug1:${date.getFullYear()}`;
  if (m === 11 && d >= 24 && d <= 26) return `xmas:${date.getFullYear()}`;
  return null;
}

async function start(ctx, id) {
  const h = (ctx.state.holiday = { id, bonfires: [], flags: false });
  if (id.startsWith('aug1')) {
    ctx.needPeaks();
    for (const p of [ctx.square(), ...Object.values(ctx.state.districts).map((d) => ctx.plazaOf(d))].filter(Boolean)) {
      await ctx.holdArea(`holiday:${p.key}`, ctx.plotRect(p.cell), 4000);
      // Over the plot's lamp post, so it never stands in the way.
      ctx.fx.later(1500, `summon minecraft:item_display ${p.x0 + 0.5} ${p.y + 6.2} ${p.z0 + 0.5} {Tags:["alps","alps_holiday"],billboard:"vertical",item:{id:"minecraft:red_banner",count:1,components:{"minecraft:banner_patterns":${SWISS}}},transformation:{left_rotation:[0f,0f,0f,1f],right_rotation:[0f,0f,0f,1f],translation:[0f,0f,0f],scale:[1.6f,1.6f,1.6f]}}`);
    }
    h.flags = true;
    for (const peak of (ctx.state.city.peaks ?? []).slice(0, 4)) {
      await ctx.holdArea(`holiday:peak:${peak.x}`, { x1: peak.x - 2, z1: peak.z - 2, x2: peak.x + 4, z2: peak.z + 2 }, 5000);
      const [x, z] = [peak.x + 3, peak.z];
      ctx.fx.later(2000, async (cmd) => {
        const out = await cmd(`execute positioned ${x} ${peak.y + 10} ${z} positioned over motion_blocking run setblock ~ ~ ~ minecraft:campfire[lit=true,signal_fire=true]`);
        if (out.includes('Changed')) {
          h.bonfires.push([x, z]);
          ctx.save();
        }
      });
    }
  } else {
    ctx.weather.base = 'rain';
    ctx.fx.push('weather rain 1h', { key: 'weather' });
  }
  ctx.save();
  ctx.log(`Holiday ${id} started`);
}

async function stop(ctx) {
  const h = ctx.state.holiday;
  if (!h) return;
  for (const [x, z] of h.bonfires ?? []) {
    await ctx.holdArea(`holiday:fire:${x}`, { x1: x, z1: z, x2: x, z2: z }, 4000);
    ctx.fx.later(1500, `execute positioned ${x} 0 ${z} positioned over motion_blocking positioned ~ ~-1 ~ if block ~ ~ ~ minecraft:campfire run setblock ~ ~ ~ air`);
  }
  if (h.id.startsWith('xmas')) {
    ctx.weather.base = null;
    ctx.fx.push('weather clear', { key: 'weather' });
  }
  ctx.state.holidaySweep = Date.now() + 7 * 86400000; // keep sweeping flags for a week (chunks unloaded now)
  delete ctx.state.holiday;
  ctx.save();
  ctx.log(`Holiday ${h.id} over`);
}

let next = 0;
let fireworksDay = null;
const holidays = {
  id: 'holidays',
  group: 'extras',
  label: '1 August and Christmas',
  description: '1 August: flags on the squares, bonfires on the peaks and fireworks at 21:00; 24–26 December: rain in the valley and snow in the mountains.',
  presets: [],
  always: ['onTick'],
  async onTick(ctx, now) {
    if (now < next) return;
    next = now + 60000;
    if (ctx.state.holidaySweep) {
      if (Date.now() > ctx.state.holidaySweep) delete ctx.state.holidaySweep;
      if (!ctx.state.holiday?.flags) ctx.fx.push('kill @e[type=minecraft:item_display,tag=alps_holiday]', { key: 'holiday:sweep' });
    }
    if (!ctx.on('holidays')) {
      if (ctx.state.holiday) await stop(ctx);
      return;
    }
    const date = ctx.now();
    const id = holidayOf(date);
    if (ctx.state.holiday && ctx.state.holiday.id !== id) await stop(ctx);
    if (id && !ctx.state.holiday) await start(ctx, id);
    if (id?.startsWith('xmas')) {
      ctx.weather.base = 'rain';
      if (date.getMinutes() === 0) ctx.fx.push('weather rain 1h', { key: 'weather' });
    }
    if (id?.startsWith('aug1') && date.getHours() === 21 && fireworksDay !== id) {
      fireworksDay = id;
      const sq = ctx.square();
      if (!sq) return;
      for (let k = 0; k < 24; k++) {
        const [x, z] = [sq.x0 + 10 + Math.round(Math.random() * 16 - 8), sq.z0 + 10 + Math.round(Math.random() * 16 - 8)];
        const colors = k % 2 ? '16711680' : '16777215';
        ctx.fx.later(k * 1600, `summon minecraft:firework_rocket ${x} ${sq.y + 2} ${z} {${fxTagsSnbt()},LifeTime:${30 + (k % 3) * 8},FireworksItem:{id:"minecraft:firework_rocket",count:1,components:{"minecraft:fireworks":{flight_duration:2,explosions:[{shape:"${['large_ball', 'star', 'burst'][k % 3]}",colors:[I;${colors}],fade_colors:[I;16711680],has_trail:true,has_twinkle:true}]}}}}`);
      }
    }
  },
};

export default holidays;
