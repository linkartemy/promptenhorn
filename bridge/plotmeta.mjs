// Building metadata derived from a finished build list (plot-local, already rotated coordinates):
// bells, chimney campfires, doors, window light slots, clock dials, flag banners, free spots for a
// lectern, a statue or scaffolding. Deriving it here keeps the generators (and their blueprint hashes)
// untouched: adding metadata to buildings.mjs would restart every half-built house.

const idOf = (block) => block.replace(/^minecraft:/, '').replace(/[[{].*$/, '');
const propOf = (block, key) => block.match(new RegExp(`[[,]${key}=([a-z_0-9]+)`))?.[1];
const DIRS = { north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0] };
const TREE = /(_log|_leaves|_wood|azalea|mangrove_roots)$/;

/** @param {{x,y,z,block}[]} list plot-local build list (x, z in 0..20, y relative to the plot ground) */
export function plotMeta(list) {
  const at = new Map();
  list.forEach((b, i) => at.set(`${b.x},${b.y},${b.z}`, i));
  const has = (x, y, z) => at.has(`${x},${y},${z}`);
  const get = (x, y, z) => {
    const i = at.get(`${x},${y},${z}`);
    return i == null ? null : list[i].block;
  };

  // Footprint of the building proper: blocks above the ground floor that are not trees or garden.
  const struct = { x1: 99, z1: 99, x2: -1, z2: -1, ymax: 0 };
  for (const b of list) {
    struct.ymax = Math.max(struct.ymax, b.y);
    if (b.y < 2 || TREE.test(idOf(b.block))) continue;
    struct.x1 = Math.min(struct.x1, b.x);
    struct.x2 = Math.max(struct.x2, b.x);
    struct.z1 = Math.min(struct.z1, b.z);
    struct.z2 = Math.max(struct.z2, b.z);
  }
  if (struct.x2 < 0) Object.assign(struct, { x1: 8, x2: 12, z1: 8, z2: 12 });
  const cx = (struct.x1 + struct.x2) / 2;
  const cz = (struct.z1 + struct.z2) / 2;

  const meta = { struct, bells: [], campfires: [], doors: [], lightSlots: [], clockFaces: [], banners: [] };
  const windows = [];
  list.forEach((b, i) => {
    const id = idOf(b.block);
    if (id === 'bell') meta.bells.push({ x: b.x, y: b.y, z: b.z });
    else if (id === 'campfire') meta.campfires.push({ x: b.x, y: b.y, z: b.z, i, block: b.block });
    else if (id.endsWith('_door') && propOf(b.block, 'half') === 'lower' && b.y <= 2) meta.doors.push({ x: b.x, y: b.y, z: b.z, i });
    else if (id.endsWith('_banner')) meta.banners.push({ x: b.x, y: b.y, z: b.z, i, block: b.block, wall: id.includes('wall') });
    else if ((id === 'glass_pane' || id === 'glass' || id.endsWith('stained_glass_pane')) && b.y >= 1) windows.push({ ...b, i });
    else if (id === 'gold_block') {
      // Clock dial (see clockFace in the generators): a gold centre in a wall, the hand above it gold
      // (big dial, blue face) or black (small dial, white face); the astronomical clock has a yellow sun.
      const up = get(b.x, b.y + 1, b.z) ?? '';
      const face = /gold_block/.test(up) ? 'blue_concrete' : /black_concrete/.test(up) ? 'white_concrete' : null;
      if (!face) return;
      for (const [nx, nz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        if (has(b.x + nx, b.y, b.z + nz)) continue;
        const [ax, az] = nx ? [0, 1] : [1, 0];
        let n = 0;
        for (const [i2, j2] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [-1, 0], [1, 0], [0, -1]]) if ((get(b.x + ax * i2, b.y + j2, b.z + az * i2) ?? '').includes(face)) n++;
        if (n >= 4) meta.clockFaces.push({ x: b.x, y: b.y, z: b.z, normal: [nx, nz], r: face === 'blue_concrete' ? 2 : 1 });
      }
    }
  });

  // Towers are hollow, so a dial is open on both sides: keep the side facing away from the middle of
  // its tower (the centroid of the dials at that height), or of the house for a lone dial.
  const dials = new Map();
  for (const f of meta.clockFaces) dials.set(`${f.x},${f.y},${f.z}`, f);
  meta.clockFaces = [];
  for (const f of dials.values()) {
    const group = [...dials.values()].filter((g) => g.y === f.y && Math.abs(g.x - f.x) <= 6 && Math.abs(g.z - f.z) <= 6);
    let [tx, tz] = [group.reduce((a, g) => a + g.x, 0) / group.length, group.reduce((a, g) => a + g.z, 0) / group.length];
    if (group.length < 2) [tx, tz] = [cx, cz];
    const nx = f.x === tx ? 0 : Math.sign(f.x - tx);
    const nz = nx ? 0 : Math.sign(f.z - tz) || 1;
    const front = !has(f.x + nx, f.y, f.z + nz);
    const plane = nx ? 'x' : 'z';
    if (front && (plane === 'x') === (f.normal[0] !== 0)) meta.clockFaces.push({ ...f, normal: [nx, nz] });
  }

  // Light slots: the air cell just inside a window (towards the middle of the house), at most two per
  // floor-ish level, spread out so the whole house glows rather than one corner.
  const seen = new Set();
  for (const w of windows) {
    const dx = Math.sign(cx - w.x);
    const dz = Math.sign(cz - w.z);
    for (const [ix, iz] of [[dx, 0], [0, dz]]) {
      if (!ix && !iz) continue;
      const sx = w.x + ix;
      const sz = w.z + iz;
      if (has(sx, w.y, sz) || sx < 2 || sx > 18 || sz < 2 || sz > 18) continue;
      if (!has(sx, w.y - 1, sz) && !has(sx, w.y - 2, sz)) continue; // floating in a void, not a room
      const level = Math.floor(w.y / 3);
      const side = `${level}:${Math.sign(sx - cx)}:${Math.sign(sz - cz)}`;
      if (seen.has(side)) continue;
      seen.add(side);
      meta.lightSlots.push({ x: sx, y: w.y, z: sz, i: w.i });
      break;
    }
  }
  meta.lightSlots = meta.lightSlots.slice(0, 8);

  // Door the builder and the chronicle lectern belong to: the lowest door nearest the front.
  // Outside is the open side facing away from the middle of the building.
  for (const d of meta.doors) {
    let best = -Infinity;
    for (const [dir, [ox, oz]] of Object.entries(DIRS)) {
      if (has(d.x + ox, d.y, d.z + oz)) continue;
      const score = ox * (d.x - cx) + oz * (d.z - cz);
      if (score > best) {
        best = score;
        d.out = [ox, oz];
        d.dir = dir;
      }
    }
  }
  meta.doors = meta.doors.filter((d) => d.out);

  const freeCell = (x, z, y = 1) => x >= 2 && x <= 18 && z >= 2 && z <= 18 && !has(x, y, z) && !has(x, y + 1, z);
  meta.freeCell = freeCell;

  // Lectern for the chronicle: beside the main door's path, not on it.
  const door = meta.doors.sort((a, b) => a.y - b.y)[0];
  if (door) {
    const [ox, oz] = door.out;
    const [sx, sz] = [oz, ox]; // sideways
    for (const [a, s] of [[2, 2], [2, -2], [1, 2], [1, -2], [3, 2], [3, -2], [2, 3], [2, -3]]) {
      const x = door.x + ox * a + sx * s;
      const z = door.z + oz * a + sz * s;
      if (freeCell(x, z, door.y)) {
        const facing = Object.entries(DIRS).find(([, v]) => v[0] === -ox && v[1] === -oz)?.[0] ?? 'north';
        meta.lectern = { x, y: door.y, z, facing };
        break;
      }
    }
  }

  // Scaffolding: four columns just outside the building's corners, where nothing else will be built.
  meta.scaffold = [];
  for (const [x, z] of [[struct.x1 - 1, struct.z1 - 1], [struct.x2 + 1, struct.z1 - 1], [struct.x1 - 1, struct.z2 + 1], [struct.x2 + 1, struct.z2 + 1]]) {
    if (x < 2 || x > 18 || z < 2 || z > 18) continue;
    let top = 0;
    for (let y = 1; y <= struct.ymax; y++) {
      if (has(x, y, z)) break;
      top = y;
    }
    if (top >= 3) meta.scaffold.push({ x, z, top: Math.min(top, struct.ymax) });
  }

  // A free paved spot near the middle of a plaza for a statue (lot centre outwards).
  for (let r = 0; r <= 7 && !meta.statue; r++)
    for (let dx = -r; dx <= r && !meta.statue; dx++)
      for (const dz of [-r, r]) {
        const x = 10 + dx;
        const z = 10 + dz;
        if (freeCell(x, z) && !has(x, 3, z) && has(x, 0, z)) {
          meta.statue = { x, z };
          break;
        }
      }
  return meta;
}
