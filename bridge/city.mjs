// City layout: one grid of plots around a central square. Every project is a district
// (its own plaza plus the houses its chats build); districts grow outward and border each other.
import * as DefaultBuildings from './buildings.mjs';
import { rngFrom } from './blueprint.mjs';
import { PLOT, rect } from './terrain.mjs';

// The generator module the city is laid out with (the bridge may load another copy, see generators.mjs).
let Buildings = DefaultBuildings;
export function useBuildings(mod) {
  Buildings = mod;
}

// Fallback selection table, used until buildings.mjs exports its own CATALOG.
const DEFAULT_CATALOG = {
  townhouse: { label: 'Дом в старом городе', zones: { core: 6, inner: 4, outer: 1 } },
  church: { label: 'Церковь', zones: { core: 1, inner: 1, outer: 0.5, rural: 0.4 }, unique: 'district' },
  hotel: { label: 'Гранд-отель', zones: { core: 0.6, inner: 1.2, outer: 0.6 }, unique: 'district' },
  modern: { label: 'Современный дом', zones: { inner: 2, outer: 4, rural: 0.5 } },
  chalet: { label: 'Шале', zones: { inner: 0.5, outer: 3, rural: 6 } },
};

export const catalog = () => Buildings.CATALOG ?? DEFAULT_CATALOG;
export const labelOf = (type) =>
  type === 'square' ? 'Площадь' : type === 'plaza' ? 'Площадь квартала' : catalog()[type]?.label ?? Buildings.LABELS?.[type] ?? type;

export const ring = ([i, j]) => Math.max(Math.abs(i), Math.abs(j));
export const zoneOf = (cell) => {
  const r = ring(cell);
  return r <= 2 ? 'core' : r <= 4 ? 'inner' : r <= 6 ? 'outer' : 'rural';
};

export const STREETS = {
  core: { main: 'stone_bricks', alts: ['polished_andesite', 'andesite', 'cracked_stone_bricks', 'mossy_stone_bricks'] },
  inner: { main: 'cobblestone', alts: ['stone_bricks', 'andesite', 'mossy_cobblestone'] },
  outer: { main: 'cobblestone', alts: ['gravel', 'andesite', 'coarse_dirt'] },
  rural: { main: 'dirt_path', alts: ['coarse_dirt', 'gravel', 'dirt_path', 'rooted_dirt'] },
};

export const cellKey = ([i, j]) => `${i},${j}`;
export const parseCell = (key) => key.split(',').map(Number);
export const plotRect = (city, [i, j]) => {
  const x0 = city.cx - 10 + i * PLOT;
  const z0 = city.cz - 10 + j * PLOT;
  return rect(x0, z0, x0 + PLOT - 1, z0 + PLOT - 1);
};

const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const N8 = [...N4, [1, 1], [1, -1], [-1, 1], [-1, -1]];

/**
 * Plaza cell for a new district: walk out from the centre along a golden-angle ray (so districts spread
 * evenly around the old town) to the first free cell that is not crowding the centre or another plaza.
 */
export function districtSeed(state, index) {
  const angle = index * 2.39996323 + 0.6;
  const plazas = Object.values(state.districts).map((d) => d.seed).filter(Boolean);
  for (let r = 2; r < 80; r += 0.35) {
    const cell = [Math.round(Math.cos(angle) * r), Math.round(Math.sin(angle) * r)];
    if (ring(cell) < 2 || state.cells[cellKey(cell)]) continue;
    if (N8.some(([a, b]) => state.cells[cellKey([cell[0] + a, cell[1] + b])] && state.plots[state.cells[cellKey([cell[0] + a, cell[1] + b])]]?.type === 'plaza')) continue;
    if (plazas.some((p) => Math.hypot(p[0] - cell[0], p[1] - cell[1]) < 3.5)) continue;
    return cell;
  }
  return [index * 4 + 4, 0];
}

/** Next cell for a district: a free neighbour of its own cells, close to the city centre and to its plaza. */
export function nextCell(state, district) {
  const own = district.cells;
  const dist = (c, d) => Math.hypot(c[0] - d[0], c[1] - d[1]);
  const score = (c) => Math.hypot(c[0], c[1]) * 1.0 + dist(c, district.seed) * 0.8;
  let best = null;
  const consider = (c) => {
    if (state.cells[cellKey(c)]) return;
    const s = score(c);
    if (!best || s < best.s) best = { c, s };
  };
  for (const [i, j] of own.map(parseCell)) for (const [a, b] of N4) consider([i + a, j + b]);
  if (best) return best.c;
  // Enclosed by other districts: take the free city-edge cell nearest to our plaza.
  for (const key of Object.keys(state.cells)) {
    const [i, j] = parseCell(key);
    for (const [a, b] of N4) {
      const c = [i + a, j + b];
      if (state.cells[cellKey(c)]) continue;
      const s = dist(c, district.seed);
      if (!best || s < best.s) best = { c, s };
    }
  }
  return best.c;
}

/** Weighted building choice for a cell, honouring per-district / per-city uniqueness and avoiding repeats. */
export function pickType(state, district, cell, seed) {
  const rng = rngFrom(`${seed}:type`);
  const zone = zoneOf(cell);
  const cat = catalog();
  const cityCounts = {};
  for (const p of Object.values(state.plots)) cityCounts[p.type] = (cityCounts[p.type] ?? 0) + 1;
  const recent = district.recentTypes ?? [];
  const entries = [];
  for (const [type, info] of Object.entries(cat)) {
    if (!Buildings.BUILDINGS?.[type]) continue;
    let w = info.zones?.[zone] ?? 0;
    if (w <= 0) continue;
    if (info.unique === 'district' && district.typeCounts[type]) continue;
    if (info.unique === 'city' && cityCounts[type]) continue;
    if (recent.includes(type)) w *= recent[recent.length - 1] === type ? 0.15 : 0.5;
    entries.push([type, w]);
  }
  if (!entries.length) return Object.keys(Buildings.BUILDINGS)[0];
  return rng.weighted(entries);
}
