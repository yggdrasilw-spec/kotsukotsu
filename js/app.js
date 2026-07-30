import { CONFIG } from './config.js';
import { createForestCoreFromData } from './core-runtime.js';
import { Camera } from './camera.js';
import { PlacementManager } from './placement.js';
import { createForestRenderer } from './render.js';
import { InteractionController } from './interaction.js';
import { loadForestBundle } from './data-loader.js';
import { BadgeManager } from './badge.js';
import { AudioManager } from './audio.js';
import { getSeasonLabel } from './season.js';
import { ApiClient } from './api-client.js';
import { ClassSync } from './class-sync.js';

function byId(id) {
  return document.getElementById(id);
}

function createShopItemsFromAssets(assets) {
  return assets
    .filter((asset) => asset.type !== 'terrain' && asset.placeable !== false)
    .map((asset) => ({
      id: `shop_${asset.id}`,
      assetId: asset.id,
      name: asset.name || asset.id,
      category: asset.layer || asset.type || 'misc',
      price: Math.max(0, Number(asset.price || 0) || Math.max(5, Number(asset.unlock || 0) * 2)),
      unlockCondition: { progress: Number(asset.unlock || 0) }
    }));
}

function buildToastHost() {
  let host = byId('toastHost');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toastHost';
    host.className = 'toast-host';
    document.body.appendChild(host);
  }
  return host;
}

function toast(message, extraClass = '') {
  const host = buildToastHost();
  const el = document.createElement('div');
  el.className = `toast ${extraClass}`.trim();
  el.textContent = message;
  host.appendChild(el);
  window.setTimeout(() => el.remove(), extraClass ? 4000 : 1800);
}

function setText(id, text) {
  const el = byId(id);
  if (el) el.textContent = text;
}

function setHTML(id, html) {
  const el = byId(id);
  if (el) el.innerHTML = html;
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const CATEGORY_LABELS = {
  tree: '木',
  flower: '花',
  mushroom: 'きのこ',
  pond: '池',
  animal: '動物',
  path: '小道',
  bridge: '橋',
  rock: '岩'
};

function summarizeMilestones(summary) {
  if (!summary) return null;
  const parts = [];
  if (Array.isArray(summary.newEvents) && summary.newEvents.length) {
    parts.push(`イベント: ${summary.newEvents.map((ev) => ev.title).join(' / ')}`);
  }
  if (Array.isArray(summary.newBadges) && summary.newBadges.length) {
    parts.push(`バッジ: ${summary.newBadges.map((badge) => badge.name).join(' / ')}`);
  }
  if (Array.isArray(summary.newCategories) && summary.newCategories.length) {
    const labels = summary.newCategories.map((c) => CATEGORY_LABELS[c.category] || c.category);
    parts.push(`新しいジャンル解放: ${labels.join(' / ')}`);
  }
  if (!parts.length) return null;
  return parts.join(' | ');
}

async function bootstrap() {
  const bundle = await loadForestBundle();
  const assets = bundle.assets;
  const spots = bundle.spots;
  const map = bundle.map;
  const events = bundle.events || [];
  const badges = bundle.badges || [];
  const shopItems = bundle.shopItems.length ? bundle.shopItems : createShopItemsFromAssets(assets);

  const core = createForestCoreFromData({ assets, spots, shopItems, storageKey: CONFIG.storageKey });
  core.setAssets(assets);
  core.setSpots(spots);
  core.setEvents(events);
  core.setBadges(badges);
  core.setShopItems(shopItems);

  const apiClient = new ApiClient();
  const classSync = new ClassSync({ apiClient, core, onSync: () => refresh() });

  const badgeManager = new BadgeManager(badges);
  const audio = new AudioManager();

  const viewportEl = byId('forestViewport');
  const worldEl = byId('forestWorld');
  const layers = {
    terrain: byId('layerTerrain'),
    assets: byId('layerAssets'),
    animals: byId('layerAnimals'),
    debug: byId('layerDebug')
  };

  const camera = new Camera({
    cellSize: CONFIG.cellSize,
    mapWidth: map.width || CONFIG.mapWidth,
    mapHeight: map.height || CONFIG.mapHeight,
    minZoom: CONFIG.minZoom,
    maxZoom: CONFIG.maxZoom,
    zoom: core.getState().settings?.zoom || 1
  });

  const placement = new PlacementManager({ assets, spots, cellSize: CONFIG.cellSize });

  const savedState = core.getState();
  const savedSettings = savedState.settings || {};
  const showGrid = Boolean(savedSettings.showGrid);
  const showSpots = Boolean(savedSettings.showSpots);
  placement.setFlags({ showGrid, showSpots });

  const renderer = createForestRenderer({
    viewportEl,
    worldEl,
    layers,
    camera,
    map,
    assets,
    spots,
    debug: showGrid || showSpots
  });

  camera.setViewport(viewportEl.clientWidth, viewportEl.clientHeight);
  if (Number.isFinite(savedSettings.cameraX) && Number.isFinite(savedSettings.cameraY)) {
    camera.x = savedSettings.cameraX;
    camera.y = savedSettings.cameraY;
    camera.zoom = savedSettings.zoom || camera.zoom;
    camera.clampToBounds();
  } else {
    camera.zoom = savedSettings.zoom || camera.zoom;
    camera.centerOnCell(map.width / 2, map.height / 2);
  }

  let lastCameraSnapshot = JSON.stringify({
    x: Math.round(camera.x * 1000) / 1000,
    y: Math.round(camera.y * 1000) / 1000,
    zoom: Math.round(camera.zoom * 1000) / 1000
  });

  let cameraPersistTimer = null;
  function syncCameraToState() {
    const snapshot = JSON.stringify({
      x: Math.round(camera.x * 1000) / 1000,
      y: Math.round(camera.y * 1000) / 1000,
      zoom: Math.round(camera.zoom * 1000) / 1000
    });
    if (snapshot === lastCameraSnapshot) return;
    lastCameraSnapshot = snapshot;
    core.state.settings = core.state.settings || {};
    core.state.settings.cameraX = camera.x;
    core.state.settings.cameraY = camera.y;
    core.state.settings.zoom = camera.zoom;
    // ドラッグ中に1pxごとlocalStorageへ書き込むと重いので、少し間を置いてから保存する
    clearTimeout(cameraPersistTimer);
    cameraPersistTimer = setTimeout(() => core.persist(), 400);
  }

  // パン/ズームの間だけ呼ばれる軽量パス。パレットやショップ等は一切再構築せず、
  // カメラのtransformとズーム表示だけを更新する。
  function updateCameraOnly() {
    renderer.updateCamera();
    syncCameraToState();
    setText('zoomValue', `${Math.round(camera.zoom * 100)}%`);
  }

  function updateUiFlagsFromState() {
    const settings = core.getState().settings || {};
    placement.setFlags({
      showGrid: Boolean(settings.showGrid),
      showSpots: Boolean(settings.showSpots)
    });
    renderer.setDebug(Boolean(settings.showGrid || settings.showSpots));
  }

  let logExpanded = false;

  function refresh() {
    announceMilestones();
    announceNotifications();
    syncCameraToState();
    updateUiFlagsFromState();

    const state = core.getState();
    const evaluatedBadges = badgeManager.evaluate(state);
    const goalsView = core.listGoals().map((g) => ({
      ...g,
      ...core.getGoalStatus(g.id)
    }));
    const pendingApprovalsView = core.listPendingApprovals();
    const renderState = {
      ...state,
      eventCatalog: events,
      evaluatedBadges,
      shopItems: core.shop.items,
      goalsView,
      pendingApprovalsView,
      logExpanded
    };

    const view = renderer.render(renderState);
    setHTML('assetPalette', view.paletteHtml);
    setHTML('statusPanel', view.statusHtml);
    setHTML('eventLog', view.logHtml);
    setHTML('badgePanel', view.badgeHtml);
    setHTML('shopPanel', view.shopHtml);
    setHTML('goalPanel', view.goalHtml);
    setHTML('approvalPanel', view.approvalHtml);
    const teacherModeChk = byId('chkTeacherMode');
    if (teacherModeChk) teacherModeChk.checked = state.goalSettings?.approvalMode === 'teacher';
    setText('progressValue', `${Math.floor(state.classPoints || 0)}`);
    setText('personalValue', `${Math.floor(state.personalPoints || 0)}`);
    setText('seasonValue', getSeasonLabel(state.settings?.season || 'spring'));
    const seasonOverlay = byId('seasonOverlay');
    if (seasonOverlay) seasonOverlay.dataset.season = state.settings?.season || 'spring';
    setText('zoomValue', `${Math.round(camera.zoom * 100)}%`);
    setText('spotModeValue', placement.mode === 'place' ? '配置' : '移動');
    const selectedAsset = placement.getSelectedAsset();
    setText('selectedAssetName', selectedAsset?.name || '未選択');
    setText('selectedAssetMeta', selectedAsset?.description || selectedAsset?.type || selectedAsset?.id || '—');
    setText('ownedCount', `${(state.ownedAssets || []).length}`);
    setText('placedCount', `${(state.placedAssets || []).length}`);
  }

  function announceMilestones() {
    const summary = core.consumeMilestoneSummary();
    const text = summarizeMilestones(summary);
    const autoSpawnText = Array.isArray(summary?.autoSpawned) && summary.autoSpawned.length
      ? `新しい仲間: ${summary.autoSpawned.map((id) => assets.find((a) => a.id === id)?.name || id).join(' / ')}`
      : null;
    const combined = [text, autoSpawnText].filter(Boolean).join(' | ');
    if (!combined) return;
    toast(combined);
    if (core.getState().settings?.sfx) {
      audio.beep(summary?.newBadges?.length ? 660 : 520, 0.06);
    }
    // events.json の effect フィールドを実際の画面演出として再生する
    const lastEventWithEffect = [...(summary?.newEvents || [])].reverse().find((ev) => ev.effect);
    if (lastEventWithEffect) playEffect(lastEventWithEffect.effect);
  }

  function announceNotifications() {
    const unread = core.consumeNotifications();
    for (const notification of unread) {
      // 「受け取った本人には特別ポップアップ表示」= 通常のトーストより長く目立たせる。
      toast(`🧡 ${notification.message}`, 'toast--special');
      if (core.getState().settings?.sfx) audio.beep(880, 0.08);
    }
  }

  function playEffect(effectName) {
    const el = byId('effectOverlay');
    if (!el || !effectName) return;
    el.removeAttribute('data-effect');
    void el.offsetWidth; // 強制リフロー。同じ演出が連続しても再生し直せるようにする
    el.dataset.effect = effectName;
  }

  const interaction = new InteractionController({
    viewportEl,
    camera,
    placement,
    core,
    onDirty: refresh,
    onCameraChange: updateCameraOnly,
    onSelect: (assetId) => {
      const asset = assets.find((a) => a.id === assetId);
      setText('selectedAssetName', asset?.name || assetId);
      setText('selectedAssetMeta', asset?.description || asset?.type || assetId);
    },
    onToast: toast,
    onPlace: (placed) => {
      if (!placed) return;
      classSync.pushPlaceAsset({ assetId: placed.assetId, spotId: placed.spotId, x: placed.x, y: placed.y });
    }
  });

  function resize() {
    camera.setViewport(viewportEl.clientWidth, viewportEl.clientHeight);
    camera.clampToBounds();
    refresh();
  }
  window.addEventListener('resize', resize);

  function saveNow() {
    core.persist();
    toast('保存しました');
  }

  function clearSelection() {
    placement.clearSelection();
    refresh();
  }

  function loadNow() {
    const loaded = core.saveManager.load();
    core.state = loaded;
    core.animals.hydrate(loaded.animals);
    core.syncMilestones();

    const loadedSettings = loaded.settings || {};
    camera.zoom = loadedSettings.zoom || 1;
    if (Number.isFinite(loadedSettings.cameraX) && Number.isFinite(loadedSettings.cameraY)) {
      camera.x = loadedSettings.cameraX;
      camera.y = loadedSettings.cameraY;
    } else {
      camera.centerOnCell(map.width / 2, map.height / 2);
    }
    camera.clampToBounds();
    lastCameraSnapshot = JSON.stringify({
      x: Math.round(camera.x * 1000) / 1000,
      y: Math.round(camera.y * 1000) / 1000,
      zoom: Math.round(camera.zoom * 1000) / 1000
    });

    updateUiFlagsFromState();
    refresh();
    toast('読込しました');
  }

  function resetNow() {
    if (!window.confirm('森の保存データをリセットしますか？')) return;
    core.reset();
    camera.zoom = 1;
    camera.centerOnCell(map.width / 2, map.height / 2);
    lastCameraSnapshot = JSON.stringify({
      x: Math.round(camera.x * 1000) / 1000,
      y: Math.round(camera.y * 1000) / 1000,
      zoom: Math.round(camera.zoom * 1000) / 1000
    });
    refresh();
    toast('リセットしました');
  }

  function bindButton(id, handler) {
    const el = byId(id);
    if (el) el.addEventListener('click', handler);
  }

  bindButton('btnSave', saveNow);
  bindButton('btnLoad', loadNow);
  bindButton('btnReset', resetNow);
  bindButton('btnZoomIn', () => {
    camera.setZoom(camera.zoom * 1.08, { x: viewportEl.clientWidth / 2, y: viewportEl.clientHeight / 2 });
    refresh();
  });
  bindButton('btnZoomOut', () => {
    camera.setZoom(camera.zoom * 0.92, { x: viewportEl.clientWidth / 2, y: viewportEl.clientHeight / 2 });
    refresh();
  });
  bindButton('btnCenter', () => {
    camera.centerOnCell(map.width / 2, map.height / 2);
    refresh();
  });
  bindButton('btnAddPoints', () => {
    core.addPoints(10);
    refresh();
    toast('（テスト用）10ポイント追加');
  });
  bindButton('btnSpawnBird', () => {
    const result = core.spawnAnimal('bird', 2);
    refresh();
    toast(result.spawned.length ? '小鳥を出しました' : 'もうスポットがいっぱいです');
  });
  bindButton('btnSpawnSquirrel', () => {
    const result = core.spawnAnimal('animal_ground', 1);
    refresh();
    toast(result.spawned.length ? '小動物を出しました' : 'もうスポットがいっぱいです');
  });
  bindButton('btnSpawnInsect', () => {
    const result = core.spawnAnimal('insect', 3);
    refresh();
    toast(result.spawned.length ? '虫を出しました' : 'もうスポットがいっぱいです');
  });

  bindButton('btnSeasonSpring', () => { core.setSeason('spring'); refresh(); });
  bindButton('btnSeasonSummer', () => { core.setSeason('summer'); refresh(); });
  bindButton('btnSeasonAutumn', () => { core.setSeason('autumn'); refresh(); });
  bindButton('btnSeasonWinter', () => { core.setSeason('winter'); refresh(); });

  bindButton('btnToggleGrid', () => {
    const current = Boolean(core.getState().settings?.showGrid);
    core.setUIFlag('showGrid', !current);
    placement.setFlags({ showGrid: !current });
    renderer.setDebug(Boolean(core.getState().settings?.showGrid || core.getState().settings?.showSpots));
    refresh();
  });
  bindButton('btnToggleSpots', () => {
    const current = Boolean(core.getState().settings?.showSpots);
    core.setUIFlag('showSpots', !current);
    placement.setFlags({ showSpots: !current });
    renderer.setDebug(Boolean(core.getState().settings?.showGrid || core.getState().settings?.showSpots));
    refresh();
  });

  function updateClassSyncStatus() {
    setText('classSyncStatus', classSync.isConfigured() ? `${classSync.info.nickname}(${classSync.info.classCode})` : '未接続');
  }

  bindButton('btnClassSync', async () => {
    if (classSync.isConfigured()) {
      const ok = window.confirm(`クラス連携中: ${classSync.info.classCode}\n連携を解除しますか？(この端末の森はローカルに残ります)`);
      if (ok) {
        classSync.disconnect();
        toast('クラス連携を解除しました');
        updateClassSyncStatus();
      }
      return;
    }
    const baseUrl = window.prompt('GASのウェブアプリURLを入力してください(例: https://script.google.com/macros/s/.../exec)');
    if (!baseUrl) return;
    const nickname = window.prompt('ニックネームを入力してください') || 'わたし';
    const codeInput = window.prompt('参加するクラスコードを入力してください。\n新しくクラスを作る場合は空欄のままOKですすめてください。');
    let result;
    if (codeInput && codeInput.trim()) {
      result = await classSync.joinExistingClass({ baseUrl, classCode: codeInput.trim(), nickname });
    } else {
      const teacherName = window.prompt('先生のお名前(任意)') || '';
      result = await classSync.setupNewClass({ baseUrl, teacherName, clearPoint: 1000, nickname });
    }
    if (result.ok) {
      toast(`クラスに接続しました（コード: ${classSync.info.classCode}）`);
      classSync.startAutoSync();
    } else {
      toast(`接続できませんでした: ${result.reason || 'unknown_error'}`);
    }
    updateClassSyncStatus();
  });

  updateClassSyncStatus();
  if (classSync.isConfigured()) {
    classSync.startAutoSync();
  }

  bindButton('btnExport', () => {
    downloadText('kokotsu_forest_save.json', JSON.stringify(core.getState(), null, 2));
    toast('保存データを書き出しました');
  });

  document.addEventListener('click', (event) => {
    const buyBtn = event.target.closest?.('[data-buy-shop]');
    if (!buyBtn) return;
    const itemId = buyBtn.dataset.buyShop;
    const result = core.buy(itemId);
    if (!result.ok) {
      toast('購入できませんでした');
      return;
    }
    if (core.getState().settings?.sfx) {
      audio.beep(720, 0.05);
    }
    toast(`${result.item.name || result.item.id} を入手`);
    classSync.pushBuyItem({ itemId, assetId: result.item.assetId, itemName: result.item.name, price: result.item.price });
    refresh();
  });

  document.addEventListener('click', (event) => {
    const selectBtn = event.target.closest?.('[data-select-asset]');
    if (!selectBtn) return;
    const assetId = selectBtn.dataset.selectAsset;
    if (!core.canPlaceAsset(assetId)) {
      toast('まだ持っていません。ショップで手に入れてね');
      return;
    }
    placement.selectAsset(assetId);
    refresh();
  });

  document.addEventListener('submit', (event) => {
    const form = event.target.closest?.('#goalCreateForm');
    if (!form) return;
    event.preventDefault();
    const titleInput = byId('goalTitleInput');
    const targetInput = byId('goalTargetInput');
    const title = titleInput ? titleInput.value : '';
    const target = targetInput ? targetInput.value : 1;
    const result = core.createGoal(title, target);
    if (!result.ok) {
      const messages = {
        empty_title: '目標を入力してね',
        max_goals_reached: 'これ以上目標は作れません'
      };
      toast(messages[result.reason] || '目標を作れませんでした');
      return;
    }
    toast('目標をつくりました');
    classSync.pushCreateGoal({ title, targetCount: target });
    refresh();
  });

  document.addEventListener('submit', (event) => {
    const thanksForm = event.target.closest?.('#thanksForm');
    if (!thanksForm) return;
    event.preventDefault();
    const nameInput = byId('thanksNameInput');
    const name = nameInput ? nameInput.value : '';
    const result = core.sendThanks(name, 'わたし');
    if (!result.ok) {
      const messages = {
        empty_name: '送る相手の名前を入れてね',
        already_sent_today: 'その人へは今日もう送っています',
        same_as_last: '直前と同じ人には続けて送れません'
      };
      toast(messages[result.reason] || '送れませんでした');
      return;
    }
    if (nameInput) nameInput.value = '';
    toast(`${result.entry.toName}さんにありがとうを送りました`);
    classSync.pushSendThanks({ toName: result.entry.toName, fromLabel: 'わたし' });
    refresh();
  });

  document.addEventListener('click', (event) => {
    const completeBtn = event.target.closest?.('[data-goal-complete]');
    if (completeBtn) {
      const goalId = completeBtn.dataset.goalComplete;
      const result = core.completeGoal(goalId);
      if (!result.ok) {
        toast(result.reason === 'already_completed_today' ? 'きょうはもう達成しています' : 'できませんでした');
        return;
      }
      toast(result.needsApproval ? '先生の承認をまってね' : `達成！ +${result.pointsAwarded}ポイント`);
      classSync.pushCompleteGoal(goalId);
      refresh();
      return;
    }

    const removeBtn = event.target.closest?.('[data-goal-remove]');
    if (removeBtn) {
      const goalId = removeBtn.dataset.goalRemove;
      if (core.removeGoal(goalId)) {
        toast('目標をやめました');
        classSync.pushRemoveGoal(goalId);
        refresh();
      }
      return;
    }

    const approveBtn = event.target.closest?.('[data-goal-approve]');
    if (approveBtn) {
      const logId = approveBtn.dataset.goalApprove;
      const result = core.approveGoal(logId);
      if (result.ok) {
        toast(`承認しました（+${result.pointsAwarded}ポイント）`);
        classSync.pushApproveGoal(logId);
        refresh();
      }
      return;
    }

    const rejectBtn = event.target.closest?.('[data-goal-reject]');
    if (rejectBtn) {
      const logId = rejectBtn.dataset.goalReject;
      if (core.rejectGoal(logId).ok) {
        toast('却下しました');
        classSync.pushRejectGoal(logId);
        refresh();
      }
      return;
    }

    const logToggleBtn = event.target.closest?.('[data-log-toggle]');
    if (logToggleBtn) {
      logExpanded = !logExpanded;
      refresh();
    }
  });

  const teacherModeChk = byId('chkTeacherMode');
  if (teacherModeChk) {
    teacherModeChk.addEventListener('change', () => {
      core.setGoalApprovalMode(teacherModeChk.checked ? 'teacher' : 'self');
      refresh();
    });
  }

  bindButton('btnPreviewThanks', () => {
    core.previewIncomingThanks('ともだち');
    refresh();
  });

  const loop = () => {
    core.tick();
    // 毎フレームのフル再描画(パレット/ショップ/バッジ/地形まで作り直す)は重いので、
    // ここでは「動物が実際に動いた時だけ」動物レイヤーだけを更新する軽量パスを使う。
    // ボタン操作や配置などの本当の状態変化は refresh() 側(onDirty経由)で処理される。
    renderer.renderAnimalsOnly(core.getState());
    requestAnimationFrame(loop);
  };

  refresh();
  requestAnimationFrame(loop);
  setInterval(() => {
    core.persist();
  }, 15000);

  // 起動が成功したので「森を読み込み中…」の表示を消す
  const appMessageEl = byId('appMessage');
  if (appMessageEl) {
    appMessageEl.remove();
  }
}

window.addEventListener('DOMContentLoaded', () => {
  bootstrap().catch((error) => {
    console.error(error);
    const el = document.querySelector('#appMessage');
    if (el) {
      el.textContent = `起動に失敗しました: ${error?.message || error}`;
    }
  });
});
