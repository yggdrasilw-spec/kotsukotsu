export class InteractionController {
  constructor({
    viewportEl,
    camera,
    placement,
    core,
    onDirty = () => {},
    onCameraChange = () => {},
    onToast = () => {},
    onPlace = () => {},
    onPlacedInfo = () => {}
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
    this.onToast = onToast;
    // 森に既に置かれている花などをタップしたとき、詳細ポップアップを開くための通知先。
    this.onPlacedInfo = onPlacedInfo;

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
    // オーバーレイやコントロールボタンの中でのpointerdownまで viewportEl が
    // pointer captureしてしまうと、ボタンのclickが失われてしまうため除外する。
    if (event.target.closest?.('.milestone-host, .placed-info-host, .welcome-host, .ending-host, .item-drawer-host, .item-drawer-fab, .viewport-controls, .placing-banner')) {
      return;
    }
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

    // 完成画面・確認モーダル・ボタン類の中でのクリックはここで止め、森の配置には渡さない。
    if (event.target.closest?.('.milestone-host, .placed-info-host, .welcome-host, .ending-host, .item-drawer-host, .item-drawer-fab, .viewport-controls, .placing-banner')) {
      return;
    }

    const target = event.target.closest?.('[data-placed-id], [data-animal-id]');

    if (target?.dataset?.animalId) {
      target.classList.remove('animal-hop');
      void target.offsetWidth;
      target.classList.add('animal-hop');
      window.setTimeout(() => target.classList.remove('animal-hop'), 500);

      const result = this.core.clickAnimal(target.dataset.animalId);
      this.onToast(result.isNewDiscovery ? `はじめて見つけた！ +${result.pointsAwarded}ポイント` : '動物がぴょこんとよろこんだよ！✨');
      this.onDirty();
      return;
    }

    // 森に既に置かれている花などをタップ → 「だれが/いつ/どんな目標のときに置いたか」の詳細を表示。
    // (素材を選び直したいときはパレット側のボタンを使う。ここは「置いたあとの物」専用。)
    if (target?.dataset?.placedId) {
      this.onPlacedInfo(target.dataset.placedId);
      return;
    }

    const selected = this.placement.getSelectedAsset();
    if (!selected) return;

    this.placeAtScreen(selected.id, event.clientX, event.clientY);
  };

  placeAtScreen(assetId, clientX, clientY) {
    const rect = this.viewportEl.getBoundingClientRect();
    if (
      clientX < rect.left ||
      clientX > rect.right ||
      clientY < rect.top ||
      clientY > rect.bottom
    ) {
      return { ok: false, reason: 'outside_viewport' };
    }
    const local = {
      x: clientX - rect.left,
      y: clientY - rect.top
    };
    const world = this.camera.screenToWorld(local.x, local.y);
    const cell = this.camera.worldToCell(world.x, world.y);
    const result = this.placement.placeAtCell(this.core, assetId, cell.x, cell.y);
    if (result.ok) {
      const asset = this.placement.assets.find((a) => a.id === assetId);
      this.onToast(`${asset?.name || assetId} を配置しました✨`);
      this.onPlace(result.placed);
      this.onDirty();
      return result;
    }
    if (result.reason === 'not_owned') {
      this.onToast('在庫がありません。ポイントで購入してね');
    } else if (result.reason === 'spot_full') {
      this.onToast('この場所はもういっぱいです');
    } else {
      this.onToast('ここには置けません');
    }
    return result;
  }
}
