async function readJson(path, fallback = null) {
  try {
    const response = await fetch(path, { cache: 'no-store' });
    if (!response.ok) return fallback;
    return await response.json();
  } catch (error) {
    console.warn(`[data-loader] failed to load ${path}`, error);
    return fallback;
  }
}

function normalizeList(payload, key) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload[key])) return payload[key];
  return [];
}

export async function loadForestBundle() {
  const [assetsRaw, spotsRaw, mapRaw, eventsRaw, shopRaw, badgesRaw] = await Promise.all([
    readJson('./data/assets.json', { assets: [] }),
    readJson('./data/spots.json', { spots: [] }),
    readJson('./data/map.json', null),
    readJson('./data/events.json', { events: [] }),
    readJson('./data/shop.json', { items: [] }),
    readJson('./data/badges.json', { badges: [] })
  ]);

  const assets = normalizeList(assetsRaw, 'assets');
  const spots = normalizeList(spotsRaw, 'spots');
  const events = normalizeList(eventsRaw, 'events');
  const shopItems = normalizeList(shopRaw, 'items');
  const badges = normalizeList(badgesRaw, 'badges');

  return {
    assets,
    spots,
    map: mapRaw || { mapId: 'kokotsu_forest_01', width: 100, height: 80, cellSize: 112, terrain: [], areas: [] },
    events,
    shopItems,
    badges
  };
}
