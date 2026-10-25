// Builder backend for mode 1 "Fast": the builder is a `mannequin` entity moved by RCON teleports, and the
// blocks are set with RCON `setblock` (~3 blocks/s plus bursts). This is the behaviour the bridge always
// had, moved here unchanged; the realistic mode (bot.mjs) falls back to it for overflow sessions and to
// show a sleeping builder.
//
// Optional "smooth motion" (setting `smoothBuilders`): the mannequin rides an invisible item_display and
// the bridge teleports that vehicle instead, with `teleport_duration`, so the client glides the builder
// between work spots instead of jumping. Same number of teleports; one extra `rotate` per move so the
// builder faces the next block.

const VEHICLE_TICKS = 8; // glide time of one move (the work loop moves the builder about once a second)
const SEAT = 0.6; // a mannequin rides 0.6 below its (zero-height) vehicle: the vehicle goes that much higher

export class MannequinBackend {
  /**
   * @param d { cmd, textJson, builderTag, builderUuid, rt, onSpawn(session, site), handItem(session, b),
   *            itemFor, soundFor, setHand(session, item), smooth() -> bool }
   */
  constructor(d) {
    this.d = d;
    this.id = 'mannequin';
  }

  sel(session) {
    return `@e[tag=${this.d.builderTag(session)},limit=1]`;
  }
  /** Only ever kills mannequins: a bot player carrying the same tag must never be hit. */
  killSel(session) {
    return `@e[type=minecraft:mannequin,tag=${this.d.builderTag(session)}]`;
  }
  vehTag(session) {
    return `alps_bv_${session.id.slice(0, 8)}`;
  }

  async ensure(session, site, { at, pose } = {}) {
    const { cmd, textJson, builderTag, builderUuid } = this.d;
    const tag = builderTag(session);
    if ((await cmd(`execute if entity @e[type=minecraft:mannequin,tag=${tag}]`)).includes('passed')) return; // (a bot leaving may still carry the tag)
    const [wx, wy, wz] = at ?? site.front;
    const out = await cmd(`summon minecraft:mannequin ${wx + 0.5} ${wy} ${wz + 0.5} {UUID:${builderUuid(session, { key: site.key })},Tags:["alps","${tag}"],Invulnerable:1b,PersistenceRequired:1b,immovable:1b,hide_description:1b,CustomNameVisible:1b,CustomName:${textJson(session.name)},profile:{texture:"entity/player/wide/${session.skin}"}${pose ? `,pose:"${pose}"` : ''}}`);
    await cmd(`particle minecraft:poof ${wx + 0.5} ${wy + 1} ${wz + 0.5} 0.3 0.5 0.3 0.02 20`);
    if (out.includes('Summoned')) {
      if (this.d.smooth()) await this.mount(session, site, [wx + 0.5, wy, wz + 0.5]);
      await this.d.onSpawn(session, site);
    }
  }

  async setPose(session, pose) {
    await this.d.cmd(`data merge entity ${this.sel(session)} {pose:"${pose}"}`);
  }

  async setHand(session, item) {
    await this.d.cmd(`item replace entity ${this.sel(session)} weapon.mainhand with ${item}`);
  }

  async toFront(session, site) {
    const [wx, wy, wz] = site.front;
    const [hx, hz] = site.look;
    const yaw = Math.round((Math.atan2(-(hx - wx), hz - wz) * 180) / Math.PI);
    if (this.d.smooth()) await this.glide(session, site, [wx + 0.5, wy, wz + 0.5], { yaw });
    else await this.d.cmd(`tp ${this.sel(session)} ${wx + 0.5} ${wy} ${wz + 0.5} ${yaw} 0`);
    Object.assign(this.d.rt(session), { pos: [wx + 0.5, wy, wz + 0.5], posAt: site.key }); // for the web map
  }

  /** Leaves a site for another one: poof, gone (it re-appears there). */
  async leave(session) {
    const { cmd, builderTag } = this.d;
    const tag = builderTag(session);
    await cmd(`execute at @e[tag=${tag},limit=1] run particle minecraft:poof ~ ~1 ~ 0.3 0.5 0.3 0.02 20`);
    await cmd(`kill ${this.killSel(session)}`);
    if (this.d.rt(session).mounted || this.d.smooth()) await this.unmount(session);
  }

  /** Classic mode, house finished / chat over: the builder goes away. */
  async remove(session) {
    await this.leave(session);
  }

  /**
   * Places up to `n` blocks of the site's list from rec.placed on (exactly the old work() loop).
   * `commit(kind)` books one index: 'skip' (already right / migrated) or 'placed' (credit spent).
   * `quiet`: no teleports, particles, sounds (offline catch-up in instant mode).
   */
  async build(session, site, built, n, commit, { quiet = false } = {}) {
    const { cmd, rt, handItem, itemFor, soundFor, setHand } = this.d;
    const rec = site.rec;
    const { list, skip } = built;
    const smooth = this.d.smooth();
    if (rec.recheck != null) await this.recheck(rec, list, skip);
    let freeSkips = 400; // blocks that are already right cost nothing, but keep one tick bounded
    while (n-- > 0 && rec.placed < list.length) {
      if (skip?.has(rec.placed)) {
        commit('skip'); // already standing from before the generators (or the stage) changed
        n++;
        continue;
      }
      const b = list[rec.placed];
      const out = await cmd(`setblock ${b.x} ${b.y} ${b.z} ${b.block}`);
      if (out.includes('not loaded')) break; // chunk still loading: retry next tick
      if (out.startsWith('Could not set') && freeSkips-- > 0) {
        // Identical block already there (lawn, ground, parts kept from before): no walk, no time spent.
        commit('skip');
        n++;
        continue;
      }
      commit('placed');
      if (quiet) continue; // offline catch-up, instant: just the blocks
      if (rec.placed % 3 === 0) {
        if (smooth) await this.glide(session, site, [b.x + 0.5, b.y + 1, b.z + 0.5], { face: list[rec.placed] ?? b });
        else await cmd(`tp ${this.sel(session)} ${b.x + 0.5} ${b.y + 1} ${b.z + 0.5} ${[0, 90, 180, 270][rec.placed % 4]} 20`);
        Object.assign(rt(session), { pos: [b.x + 0.5, b.y + 1, b.z + 0.5], posAt: site.key }); // for the web map
        await cmd(`particle minecraft:happy_villager ${b.x + 0.5} ${b.y + 0.7} ${b.z + 0.5} 0.3 0.3 0.3 0 2`);
        await cmd(`playsound minecraft:${soundFor(b.block)} block @a ${b.x} ${b.y} ${b.z} 0.5 1`);
      }
      if (rec.placed % 12 === 1) await setHand(session, handItem(session, b) ?? itemFor(b.block));
    }
  }

  /**
   * A bot built [rec.recheck, rec.placed) before this mannequin took over: set it again (setblock is a
   * no-op where the block is right, so this only fixes what a bot left off), 400 per tick, no credit.
   */
  async recheck(rec, list, skip) {
    let budget = 400;
    while (rec.recheck < Math.min(rec.placed, list.length) && budget-- > 0) {
      const i = rec.recheck;
      if (!skip?.has(i)) {
        const b = list[i];
        if ((await this.d.cmd(`setblock ${b.x} ${b.y} ${b.z} ${b.block}`)).includes('not loaded')) return;
      }
      rec.recheck++;
    }
    if (rec.recheck >= Math.min(rec.placed, list.length)) delete rec.recheck;
  }

  // ------------------------------------------------------------------ smooth motion

  /** Seats the mannequin on its invisible vehicle (created where the builder stands). */
  async mount(session, site, [x, y, z]) {
    const { cmd, builderUuid } = this.d;
    const v = this.vehTag(session);
    const r = this.d.rt(session);
    await cmd(`kill @e[type=minecraft:item_display,tag=${v}]`);
    await cmd(`summon minecraft:item_display ${x} ${y + SEAT} ${z} {UUID:${builderUuid(session, { key: site.key }, 'veh:')},Tags:["alps","alps_bv","${v}"],teleport_duration:${VEHICLE_TICKS}}`);
    const out = await cmd(`ride ${this.sel(session)} mount @e[type=minecraft:item_display,tag=${v},limit=1]`);
    r.mounted = /started riding/i.test(out);
    r.mountedAt = site.key;
  }

  async unmount(session) {
    this.d.rt(session).mounted = false;
    await this.d.cmd(`kill @e[type=minecraft:item_display,tag=${this.vehTag(session)}]`);
  }

  /**
   * Moves the vehicle (the client interpolates over VEHICLE_TICKS) and turns the builder to `face` (a
   * block) or to `yaw`. A builder that lost its vehicle (switched on later, teleported by something
   * else, bridge restart) gets a new one first.
   */
  async glide(session, site, [x, y, z], { face, yaw } = {}) {
    const { cmd } = this.d;
    const r = this.d.rt(session);
    const v = `@e[type=minecraft:item_display,tag=${this.vehTag(session)},limit=1]`;
    if (!r.mounted || r.mountedAt !== site.key) {
      const pos = (await cmd(`data get entity ${this.sel(session)} Pos`)).match(/\[(-?[\d.]+)d, (-?[\d.]+)d, (-?[\d.]+)d\]/);
      if (!pos) return;
      await this.mount(session, site, [Number(pos[1]), Number(pos[2]), Number(pos[3])]);
      if (!r.mounted) return cmd(`tp ${this.sel(session)} ${x} ${y} ${z}${yaw != null ? ` ${yaw} 0` : ''}`);
    }
    const out = await cmd(`tp ${v} ${x} ${y + SEAT} ${z}`);
    if (!out.startsWith('Teleported')) {
      r.mounted = false;
      return;
    }
    if (face) await cmd(`rotate ${this.sel(session)} facing ${face.x + 0.5} ${face.y + 0.5} ${face.z + 0.5}`);
    else if (yaw != null) await cmd(`rotate ${this.sel(session)} ${yaw} 0`);
  }

  /** The setting was switched off: every builder steps off its vehicle. */
  async dropVehicles(sessions) {
    for (const s of sessions) {
      if (!this.d.rt(s).mounted) continue;
      await this.d.cmd(`ride ${this.sel(s)} dismount`);
      await this.unmount(s);
    }
    await this.d.cmd('kill @e[type=minecraft:item_display,tag=alps_bv]');
  }
}
