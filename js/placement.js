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

  // 1マスに複数置けるスポット(花・きのこ等、maxCount>1)では、全員が同じ座標に
  // 重なって見えてしまうと「置いたのに増えて見えない」状態になる。
  // そこで、そのスポットに何個目かに応じて、マス内の決まった位置へ少しずつ
  // ずらして配置する(毎回ランダムだと再読込のたびに散らばり方が変わって不自然なので、
  // 個数に応じた固定パターンを使う)。
  static SCATTER_OFFSETS = [
    { x: 0, y: 0 },
    { x: -0.22, y: -0.1 },
    { x: 0.22, y: -0.1 },
    { x: -0.18, y: 0.16 },
    { x: 0.18, y: 0.16 },
    { x: 0, y: -0.24 }
  ];

  getScatterOffset(index) {
    const table = PlacementManager.SCATTER_OFFSETS;
    return table[index % table.length];
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
    let targetX = spot ? spot.x : cellX;
    let targetY = spot ? spot.y : cellY;
    if (spot && Number(spot.maxCount || 1) > 1 && typeof core.countPlacedAtSpot === 'function') {
      const occupantIndex = core.countPlacedAtSpot(spot.id);
      const offset = this.getScatterOffset(occupantIndex);
      targetX = spot.x + offset.x;
      targetY = spot.y + offset.y;
    }
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
