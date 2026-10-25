// Decision layer for colonists. Two brains, same skills:
//
//   utility (default): every candidate action scores its urgency 0..100 from the colonist's needs
//     (danger, health, hunger, inventory, tools, night, role work); the highest score runs. Actions are
//     bounded in time, so the choice is re-evaluated every few seconds; the reflex layer interrupts on
//     danger. Roles (miner, lumberjack, farmer, hunter, guard, builder) come from the colony's needs.
//   naive: the first spike's fixed priority list (fight everything, eat only when starving, no retreat,
//     no kit, no tool care) — kept to measure what the utility brain buys.
import * as I from './items.mjs';

const DESPAWN_SAFE_MS = 270000;

/** Upgrade path (first missing entry is the next one). */
export const UPGRADES = [
  { item: 'wooden_pickaxe', kind: 'pickaxe', tier: 0, needs: { planks: 3, stick: 2 } },
  { item: 'stone_pickaxe', kind: 'pickaxe', tier: 1, needs: { stone: 3, stick: 2 } },
  { item: 'stone_sword', kind: 'sword', tier: 1, needs: { stone: 2, stick: 1 } },
  { item: 'stone_axe', kind: 'axe', tier: 1, needs: { stone: 3, stick: 2 } },
  { item: 'furnace', place: 'furnace', needs: { stone: 8 }, when: (c) => !c.colony.furnaceBlock(c.bot) },
  { item: 'iron_pickaxe', kind: 'pickaxe', tier: 2, needs: { iron_ingot: 3, stick: 2 } },
  { item: 'iron_sword', kind: 'sword', tier: 2, needs: { iron_ingot: 2, stick: 1 } },
  { item: 'shield', needs: { iron_ingot: 1, planks: 6 }, when: (c) => !c.hasShield() },
  { item: 'iron_chestplate', wear: 'torso', needs: { iron_ingot: 8 } },
  { item: 'iron_helmet', wear: 'head', needs: { iron_ingot: 5 } },
  { item: 'iron_leggings', wear: 'legs', needs: { iron_ingot: 7 } },
  { item: 'iron_boots', wear: 'feet', needs: { iron_ingot: 4 } },
];
export const TOOL_RECIPE = {
  pickaxe: (tier) => ({ item: `${['wooden', 'stone', 'iron'][tier]}_pickaxe`, needs: [{ planks: 3, stick: 2 }, { stone: 3, stick: 2 }, { iron_ingot: 3, stick: 2 }][tier] }),
  sword: (tier) => ({ item: `${['wooden', 'stone', 'iron'][tier]}_sword`, needs: [{ planks: 2, stick: 1 }, { stone: 2, stick: 1 }, { iron_ingot: 2, stick: 1 }][tier] }),
  axe: (tier) => ({ item: `${['wooden', 'stone', 'iron'][tier]}_axe`, needs: [{ planks: 3, stick: 2 }, { stone: 3, stick: 2 }, { iron_ingot: 3, stick: 2 }][tier] }),
  hoe: (tier) => ({ item: `${['wooden', 'stone', 'iron'][tier]}_hoe`, needs: [{ planks: 2, stick: 2 }, { stone: 2, stick: 2 }, { iron_ingot: 2, stick: 2 }][tier] }),
};

export function nextUpgrade(c) {
  for (const u of UPGRADES) {
    if (u.when) {
      if (u.when(c)) return u;
      continue;
    }
    if (u.kind && I.toolTier(c.bot, u.kind) < u.tier) return u;
    if (u.wear) {
      const cur = I.equipped(c.bot, u.wear);
      const spare = I.itemsOf(c.bot).find((i) => I.ARMOR_SLOTS[I.armorPart(i.name)] === u.wear && I.armorTier(i.name) >= 3);
      if ((!cur || I.armorTier(cur.name) < 3) && !spare) return u;
    }
  }
  return null;
}

/** Hostiles around: { n, creeperNear, nearest }. */
function danger(c) {
  const bot = c.bot;
  const me = bot.entity.position;
  let n = 0;
  let creeper = null;
  for (const e of Object.values(bot.entities)) {
    if (e === bot.entity || !c.combat.isHostile(e)) continue;
    const d = e.position.distanceTo(me);
    if (d > 12 || Math.abs(e.position.y - me.y) > 6) continue;
    n++;
    if (e.name === 'creeper' && d < 5 && (!creeper || d < creeper.position.distanceTo(me))) creeper = e;
  }
  return { n, creeper };
}

const armorTierAvg = (c) => {
  const t = ['head', 'torso', 'legs', 'feet'].map((s) => I.armorTier(I.equipped(c.bot, s)?.name ?? ''));
  return t.reduce((a, b) => a + Math.max(0, b), 0) / 4;
};

/** Candidate actions with their urgency. */
export function candidates(c) {
  const bot = c.bot;
  const col = c.colony;
  const out = [];
  const add = (name, cat, score, run) => score > 0 && out.push({ name, cat, score, run });
  const night = !c.isDay();
  const hp = bot.health;
  const food = bot.food;
  const sat = bot.foodSaturation ?? 0;
  const threat = c.takeThreat();
  const { n: hostiles, creeper } = danger(c);
  const weak = hp < 14 || armorTierAvg(c) < 2.5;
  const hasFood = !!I.bestFood(bot, { allowRaw: true, allowBad: food < 4 });

  // --- survival
  if (bot.entity.isInWater && (bot.oxygenLevel ?? 20) < 18) add('surface', 'survival', 100, () => c.surface());
  if (creeper && !c.hasShield()) add('flee:creeper', 'survival', 95, () => c.flee(creeper, 9));
  if (threat && hp <= 6) add('flee:hurt', 'survival', 92, () => c.retreat(threat));
  const armed = I.toolTier(bot, 'sword') >= 0 || I.toolTier(bot, 'axe') >= 0;
  if (threat && !armed && threat.name !== 'creeper') add('flee:unarmed', 'survival', 84, () => c.retreat(threat));
  if (hostiles >= 3 && weak) add('flee:group', 'survival', 88, () => c.retreat(threat));
  if (hp <= 8 && I.find(bot, /^(golden_apple|enchanted_golden_apple)$/)) add('eat:golden', 'survival', 91, () => c.eat({ golden: true }));
  if (threat) add('combat', 'survival', 80, () => c.fightTask(threat));
  if (hasFood) {
    if (food <= 6) add('eat', 'survival', 85, () => c.eat());
    else if (food <= 14) add('eat', 'survival', 55, () => c.eat());
    else if (hp < 16 && food < 20 && sat < 1 && !threat) add('eat:regen', 'survival', 46, () => c.eat());
  }
  if (c.deathRecord && Date.now() - c.deathRecord.at < DESPAWN_SAFE_MS) {
    const far = c.deathRecord.pos.distanceTo(bot.entity.position) > 120 || col.outsideBorder(c.deathRecord.pos);
    if (far) c.deathRecord = null;
    else add('recover', 'survival', c.deathRecord.unsafe ? 0 : 75, () => c.recover());
  }
  if (c.mode === 'leaving') add('leave', 'social', 72, () => c.doLeave());

  // --- kit and inventory
  const kitGap = c.kitGap();
  // the kit from storage — at most every 2 minutes (what storage cannot give stays missing)
  if (kitGap && Date.now() - (c.kitCheckedAt ?? 0) > 120000 && col.storageCanFill(kitGap)) add('kit', 'work', 70, () => c.fetchKit(kitGap));
  // storage full: no walking back and forth to it (backoff), a new chest is made instead (storageJob)
  const canDeposit = Date.now() > (c.depositBackoff ?? 0);
  if (canDeposit && I.freeSlots(bot) < 4) add('deposit:full', 'work', 68, () => c.visitBase({ reason: 'full' }));
  else if (canDeposit && Date.now() - (c.lastDeposit ?? c.connectedAt ?? 0) > 240000 && c.hasSurplus()) add('deposit', 'work', 36, () => c.visitBase({ reason: 'surplus' }));
  const sj = !c.helper && c.mode !== 'leaving' && col.storageJob(c);
  if (sj) add(`storage:chest`, 'work', 66, () => c.makeStorageChest(sj));

  // --- night: sleep only when needed (insomnia risk, the colony skips a dangerous night, low health);
  // otherwise a safe night shift (below). A failed attempt (monsters near the bed) waits a minute.
  const sleepWhy = night ? col.sleepNeed(c) : null;
  if (sleepWhy && Date.now() - (c.sleepFailAt ?? 0) > 60000 && (col.houseOf(c) || col.campBed(c))) add(`sleep:${sleepWhy}`, 'survival', sleepWhy === 'skip' ? 70 : 65, () => c.doSleep(sleepWhy));
  else if (sleepWhy) add('home:night', 'survival', 60, () => c.doHome(true));
  if (night && !sleepWhy && !threat && Date.now() - (c.nightSmeltAt ?? 0) > 120000 && (I.count(bot, 'raw_iron') >= 3 || col.storageCount('raw_iron') >= 3) && col.furnaceBlock(bot)) add('smelt:iron', 'work', 34, () => c.nightSmelt());

  // --- jobs for the colony
  const pj = col.placeJob(c);
  if (pj) add(`place:${pj.item}`, 'work', 50, () => c.placeAtBase(pj.item, pj.spot));
  if (col.wantsGift(c)) add('share', 'social', 48, () => c.doShare());
  if (!night) {
    const tj = col.tidyJob(c);
    if (tj) add('tidy:bed', 'work', 34, () => c.tidy(tj));
  }
  if (!night && !c.helper && c.mode === 'work' && hp >= 14 && (['miner', 'lumberjack', 'hunter'].includes(c.role) || (c.role === 'builder' && !col.projectReady()))) {
    const lj = col.lootJob(c);
    if (lj) add(`loot:${lj.place}`, 'work', 39, () => c.loot(lj));
  }
  if (I.foodCount(bot) < 4) add('food', 'work', food <= 12 || hp <= 10 ? 62 : food <= 16 ? 44 : 28, () => c.getFood());
  // badly hurt and nothing to eat: rest on the lit plaza until health comes back
  if (hp <= 8 && !hasFood && !threat) add('rest', 'survival', 58, () => c.rest());
  if (!c.helper) {
    const worn = c.wornTool();
    if (worn) add(`repair:${worn.kind}`, 'work', 52, () => c.replaceTool(worn));
    const up = nextUpgrade(c);
    // stone tools are essential; the iron ladder competes with the colony's needs (food, the house)
    if (up) add(`upgrade:${up.item}`, 'work', I.toolTier(bot, 'pickaxe') < 1 || (up.kind && I.toolTier(bot, up.kind) < 1) ? 47 : 36, () => c.doUpgrade(up));
  }
  if (c.mode === 'home') add('home', 'idle', 40, () => c.doHome(night));
  else {
    // night shift: woodcutters go down the mine, hunters guard the plaza; farmers (lit, fenced field),
    // miners and the builder (by the plaza) carry on
    const role = night ? ({ lumberjack: 'miner', hunter: 'guard' }[c.role] ?? c.role ?? 'miner') : c.role ?? 'lumberjack';
    const boost = (c.boost ?? 0) * 3;
    if (role === 'builder' && col.projectReady()) add('build', 'work', 45 + boost, () => col.runBuild(c));
    else if (role === 'farmer') add('farm', 'work', 40 + boost, () => c.farm());
    else if (role === 'hunter') add('hunt', 'work', 40 + boost, () => c.hunt());
    else if (role === 'guard') add('guard', 'idle', 30, () => c.guard(20000));
    else if (role === 'miner' || role === 'builder') add(`mine:${col.mineTarget(c)}`, 'work', 31 + boost, () => c.gather(col.mineTarget(c)));
    else add('gather:wood', 'work', 31 + boost, () => c.gather('wood'));
    if (!night) add('gather:any', 'work', 20, () => c.gather(col.gatherTarget(c)));
    else add('guard', 'idle', 22, () => c.guard(15000));
  }
  return out.sort((a, b) => b.score - a.score);
}

export function chooseUtility(c) {
  const list = candidates(c);
  return list[0] ?? { name: 'idle', cat: 'idle', score: 0, run: () => c.guard(5000) };
}

/** The spike's fixed priority list (for comparison runs: WILD brain "naive"). */
export function chooseNaive(c) {
  const bot = c.bot;
  const col = c.colony;
  const threat = c.takeThreat();
  if (bot.entity.isInWater && (bot.oxygenLevel ?? 20) < 18) return { name: 'surface', cat: 'survival', run: () => c.surface() };
  if (threat) return { name: 'combat', cat: 'survival', run: () => c.fightTask(threat, { naive: true }) };
  if (bot.food < 6 && I.bestFood(bot, { allowRaw: true, allowBad: true })) return { name: 'eat', cat: 'survival', run: () => c.eat() };
  if (c.deathRecord && Date.now() - c.deathRecord.at < DESPAWN_SAFE_MS) return { name: 'recover', cat: 'survival', run: () => c.recover() };
  if (c.mode === 'leaving') return { name: 'leave', cat: 'social', run: () => c.doLeave() };
  if (I.freeSlots(bot) < 4) return { name: 'deposit:full', cat: 'work', run: () => c.visitBase({ reason: 'full' }) };
  if (!c.isDay()) return col.bedFor(c) ? { name: 'sleep', cat: 'survival', run: () => c.doSleep('naive') } : { name: 'home:night', cat: 'survival', run: () => c.doHome(true) };
  if (c.mode === 'home') return { name: 'home', cat: 'idle', run: () => c.doHome(false) };
  const up = !c.helper && nextUpgrade(c);
  if (up) return { name: `upgrade:${up.item}`, cat: 'work', run: () => c.doUpgrade(up) };
  if (col.builder === c && col.projectReady()) return { name: 'build', cat: 'work', run: () => col.runBuild(c) };
  if (I.foodCount(bot) < 2) return { name: 'food', cat: 'work', run: () => c.getFood() };
  const want = col.gatherTarget(c);
  return { name: `gather:${want}`, cat: 'work', run: () => c.gather(want) };
}
