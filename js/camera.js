export class Camera {
  constructor({
    cellSize = 112,
    mapWidth = 100,
    mapHeight = 80,
    minZoom = 0.85,
    maxZoom = 1.2,
    zoom = 1
  } = {}) {
    this.cellSize = cellSize;
    this.mapWidth = mapWidth;
    this.mapHeight = mapHeight;
    this.minZoom = minZoom;
    this.maxZoom = maxZoom;
    this.zoom = this.clampZoom(zoom);
    this.x = 0;
    this.y = 0;
    this.viewportWidth = 1;
    this.viewportHeight = 1;
  }

  setViewport(width, height) {
    this.viewportWidth = Math.max(1, width);
    this.viewportHeight = Math.max(1, height);
    this.clampToBounds();
  }

  clampZoom(value) {
    return Math.min(this.maxZoom, Math.max(this.minZoom, Number(value) || 1));
  }

  setZoom(value, anchor = null) {
    const nextZoom = this.clampZoom(value);
    if (anchor) {
      const before = this.screenToWorld(anchor.x, anchor.y);
      this.zoom = nextZoom;
      this.x = before.x - anchor.x / this.zoom;
      this.y = before.y - anchor.y / this.zoom;
    } else {
      this.zoom = nextZoom;
    }
    this.clampToBounds();
  }

  panBy(deltaScreenX, deltaScreenY) {
    this.x -= deltaScreenX / this.zoom;
    this.y -= deltaScreenY / this.zoom;
    this.clampToBounds();
  }

  centerOnCell(cellX, cellY) {
    const worldX = cellX * this.cellSize;
    const worldY = cellY * this.cellSize;
    this.x = worldX - this.viewportWidth / (2 * this.zoom);
    this.y = worldY - this.viewportHeight / (2 * this.zoom);
    this.clampToBounds();
  }

  resetToMapCenter() {
    this.centerOnCell(this.mapWidth / 2, this.mapHeight / 2);
  }

  setMapSize(mapWidth, mapHeight) {
    this.mapWidth = mapWidth;
    this.mapHeight = mapHeight;
    this.clampToBounds();
  }

  clampToBounds() {
    const worldWidth = this.mapWidth * this.cellSize;
    const worldHeight = this.mapHeight * this.cellSize;
    const visibleWidth = this.viewportWidth / this.zoom;
    const visibleHeight = this.viewportHeight / this.zoom;
    const maxX = Math.max(0, worldWidth - visibleWidth);
    const maxY = Math.max(0, worldHeight - visibleHeight);
    this.x = Math.min(maxX, Math.max(0, this.x));
    this.y = Math.min(maxY, Math.max(0, this.y));
  }

  screenToWorld(screenX, screenY) {
    return {
      x: this.x + screenX / this.zoom,
      y: this.y + screenY / this.zoom
    };
  }

  worldToScreen(worldX, worldY) {
    return {
      x: (worldX - this.x) * this.zoom,
      y: (worldY - this.y) * this.zoom
    };
  }

  worldToCell(worldX, worldY) {
    return {
      x: Math.floor(worldX / this.cellSize),
      y: Math.floor(worldY / this.cellSize)
    };
  }

  getTransform() {
    const tx = -this.x * this.zoom;
    const ty = -this.y * this.zoom;
    return `translate3d(${tx}px, ${ty}px, 0) scale(${this.zoom})`;
  }

  getVisibleRect() {
    return {
      x: this.x,
      y: this.y,
      width: this.viewportWidth / this.zoom,
      height: this.viewportHeight / this.zoom
    };
  }
}
