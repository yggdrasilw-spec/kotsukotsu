export class InteractionController {
  constructor({
    viewportEl,
    camera,
    placement,
    core,
    onDirty = () => {},
    onCameraChange = () => {},
    onSelect = () => {},
    onToast = () => {},
    onPlace = () => {}
  } = {}) {
    this.viewportEl = viewportEl;
    this.camera = camera;
    this.placement = placement;
    this.core = core;
    this.onDirty = onDirty;
    this.onPlace = onPlace;
    // パン/ズームはフレーム内で何度も発生しうるので、パレット/ショップ/バッジ等を
    // 含むフルの再描画(onDirty)ではなく、カメラのtransformだけを更新する
    // 軽量な経路(onCameraChange)を使う。
    this.onCameraChange = onCameraChange;
    this.onSelect = onSelect;
    this.onToast = onToast;

    this.dragging = false;
    this.dragMoved = false;
    this.pointerStart = { x: 0, y: 0 };
    this.pointerLast = { x: 0, y: 0 };
    this.activePointerId = null;

    this.bind();
  }

  bind() {
    this.viewportEl.addEventListener('pointerdown', this.handlePointerDown);
    window.addEventListener('pointermove', this.handlePointerMove);
    window.addEventListener('pointerup', this.handlePointerUp);
    this.viewportEl.addEventListener('wheel', this.handleWheel, { passive: false });

    this.viewportEl.addEventListener('click', this.handleClick);
  }

  destroy() {
    this.viewportEl.removeEventListener('pointerdown', this.handlePointerDown);
    window.removeEventListener('pointermove', this.handlePointerMove);
    window.removeEventListener('pointerup', this.handlePointerUp);
    this.viewportEl.removeEventListener('wheel', this.handleWheel);
    this.viewportEl.removeEventListener('click', this.handleClick);
  }

  getLocalPoint(event) {
    const rect = this.viewportEl.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
  }

  handlePointerDown = (event) => {
    if (event.button !== 0 && event.pointerType !== 'touch') return;
    this.activePointerId = event.pointerId;
    this.dragging = true;
    this.dragMoved = false;
    this.pointerStart = { x: event.clientX, y: event.clientY };
    this.pointerLast = { x: event.clientX, y: event.clientY };
    this.viewportEl.setPointerCapture?.(event.pointerId);
  };

  handlePointerMove = (event) => {
    if (!this.dragging || event.pointerId !== this.activePointerId) return;
    const dx = event.clientX - this.pointerLast.x;
    const dy = event.clientY - this.pointerLast.y;
    if (Math.hypot(event.clientX - this.pointerStart.x, event.clientY - this.pointerStart.y) > 4) {
      this.dragMoved = true;
    }
    this.camera.panBy(dx, dy);
    this.pointerLast = { x: event.clientX, y: event.clientY };
    this.onCameraChange();
  };

  handlePointerUp = (event) => {
    if (event.pointerId !== this.activePointerId) return;
    this.dragging = false;
    this.activePointerId = null;
  };

  handleWheel = (event) => {
    event.preventDefault();
    const rect = this.viewportEl.getBoundingClientRect();
    const anchor = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
    const factor = event.deltaY > 0 ? 0.92 : 1.08;
    this.camera.setZoom(this.camera.zoom * factor, anchor);
    this.onCameraChange();
  };

  handleClick = (event) => {
    if (this.dragMoved) {
      this.dragMoved = false;
      return;
    }

    const target = event.target.closest?.('[data-asset-id], [data-animal-id]');

    if (target?.dataset?.animalId) {
      const result = this.core.clickAnimal(target.dataset.animalId);
      this.onToast(result.isNewDiscovery ? `はじめて見つけた！ +${result.pointsAwarded}ポイント` : '動物が反応したよ');
      this.onDirty();
      return;
    }

    if (target?.dataset?.assetId) {
      this.onSelect(target.dataset.assetId);
      return;
    }

    const selected = this.placement.getSelectedAsset();
    if (!selected) return;

    const local = this.getLocalPoint(event);
    const world = this.camera.screenToWorld(local.x, local.y);
    const cell = this.camera.worldToCell(world.x, world.y);
    const result = this.placement.placeAtCell(this.core, selected.id, cell.x, cell.y);
    if (result.ok) {
      const points = result.placed?.pointsAwarded;
      this.onToast(`${selected.name || selected.id} を配置${points ? ` (+${points}ポイント)` : ''}`);
      this.onPlace(result.placed);
      this.onDirty();
      return;
    }
    if (result.reason === 'not_owned') {
      this.onToast('まだ持っていません。ショップで手に入れてね');
    } else if (result.reason === 'spot_full') {
      this.onToast('このスポットはもういっぱいです');
    } else {
      this.onToast('置ける場所が見つかりません');
    }
  };
}
