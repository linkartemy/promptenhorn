// Client physics fix for Paper 1.21.11, imported BEFORE mineflayer.
//
// prismarine-physics lets an airborne player "step up" (stepHeight 0.6) when it lands against a block edge
// (the `oldVelY < 0` branch of its step logic). The server does not allow that move, answers with a
// position reset every tick, and the bot freezes in the air (see docs/live-builders-spike.md, risk 1).
// We disable stepping for ticks that start in the air: the bot then simply lands and walks/jumps on.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pp = require('prismarine-physics');

if (!pp.__wildPatched && !process.env.WILD_NO_PHYSICS_PATCH) {
  const Original = pp.Physics;
  pp.Physics = function PatchedPhysics(mcData, world) {
    const physics = Original(mcData, world);
    // Keep a hair of distance from walls: when the client settles exactly flush against a block,
    // Paper 1.21.11 treats it as a new collision, rejects the move and teleports the bot back, forever.
    physics.playerHalfWidth = 0.3 + (Number(process.env.WILD_BB_PAD) || 0.002);
    const simulate = physics.simulatePlayer;
    physics.simulatePlayer = function (state, w) {
      if (state.onGround) return simulate.call(this, state, w);
      const step = physics.stepHeight;
      physics.stepHeight = 0;
      try {
        return simulate.call(this, state, w);
      } finally {
        physics.stepHeight = step;
      }
    };
    return physics;
  };
  pp.__wildPatched = true;
}
