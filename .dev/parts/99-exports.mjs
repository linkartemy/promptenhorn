
// ================================================================ registry

const RAW = {
  chalet, townhouse, cafe, church, clocktower, hotel, modern, apartment, farmhouse, hut,
  // waterfront (zone 'shore')
  lighthouse, boathouse, schiffstation, lido,
  // public works (built for a district by the economy)
  school, markethall, station, funicular_bottom, funicular_top, viewpoint, firestation, postoffice,
};

/**
 * Growth stages per type (docs/generator-contract.md §3): 1 small house, 2 full house, 3 extension.
 * Types not listed have one stage (the full building) whatever stage is asked for.
 */
export const STAGES = { chalet: 3, townhouse: 3, cafe: 3, hotel: 3, modern: 3, apartment: 3, farmhouse: 3, hut: 3 };

/**
 * type -> (rng, options) => Blueprint at options.stage (default: the last stage), with the shared semantic
 * markers (doors, seats, beds, ...) added. Generators always draw every stage, so rng use is the same for all.
 */
export const BUILDINGS = Object.fromEntries(Object.entries(RAW).map(([type, gen]) => [type, (rng, options = {}) => {
  const max = STAGES[type] ?? 1;
  const stage = Math.max(1, Math.min(max, Math.round(Number(options?.stage) || max)));
  const bp = gen(rng, options ?? {});
  return autoMarks(max > 1 ? bp.atStage(stage) : bp, type);
}]));

/**
 * Building catalogue for the bridge. label: English name (for the UI use t(labelKey), locales/*.json "building.<type>").
 * zones: relative weights per ring around the city centre (core = old town, inner, outer, rural = villages and farms);
 * a type with no weight in any of these is never picked as a chat's home. unique: at most one per district / city.
 * kind: 'home' (a chat's house, grows in STAGES), 'public' (built for a district by the economy), 'shore' (needs a lot
 * with water on its local north, see docs/generator-contract.md §7). site: where such a building belongs (hint for the
 * terrain planner); variants: terrain modes the generator builds itself (VARIANTS). Terrain weights for homes stay in
 * bridge/city.mjs (TERRAIN_WEIGHTS) unless a type sets terrain: { slope, stilts, waterfront }.
 */
const C = (type, label, o) => ({ label, labelKey: `building.${type}`, ...o, ...(VARIANTS[type] ? { variants: VARIANTS[type] } : {}) });
export const CATALOG = {
  chalet: C('chalet', 'Chalet', { kind: 'home', zones: { inner: 2, outer: 5, rural: 4 } }),
  townhouse: C('townhouse', 'Old-town house', { kind: 'home', zones: { core: 8, inner: 5, outer: 1 } }),
  cafe: C('cafe', 'Konditorei', { kind: 'home', zones: { core: 3, inner: 2, outer: 0.5 } }),
  church: C('church', 'Church', { kind: 'public', zones: { core: 1, inner: 1.5, outer: 1, rural: 0.6 }, unique: 'district' }),
  clocktower: C('clocktower', 'Clock tower', { kind: 'public', zones: { core: 2.5 }, unique: 'city' }),
  hotel: C('hotel', 'Grand Hotel', { kind: 'home', zones: { core: 1, inner: 2, outer: 1 }, unique: 'district' }),
  modern: C('modern', 'Modern house', { kind: 'home', zones: { inner: 2, outer: 4, rural: 1 } }),
  apartment: C('apartment', 'Co-op housing', { kind: 'home', zones: { inner: 3, outer: 3 } }),
  farmhouse: C('farmhouse', 'Emmental farm', { kind: 'home', zones: { outer: 0.8, rural: 5 } }),
  hut: C('hut', 'Alpine hut', { kind: 'home', zones: { rural: 2 } }),
  // Waterfront: only on shore lots (the terrain planner picks them by zone 'shore').
  lighthouse: C('lighthouse', 'Lighthouse', { kind: 'shore', zones: { shore: 1 }, unique: 'city', site: 'mole head' }),
  boathouse: C('boathouse', 'Boathouse', { kind: 'shore', zones: { shore: 4 }, site: 'shoreline' }),
  schiffstation: C('schiffstation', 'Steamer landing', { kind: 'shore', zones: { shore: 1.5 }, unique: 'district', site: 'harbour' }),
  lido: C('lido', 'Lido', { kind: 'shore', zones: { shore: 1.5 }, unique: 'district', site: 'beach' }),
  // Public works: built for a district by the economy, never a chat's home.
  school: C('school', 'School', { kind: 'public', zones: {}, unique: 'district' }),
  markethall: C('markethall', 'Market hall', { kind: 'public', zones: {}, unique: 'district' }),
  station: C('station', 'Railway station', { kind: 'public', zones: {}, unique: 'city' }),
  funicular_bottom: C('funicular_bottom', 'Funicular (valley)', { kind: 'public', zones: {}, unique: 'city', pair: 'funicular_top' }),
  funicular_top: C('funicular_top', 'Funicular (summit)', { kind: 'public', zones: {}, unique: 'city', pair: 'funicular_bottom', site: 'upper end of a steep slope' }),
  viewpoint: C('viewpoint', 'Viewpoint', { kind: 'public', zones: {}, site: 'edge of a cliff or steep cell' }),
  firestation: C('firestation', 'Fire station', { kind: 'public', zones: {}, unique: 'district' }),
  postoffice: C('postoffice', 'Post office', { kind: 'public', zones: {}, unique: 'district' }),
};

export const LABELS = { ...Object.fromEntries(Object.entries(CATALOG).map(([k, v]) => [k, v.label])), square: 'Main square', plaza: 'District square' };
export const LABEL_KEYS = { ...Object.fromEntries(Object.entries(CATALOG).map(([k, v]) => [k, v.labelKey])), square: 'building.square', plaza: 'building.plaza' };

export function generate(type, seed, options = {}) {
  return BUILDINGS[type](rngFrom(`${seed}:${type}`), options);
}
