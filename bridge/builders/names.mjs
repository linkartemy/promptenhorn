// Player names for live builders (realistic mode). A bot is a real player on the server, so its name is
// an ASCII Minecraft username (<= 16 chars): a Swiss building trade plus the chat's skin, "Maurer_Noor".
// The chat's own name is shown next to it by a team prefix (see bots/worker.mjs).
//
// Offline-mode players without a skin get one of the nine default skins, picked by their UUID, which in
// offline mode is derived from the name. So we pick the trade (and, if needed, a digit) whose UUID gives
// the chat's skin: the bot looks like the mannequin it replaces.
import crypto from 'node:crypto';

export const TRADES = ['Maurer', 'Zimmerer', 'Schreiner', 'Steinmetz', 'Glaser', 'Polier', 'Bauer', 'Schmied', 'Senn', 'Decker'];
const SKIN_ORDER = ['alex', 'ari', 'efe', 'kai', 'makena', 'noor', 'steve', 'sunny', 'zuri']; // net.minecraft.client.resources.DefaultPlayerSkin
const BOT_NAME = new RegExp(`^(?:${TRADES.join('|')})_[A-Z][a-z]+\\d?$`);

/** True for names this project gives to bots: they are never treated as human players. */
export const isBotName = (name) => BOT_NAME.test(String(name));

/** UUID the server assigns to an offline-mode player (UUID.nameUUIDFromBytes("OfflinePlayer:" + name)). */
export function offlineUuid(name) {
  const md5 = crypto.createHash('md5').update(`OfflinePlayer:${name}`, 'utf8').digest();
  md5[6] = (md5[6] & 0x0f) | 0x30;
  md5[8] = (md5[8] & 0x3f) | 0x80;
  return md5;
}

/** Default skin of an offline player: { skin, model } as the vanilla client picks it. */
export function defaultSkin(name) {
  const b = offlineUuid(name);
  const hi = b.readBigInt64BE(0);
  const lo = b.readBigInt64BE(8);
  const hilo = hi ^ lo;
  const hash = Number(BigInt.asIntN(32, hilo >> 32n)) ^ Number(BigInt.asIntN(32, hilo));
  const idx = ((hash % 18) + 18) % 18;
  return { skin: SKIN_ORDER[idx % 9], model: idx < 9 ? 'slim' : 'wide' };
}

export const uuidString = (name) => {
  const h = offlineUuid(name).toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

function hash(text) {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

/**
 * A bot name for a session: deterministic, unused by the other live bots, and — where the trades allow —
 * one whose default skin is the session's skin (wide model, as the mannequins use).
 */
export function botNameFor(session, taken = new Set()) {
  const skin = String(session.skin || 'steve').toLowerCase();
  const nice = skin.charAt(0).toUpperCase() + skin.slice(1);
  const start = hash(session.id) % TRADES.length;
  const candidates = [];
  for (const digit of ['', '2', '3', '4', '5', '6', '7', '8', '9'])
    for (let k = 0; k < TRADES.length; k++) {
      const name = `${TRADES[(start + k) % TRADES.length]}_${nice}${digit}`;
      if (name.length <= 16) candidates.push(name);
    }
  const free = candidates.filter((n) => !taken.has(n));
  return free.find((n) => { const d = defaultSkin(n); return d.skin === skin && d.model === 'wide'; }) ?? free.find((n) => defaultSkin(n).skin === skin) ?? free[0];
}
