// Top-down and isometric renderers over a loaded World (see anvil.mjs).
import { Raster } from './png.mjs';
import { chunkGet } from './anvil.mjs';

const WATER = [45, 85, 200];
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/**
 * Scan one column top-down. Returns null for an ungenerated chunk, else
 * { color, h (surface height used for shading), top (highest drawn block), depth (water depth), name }.
 */
export function scanColumn(world, x, z, yCap = Infinity) {
  const ch = world.chunkAt(x, z);
  if (!ch) return null;
  const lx = x & 15, lz = z & 15;
  const overlays = [];
  let h = null, top = null, waterTop = null, depth = 0, bottom = null;
  outer: for (let si = ch.secs.length - 1; si >= 0; si--) {
    const sec = ch.secs[si];
    if (sec === 0) continue;
    const yBase = (si + ch.minSy) * 16;
    for (let ly = 15; ly >= 0; ly--) {
      const y = yBase + ly;
      if (y > yCap) continue;
      const id = typeof sec === 'number' ? sec : sec[(ly << 8) | (lz << 4) | lx];
      if (id === 0) continue;
      const inf = world.states[id];
      if (inf.td === 'skip') continue;
      if (top === null) top = y;
      if (inf.td === 'water') {
        if (waterTop === null) { waterTop = y; if (h === null) h = y; }
        depth++;
        continue;
      }
      if (inf.td === 'blend') {
        if (waterTop === null) overlays.push([inf.color, inf.alpha]);
        continue;
      }
      if (inf.td === 'glass') {
        if (waterTop === null) overlays.push([inf.color, inf.alpha]);
        if (h === null) h = y;
        continue;
      }
      if (inf.props.waterlogged === 'true') {
        if (waterTop === null) { waterTop = y; if (h === null) h = y; }
        depth++;
      }
      bottom = inf;
      if (h === null) h = y;
      break outer;
    }
  }
  if (top === null) return null; // empty column: chunk exists but has no blocks yet (proto chunk)
  let col = bottom ? bottom.color.slice() : [20, 20, 30];
  if (depth > 0) {
    col = mix(col, WATER, Math.min(0.9, 0.4 + 0.09 * depth));
    const dk = 1 - Math.min(0.4, depth * 0.025);
    col = col.map((v) => v * dk);
  }
  for (let i = overlays.length - 1; i >= 0; i--) col = mix(col, overlays[i][0], overlays[i][1]);
  return { color: col, h, top, depth, name: bottom ? bottom.name : 'water' };
}

function percentile(values, p) {
  if (!values.length) return 0;
  const s = Float64Array.from(values).sort();
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))];
}

const RAMP = [[0, [40, 60, 160]], [0.2, [40, 150, 180]], [0.45, [80, 175, 70]], [0.7, [225, 205, 60]], [0.88, [205, 90, 50]], [1, [250, 240, 240]]];
function ramp(t) {
  t = clamp(t, 0, 1);
  for (let i = 1; i < RAMP.length; i++) {
    if (t <= RAMP[i][0]) {
      const [t0, c0] = RAMP[i - 1], [t1, c1] = RAMP[i];
      return mix(c0, c1, (t - t0) / (t1 - t0));
    }
  }
  return RAMP[RAMP.length - 1][1];
}

function pickTick(blocks, pxPerBlock, minPx) {
  for (const t of [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000]) if (t * pxPerBlock >= minPx) return t;
  return 1000;
}
const mod = (a, n) => ((a % n) + n) % n;

/** Scan the whole rect: returns per-column arrays. */
export function scanRect(world, rect, yCap) {
  const { x1, z1, x2, z2 } = rect;
  const W = x2 - x1 + 1, D = z2 - z1 + 1;
  const H = new Float64Array(W * D).fill(NaN);
  const TOP = new Float64Array(W * D).fill(NaN);
  const DEPTH = new Uint16Array(W * D);
  const COL = new Float32Array(W * D * 3);
  for (let z = 0; z < D; z++) {
    for (let x = 0; x < W; x++) {
      const c = scanColumn(world, x1 + x, z1 + z, yCap);
      if (!c) continue;
      const i = z * W + x;
      H[i] = c.h; TOP[i] = c.top; DEPTH[i] = c.depth;
      COL[i * 3] = c.color[0]; COL[i * 3 + 1] = c.color[1]; COL[i * 3 + 2] = c.color[2];
    }
  }
  return { W, D, H, TOP, DEPTH, COL };
}

export function renderTopDown(world, rect, opts = {}) {
  const scale = Math.max(1, opts.scale | 0 || 1);
  const { x1, z1, x2, z2 } = rect;
  const { W, D, H, DEPTH, COL } = scanRect(world, rect, opts.ymax ?? Infinity);
  const valid = [];
  for (let i = 0; i < W * D; i++) if (!Number.isNaN(H[i])) valid.push(H[i]);
  let hlo = percentile(valid, 0.02), hhi = Math.max(hlo + 1, percentile(valid, opts.heightMode ? 0.85 : 0.995));
  if (opts.range) [hlo, hhi] = [opts.range[0], Math.max(opts.range[0] + 1, opts.range[1])];

  const fs = opts.fontScale ?? (W * scale >= 300 ? 2 : 1);
  const labels = opts.labels !== false;
  const Lm = labels ? Raster.textWidth('-00000', fs) + 6 : 0;
  const Tm = labels ? 5 * fs + 8 : 0;
  const Bm = labels ? 5 * fs + 8 + (opts.heightMode ? 10 + 5 * fs + 4 : 0) : 0;
  const Rm = labels ? 6 : 0;
  const img = new Raster(Lm + W * scale + Rm, Tm + D * scale + Bm, [24, 24, 28]);

  for (let z = 0; z < D; z++) {
    for (let x = 0; x < W; x++) {
      const i = z * W + x;
      let c;
      const h0 = H[i];
      if (Number.isNaN(h0)) {
        c = ((x >> 2) + (z >> 2)) & 1 ? [48, 48, 52] : [64, 64, 70];
      } else {
        const hn = z > 0 && !Number.isNaN(H[i - W]) ? H[i - W] : h0;
        const hw = x > 0 && !Number.isNaN(H[i - 1]) ? H[i - 1] : h0;
        const d = (h0 - hn) + (h0 - hw); // >0: higher than the NW neighbours -> lit
        let shade = DEPTH[i] > 0 && hn === h0 && hw === h0 ? 1 : 1 + clamp(d * 0.12, -0.45, 0.32);
        const t = (h0 - hlo) / (hhi - hlo);
        if (opts.heightMode) {
          c = ramp(t).map((v) => v * shade);
          if (DEPTH[i] > 0) c = mix(c, WATER, 0.45);
        } else {
          shade *= 0.9 + 0.2 * clamp(t, 0, 1);
          c = [COL[i * 3] * shade, COL[i * 3 + 1] * shade, COL[i * 3 + 2] * shade];
        }
      }
      const r = clamp(Math.round(c[0]), 0, 255), g = clamp(Math.round(c[1]), 0, 255), b = clamp(Math.round(c[2]), 0, 255);
      for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) img.set(Lm + x * scale + dx, Tm + z * scale + dy, r, g, b);
    }
  }

  // plot grid
  if (opts.grid) {
    const n = opts.grid, [gx, gz] = opts.gridOrigin ?? [0, 0];
    const gc = [255, 60, 60];
    for (let x = 0; x < W; x++) {
      if (mod(x1 + x - gx, n) !== 0) continue;
      for (let y = 0; y < D * scale; y++) img.blend(Lm + x * scale, Tm + y, gc, 0.65);
    }
    for (let z = 0; z < D; z++) {
      if (mod(z1 + z - gz, n) !== 0) continue;
      for (let x = 0; x < W * scale; x++) img.blend(Lm + x, Tm + z * scale, gc, 0.65);
    }
  }

  // markers
  for (const [mx, mz] of opts.marks ?? []) {
    if (mx < x1 || mx > x2 || mz < z1 || mz > z2) continue;
    const cx = Lm + (mx - x1) * scale + (scale >> 1), cy = Tm + (mz - z1) * scale + (scale >> 1);
    const r = Math.max(3, scale * 2);
    for (let k = -r; k <= r; k++) {
      img.set(cx + k, cy, 255, 0, 255); img.set(cx, cy + k, 255, 0, 255);
      img.set(cx + k, cy + 1, 0, 0, 0); img.set(cx + 1, cy + k, 0, 0, 0);
    }
  }

  if (labels) {
    const tick = opts.tick ?? pickTick(W, scale, Raster.textWidth('-0000', fs) + 12);
    const fg = [230, 230, 230];
    for (let x = Math.ceil(x1 / tick) * tick; x <= x2; x += tick) {
      const px = Lm + (x - x1) * scale;
      img.fill(px, Tm - 4, 1, 4, fg);
      const s = String(x), tw = Raster.textWidth(s, fs);
      img.text(clamp(px - (tw >> 1), 0, img.w - tw), 1, s, fg, fs);
    }
    for (let z = Math.ceil(z1 / tick) * tick; z <= z2; z += tick) {
      const py = Tm + (z - z1) * scale;
      img.fill(Lm - 4, py, 4, 1, fg);
      const s = String(z), tw = Raster.textWidth(s, fs);
      img.text(Lm - 6 - tw, clamp(py - ((5 * fs) >> 1), 0, img.h), s, fg, fs);
    }
    const foot = `x ${x1}..${x2}  z ${z1}..${z2}  y ${Math.round(hlo)}..${Math.round(hhi)}` + (opts.grid ? `  grid ${opts.grid}` : '');
    img.text(Lm, Tm + D * scale + 4, foot, [200, 200, 200], fs);
    if (opts.heightMode) {
      const by = Tm + D * scale + 4 + 5 * fs + 4, bw = Math.min(W * scale, 300);
      for (let i = 0; i < bw; i++) img.fill(Lm + i, by, 1, 8, ramp(i / (bw - 1)).map(Math.round));
      img.text(Lm, by + 10, String(Math.round(hlo)), fg, fs);
      const s = String(Math.round(hhi));
      img.text(Lm + bw - Raster.textWidth(s, fs), by + 10, s, fg, fs);
    }
  }
  return { img, hlo, hhi, W, D };
}

// ---------------- isometric ----------------

// View rotations: (u, v) are screen axes "right-down" and "left-down"; the viewer sits at +u,+v.
const VIEWS = {
  se: { U: (W) => W, V: (W, D) => D, toXZ: (u, v, W, D) => [u, v] },
  sw: { U: (W, D) => D, V: (W) => W, toXZ: (u, v, W, D) => [W - 1 - v, u] },
  ne: { U: (W, D) => D, V: (W) => W, toXZ: (u, v, W, D) => [v, D - 1 - u] },
  nw: { U: (W) => W, V: (W, D) => D, toXZ: (u, v, W, D) => [W - 1 - u, D - 1 - v] },
};
const SPRITE_BOXES = {
  full: [0, 1, 0, 1, 0, 1], slab: [0, 1, 0, 1, 0, 0.5], topslab: [0, 1, 0, 1, 0.5, 1],
  thin: [0, 1, 0, 1, 0, 0.125], topthin: [0, 1, 0, 1, 0.81, 1], post: [0.375, 0.625, 0.375, 0.625, 0, 1],
  wall: [0.25, 0.75, 0.25, 0.75, 0, 0.8125], small: [0.3, 0.7, 0.3, 0.7, 0, 0.45],
};
const SPRITE_NAMES = Object.keys(SPRITE_BOXES);

function inConvex(px, py, poly) {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i], [bx, by] = poly[(i + 1) % poly.length];
    const cr = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
    if (cr === 0) continue;
    const s = cr > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

/** Rasterise a box sprite: list of [dx, dy, face] with face 0=top, 1=left(+v), 2=right(+u). */
function makeSprite([u0, u1, v0, v1, y0, y1], a, b, c) {
  const P = (u, v, y) => [(u - v) * a, (u + v) * b - y * c];
  const faces = [
    [P(u0, v0, y1), P(u1, v0, y1), P(u1, v1, y1), P(u0, v1, y1)],
    [P(u0, v1, y1), P(u1, v1, y1), P(u1, v1, y0), P(u0, v1, y0)],
    [P(u1, v0, y1), P(u1, v1, y1), P(u1, v1, y0), P(u1, v0, y0)],
  ];
  const all = faces.flat();
  const minX = Math.floor(Math.min(...all.map((p) => p[0]))), maxX = Math.ceil(Math.max(...all.map((p) => p[0])));
  const minY = Math.floor(Math.min(...all.map((p) => p[1]))), maxY = Math.ceil(Math.max(...all.map((p) => p[1])));
  const out = [];
  for (let y = minY; y < maxY; y++) {
    for (let x = minX; x < maxX; x++) {
      for (let f = 0; f < 3; f++) {
        const poly = faces[f];
        // skip degenerate faces (zero area)
        if (inConvex(x + 0.5, y + 0.5, poly) && polyArea(poly) > 0.01) { out.push(x, y, f); break; }
      }
    }
  }
  return Int16Array.from(out);
}
function polyArea(p) {
  let s = 0;
  for (let i = 0; i < p.length; i++) { const [ax, ay] = p[i], [bx, by] = p[(i + 1) % p.length]; s += ax * by - bx * ay; }
  return Math.abs(s) / 2;
}

export function renderIso(world, rect, opts = {}) {
  const { x1, z1, x2, z2 } = rect;
  const W = x2 - x1 + 1, D = z2 - z1 + 1;
  const view = VIEWS[opts.from ?? 'se'];
  if (!view) throw new Error(`--from must be one of ${Object.keys(VIEWS).join(', ')}`);

  // y-range from the surface statistics
  const scan = scanRect(world, rect, Infinity);
  const surf = [], tops = [];
  for (let i = 0; i < W * D; i++) if (!Number.isNaN(scan.H[i])) { surf.push(scan.H[i]); tops.push(scan.TOP[i]); }
  const smin = percentile(surf, 0.01), smax = percentile(surf, 1);
  let ymin = opts.ymin ?? Math.floor(smin) - 5;
  let ymax = opts.ymax ?? Math.min(Math.ceil(smax) + 35, Math.max(...tops, ymin));
  if (ymax < ymin) ymax = ymin;
  const HY = ymax - ymin + 1;

  const U = view.U(W, D), V = view.V(W, D);
  let a = opts.cube ?? 4;
  if (opts.cube == null) while (a > 2 && (U + V) * a > 3000) a--;
  const b = Math.max(1, Math.round(a / 2)), c = a;

  // dense view-ordered volume
  const vol = new Uint16Array(U * V * HY);
  const idx = (u, v, y) => (y * V + v) * U + u;
  for (let v = 0; v < V; v++) {
    for (let u = 0; u < U; u++) {
      const [xi, zi] = view.toXZ(u, v, W, D);
      const wx = x1 + xi, wz = z1 + zi;
      const ch = world.chunkAt(wx, wz);
      if (!ch) continue;
      const lx = wx & 15, lz = wz & 15;
      for (let y = 0; y < HY; y++) vol[idx(u, v, y)] = chunkGet(ch, lx, ymin + y, lz);
    }
  }

  // per-state lookup tables
  const S = world.states;
  const spriteOf = new Int8Array(S.length).fill(-1);
  const occl = new Uint8Array(S.length);
  const col = new Float32Array(S.length * 3);
  S.forEach((s, i) => {
    if (s.iso) spriteOf[i] = SPRITE_NAMES.indexOf(s.iso);
    occl[i] = s.occl ? 1 : 0;
    col[i * 3] = s.color[0]; col[i * 3 + 1] = s.color[1]; col[i * 3 + 2] = s.color[2];
  });
  const sprites = SPRITE_NAMES.map((n) => makeSprite(SPRITE_BOXES[n], a, b, c));
  const FACE = [1.0, 0.8, 0.62];
  const checker = opts.checker !== false;

  const margin = 24;
  const fs = 2;
  const imgW = (U + V) * a + 2 * margin;
  const imgH = (U + V) * b + HY * c + 2 * margin + 5 * fs + 6;
  const offX = V * a + margin, offY = HY * c + margin;
  const bg = opts.background ?? [236, 238, 242];
  const img = new Raster(imgW, imgH, bg);
  const px = img.px;

  let drawn = 0;
  const maxD = (U - 1) + (V - 1) + (HY - 1);
  for (let d = 0; d <= maxD; d++) {
    const yLo = Math.max(0, d - (U - 1) - (V - 1)), yHi = Math.min(HY - 1, d);
    for (let y = yLo; y <= yHi; y++) {
      const s = d - y;
      const uLo = Math.max(0, s - (V - 1)), uHi = Math.min(U - 1, s);
      for (let u = uLo; u <= uHi; u++) {
        const v = s - u;
        const id = vol[(y * V + v) * U + u];
        if (id === 0) continue;
        const sp = spriteOf[id];
        if (sp < 0) continue;
        const topVis = y === HY - 1 || !occl[vol[((y + 1) * V + v) * U + u]];
        const leftVis = v === V - 1 || !occl[vol[(y * V + v + 1) * U + u]];
        const rightVis = u === U - 1 || !occl[vol[(y * V + v) * U + u + 1]];
        if (!topVis && !leftVis && !rightVis) continue;
        drawn++;
        const ox = (u - v) * a + offX, oy = (u + v) * b - y * c + offY;
        const cr = col[id * 3], cg = col[id * 3 + 1], cb = col[id * 3 + 2];
        const chk = checker && ((u + v) & 1) ? 0.94 : 1;
        const spr = sprites[sp];
        for (let k = 0; k < spr.length; k += 3) {
          const f = spr[k + 2];
          if (f === 0 ? !topVis : f === 1 ? !leftVis : !rightVis) continue;
          const X = ox + spr[k], Y = oy + spr[k + 1];
          if (X < 0 || Y < 0 || X >= imgW || Y >= imgH) continue;
          const m = FACE[f] * (f === 0 ? chk : 1);
          const o = (Y * imgW + X) * 3;
          px[o] = cr * m > 255 ? 255 : cr * m;
          px[o + 1] = cg * m > 255 ? 255 : cg * m;
          px[o + 2] = cb * m > 255 ? 255 : cb * m;
        }
      }
    }
  }

  // projected point for a world column at height y (world coords), for labels/markers
  const project = (wx, wz, wy) => {
    const xi = wx - x1, zi = wz - z1;
    // invert toXZ by search over the 4 rotations' closed forms
    let u, v;
    switch (opts.from ?? 'se') {
      case 'se': u = xi; v = zi; break;
      case 'sw': u = zi; v = W - 1 - xi; break;
      case 'ne': u = D - 1 - zi; v = xi; break;
      case 'nw': u = W - 1 - xi; v = D - 1 - zi; break;
    }
    return [Math.round((u - v) * a + offX), Math.round((u + v + 1) * b - (wy - ymin + 1) * c + offY)];
  };
  const fg = [30, 30, 30];
  const corners = [[x1, z1], [x2, z1], [x1, z2], [x2, z2]];
  const far = corners.reduce((best, cc) => (project(cc[0], cc[1], ymin)[1] < project(best[0], best[1], ymin)[1] ? cc : best));
  for (const [cx, cz] of corners) {
    // the far (top) corner is usually hidden behind terrain: label it above the scene instead
    const isFar = cx === far[0] && cz === far[1];
    let [sx, sy] = project(cx, cz, isFar ? ymax + 1 : ymin - 1);
    if (isFar) sy -= 5 * fs + 14;
    const s = `${cx},${cz}`, tw = Raster.textWidth(s, fs);
    img.text(clamp(sx - (tw >> 1), 1, imgW - tw - 1), clamp(sy + 6, 1, imgH - 5 * fs - 1), s, fg, fs);
  }
  for (const [mx, mz] of opts.marks ?? []) {
    if (mx < x1 || mx > x2 || mz < z1 || mz > z2) continue;
    const top = scan.TOP[(mz - z1) * W + (mx - x1)];
    const [sx, sy] = project(mx, mz, (Number.isNaN(top) ? ymin : Math.min(top, ymax)) + 1);
    for (let k = -6; k <= 6; k++) { img.set(sx + k, sy, 255, 0, 255); img.set(sx, sy + k, 255, 0, 255); }
  }
  img.text(4, imgH - 5 * fs - 3, `view ${opts.from ?? 'se'}  x ${x1}..${x2}  z ${z1}..${z2}  y ${ymin}..${ymax}  cube ${a}`, fg, fs);
  return { img, ymin, ymax, cube: a, drawn, U, V };
}
