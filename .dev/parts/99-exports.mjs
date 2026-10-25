
// ================================================================ registry

export const BUILDINGS = { chalet, townhouse, cafe, church, clocktower, hotel, modern, apartment, farmhouse, hut };

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

export function generate(type, seed) {
  const rng = rngFrom(`${seed}:${type}`);
  return BUILDINGS[type](rng);
}
