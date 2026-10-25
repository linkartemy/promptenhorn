// Own melee combat for colonists (replaces mineflayer-pvp, which drags in mineflayer 2.41).
// Target selection by danger, approach with pathfinder, then manual footwork in range: keep distance,
// strafe, jump-crit, respect the weapon cooldown, raise the shield between swings, back off creepers,
// retreat when low on health.
import { createRequire } from 'node:module';
import { HOSTILE, RANGED, bestTool, find, tierOf } from './items.mjs';
import { Interrupted } from './net.mjs';

const require = createRequire(import.meta.url);
const { goals } = require('mineflayer-pathfinder');

const COOLDOWN = { sword: 13, axe: 25, pickaxe: 17, shovel: 20, hoe: 10, hand: 5 };
const RANGE = 3.0; // survival attack reach (server allows a bit more; stay safe)

export const isHostile = (e) => !!e && e.isValid !== false && (HOSTILE.has(e.name) || (e.type === 'hostile' && e.name !== 'enderman' && e.name !== 'zombified_piglin' && e.name !== 'piglin'));

export class Combat {
  constructor(colonist) {
    this.c = colonist;
    this.bot = colonist.bot;
    this.ignored = new Map(); // entity id -> until (targets we could not reach)
    this.kills = 0;
  }

  isHostile(e) {
    return isHostile(e);
  }

  /** The most dangerous hostile worth fighting, or null. */
  threat(radius = 12) {
    const bot = this.bot;
    const me = bot.entity.position;
    let best = null;
    let bestScore = Infinity;
    const now = Date.now();
    for (const e of Object.values(bot.entities)) {
      if (e === bot.entity || !isHostile(e)) continue;
      if ((this.ignored.get(e.id) ?? 0) > now) continue;
      const d = e.position.distanceTo(me);
      const r = RANGED.has(e.name) ? radius + 4 : e.name === 'creeper' ? radius : e.name === 'phantom' ? 6 : radius;
      if (d > r || Math.abs(e.position.y - me.y) > 6) continue;
      // spiders are neutral by day; a creeper right next to us is the top priority
      let score = d;
      if (e.name === 'creeper') score -= d < 5 ? 6 : 2;
      if (RANGED.has(e.name)) score -= 1.5;
      if (e.name === 'spider' && this.c.isDay() && d > 4) continue;
      if (score < bestScore) {
        best = e;
        bestScore = score;
      }
    }
    return best;
  }

  weapon() {
    const bot = this.bot;
    return bestTool(bot, 'sword') ?? bestTool(bot, 'axe') ?? bestTool(bot, 'pickaxe') ?? null;
  }

  cooldownTicks(item) {
    if (!item) return COOLDOWN.hand;
    const kind = Object.keys(COOLDOWN).find((k) => item.name.endsWith('_' + k));
    let t = COOLDOWN[kind] ?? 10;
    if (kind === 'axe' && tierOf(item.name) >= 2) t = 22;
    return t;
  }

  async equipWeapon() {
    const w = this.weapon();
    if (w && this.bot.heldItem?.name !== w.name) await this.bot.equip(w, 'hand').catch(() => {});
    const shield = find(this.bot, 'shield');
    if (shield && this.bot.inventory.slots[45]?.name !== 'shield') await this.bot.equip(shield, 'off-hand').catch(() => {});
    return w;
  }

  hasShield() {
    return this.bot.inventory.slots[45]?.name === 'shield';
  }

  /**
   * Fights `target` until it is dead, gone, unreachable, or we must retreat.
   * Returns 'killed' | 'gone' | 'retreat' | 'unreachable' | 'timeout'.
   */
  async fight(target, { retreatHp = 7, maxMs = 45000 } = {}) {
    const bot = this.bot;
    const weapon = await this.equipWeapon();
    const cd = this.cooldownTicks(weapon);
    let sinceAttack = cd;
    let strafe = Math.random() < 0.5 ? 'left' : 'right';
    let strafeTicks = 0;
    let backoff = 0;
    let jumping = 0;
    let following = false;
    let shieldUp = false;
    const t0 = Date.now();
    let lastCloser = Date.now();
    let bestDist = Infinity;
    const stopAll = () => {
      bot.pathfinder.setGoal(null);
      bot.clearControlStates();
      if (shieldUp) bot.deactivateItem();
      shieldUp = false;
    };
    const targetHealthLow = () => (target.metadata?.[9] ?? 20) <= 4;
    try {
      for (;;) {
        if (!bot.entity || this.c.dead) throw new Interrupted('dead');
        if (!bot.entities[target.id] || target.isValid === false) return 'killed';
        const me = bot.entity.position;
        const d = target.position.distanceTo(me);
        if (d > 24) return 'gone';
        if (Date.now() - t0 > maxMs) return 'timeout';
        if (bot.health <= retreatHp && !targetHealthLow()) return 'retreat';
        if (d < bestDist - 0.5) {
          bestDist = d;
          lastCloser = Date.now();
        } else if (d > RANGE + 0.5 && Date.now() - lastCloser > 9000) {
          this.ignored.set(target.id, Date.now() + 30000);
          return 'unreachable';
        }
        const aim = target.position.offset(0, (target.height ?? 1.8) * 0.75, 0);
        await bot.lookAt(aim, true);
        sinceAttack++;
        if (d > RANGE + 0.3 || Math.abs(target.position.y - me.y) > 1.6) {
          // approach
          if (shieldUp) {
            bot.deactivateItem();
            shieldUp = false;
          }
          if (!following) {
            bot.clearControlStates();
            bot.pathfinder.setGoal(new goals.GoalFollow(target, 1.5), true);
            following = true;
          }
        } else {
          if (following) {
            bot.pathfinder.setGoal(null);
            following = false;
          }
          // footwork
          const creeper = target.name === 'creeper';
          const keep = creeper ? 2.6 : 1.8;
          if (backoff > 0) {
            backoff--;
            bot.setControlState('forward', false);
            bot.setControlState('back', true);
          } else {
            bot.setControlState('back', d < keep);
            bot.setControlState('forward', d > 2.5);
          }
          if (++strafeTicks > 14 + Math.floor(Math.random() * 10)) {
            strafeTicks = 0;
            strafe = strafe === 'left' ? 'right' : 'left';
          }
          bot.setControlState('left', strafe === 'left');
          bot.setControlState('right', strafe === 'right');
          // swing when the weapon is charged; try a falling (critical) hit now and then
          const ready = sinceAttack >= cd;
          if (ready && jumping === 0 && bot.entity.onGround && !creeper && Math.random() < 0.3 && d < RANGE - 0.4) {
            bot.setControlState('jump', true);
            jumping = 1;
          } else if (jumping > 0) {
            jumping++;
            bot.setControlState('jump', false);
          }
          const falling = jumping > 0 && bot.entity.velocity.y < -0.05;
          if (ready && d <= RANGE && (jumping === 0 || falling || jumping > 8)) {
            if (shieldUp) {
              bot.deactivateItem();
              shieldUp = false;
            }
            bot.attack(target);
            sinceAttack = 0;
            jumping = 0;
            if (creeper) backoff = 10;
          } else if (!ready && this.hasShield() && (creeper || RANGED.has(target.name)) && sinceAttack > 2 && cd - sinceAttack > 6) {
            if (!shieldUp) {
              bot.activateItem(true);
              shieldUp = true;
            }
          } else if (shieldUp && cd - sinceAttack <= 4) {
            bot.deactivateItem();
            shieldUp = false;
          }
        }
        await bot.waitForTicks(1);
      }
    } finally {
      stopAll();
    }
  }
}
