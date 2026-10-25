
// ================================================================ registry

const RAW = { chalet, townhouse, cafe, church, clocktower, hotel, modern, apartment, farmhouse, hut };

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
 * Building catalogue for the bridge. zones: relative weights per ring around the city centre
 * (core = old town, inner, outer, rural = villages and farms). unique: at most one per district / per city.
 */
export const CATALOG = {
  chalet: { label: 'Шале', zones: { inner: 2, outer: 5, rural: 4 } },
  townhouse: { label: 'Дом в старом городе', zones: { core: 8, inner: 5, outer: 1 } },
  cafe: { label: 'Кондитерская', zones: { core: 3, inner: 2, outer: 0.5 } },
  church: { label: 'Церковь', zones: { core: 1, inner: 1.5, outer: 1, rural: 0.6 }, unique: 'district' },
  clocktower: { label: 'Часовая башня', zones: { core: 2.5 }, unique: 'city' },
  hotel: { label: 'Гранд-отель', zones: { core: 1, inner: 2, outer: 1 }, unique: 'district' },
  modern: { label: 'Современный дом', zones: { inner: 2, outer: 4, rural: 1 } },
  apartment: { label: 'Кооперативный дом', zones: { inner: 3, outer: 3 } },
  farmhouse: { label: 'Эмментальская ферма', zones: { outer: 0.8, rural: 5 } },
  hut: { label: 'Альпийская хижина', zones: { rural: 2 } },
};

export const LABELS = { ...Object.fromEntries(Object.entries(CATALOG).map(([k, v]) => [k, v.label])), square: 'Главная площадь', plaza: 'Площадь района' };

export function generate(type, seed, options = {}) {
  return BUILDINGS[type](rngFrom(`${seed}:${type}`), options);
}
