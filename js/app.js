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
import { FirebaseClient } from './firebase-client.js';
import { FirebaseSync } from './firebase-sync.js';

function byId(id) {
  return document.getElementById(id);
}

function escapeHtml(text) {
  return String(text ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
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

// 「クリア」ボタンの位置から、+ポイントと星をふわっと飛ばす。
// ボタンはこのあとrefresh()で作り直されるので、要素ではなく座標だけ使う。
function spawnCelebration(anchorEl, points) {
  const rect = anchorEl?.getBoundingClientRect?.();
  if (!rect) return;
  const originX = rect.left + rect.width / 2;
  const originY = rect.top + rect.height / 2;

  const pieces = [];
  if (points) pieces.push({ text: `+${points}`, cls: 'celebrate-particle--points', dx: 0, delay: 0 });
  const emojis = ['✨', '🌟', '🍃'];
  emojis.forEach((emoji, i) => {
    pieces.push({ text: emoji, cls: 'celebrate-particle--emoji', dx: (i - 1) * 26, delay: 40 + i * 40 });
  });

  pieces.forEach(({ text, cls, dx, delay }) => {
    window.setTimeout(() => {
      const el = document.createElement('span');
      el.className = `celebrate-particle ${cls}`;
      el.textContent = text;
      el.style.left = `${originX}px`;
      el.style.top = `${originY}px`;
      el.style.setProperty('--drift-x', `calc(-50% + ${dx}px)`);
      document.body.appendChild(el);
      window.setTimeout(() => el.remove(), 1000);
    }, delay);
  });
}

// 数字が変わったことに気づきやすいよう、一瞬だけパルスさせる。
function pulse(id) {
  const el = byId(id);
  if (!el) return;
  el.classList.remove('stat-pop');
  void el.offsetWidth; // 連続で発火しても再生し直せるよう強制リフロー
  el.classList.add('stat-pop');
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
  // ショップも右カラム(パレット)と同じ基準(assets.jsonのplaceable)で絞り込む。
  // 「木」「岩」のような、進行度で自動配置される大物は児童が選んで置くものではないため、
  // data/shop.jsonに項目が残っていてもショップには出さない(v24でパレット側は対応済みだったが、
  // ショップ側は別経路だったため漏れていた)。
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const shopItemsRaw = bundle.shopItems.length ? bundle.shopItems : createShopItemsFromAssets(assets);
  const shopItems = shopItemsRaw.filter((item) => {
    const asset = assetById.get(item.assetId);
    return !asset || asset.placeable !== false;
  });

  const core = createForestCoreFromData({ assets, spots, shopItems, storageKey: CONFIG.storageKey });
  core.setAssets(assets);
  core.setSpots(spots);
  core.setEvents(events);
  core.setBadges(badges);
  core.setShopItems(shopItems);

  const apiClient = new ApiClient();
  const classSync = new ClassSync({
    apiClient, core, onSync: () => refresh(),
    onPlaceFailed: () => toast('うまく置けなかったみたい。もう一度おいてみてね')
  });

  const firebaseClient = new FirebaseClient();
  const firebaseSync = new FirebaseSync({
    firebaseClient,
    core,
    onSync: () => refresh(),
    onPlaceFailed: () => toast('うまく置けなかったみたい。もう一度おいてみてね'),
    onThanksReceived: (thx) => {
      const host = byId('thanksReceivedHost');
      const fromEl = byId('thanksReceivedFrom');
      const msgEl = byId('thanksReceivedMsg');
      if (host && fromEl && msgEl) {
        fromEl.textContent = `${thx.fromLabel || 'おともだち'} さんから`;
        msgEl.textContent = thx.message || 'いつもありがとう！';
        host.style.display = 'flex';
        audio.playThanks();
      }
    },
    onGoalApproved: (approvedGoals) => {
      toast(`先生が「${approvedGoals[0]?.goalTitle || '目標'}」を承認してくれました！ +20ポイント`);
      audio.chime();
      refresh();
    }
  });

  if (firebaseSync.isConfigured()) {
    firebaseSync.startListening();
  }

  // 「だれが置いたか」の記録用。クラス未接続ならローカルの「わたし」のまま。
  core.setIdentity({ studentId: classSync.info?.studentId || null, nickname: classSync.info?.nickname || 'わたし' });

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

  // 画面サイズに対して森全体(map.width × map.height)が入りきる倍率を計算する。
  // これを実質的なminZoomとして採用することで、「85%までしか縮小できず全体が見えない」
  // 問題を解消する。ウィンドウリサイズのたびに呼び直す。
  function computeFitZoom() {
    const worldWidth = map.width * camera.cellSize;
    const worldHeight = map.height * camera.cellSize;
    const fit = Math.min(camera.viewportWidth / worldWidth, camera.viewportHeight / worldHeight);
    return Math.max(0.06, fit * 0.94); // 少し余白を残す
  }
  function applyDynamicMinZoom() {
    camera.minZoom = Math.min(CONFIG.minZoom, computeFitZoom());
  }
  applyDynamicMinZoom();

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

  // マウスドラッグ/ホイールでのズームには使わない、演出専用のなめらかなカメラ移動。
  // { x, y }は移動先の左上ワールド座標、zoomは目標倍率。どちらも省略可。
  function animateCamera({ x, y, zoom } = {}, duration = 650) {
    return new Promise((resolve) => {
      const startX = camera.x;
      const startY = camera.y;
      const startZoom = camera.zoom;
      const endZoom = zoom == null ? startZoom : camera.clampZoom(zoom);
      const endX = x == null ? startX : x;
      const endY = y == null ? startY : y;
      const startTime = performance.now();
      function step(now) {
        const t = Math.min(1, (now - startTime) / duration);
        const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        camera.zoom = startZoom + (endZoom - startZoom) * eased;
        camera.x = startX + (endX - startX) * eased;
        camera.y = startY + (endY - startY) * eased;
        camera.clampToBounds();
        updateCameraOnly();
        if (t < 1) {
          requestAnimationFrame(step);
        } else {
          resolve();
        }
      }
      requestAnimationFrame(step);
    });
  }

  // 指定したワールド座標(worldX, worldY)が画面中央に来るような、目標zoomでのカメラ位置を計算する。
  function cameraTopLeftToCenterOn(worldX, worldY, zoom) {
    return {
      x: worldX - camera.viewportWidth / (2 * zoom),
      y: worldY - camera.viewportHeight / (2 * zoom)
    };
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
  let pendingStatPulse = false;
  let confirmRemoveGoalId = null;
  let confirmRemoveTimer = null;

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
    const renderState = {
      ...state,
      eventCatalog: events,
      evaluatedBadges,
      shopItems: core.shop.items,
      goalsView,
      logExpanded,
      confirmRemoveGoalId,
      selectedAssetId: placement.selectedAssetId
    };

    const view = renderer.render(renderState);
    setHTML('statusPanel', view.statusHtml);
    setHTML('eventLog', view.logHtml);
    setHTML('badgePanel', view.badgeHtml);
    
    // ドロワー内のカテゴリタブとアイテム一覧
    if (view.shopHtml) {
      setHTML('drawerCategoryTabs', view.shopHtml.tabsHtml);
      setHTML('drawerItemList', view.shopHtml.itemsHtml);
    }
    setText('drawerPersonalValue', `${Math.floor(state.personalPoints || 0)}`);

    // 配置中バナーの表示・更新
    const placingBanner = byId('placingBanner');
    if (placingBanner) {
      if (placement.selectedAssetId) {
        const selAsset = placement.getSelectedAsset();
        const iconEl = byId('placingBannerIcon');
        const textEl = byId('placingBannerText');
        if (iconEl && selAsset) {
          const visual = (typeof resolveVisual === 'function' ? resolveVisual(selAsset) : { image: selAsset.image });
          iconEl.style.backgroundImage = visual?.image ? `url('${visual.image}')` : 'none';
          iconEl.textContent = visual?.image ? '' : '🌱';
        }
        if (textEl && selAsset) {
          textEl.innerHTML = `<strong>${escapeHtml(selAsset.name || selAsset.id)}</strong> を配置中（森の好きなマスをタップしてね）`;
        }
        placingBanner.style.display = 'flex';
      } else {
        placingBanner.style.display = 'none';
      }
    }

    // FABボタンの所持アイテム総数バッジ
    const totalOwnedItems = Object.values(state.assetQuantities || {}).reduce((sum, q) => sum + (Number(q) || 0), 0);
    const fabBadge = byId('itemDrawerBadge');
    if (fabBadge) {
      if (totalOwnedItems > 0) {
        fabBadge.textContent = totalOwnedItems;
        fabBadge.style.display = 'inline-block';
      } else {
        fabBadge.style.display = 'none';
      }
    }

    setHTML('goalPanel', view.goalHtml);
    setHTML('classPowerPanel', view.classPowerHtml);
    setText('progressPercentValue', `${Math.floor(core.getProgressPercent())}%`);
    const progressFillEl = byId('progressBarFill');
    if (progressFillEl) progressFillEl.style.width = `${core.getProgressPercent()}%`;
    setText('personalValue', `${Math.floor(state.personalPoints || 0)}`);
    setText('seasonValue', getSeasonLabel(state.settings?.season || 'spring'));
    if (pendingStatPulse) {
      pendingStatPulse = false;
      pulse('personalValue');
      pulse('progressPercentValue');
    }
    const seasonOverlay = byId('seasonOverlay');
    if (seasonOverlay) seasonOverlay.dataset.season = state.settings?.season || 'spring';
    setText('zoomValue', `${Math.round(camera.zoom * 100)}%`);
    setText('spotModeValue', placement.mode === 'place' ? '配置' : '移動');
    // アセットの枠は廃止し、ショップで買ったものをそのまま配置するので、
    // 「いま何を配置中か／残り何個か」はショップパネルの上に小さく出す。
    const selectedAsset = placement.getSelectedAsset();
    const placingHost = byId('placingIndicator');
    if (placingHost) {
      if (selectedAsset) {
        const qty = core.getAssetQuantity(selectedAsset.id);
        placingHost.style.display = '';
        setText('placingIndicatorName', `${selectedAsset.name || selectedAsset.id} を配置中`);
        setText('placingIndicatorMeta', qty > 0 ? `のこり ${qty}こ・森をタップして置いてね` : '在庫がありません');
      } else {
        placingHost.style.display = 'none';
      }
    }
    setText('ownedCount', `${(state.ownedAssets || []).length}`);
    setText('placedCount', `${(state.placedAssets || []).length}`);
    updateThanksOptions(state.classmates || []);

    // エンディング演出が表示中に先生が「次の森を解放する」を押した場合にも、
    // 20秒周期の同期(classSync)からrefresh()経由でボタンの表示が追いつくようにする。
    const endingHost = byId('endingHost');
    if (endingHost && endingHost.style.display !== 'none') updateEndingReleaseState();
  }

  // クラス未接続(ソロプレイ)では送る相手がそもそも存在しないため、
  // 「だれに送る？」しか選べない空のフォームを出し続けるのではなく、
  // 「クラスとつながると使える」ことが伝わるロック表示に切り替える。
  function updateThanksOptions(classmates) {
    const form = byId('thanksForm');
    const lockedMessage = byId('thanksLockedMessage');
    const isConnected = classSync.isConfigured();
    if (form) form.style.display = isConnected ? '' : 'none';
    if (lockedMessage) lockedMessage.style.display = isConnected ? 'none' : '';
    if (!isConnected) return;

    const select = byId('thanksNameSelect');
    if (!select) return;
    const current = select.value;
    const optionsHtml = ['<option value="">だれに送る？</option>']
      .concat(classmates.map((name) => `<option value="${name}">${name}さん</option>`));
    select.innerHTML = optionsHtml.join('');
    if (classmates.includes(current)) select.value = current;
  }

  // ---- マイルストーン(イベント/バッジ)演出 ----
  // 「何かが起きたら、拡大してメッセージを出す」ための、1件ずつ順番に見せるキュー。
  // 同時に複数のイベント/バッジが達成されても(デモ再生でよく起こる)、
  // 一つずつカメラをズームインしながら見せるので、何が起きたか追いやすい。
  const milestoneQueue = [];
  let milestoneBusy = false;
  // 100%到達(森の完成)を検知したら、通常のイベント/バッジ演出が全部終わった後に
  // エンディングモーダルを開く。ここに積んでおいて、キューが空になったタイミングで消費する。
  let pendingForestCompletion = null;

  function wait(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function showBanner({ icon, title, message, rewardText, contributorText }) {
    const host = byId('milestoneHost');
    if (!host) return null;
    host.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'milestone-banner';
    const iconEl = document.createElement('div');
    iconEl.className = 'milestone-banner__icon';
    iconEl.textContent = icon || '✨';
    card.appendChild(iconEl);
    const titleEl = document.createElement('div');
    titleEl.className = 'milestone-banner__title';
    titleEl.textContent = title || '';
    card.appendChild(titleEl);
    if (message) {
      const msgEl = document.createElement('div');
      msgEl.className = 'milestone-banner__message';
      msgEl.textContent = message;
      card.appendChild(msgEl);
    }
    if (rewardText) {
      const rewardEl = document.createElement('div');
      rewardEl.className = 'milestone-banner__reward';
      rewardEl.textContent = rewardText;
      card.appendChild(rewardEl);
    }
    // クラス協力の意味づけ強化(v22): このイベントが起きる「最後のひと押し」が
    // 誰の行動だったかを添える。分かるときだけ表示する(不明ならcontributorTextがnull)。
    if (contributorText) {
      const contribEl = document.createElement('div');
      contribEl.className = 'milestone-banner__contributor';
      contribEl.textContent = contributorText;
      card.appendChild(contribEl);
    }
    host.appendChild(card);
    requestAnimationFrame(() => card.classList.add('is-visible'));
    return card;
  }

  // eventSummary.contributor(ニックネーム、または自分の場合はidentity.nicknameと一致)から
  // バナーに出す文言を組み立てる。分からなければnull(バナーには何も足さない)。
  function contributorLabel(contributor) {
    if (!contributor) return null;
    const myNickname = core.identity?.nickname;
    if (myNickname && contributor === myNickname) return '🙌 最後のひと押しは、あなたでした！';
    return `🙌 最後のひと押しは、${contributor}さんでした！`;
  }

  function hideBanner(card) {
    if (!card) return;
    card.classList.remove('is-visible');
    window.setTimeout(() => card.remove(), 320);
  }

  // 森に置かれている花などをタップしたときの「だれが/いつ/どんな目標をクリアして」ポップアップ。
  function formatPlacedAt(iso) {
    if (!iso) return '記録なし';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '記録なし';
    return d.toLocaleString('ja-JP', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function showPlacedInfoPopup(placedId) {
    const info = core.getPlacedAssetInfo(placedId);
    const host = byId('placedInfoHost');
    if (!info || !host) return;
    const { asset, nickname, goalTitle, createdAt } = info;
    setText('placedInfoEmoji', asset?.emoji || '🌱');
    setText('placedInfoName', asset?.name || info.item.assetId);
    setText('placedInfoWho', `${nickname}が置いたよ`);
    setText('placedInfoWhen', formatPlacedAt(createdAt));
    setText('placedInfoGoal', goalTitle ? `「${goalTitle}」をクリアしたよ` : 'とくに目標はなく、自由に置いたよ');
    host.style.display = 'block';
    requestAnimationFrame(() => host.classList.add('is-visible'));
  }

  function hidePlacedInfoPopup() {
    const host = byId('placedInfoHost');
    if (!host) return;
    host.classList.remove('is-visible');
    window.setTimeout(() => { host.style.display = 'none'; }, 220);
  }

  // window.confirm()は、環境によって(タブレットの管理者設定・アプリ内ブラウザ等)
  // ダイアログ自体が出ずに即false扱いになることがあり、その場合「ボタンを押しても
  // 何も起きない」ように見えてしまう。ブラウザ標準ダイアログに頼らず、アプリ内の
  // カード(#confirmHost)で同じ役割を果たす。Promise<boolean>を返すのでawaitして使う。
  function showConfirm(message) {
    return new Promise((resolve) => {
      const host = byId('confirmHost');
      if (!host) {
        resolve(true);
        return;
      }
      setText('confirmMessage', message);
      host.style.display = 'block';
      requestAnimationFrame(() => host.classList.add('is-visible'));

      function cleanup(result) {
        host.classList.remove('is-visible');
        window.setTimeout(() => { host.style.display = 'none'; }, 220);
        byId('confirmYes')?.removeEventListener('click', onYes);
        byId('confirmNo')?.removeEventListener('click', onNo);
        byId('confirmBackdrop')?.removeEventListener('click', onNo);
        resolve(result);
      }
      function onYes() { cleanup(true); }
      function onNo() { cleanup(false); }

      byId('confirmYes')?.addEventListener('click', onYes);
      byId('confirmNo')?.addEventListener('click', onNo);
      byId('confirmBackdrop')?.addEventListener('click', onNo);
    });
  }

  // ---- 起動画面ポップアップ(連続ログイン・きのうの出来事・はげまし) ----
  function showWelcomePopup() {
    const host = byId('welcomeHost');
    if (!host) return;
    const summary = core.getDailySummary();
    setText('welcomeStreak', summary.streak >= 2 ? `🔥 ${summary.streak}日連続で来てくれたね` : 'ようこそ、コツコツの森へ');
    setText('welcomeProgress', `森の進み具合: ${Math.floor(summary.progressPercent)}%（${summary.forestGeneration}代目）`);
    setText('welcomeEncouragement', summary.encouragement);
    // イベント通知(前回の起動からのできごと)があればそちらを優先表示する。
    // クラス共有プレイでは自分が見ていない間に他の子の行動で進んだ分もここに含まれる。
    const hasEventNotifications = summary.eventNotificationCount > 0;
    setText('welcomeHighlightsTitle', hasEventNotifications ? 'あたらしいできごと' : 'きのうのできごと');
    const highlightSource = hasEventNotifications ? summary.eventNotifications : summary.yesterdayHighlights;
    const highlightsHtml = highlightSource.length
      ? highlightSource.map((m) => `<li>${escapeHtml(m)}</li>`).join('')
      : '<li>きのうはお休みだったみたい。今日からまたコツコツいこう</li>';
    setHTML('welcomeHighlights', highlightsHtml);
    setText('welcomeUnread', summary.unreadCount > 0 ? `🧡 とどいている「ありがとう」が ${summary.unreadCount} 件あるよ` : '');
    host.style.display = 'block';
    requestAnimationFrame(() => host.classList.add('is-visible'));
  }

  function hideWelcomePopup() {
    const host = byId('welcomeHost');
    if (!host) return;
    host.classList.remove('is-visible');
    window.setTimeout(() => { host.style.display = 'none'; }, 220);
  }

  // ---- エンディング(森の完成)演出: 「動画っぽい振り返り」 ----
  // Instagram/メルカリのストーリーのように、タイトル→日ごとのできごと→統計→
  // 締めくくり、の順にスライドを自動再生する。タップで前後移動、一時停止も可能。
  // 文字だけで確認したい/読むのに時間がかかる子のために、静的な一覧表示も残す。
  let storySlides = [];
  let storyIndex = 0;
  let storyTimer = null;
  let storyPaused = false;
  let storyPausedBeforeText = false;

  function groupTimelineByDate(timeline) {
    const groups = [];
    const map = new Map();
    for (const entry of Array.isArray(timeline) ? timeline : []) {
      const dateLabel = formatEndingDate(entry.at) || '記録なし';
      if (!map.has(dateLabel)) {
        const group = { dateLabel, entries: [] };
        map.set(dateLabel, group);
        groups.push(group);
      }
      map.get(dateLabel).entries.push(entry);
    }
    return groups;
  }

  // 日数が多いときは全部見せず、はじめ・なか・おわりから均等に選んで
  // 「ハイライト」にする(動画のダイジェストに近い感覚にするため)。
  function pickHighlightGroups(groups, max) {
    if (groups.length <= max) return groups;
    const picked = new Set();
    const step = (groups.length - 1) / (max - 1);
    for (let i = 0; i < max; i++) picked.add(groups[Math.round(i * step)]);
    return groups.filter((g) => picked.has(g));
  }

  function buildEndingStorySlides(summary) {
    const slides = [];
    const dateRange = `${formatEndingDate(summary.startedAt)} 〜 ${formatEndingDate(summary.completedAt)}`;

    slides.push({
      duration: 2600,
      render: () => `
        <div class="story-slide story-slide--title">
          <div class="story-slide__emoji">🎉</div>
          <h3>${summary.generation}代目の森が完成！</h3>
          <p>${escapeHtml(dateRange)}</p>
        </div>
      `
    });

    const groups = groupTimelineByDate(summary.timeline);
    const highlightGroups = pickHighlightGroups(groups, 6);
    const overflowCount = groups.length - highlightGroups.length;

    highlightGroups.forEach((group, i) => {
      const isLast = i === highlightGroups.length - 1;
      slides.push({
        duration: Math.min(4200, 1800 + group.entries.length * 500),
        render: () => `
          <div class="story-slide story-slide--day">
            <time>${escapeHtml(group.dateLabel)}</time>
            <ul>
              ${group.entries.map((e) => `<li>${escapeHtml(e.icon || '🌲')} ${escapeHtml(e.message)}</li>`).join('')}
            </ul>
            ${isLast && overflowCount > 0 ? `<p class="story-slide__note">ほかにも${overflowCount}日ぶん、みんなでコツコツ育てました</p>` : ''}
          </div>
        `
      });
    });

    slides.push({
      duration: 3400,
      countUp: true,
      render: () => `
        <div class="story-slide story-slide--stats">
          <h3>みんなで育てた記録</h3>
          <div class="story-stat"><span class="story-stat__label">クラスポイント</span><strong data-count-to="${Math.floor(summary.classPoints)}">0</strong></div>
          <div class="story-stat"><span class="story-stat__label">置いたもの</span><strong data-count-to="${summary.placedCount}">0</strong></div>
          <div class="story-stat"><span class="story-stat__label">起きたできごと</span><strong data-count-to="${summary.eventCount}">0</strong></div>
          <div class="story-stat"><span class="story-stat__label">獲得バッジ</span><strong data-count-to="${summary.badgeCount}">0</strong></div>
        </div>
      `
    });

    slides.push({
      duration: 0,
      isFinal: true,
      render: () => `
        <div class="story-slide story-slide--final">
          <div class="story-slide__emoji">🌳</div>
          <h3>今日もコツコツ、ありがとう！</h3>
          <p>下のボタンから、このまま見るか、新しい森をはじめよう。</p>
        </div>
      `
    });

    return slides;
  }

  function runStoryCountUp() {
    document.querySelectorAll('#endingStorySlide [data-count-to]').forEach((el) => {
      const target = Number(el.dataset.countTo) || 0;
      const start = performance.now();
      const duration = 900;
      function step(now) {
        const t = Math.min(1, (now - start) / duration);
        el.textContent = `${Math.floor(target * t)}`;
        if (t < 1) requestAnimationFrame(step);
        else el.textContent = `${target}`;
      }
      requestAnimationFrame(step);
    });
  }

  function renderStoryProgress() {
    const host = byId('endingStoryProgress');
    if (!host) return;
    host.innerHTML = storySlides.map((slide, i) => {
      const cls = i < storyIndex ? 'is-done' : i === storyIndex ? (slide.isFinal ? 'is-current is-final' : 'is-current') : '';
      const style = i === storyIndex && slide.duration ? ` style="--story-duration:${slide.duration}ms"` : '';
      return `<span class="story-progress__seg ${cls}"${style}><span class="story-progress__fill"></span></span>`;
    }).join('');
    host.classList.toggle('is-paused', storyPaused);
  }

  function scheduleStoryAdvance() {
    window.clearTimeout(storyTimer);
    const slide = storySlides[storyIndex];
    if (!slide || slide.isFinal || storyPaused || !slide.duration) return;
    storyTimer = window.setTimeout(() => goToStorySlide(storyIndex + 1), slide.duration);
  }

  function renderStorySlide() {
    const slide = storySlides[storyIndex];
    if (!slide) return;
    setHTML('endingStorySlide', slide.render());
    if (slide.countUp) runStoryCountUp();
    renderStoryProgress();
    scheduleStoryAdvance();
    setText('endingStoryPlayPause', storyPaused ? '▶' : '⏸');
    // 最後のスライドまで来たら、映像優先の小さな字幕表示から
    // 統計・年表・ボタンが見える通常のカード表示へ切り替える。
    if (slide.isFinal) {
      const host = byId('endingHost');
      if (host) host.classList.add('is-expanded');
    }
  }

  function goToStorySlide(index) {
    if (!storySlides.length) return;
    storyIndex = Math.max(0, Math.min(storySlides.length - 1, index));
    renderStorySlide();
  }

  function toggleStoryPause(forcePause) {
    storyPaused = forcePause !== undefined ? forcePause : !storyPaused;
    const host = byId('endingStoryProgress');
    if (host) host.classList.toggle('is-paused', storyPaused);
    setText('endingStoryPlayPause', storyPaused ? '▶' : '⏸');
    window.clearTimeout(storyTimer);
    if (!storyPaused) scheduleStoryAdvance();
  }

  bindButton('endingStoryPlayPause', () => toggleStoryPause());
  bindButton('endingStoryPrev', () => goToStorySlide(storyIndex - 1));
  bindButton('endingStoryNext', () => goToStorySlide(storyIndex + 1));
  bindButton('endingStoryToggleText', () => {
    const details = byId('endingDetails');
    const btn = byId('endingStoryToggleText');
    const host = byId('endingHost');
    if (!details) return;
    const opening = details.style.display === 'none' || !details.style.display;
    if (opening) {
      storyPausedBeforeText = storyPaused;
      toggleStoryPause(true);
      details.style.display = 'block';
      if (btn) btn.textContent = 'スライドにもどる';
      if (host) host.classList.add('is-expanded');
    } else {
      details.style.display = 'none';
      toggleStoryPause(storyPausedBeforeText);
      if (btn) btn.textContent = '文字でまとめて見る';
      // 最後のスライドまで進んでいれば展開表示のままにする(見出し等が消えないように)
      if (host && !storySlides[storyIndex]?.isFinal) host.classList.remove('is-expanded');
    }
  });

  // ---- エンディング(森の完成)演出 ----
  function formatEndingDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('ja-JP', { month: 'long', day: 'numeric' });
  }

  // 先生の解放待ち(v23)なら「新しい森をはじめる」ボタンを隠し、待機メッセージを出す。
  // クラス未接続(ローカル単独)のときは常にボタンを出す。
  function updateEndingReleaseState() {
    const newForestBtn = byId('endingNewForest');
    const waitingNote = byId('endingWaitingForTeacher');
    const state = core.getState();
    const waiting = Boolean(state.classInfo?.classCode) && !state.nextForestUnlocked;
    if (newForestBtn) newForestBtn.style.display = waiting ? 'none' : '';
    if (waitingNote) waitingNote.style.display = waiting ? 'block' : 'none';
  }

  function showEndingModal(summary) {
    const host = byId('endingHost');
    if (!host || !summary) return;
    setText('endingGeneration', `${summary.generation}代目の森（${formatEndingDate(summary.startedAt)}〜${formatEndingDate(summary.completedAt)}）`);
    setText('endingPoints', `${Math.floor(summary.classPoints)} / ${Math.floor(summary.clearPoint)}`);
    setText('endingPlaced', `${summary.placedCount}`);
    setText('endingEvents', `${summary.eventCount}`);
    setText('endingBadges', `${summary.badgeCount}`);
    setHTML('endingTimeline', buildEndingTimelineHtml(summary.timeline));
    updateEndingReleaseState();

    const details = byId('endingDetails');
    if (details) details.style.display = 'none';
    const toggleBtn = byId('endingStoryToggleText');
    if (toggleBtn) toggleBtn.textContent = '文字でまとめて見る';

    // 演出は毎回、映像(カメラ演出)優先の小さな字幕表示からスタートする。
    host.classList.remove('is-expanded');

    storySlides = buildEndingStorySlides(summary);
    storyIndex = 0;
    storyPaused = false;
    renderStorySlide();

    host.style.display = 'block';
    requestAnimationFrame(() => host.classList.add('is-visible'));
  }

  // 「森の年表」を日付ごとにまとめ、種別アイコンを添えて密度を出す。
  // 1件ずつ横に並べるより、メルカリ風の「その日なにが起きたか」のまとまりに近づける。
  function buildEndingTimelineHtml(timeline) {
    const entries = Array.isArray(timeline) ? timeline : [];
    if (!entries.length) return '<li>記録が見つかりませんでした</li>';

    const groups = new Map();
    for (const entry of entries) {
      const dateLabel = formatEndingDate(entry.at) || '記録なし';
      if (!groups.has(dateLabel)) groups.set(dateLabel, []);
      groups.get(dateLabel).push(entry);
    }

    return [...groups.entries()].map(([dateLabel, dayEntries]) => `
      <li class="ending-card__timeline-day">
        <time>${escapeHtml(dateLabel)}</time>
        <ul class="ending-card__timeline-items">
          ${dayEntries.map((entry) => `<li>${escapeHtml(entry.icon || '🌲')} ${escapeHtml(entry.message)}</li>`).join('')}
        </ul>
      </li>
    `).join('');
  }

  function hideEndingModal() {
    const host = byId('endingHost');
    if (!host) return;
    window.clearTimeout(storyTimer);
    host.classList.remove('is-visible');
    window.setTimeout(() => { host.style.display = 'none'; }, 260);
  }

  // 森の完成を検知したら、カメラを引いて全景を見せてからエンディングモーダルを開く。
  async function showEndingSequence(summary) {
    const fitZoom = computeFitZoom();
    const center = cameraTopLeftToCenterOn(
      (map.width * camera.cellSize) / 2,
      (map.height * camera.cellSize) / 2,
      fitZoom
    );
    await animateCamera({ x: center.x, y: center.y, zoom: fitZoom }, 900);
    playEffect('rainbow');
    if (core.getState().settings?.sfx) audio.beep(880, 0.12);
    await wait(400);
    showEndingModal(summary);
  }

  async function presentMilestone(item) {
    const prevX = camera.x;
    const prevY = camera.y;
    const prevZoom = camera.zoom;
    const targetZoom = camera.clampZoom(Math.max(camera.zoom, 1.0) * 1.15);

    let targetPos;
    if (item.focus) {
      const worldX = item.focus.x * camera.cellSize + camera.cellSize / 2;
      const worldY = item.focus.y * camera.cellSize + camera.cellSize / 2;
      targetPos = cameraTopLeftToCenterOn(worldX, worldY, targetZoom);
    } else {
      const centerWorldX = camera.x + camera.viewportWidth / (2 * camera.zoom);
      const centerWorldY = camera.y + camera.viewportHeight / (2 * camera.zoom);
      targetPos = cameraTopLeftToCenterOn(centerWorldX, centerWorldY, targetZoom);
    }

    await animateCamera({ x: targetPos.x, y: targetPos.y, zoom: targetZoom }, 550);
    const card = showBanner({ ...item, contributorText: item.kind === 'event' ? contributorLabel(item.contributor) : null });
    if (item.effect) playEffect(item.effect);
    if (core.getState().settings?.sfx) {
      audio.beep(item.kind === 'badge' ? 660 : 520, 0.06);
    }
    await wait(1900);
    hideBanner(card);
    await animateCamera({ x: prevX, y: prevY, zoom: prevZoom }, 500);
  }

  async function processMilestoneQueue() {
    milestoneBusy = true;
    while (milestoneQueue.length) {
      const item = milestoneQueue.shift();
      await presentMilestone(item);
    }
    if (pendingForestCompletion) {
      const completion = pendingForestCompletion;
      pendingForestCompletion = null;
      await showEndingSequence(completion);
    }
    milestoneBusy = false;
  }

  function announceMilestones() {
    const summary = core.consumeMilestoneSummary();
    if (!summary) return;

    for (const ev of summary.newEvents || []) {
      milestoneQueue.push({
        kind: 'event',
        icon: '🌲',
        title: ev.title,
        message: ev.message,
        effect: ev.effect,
        focus: ev.focus || null,
        contributor: ev.contributor || null
      });
    }

    for (const badge of summary.newBadges || []) {
      const rewardParts = [];
      if (badge.reward?.points) rewardParts.push(`+${badge.reward.points}ポイント`);
      if (badge.reward?.items) {
        for (const [key, value] of Object.entries(badge.reward.items)) {
          rewardParts.push(`${key}×${value}`);
        }
      }
      milestoneQueue.push({
        kind: 'badge',
        icon: '🏅',
        title: `バッジ獲得: ${badge.name}`,
        message: badge.description,
        rewardText: rewardParts.length ? rewardParts.join(' / ') : null
      });
    }

    // 頻度が高いもの(カテゴリ解放・仲間の出現)は大演出にすると煩わしいので軽いトーストのままにする
    const spawnNames = Array.isArray(summary.autoSpawned)
      ? summary.autoSpawned.map((s) => assets.find((a) => a.id === s.assetId)?.name || s.assetId)
      : [];
    // 「木」「岩」などの自動配置(v24)も同じ軽いトーストで伝え、サーバーにも共有する
    // (置いたのは児童ではないので、手動配置と同じ pushPlaceAsset で個別に送る)。
    if (Array.isArray(summary.autoPlaced) && summary.autoPlaced.length) {
      for (const placedItem of summary.autoPlaced) {
        spawnNames.push(assets.find((a) => a.id === placedItem.assetId)?.name || placedItem.assetId);
        classSync.pushPlaceAsset({
          placedId: placedItem.placedId,
          assetId: placedItem.assetId, spotId: placedItem.spotId, x: placedItem.x, y: placedItem.y,
          goalId: null, goalTitle: null
        });
      }
    }
    const categoryText = Array.isArray(summary.newCategories) && summary.newCategories.length
      ? `新しいジャンル解放: ${summary.newCategories.map((c) => CATEGORY_LABELS[c.category] || c.category).join(' / ')}`
      : null;
    const spawnText = spawnNames.length ? `新しい仲間: ${spawnNames.join(' / ')}` : null;
    const lightCombined = [categoryText, spawnText].filter(Boolean).join(' | ');
    if (lightCombined) toast(lightCombined);

    if (summary.forestCompleted) {
      pendingForestCompletion = summary.forestCompleted;
      // 20秒周期のpull()を待たず、完成した瞬間にクラス全体へ伝える。
      classSync.pushForestCompleted();
    }

    if ((milestoneQueue.length || pendingForestCompletion) && !milestoneBusy) {
      processMilestoneQueue();
    }
  }

  // (v25) 森が始まった瞬間(または新しい代が始まった瞬間)に、中心に植えたばかりの
  // シンボルツリーへ1回だけズームインして紹介する。presentMilestone()の
  // ズームイン→バナー表示→ズームアウトの仕組みをそのまま流用する。
  function maybeShowSymbolTreeIntro() {
    if (!core.shouldShowSymbolTreeIntro()) return;
    const spot = (spots || []).find((s) => s.id === 'symbolTreeSpot');
    if (!spot) return;
    milestoneQueue.push({
      kind: 'event',
      icon: '🌱',
      title: '森のはじまり',
      message: 'まんなかに、この森のシンボルツリーになる苗木を植えたよ。がんばるほど、少しずつ大きく育っていくよ',
      effect: 'grow',
      focus: { x: spot.x, y: spot.y }
    });
    core.markSymbolTreeIntroShown();
    if (!milestoneBusy) processMilestoneQueue();
  }

  function announceNotifications() {
    const unread = core.consumeNotifications();
    for (const notification of unread) {
      if (notification.type === 'goal_approved') {
        // 承認制モードでの「達成」の瞬間。自己承認モードの celebrate と
        // 体験を揃える(先生の承認を待った子が損をした気にならないように)。
        toast(`✅ ${notification.message}${notification.points ? ` +${notification.points}ポイント` : ''}`, 'toast--special');
        if (core.getState().settings?.sfx) audio.chime();
        const anchor = byId('progressPercentValue') || byId('personalValue');
        if (anchor) spawnCelebration(anchor, notification.points);
        pendingStatPulse = true;
        continue;
      }
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
    onToast: toast,
    onPlace: (placed) => {
      if (!placed) return;
      audio.playPlace();
      classSync.pushPlaceAsset({
        placedId: placed.placedId,
        assetId: placed.assetId, spotId: placed.spotId, x: placed.x, y: placed.y,
        goalId: placed.goalId, goalTitle: placed.goalTitle
      });
      firebaseSync.pushPlaceAsset({
        placedId: placed.placedId,
        assetId: placed.assetId, spotId: placed.spotId, x: placed.x, y: placed.y,
        goalId: placed.goalId, goalTitle: placed.goalTitle
      });
      // 買った分の在庫を使い切ったら、置けるものが無いままモードだけ残らないよう自動解除する。
      if (core.getAssetQuantity(placed.assetId) <= 0) {
        placement.clearSelection();
      }
    },
    onPlacedInfo: (placedId) => showPlacedInfoPopup(placedId)
  });

  function resize() {
    camera.setViewport(viewportEl.clientWidth, viewportEl.clientHeight);
    applyDynamicMinZoom();
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

  async function resetNow() {
    if (!(await showConfirm('森の保存データをリセットしますか？'))) return;
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
  bindButton('btnFitView', () => {
    const fitZoom = computeFitZoom();
    const center = cameraTopLeftToCenterOn(
      (map.width * camera.cellSize) / 2,
      (map.height * camera.cellSize) / 2,
      fitZoom
    );
    animateCamera({ x: center.x, y: center.y, zoom: fitZoom }, 550);
  });

  bindButton('btnSeasonSpring', () => { core.setSeason('spring'); refresh(); });
  bindButton('btnSeasonSummer', () => { core.setSeason('summer'); refresh(); });
  bindButton('btnSeasonAutumn', () => { core.setSeason('autumn'); refresh(); });
  bindButton('btnSeasonWinter', () => { core.setSeason('winter'); refresh(); });

  function updateClassSyncStatus() {
    const bar = byId('classConnectBar');
    const isConnected = firebaseSync.isConfigured() || classSync.isConfigured();
    if (bar) bar.style.display = isConnected ? 'none' : 'flex';
  }

  // ---- かんたん表示(低学年・支援級向けに、サイドパネルを1枚ずつに絞る) ----
  const TAB_IDS = ['goals', 'thanks', 'classpower', 'badges'];
  let activeTab = TAB_IDS[0];

  function applySimpleMode() {
    const simpleMode = Boolean(core.getState().settings?.simpleMode);
    const shell = byId('app');
    if (shell) shell.classList.toggle('app-shell--simple', simpleMode);
    const toggleBtn = byId('simpleModeToggle');
    if (toggleBtn) toggleBtn.textContent = simpleMode ? 'ぜんぶ表示' : 'かんたん表示';
    if (!simpleMode) return;

    document.querySelectorAll('.sidebar .panel[data-tab]').forEach((panel) => {
      panel.classList.toggle('is-active-tab', panel.dataset.tab === activeTab);
    });
    document.querySelectorAll('.panel-tabs__btn').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.tabTarget === activeTab);
    });
  }

  bindButton('simpleModeToggle', () => {
    const state = core.getState();
    state.settings = state.settings || {};
    state.settings.simpleMode = !state.settings.simpleMode;
    core.persist();
    applySimpleMode();
  });

  // ---- ふりがな(既定オン。漢字がまだ読めない学年の子でも迷わないように) ----
  function applyFurigana() {
    const state = core.getState();
    const on = state.settings?.furigana !== false;
    const shell = byId('app');
    if (shell) shell.classList.toggle('furigana-on', on);
    const toggleBtn = byId('furiganaToggle');
    if (toggleBtn) toggleBtn.textContent = on ? 'ふりがな消す' : 'ふりがな';
  }

  bindButton('furiganaToggle', () => {
    const state = core.getState();
    state.settings = state.settings || {};
    state.settings.furigana = state.settings.furigana === false; // 現在offならon、それ以外はoff
    core.persist();
    applyFurigana();
  });

  applyFurigana();

  document.addEventListener('click', (event) => {
    const tabBtn = event.target.closest?.('[data-tab-target]');
    if (!tabBtn) return;
    activeTab = tabBtn.dataset.tabTarget;
    applySimpleMode();
  });

  applySimpleMode();

  document.addEventListener('submit', async (event) => {
    const form = event.target.closest?.('#classConnectForm');
    if (!form) return;
    event.preventDefault();
    const classCode = (byId('classCodeFieldInput')?.value || '').trim();
    const nickname = (byId('classNicknameInput')?.value || '').trim();
    if (!classCode || !nickname) return;

    let connected = false;
    let studentId = null;

    // (1) Firebase Firestore に接続
    if (firebaseClient.isReady()) {
      const fbRes = await firebaseSync.joinClass({ classCode, nickname });
      if (fbRes.ok) {
        connected = true;
        studentId = fbRes.data.studentId;
      }
    }

    // (2) GAS にも接続（設定されている場合）
    if (CONFIG.gasBaseUrl) {
      classSync.joinExistingClass({ baseUrl: CONFIG.gasBaseUrl, classCode, nickname }).then((result) => {
        if (result.ok) {
          classSync.startAutoSync();
        }
      });
    }

    if (connected || classSync.isConfigured()) {
      toast(`クラスに入りました（${classCode}）`);
      core.setIdentity({ studentId: studentId || classSync.info?.studentId, nickname });
      updateClassSyncStatus();
      refresh();
    } else {
      toast('入れませんでした。接続設定を確認してください');
    }
  });

  document.addEventListener('click', (event) => {
    if (event.target.closest?.('#placedInfoClose') || event.target.closest?.('#placedInfoBackdrop')) {
      hidePlacedInfoPopup();
    }
    if (event.target.closest?.('#welcomeClose') || event.target.closest?.('#welcomeBackdrop') || event.target.closest?.('#welcomeStart')) {
      hideWelcomePopup();
    }
    if (event.target.closest?.('#endingClose')) {
      hideEndingModal();
    }
    if (event.target.closest?.('#endingNewForest')) {
      showConfirm('今の森はそのまま「過去の森」として残ります。新しい森をはじめますか？').then((confirmed) => {
        if (!confirmed) return;
        const result = core.startNewForest();
        if (result.ok) {
          hideEndingModal();
          camera.zoom = 1;
          camera.centerOnCell(map.width / 2, map.height / 2);
          camera.clampToBounds();
          toast(`🌱 ${result.generation}代目の森がはじまりました`);
          refresh();
          maybeShowSymbolTreeIntro();
          // クラス共有プレイなら、みんなでも同じ次代へ進めるようにサーバー側にも伝える。
          firebaseSync.pushStartNewForest();
          classSync.pushStartNewForest();
        } else if (result.reason === 'waiting_for_teacher') {
          toast('先生が「次の森」を解放するまで、少し待ってね');
          updateEndingReleaseState();
        } else {
          toast('新しい森を始められませんでした');
        }
      });
    }
  });

  updateClassSyncStatus();
  if (firebaseSync.isConfigured()) {
    firebaseSync.startListening();
  }
  if (classSync.isConfigured()) {
    classSync.startAutoSync();
  }

  bindButton('btnExport', () => {
    downloadText('kokotsu_forest_save.json', JSON.stringify(core.getState(), null, 2));
    toast('保存データを書き出しました');
  });

  // ---- たね・もちもの ドロワー制御 ----
  let isItemDrawerOpen = false;

  function openItemDrawer() {
    isItemDrawerOpen = true;
    const host = byId('itemDrawerHost');
    if (host) host.style.display = 'flex';
    refresh();
  }

  function closeItemDrawer() {
    isItemDrawerOpen = false;
    const host = byId('itemDrawerHost');
    if (host) host.style.display = 'none';
  }

  function toggleItemDrawer() {
    if (isItemDrawerOpen) closeItemDrawer();
    else openItemDrawer();
  }

  bindButton('itemDrawerFab', () => toggleItemDrawer());
  bindButton('itemDrawerClose', () => closeItemDrawer());
  bindButton('itemDrawerBackdrop', () => closeItemDrawer());
  bindButton('panelTabShopBtn', () => openItemDrawer());
  bindButton('placingBannerCancel', () => {
    placement.clearSelection();
    toast('配置をキャンセルしました');
    refresh();
  });

  // ESCキーでドロワーまたは配置モードを解除
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (isItemDrawerOpen) closeItemDrawer();
      if (placement.selectedAssetId) {
        placement.clearSelection();
        toast('配置をキャンセルしました');
        refresh();
      }
    }
  });

  // ドロワー内カテゴリタブ切り替え
  document.addEventListener('click', (event) => {
    const tabBtn = event.target.closest?.('[data-drawer-category]');
    if (!tabBtn) return;
    const category = tabBtn.dataset.drawerCategory;
    renderer.setActiveShopCategory(category);
    refresh();
  });

  // ドロワー内アイテムのタップ選択（タップで選んで森をタップして置く）
  document.addEventListener('click', (event) => {
    const itemCard = event.target.closest?.('[data-drawer-item]');
    if (!itemCard) return;
    if (dragState.didDrag) {
      dragState.didDrag = false;
      return;
    }
    const assetId = itemCard.dataset.assetId;
    const itemId = itemCard.dataset.id;
    const unlocked = itemCard.dataset.unlocked === '1';
    const unlockProgress = itemCard.dataset.unlockProgress;
    const price = Number(itemCard.dataset.price || 0);
    const qty = Number(itemCard.dataset.qty || 0);
    const personalPoints = Number(core.getState().personalPoints || 0);

    if (!unlocked) {
      toast(`森の成長が ${unlockProgress}% になると解放されるよ！`);
      return;
    }

    if (qty <= 0 && personalPoints < price) {
      toast(`ポイントが足りないよ（あと ${price - personalPoints} P）`);
      return;
    }

    // 在庫がなくポイントがある場合は、選択した時点で1個入手して配置モードへ
    if (qty <= 0 && personalPoints >= price) {
      const buyRes = core.buy(itemId);
      if (!buyRes.ok) {
        toast('入手できませんでした');
        return;
      }
      firebaseSync.pushBuyItem({ itemId, assetId, itemName: itemCard.dataset.name, price });
      classSync.pushBuyItem({ itemId, assetId, itemName: itemCard.dataset.name, price });
      if (core.getState().settings?.sfx) audio.beep(720, 0.05);
    }

    placement.selectAsset(assetId);
    closeItemDrawer();
    const asset = assets.find((a) => a.id === assetId);
    toast(`「${asset?.name || assetId}」を選んだよ。森の好きなマスをタップしてね！`);
    refresh();
  });

  // ---- ドラッグ＆ドロップ（DnD: ポインター & タッチ対応） ----
  const dragState = {
    active: false,
    didDrag: false,
    item: null,
    startX: 0,
    startY: 0
  };

  const dragGhostEl = byId('dragGhost');
  const drawerEl = byId('itemDrawer');

  document.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 && event.pointerType !== 'touch') return;
    const itemCard = event.target.closest?.('[data-drawer-item]');
    if (!itemCard) return;
    const unlocked = itemCard.dataset.unlocked === '1';
    if (!unlocked) return;

    dragState.active = true;
    dragState.didDrag = false;
    dragState.startX = event.clientX;
    dragState.startY = event.clientY;
    dragState.item = {
      id: itemCard.dataset.id,
      assetId: itemCard.dataset.assetId,
      name: itemCard.dataset.name,
      image: itemCard.dataset.image,
      price: Number(itemCard.dataset.price || 0),
      qty: Number(itemCard.dataset.qty || 0)
    };
  });

  window.addEventListener('pointermove', (event) => {
    if (!dragState.active || !dragState.item) return;
    const dx = event.clientX - dragState.startX;
    const dy = event.clientY - dragState.startY;
    if (!dragState.didDrag && Math.hypot(dx, dy) > 6) {
      dragState.didDrag = true;
      if (dragGhostEl) {
        dragGhostEl.style.backgroundImage = `url('${dragState.item.image}')`;
        dragGhostEl.style.display = 'block';
      }
      if (drawerEl) drawerEl.style.opacity = '0.45';
    }

    if (dragState.didDrag) {
      if (dragGhostEl) {
        dragGhostEl.style.left = `${event.clientX}px`;
        dragGhostEl.style.top = `${event.clientY}px`;
      }
      const vRect = viewportEl.getBoundingClientRect();
      const isOverForest = (
        event.clientX >= vRect.left &&
        event.clientX <= vRect.right &&
        event.clientY >= vRect.top &&
        event.clientY <= vRect.bottom
      );
      viewportEl.classList.toggle('is-drag-over', isOverForest);
    }
  });

  window.addEventListener('pointerup', (event) => {
    if (!dragState.active) return;
    const wasDragging = dragState.didDrag;
    const item = dragState.item;
    dragState.active = false;
    dragState.item = null;

    if (dragGhostEl) dragGhostEl.style.display = 'none';
    if (drawerEl) drawerEl.style.opacity = '1';
    viewportEl.classList.remove('is-drag-over');

    if (wasDragging && item) {
      const vRect = viewportEl.getBoundingClientRect();
      const isOverForest = (
        event.clientX >= vRect.left &&
        event.clientX <= vRect.right &&
        event.clientY >= vRect.top &&
        event.clientY <= vRect.bottom
      );

      if (isOverForest) {
        const personalPoints = Number(core.getState().personalPoints || 0);
        const currentQty = core.getAssetQuantity(item.assetId);

        // 在庫がない場合は自動購入を試みる
        if (currentQty <= 0) {
          if (personalPoints < item.price) {
            toast(`ポイントが足りないよ（あと ${item.price - personalPoints} P）`);
            return;
          }
          const buyRes = core.buy(item.id);
          if (!buyRes.ok) {
            toast('入手できませんでした');
            return;
          }
          firebaseSync.pushBuyItem({ itemId: item.id, assetId: item.assetId, itemName: item.name, price: item.price });
          classSync.pushBuyItem({ itemId: item.id, assetId: item.assetId, itemName: item.name, price: item.price });
        }

        // 指定スクリーン座標で配置を実行
        const placeRes = interaction.placeAtScreen(item.assetId, event.clientX, event.clientY);
        if (placeRes.ok) {
          if (core.getState().settings?.sfx) audio.pop?.();
          closeItemDrawer();
          refresh();
        } else {
          refresh();
        }
      }
    }
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
    firebaseSync.pushCreateGoal({ goal: result.goal });
    classSync.pushCreateGoal({ title, targetCount: target });
    refresh();
  });

  document.addEventListener('submit', (event) => {
    const thanksForm = event.target.closest?.('#thanksForm');
    if (!thanksForm) return;
    event.preventDefault();
    const nameSelect = byId('thanksNameSelect');
    const name = nameSelect ? nameSelect.value : '';
    const result = core.sendThanks(name, 'わたし');
    if (!result.ok) {
      const messages = {
        empty_name: '送る相手を選んでね',
        already_sent_today: 'その人へは今日もう送っています',
        same_as_last: '直前と同じ人には続けて送れません'
      };
      toast(messages[result.reason] || '送れませんでした');
      return;
    }
    if (nameSelect) nameSelect.value = '';
    toast(`${result.entry.toName}さんにありがとうを送りました`);
    firebaseSync.pushThanks({ toName: result.entry.toName, message: '' });
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
      classSync.pushCompleteGoal(goalId);

      if (result.needsApproval) {
        // 承認待ちは「まだ完了ではない」ので、達成演出は承認された時のために取っておく。
        toast('先生の承認をまってね');
        firebaseSync.pushGoalCompletion({ goalId, goalTitle: core.getGoal(goalId)?.title || '', autoApprove: false });
        refresh();
        return;
      }

      // 達成の瞬間が一番気持ちいいべきなので、テキストのトーストだけでなく
      // カードのポップ・パーティクル・上昇アルペジオを重ねる。
      toast(`達成！ +${result.pointsAwarded}ポイント`);
      audio.chime();
      firebaseSync.pushGoalCompletion({ goalId, goalTitle: core.getGoal(goalId)?.title || '', autoApprove: true });
      const card = completeBtn.closest('.goal-card');
      card?.classList.add('goal-card--celebrate');
      spawnCelebration(completeBtn, result.pointsAwarded);
      pendingStatPulse = true;
      // カードが一瞬"できた!"の表情を見せてから、通常の再描画(達成済み表示)に切り替える。
      window.setTimeout(refresh, 420);
      return;
    }

    // 目標プリセットスタンプのワンタップ登録
    const presetBtn = event.target.closest?.('.goal-preset-btn');
    if (presetBtn) {
      const title = presetBtn.dataset.preset;
      if (title) {
        const result = core.createGoal(title, 1);
        if (result.ok) {
          toast(`「${title}」を追加しました！`);
          audio.tone(587.33, 0, 0.15, 0.08); // D5
          firebaseSync.pushCreateGoal({ goal: result.goal });
          classSync.pushCreateGoal({ title, targetCount: 1 });
          refresh();
        } else {
          toast('これ以上目標は作れません');
        }
      }
      return;
    }

    // サウンドON/OFFトグル
    const soundBtn = event.target.closest?.('#soundToggle');
    if (soundBtn) {
      audio.setEnabled(!audio.enabled);
      soundBtn.textContent = audio.enabled ? '🔊 おと' : '🔇 おとOFF';
      toast(audio.enabled ? 'おとをONにしました' : 'おとをOFFにしました');
      return;
    }

    // BGM（そよ風・小鳥環境音）トグル
    const bgmBtn = event.target.closest?.('#bgmToggle');
    if (bgmBtn) {
      audio.setBgmEnabled(!audio.bgmEnabled);
      bgmBtn.textContent = audio.bgmEnabled ? '🍃 そよ風ON' : '🍃 そよ風';
      toast(audio.bgmEnabled ? '森のそよ風をはじめました' : 'そよ風をとめました');
      return;
    }

    // ありがとう受信ポップアップ閉じる
    const thanksCloseBtn = event.target.closest?.('#thanksReceivedClose');
    if (thanksCloseBtn) {
      const host = byId('thanksReceivedHost');
      if (host) host.style.display = 'none';
      return;
    }

    // Firebase設定モーダル
    const fbBtn = event.target.closest?.('#firebaseSettingsBtn');
    if (fbBtn) {
      const modal = byId('firebaseModal');
      const apiKeyIn = byId('fbApiKeyInput');
      const projIn = byId('fbProjectIdInput');
      const appIn = byId('fbAppIdInput');
      if (modal) {
        if (firebaseClient.config) {
          if (apiKeyIn) apiKeyIn.value = firebaseClient.config.apiKey || '';
          if (projIn) projIn.value = firebaseClient.config.projectId || '';
          if (appIn) appIn.value = firebaseClient.config.appId || '';
        }
        modal.style.display = 'flex';
      }
      return;
    }

    const fbCloseBtn = event.target.closest?.('#firebaseModalClose') || event.target.closest?.('#firebaseBackdrop');
    if (fbCloseBtn) {
      const modal = byId('firebaseModal');
      if (modal) modal.style.display = 'none';
      return;
    }

    const fbSaveBtn = event.target.closest?.('#fbSaveBtn');
    if (fbSaveBtn) {
      const apiKey = byId('fbApiKeyInput')?.value?.trim();
      const projectId = byId('fbProjectIdInput')?.value?.trim();
      const appId = byId('fbAppIdInput')?.value?.trim();
      if (apiKey && projectId) {
        firebaseClient.saveConfig({ apiKey, projectId, appId });
        toast('Firebase設定を保存しました！');
        if (firebaseSync.isConfigured()) {
          firebaseSync.startListening();
        }
      } else {
        toast('API Key と Project ID を入力してください');
      }
      const modal = byId('firebaseModal');
      if (modal) modal.style.display = 'none';
      return;
    }

    const removeBtn = event.target.closest?.('[data-goal-remove]');
    if (removeBtn) {
      // 即削除はしない。「本当に消す？」の確認状態に切り替えるだけ。
      const goalId = removeBtn.dataset.goalRemove;
      window.clearTimeout(confirmRemoveTimer);
      confirmRemoveGoalId = goalId;
      // 確認状態のまま放置されたら、事故防止のため自動でもとに戻す。
      confirmRemoveTimer = window.setTimeout(() => {
        confirmRemoveGoalId = null;
        refresh();
      }, 4000);
      refresh();
      return;
    }

    const removeCancelBtn = event.target.closest?.('[data-goal-remove-cancel]');
    if (removeCancelBtn) {
      window.clearTimeout(confirmRemoveTimer);
      confirmRemoveGoalId = null;
      refresh();
      return;
    }

    const removeConfirmBtn = event.target.closest?.('[data-goal-remove-confirm]');
    if (removeConfirmBtn) {
      const goalId = removeConfirmBtn.dataset.goalRemoveConfirm;
      window.clearTimeout(confirmRemoveTimer);
      confirmRemoveGoalId = null;
      if (core.removeGoal(goalId)) {
        toast('目標をやめました');
        firebaseSync.pushRemoveGoal(goalId);
        classSync.pushRemoveGoal(goalId);
      }
      refresh();
      return;
    }

    const logToggleBtn = event.target.closest?.('[data-log-toggle]');
    if (logToggleBtn) {
      logExpanded = !logExpanded;
      refresh();
    }
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
  if (core.getState().forestStatus === 'completed') {
    // 前回のセッションで完成していた森を開いた場合は、起動画面ポップアップの代わりに
    // 完成画面(「新しい森をはじめる」への導線)を出す。
    showEndingModal(core.getForestSummary());
  } else {
    showWelcomePopup();
    maybeShowSymbolTreeIntro();
  }
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
