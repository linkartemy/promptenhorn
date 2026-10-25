// Client physics fix for Paper 1.21.11 (docs/live-builders-spike.md, "Риски" 1: bots freezing in 1-block
// dips while the server resets their position every tick).
//
// Root cause, measured with physics-probe.mjs: prismarine-physics stops the bot's hit box *exactly* at a
// wall (half width 0.3, a double). The server's player box is built from the float 0.6F, so its half
// width is 0.30000001192…: at the client's claimed position the server box pokes ~1e-8 into the wall,
// Paper's move check calls that "clipped into a block" (PlayerFailMoveEvent CLIPPED_INTO_BLOCK) and
// teleports the player back — every tick, as long as the bot keeps walking into that wall (typically
// the far side of a dip it is falling into). Making the client box a hair wider than the server's
// keeps a tiny gap, so the server never sees an overlap.
//
// On the dip course (physics-test.mjs, 10 dips, 40 blocks): 0 resets and 8.7 s per run with the fix,
// against 2–549 resets and 9.5–40 s (timeouts) without. The walk-retry in worker.mjs stays as a guard.

export const HALF_WIDTH = 0.3001;

/** Applies the fix to a freshly created bot (call before it starts walking). */
export function fixPhysics(bot) {
  if (bot?.physics && typeof bot.physics.playerHalfWidth === 'number') {
    bot.physics.playerHalfWidth = HALF_WIDTH;
    return 'half-width';
  }
  return 'unavailable';
}
