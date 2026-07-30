export class PlacementManager {
  constructor({ assets = [], spots = [], cellSize = 112 } = {}) {
    this.assets = assets;
    this.spots = spots;
    this.cellSize = cellSize;
    this.selectedAssetId = null;
    this.mode = 'pan';
    this.showGrid = false;
    this.showSpots = true;
  }

  setAssets(assets) {
    this.assets = Array.isArray(assets) ? assets : [];
  }

  setSpots(spots) {
    this.spots = Array.isArray(spots) ? spots : [];
  }

  selectAsset(assetId) {
    this.selectedAssetId = assetId;
    this.mode = 'place';
  }

  clearSelection() {
    this.selectedAssetId = null;
    this.mode = 'pan';
  }

  setFlags({ showGrid, showSpots } = {}) {
    if (typeof showGrid === 'boolean') this.showGrid = showGrid;
    if (typeof showSpots === 'boolean') this.showSpots = showSpots;
  }

  getSelectedAsset() {
    return this.assets.find((asset) => asset.id === this.selectedAssetId) || null;
  }

  findSpotForAsset(asset, cellX, cellY, isSpotAvailable = () => true) {
    if (!asset) return null;
    const type = asset.type;
    const candidates = this.spots.filter((spot) => {
      const allow = Array.isArray(spot.allow) ? spot.allow : [];
      return spot.type === type || allow.includes(asset.id) || allow.includes(type);
    });

    if (!candidates.length) return null;

    let best = null;
    let bestDistance = Infinity;
    for (const spot of candidates) {
      if (!isSpotAvailable(spot.id)) continue;
      const dx = spot.x - cellX;
      const dy = spot.y - cellY;
      const radius = Number(spot.radius || 0);
      const dist = Math.hypot(dx, dy);
      if (dist <= radius + 0.01 && dist < bestDistance) {
        best = spot;
        bestDistance = dist;
      }
    }
    return best;
  }

  placeAtCell(core, assetId, cellX, cellY) {
    const asset = this.assets.find((a) => a.id === assetId);
    if (!asset) {
      return { ok: false, reason: 'asset_not_found' };
    }
    if (typeof core.canPlaceAsset === 'function' && !core.canPlaceAsset(assetId)) {
      return { ok: false, reason: 'not_owned' };
    }
    const isSpotAvailable = typeof core.isSpotAvailable === 'function'
      ? (spotId) => core.isSpotAvailable(spotId)
      : () => true;
    const spot = this.findSpotForAsset(asset, cellX, cellY, isSpotAvailable);
    const targetX = spot ? spot.x : cellX;
    const targetY = spot ? spot.y : cellY;
    const result = core.placeAsset(assetId, spot ? spot.id : null, targetX, targetY);
    if (!result.ok) {
      return { ok: false, reason: result.reason || 'place_failed' };
    }
    return { ok: true, placed: result, spot };
  }

  getAssetBadgeText(asset) {
    if (!asset) return '';
    return asset.name || asset.id;
  }
}
