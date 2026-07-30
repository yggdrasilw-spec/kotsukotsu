function escapeHtml(text) {
  return String(text ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

// asset.emoji があればプレースホルダーとして絵文字表示、無ければ実画像を使う。
// 本物の画像が揃ったら assets.json から emoji フィールドを外すだけで、
// ここは自動的に image 側へ切り替わる。
function resolveVisual(asset) {
  if (!asset) return { image: '', glyph: '' };
  if (asset.emoji) return { image: '', glyph: asset.emoji };
  return { image: asset.image ? `assets/${asset.image}` : '', glyph: '' };
}

function assetSize(asset, cellSize) {
  if (!asset) return { width: cellSize, height: cellSize };
  if ((asset.gridWidth || 0) > 0 && (asset.gridHeight || 0) > 0) {
    return {
      width: asset.gridWidth * cellSize,
      height: asset.gridHeight * cellSize
    };
  }
  const width = Number(asset.imageWidth || cellSize);
  const height = Number(asset.imageHeight || cellSize);
  return { width, height };
}

function assetPosition(item, asset, cellSize) {
  const size = assetSize(asset, cellSize);
  const anchor = asset?.anchor || { x: 0.5, y: 1.0 };
  const worldX = Number(item.x || 0) * cellSize;
  const worldY = Number(item.y || 0) * cellSize;
  return {
    left: worldX - size.width * anchor.x,
    top: worldY - size.height * anchor.y,
    width: size.width,
    height: size.height
  };
}

function makeNodeHtml({ id, title, image, glyph = '', className = '', left, top, width, height, layer, extraData = '', label = '', tileSize = null, glyphColor = '' }) {
  const style = [
    `left:${left}px`,
    `top:${top}px`,
    `width:${width}px`,
    `height:${height}px`
  ];

  // 本物の画像(image)が無く、絵文字プレースホルダー(glyph)がある場合は
  // background-imageを使わず、中央に大きく絵文字を1文字表示するだけにする。
  // 本物の画像が用意できたら、データ側からemojiフィールドを外すだけで
  // 自動的にこちらの分岐を通らなくなり、コード側は触らずに済む。
  if (!image && glyph) {
    const styleStr = style.join(';');
    const fontSize = Math.max(10, Math.round(Math.min(width, height) * 0.7));
    return `
      <div class="forest-node forest-node--glyph ${className}" data-id="${escapeHtml(id)}" data-layer="${escapeHtml(layer)}" title="${escapeHtml(title)}" style="${styleStr}${glyphColor ? `;background:${glyphColor}` : ''}" ${extraData}>
        <span class="forest-node__glyph" style="font-size:${fontSize}px;line-height:${height}px;">${escapeHtml(glyph)}</span>
        <div class="forest-node__label">${escapeHtml(label || title)}</div>
      </div>
    `;
  }

  // tileSize が指定されている場合は、1マス分の画像を繰り返し敷き詰める
  // (地面や小道など、面全体を1枚の画像で引き伸ばしてしまわないようにするため)
  if (tileSize) {
    style.push('background-repeat:repeat', `background-size:${tileSize}px ${tileSize}px`);
  } else {
    style.push('background-repeat:no-repeat', 'background-size:contain');
  }
  const styleStr = style.join(';');
  const bg = image ? `style="background-image:url('${image}');${styleStr}"` : `style="${styleStr}"`;
  return `
    <div class="forest-node ${className}" data-id="${escapeHtml(id)}" data-layer="${escapeHtml(layer)}" title="${escapeHtml(title)}" ${bg} ${extraData}>
      <div class="forest-node__label">${escapeHtml(label || title)}</div>
    </div>
  `;
}

export function createForestRenderer({
  viewportEl,
  worldEl,
  layers,
  camera,
  map,
  assets,
  spots = [],
  debug = false
} = {}) {
  let assetById = new Map((assets || []).map((asset) => [asset.id, asset]));
  let spotById = new Map((spots || []).map((spot) => [spot.id, spot]));
  let debugMode = Boolean(debug);

  function setAssets(nextAssets) {
    assetById = new Map((nextAssets || []).map((asset) => [asset.id, asset]));
    terrainHtmlCache = null;
  }

  function setSpots(nextSpots) {
    spotById = new Map((nextSpots || []).map((spot) => [spot.id, spot]));
  }

  function setDebug(value) {
    debugMode = Boolean(value);
  }

  function renderGridOverlay() {
    if (!debugMode) return '';
    const cellSize = camera.cellSize;
    const cols = map.width;
    const rows = map.height;
    const parts = [];
    for (let x = 0; x <= cols; x += 1) {
      parts.push(`<div class="grid-line grid-line--v" style="left:${x * cellSize}px;"></div>`);
    }
    for (let y = 0; y <= rows; y += 1) {
      parts.push(`<div class="grid-line grid-line--h" style="top:${y * cellSize}px;"></div>`);
    }
    return parts.join('');
  }

  function renderSpots(state) {
    if (!debugMode) return '';
    const placedAssets = Array.isArray(state?.placedAssets) ? state.placedAssets : [];
    const counts = new Map();
    placedAssets.forEach((item) => {
      if (!item.spotId) return;
      counts.set(item.spotId, (counts.get(item.spotId) || 0) + 1);
    });
    return spots.map((spot) => {
      const left = Number(spot.x || 0) * camera.cellSize - 8;
      const top = Number(spot.y || 0) * camera.cellSize - 8;
      const label = spot.id;
      const count = counts.get(spot.id) || 0;
      const maxCount = Number(spot.maxCount || 1);
      const isFull = count >= maxCount;
      return `
        <button class="spot-dot ${isFull ? 'is-full' : ''}" data-spot-id="${escapeHtml(spot.id)}" title="${escapeHtml(label)} (${count}/${maxCount})" style="left:${left}px; top:${top}px;">
          <span>${escapeHtml(spot.type)}</span>
        </button>
      `;
    }).join('');
  }

  function renderTerrain(mapData) {
    const terrain = Array.isArray(mapData?.terrain) ? mapData.terrain : [];
    return terrain.map((item) => {
      const asset = assetById.get(item.assetId) || null;
      const cellsWide = Number(item.width || asset?.gridWidth || 1);
      const cellsHigh = Number(item.height || asset?.gridHeight || 1);
      const width = cellsWide * camera.cellSize;
      const height = cellsHigh * camera.cellSize;
      const left = Number(item.x || 0) * camera.cellSize;
      const top = Number(item.y || 0) * camera.cellSize;
      const label = item.id || item.assetId;
      const { image, glyph } = resolveVisual(asset);

      // アセット本来のマス数(gridWidth/gridHeight)より広い範囲に敷く場合は
      // 1枚の画像を引き伸ばすのではなく、タイルとして繰り返し敷き詰める。
      // (grass_01やpath_01のような1マス画像を、面全体に敷くケース)
      const nativeCellsWide = Number(asset?.gridWidth || 1);
      const nativeCellsHigh = Number(asset?.gridHeight || 1);
      const shouldTile = cellsWide > nativeCellsWide || cellsHigh > nativeCellsHigh;
      const styleParts = [
        `left:${left}px`,
        `top:${top}px`,
        `width:${width}px`,
        `height:${height}px`
      ];

      if (shouldTile && (asset?.placeholderColor || glyph)) {
        // 絵文字1文字をタイルとして敷き詰めるのは見た目が破綻するため、
        // 代わりにベタ塗りの色で代用する(本物の画像が揃ったら自動でこの分岐を通らなくなる)。
        styleParts.push(`background:${asset?.placeholderColor || '#cfe8b8'}`);
        return `
          <div class="forest-node forest-node--terrain forest-node--${escapeHtml(item.type || 'terrain')}"
               data-terrain-id="${escapeHtml(item.id)}"
               data-layer="${escapeHtml(item.layer || 'terrain')}"
               title="${escapeHtml(label)}"
               style="${styleParts.join(';')}">
          </div>
        `;
      }

      if (!shouldTile && glyph) {
        // 池・橋のような単体スプライト相当のものは、中央に絵文字を1つ出すだけでよい
        const fontSize = Math.max(16, Math.round(Math.min(width, height) * 0.6));
        return `
          <div class="forest-node forest-node--terrain forest-node--glyph forest-node--${escapeHtml(item.type || 'terrain')}"
               data-terrain-id="${escapeHtml(item.id)}"
               data-layer="${escapeHtml(item.layer || 'terrain')}"
               title="${escapeHtml(label)}"
               style="${styleParts.join(';')}">
            <span class="forest-node__glyph" style="font-size:${fontSize}px;line-height:${height}px;">${escapeHtml(glyph)}</span>
          </div>
        `;
      }

      if (image) styleParts.push(`background-image:url('${image}')`);
      if (shouldTile) {
        styleParts.push('background-repeat:repeat', `background-size:${nativeCellsWide * camera.cellSize}px ${nativeCellsHigh * camera.cellSize}px`);
      } else {
        styleParts.push('background-repeat:no-repeat', 'background-size:contain');
      }

      return `
        <div class="forest-node forest-node--terrain forest-node--${escapeHtml(item.type || 'terrain')}"
             data-terrain-id="${escapeHtml(item.id)}"
             data-layer="${escapeHtml(item.layer || 'terrain')}"
             title="${escapeHtml(label)}"
             style="${styleParts.join(';')}">
          <div class="forest-node__label">${escapeHtml(asset?.name || item.assetId || item.type || 'terrain')}</div>
        </div>
      `;
    }).join('');
  }

  function renderPlacedAssets(state) {
    const placedAssets = Array.isArray(state?.placedAssets) ? state.placedAssets : [];
    return placedAssets.map((item, index) => {
      const asset = assetById.get(item.assetId) || null;
      const pos = assetPosition(item, asset, camera.cellSize);
      const { image, glyph } = resolveVisual(asset);
      return makeNodeHtml({
        id: `placed-${index}`,
        title: `${asset?.name || item.assetId || 'asset'}`,
        image,
        glyph,
        className: `forest-node--asset forest-node--${escapeHtml(asset?.type || 'unknown')}`,
        left: pos.left,
        top: pos.top,
        width: pos.width,
        height: pos.height,
        layer: asset?.layer || 'asset',
        extraData: `data-asset-id="${escapeHtml(item.assetId)}" data-placed-index="${index}"`,
        label: asset?.name || item.assetId
      });
    }).join('');
  }

  function renderAnimals(state) {
    const animals = Array.isArray(state?.animals) ? state.animals : [];
    return animals.map((animal) => {
      const asset = assetById.get(animal.assetId) || null;
      const pos = assetPosition(animal, asset, camera.cellSize);
      const { image, glyph } = resolveVisual(asset);
      return makeNodeHtml({
        id: animal.id,
        title: `${asset?.name || animal.assetId || 'animal'}`,
        image,
        glyph,
        className: `forest-node--animal forest-node--${escapeHtml(asset?.type || 'animal')} forest-node--dir-${escapeHtml(animal.direction || 'right')}`,
        left: pos.left,
        top: pos.top,
        width: pos.width,
        height: pos.height,
        layer: asset?.layer || 'animal',
        extraData: `data-animal-id="${escapeHtml(animal.id)}" data-animal-state="${escapeHtml(animal.state || 'idle')}"`,
        label: asset?.name || animal.assetId
      });
    }).join('');
  }

  function renderPalette(state) {
    const owned = new Set([...(state?.ownedAssets || []), ...(state?.shopPurchased || [])]);
    const progress = Number(state?.classPoints || 0);
    const shopItems = Array.isArray(state?.shopItems) ? state.shopItems : [];
    const shopAssetIds = new Set(shopItems.map((item) => item.assetId));

    const grouped = new Map();
    (assets || []).forEach((asset) => {
      // 最初からmap.json上に固定terrainとして存在するアセットは
      // プレイヤーが選んで配置するものではないため、パレットに出さない。
      if (asset.placeable === false) return;
      const category = asset.layer || asset.type || 'misc';
      if (!grouped.has(category)) grouped.set(category, []);
      grouped.get(category).push(asset);
    });

    const sections = [];
    for (const [category, items] of grouped.entries()) {
      const cards = items.map((asset) => {
        const isOwned = owned.has(asset.id);
        const requiresShop = shopAssetIds.has(asset.id);
        const unlockedByProgress = progress >= Number(asset.unlock || 0);
        // ショップ商品があるアセットは購入済みでないと置けない。
        // ショップ商品がない無料アセット（地形など）は進行度だけで解放される。
        const canPlace = isOwned || (!requiresShop && unlockedByProgress);
        const statusLabel = isOwned
          ? ''
          : requiresShop
            ? 'ショップで購入'
            : unlockedByProgress
              ? ''
              : '未解放';
        const { image, glyph } = resolveVisual(asset);
        const thumb = glyph
          ? `<div class="asset-card__thumb asset-card__thumb--glyph"><span>${escapeHtml(glyph)}</span></div>`
          : `<div class="asset-card__thumb" style="background-image:url('${image}')"></div>`;
        return `
          <button class="asset-card ${canPlace ? '' : 'is-locked'} ${isOwned ? 'is-owned' : ''}"
                  data-select-asset="${escapeHtml(asset.id)}"
                  data-asset-type="${escapeHtml(asset.type || '')}"
                  title="${escapeHtml(asset.description || asset.name || asset.id)}"
                  ${canPlace ? '' : 'disabled'}>
            ${thumb}
            <div class="asset-card__name">${escapeHtml(asset.name || asset.id)}</div>
            <div class="asset-card__meta">${statusLabel ? escapeHtml(statusLabel) : escapeHtml(asset.id)}</div>
          </button>
        `;
      }).join('');
      sections.push(`
        <section class="palette-section">
          <h3>${escapeHtml(category)}</h3>
          <div class="palette-grid">${cards}</div>
        </section>
      `);
    }
    return sections.join('');
  }


  function renderShop(state) {
    const items = Array.isArray(state?.shopItems) ? state.shopItems : [];
    const progress = Number(state?.classPoints || 0);
    const points = Number(state?.personalPoints || 0);
    const purchased = new Set(Array.isArray(state?.shopPurchased) ? state.shopPurchased : []);
    if (!items.length) return '<p class="muted">ショップ商品がまだありません。</p>';

    const sections = new Map();
    items.forEach((item) => {
      const category = item.category || 'misc';
      if (!sections.has(category)) sections.set(category, []);
      sections.get(category).push(item);
    });

    return [...sections.entries()].map(([category, entries]) => {
      const cards = entries.map((item) => {
        const unlocked = progress >= Number(item?.unlockCondition?.progress || 0);
        const price = Number(item?.price || 0);
        const canBuy = unlocked && !purchased.has(item.id) && points >= price;
        const owned = purchased.has(item.id);
        const asset = assetById.get(item.assetId) || null;
        const { image, glyph } = resolveVisual(asset);
        const icon = glyph
          ? `<div class="shop-card__icon shop-card__icon--glyph"><span>${escapeHtml(glyph)}</span></div>`
          : image
            ? `<div class="shop-card__icon" style="background-image:url('${image}')"></div>`
            : '';
        return `
          <div class="shop-card ${unlocked ? '' : 'is-locked'} ${owned ? 'is-owned' : ''}">
            ${icon}
            <div class="shop-card__name">${escapeHtml(item.name || item.id)}</div>
            <div class="shop-card__meta">価格 ${price} / 解放 ${Number(item?.unlockCondition?.progress || 0)}</div>
            <div class="shop-card__desc">${escapeHtml(item.description || '')}</div>
            <button class="btn shop-card__buy" data-buy-shop="${escapeHtml(item.id)}" ${canBuy ? '' : 'disabled'}>${owned ? '購入済み' : unlocked ? '購入' : '未解放'}</button>
          </div>
        `;
      }).join('');
      return `
        <section class="shop-section">
          <h3>${escapeHtml(category)}</h3>
          <div class="shop-grid">${cards}</div>
        </section>
      `;
    }).join('');
  }

  // 目標パネル: 一覧＋クリアボタン＋新規作成フォーム。
  function renderGoals(state) {
    const goals = Array.isArray(state?.goalsView) ? state.goalsView : [];
    const settings = state?.goalSettings || { maxGoals: 3, approvalMode: 'self' };
    const canAddMore = goals.length < Number(settings.maxGoals || 3);

    const rows = goals.length
      ? goals.map((g) => {
          const full = g.done + g.pending >= g.targetCount;
          const label = g.pending > 0 ? '承認待ち…' : full ? 'きょうは達成！' : 'クリア';
          return `
            <div class="goal-card">
              <div class="goal-card__title">${escapeHtml(g.title)}</div>
              <div class="goal-card__meta">きょう ${g.done}/${g.targetCount}${g.pending ? `（承認待ち ${g.pending}）` : ''}</div>
              <div class="goal-card__actions">
                <button class="btn" data-goal-complete="${escapeHtml(g.id)}" ${full ? 'disabled' : ''}>${label}</button>
                <button class="btn btn--ghost" data-goal-remove="${escapeHtml(g.id)}">やめる</button>
              </div>
            </div>
          `;
        }).join('')
      : '<p class="muted">まだ目標がありません。下から作ってみよう。</p>';

    const form = canAddMore
      ? `
        <form id="goalCreateForm" class="goal-form">
          <input type="text" id="goalTitleInput" placeholder="目標を書いてね（例: 漢字を3こおぼえる）" maxlength="40" required />
          <select id="goalTargetInput">
            <option value="1">1日1回</option>
            <option value="2">1日2回</option>
            <option value="3">1日3回</option>
            <option value="5">1日5回</option>
          </select>
          <button type="submit" class="btn">目標をつくる</button>
        </form>
      `
      : `<p class="muted">目標は最大${Number(settings.maxGoals || 3)}個までです。</p>`;

    const modeNote = settings.approvalMode === 'teacher'
      ? '<p class="muted">今は先生の承認があるとポイントがもらえます。</p>'
      : '';

    return `${rows}${form}${modeNote}`;
  }

  // 先生承認待ち一覧。1件ずつ承認/却下する(一括承認はしない)。
  function renderApprovals(state) {
    const pending = Array.isArray(state?.pendingApprovalsView) ? state.pendingApprovalsView : [];
    if (state?.goalSettings?.approvalMode !== 'teacher') {
      return '<p class="muted">今は自己判定モードです。先生承認は使われていません。</p>';
    }
    if (!pending.length) return '<p class="muted">承認待ちの目標はありません。</p>';
    return pending.map((entry) => `
      <div class="goal-card">
        <div class="goal-card__title">${escapeHtml(entry.goalTitle || '')}</div>
        <div class="goal-card__meta">${escapeHtml(entry.date)} に達成報告</div>
        <div class="goal-card__actions">
          <button class="btn" data-goal-approve="${escapeHtml(entry.id)}">承認</button>
          <button class="btn btn--ghost" data-goal-reject="${escapeHtml(entry.id)}">却下</button>
        </div>
      </div>
    `).join('');
  }

  function renderStatus(state) {
    const personalPoints = Number(state?.personalPoints || 0);
    const lifetimePoints = Number(state?.lifetimePoints || 0);
    const classPoints = Number(state?.classPoints || 0);
    const season = state?.settings?.season || 'spring';
    const ownedCount = Array.isArray(state?.ownedAssets) ? state.ownedAssets.length : 0;
    const placedCount = Array.isArray(state?.placedAssets) ? state.placedAssets.length : 0;
    const animalsCount = Array.isArray(state?.animals) ? state.animals.length : 0;
    const badgeCount = Array.isArray(state?.badges) ? state.badges.length : 0;
    return `
      <div class="stat-row"><span>所持ポイント</span><strong>${personalPoints}</strong></div>
      <div class="stat-row"><span>累積ポイント</span><strong>${lifetimePoints}</strong></div>
      <div class="stat-row"><span>クラスポイント</span><strong>${classPoints}</strong></div>
      <div class="stat-row"><span>季節</span><strong>${escapeHtml(season)}</strong></div>
      <div class="stat-row"><span>所持アセット</span><strong>${ownedCount}</strong></div>
      <div class="stat-row"><span>配置数</span><strong>${placedCount}</strong></div>
      <div class="stat-row"><span>動物</span><strong>${animalsCount}</strong></div>
      <div class="stat-row"><span>バッジ</span><strong>${badgeCount}</strong></div>
    `;
  }

  function renderEventLog(state, expanded = false) {
    const log = Array.isArray(state?.activityLog) ? state.activityLog : [];
    const limit = expanded ? 50 : 3;
    const recent = log.slice(-limit).reverse();
    if (!recent.length) return '<p class="muted">まだログはありません。</p>';
    const items = recent.map((entry) => `
      <div class="log-item">
        ${escapeHtml(entry.message || '')}
        <span class="log-item__time">${formatLogTime(entry.createdAt)}</span>
      </div>
    `).join('');
    const toggle = log.length > 3
      ? `<button class="btn btn--ghost log-toggle" data-log-toggle>${expanded ? 'たたむ' : `もっと見る（全${Math.min(log.length, 50)}件）`}</button>`
      : '';
    return `<div class="log-list ${expanded ? 'log-list--expanded' : ''}">${items}</div>${toggle}`;
  }

  function formatLogTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return `${d.getMonth() + 1}/${d.getDate()} ${`${d.getHours()}`.padStart(2, '0')}:${`${d.getMinutes()}`.padStart(2, '0')}`;
  }

  function renderBadgePanel(badgeState = []) {
    const badges = Array.isArray(badgeState) ? badgeState : [];
    if (!badges.length) return '<p class="muted">まだバッジはありません。</p>';
    return badges.map((badge) => `
      <div class="badge-card ${badge.unlocked ? 'is-unlocked' : 'is-locked'}">
        <div class="badge-card__name">${escapeHtml(badge.name || badge.id)}</div>
        <div class="badge-card__meta">${badge.unlocked ? '達成' : '未達成'}</div>
        <div class="badge-card__desc">${escapeHtml(badge.description || '')}</div>
      </div>
    `).join('');
  }

  // 地形(terrain)は map.json 由来で実行中に変化しないため、初回だけ組み立てて
  // キャッシュする。毎フレーム同じ巨大HTMLを作り直すムダを無くす。
  let terrainHtmlCache = null;
  function getTerrainHtml() {
    if (terrainHtmlCache === null) terrainHtmlCache = renderTerrain(map);
    return terrainHtmlCache;
  }

  // カメラのパン/ズームだけを反映する軽量パス。
  // DOMのHTML再構築は行わず、transform関連のスタイルだけ更新する。
  // ポインタのドラッグ中やrAFループの毎フレームはこちらだけを呼べばよい。
  function updateCamera() {
    camera.clampToBounds();
    if (viewportEl) {
      viewportEl.style.setProperty('--zoom', camera.zoom);
    }
    if (worldEl) {
      worldEl.style.width = `${map.width * camera.cellSize}px`;
      worldEl.style.height = `${map.height * camera.cellSize}px`;
      worldEl.style.transform = camera.getTransform();
    }
  }

  // 動物は少しずつ動くので、毎フレーム呼んでも良いように差分チェック付きで
  // 動物レイヤーだけを再構築する。他のレイヤー(地形/配置物)やサイドパネルには
  // 一切触れないので、パレットやショップパネルの毎フレーム再構築を避けられる。
  let lastAnimalsSignature = null;
  function renderAnimalsOnly(state) {
    const animals = Array.isArray(state?.animals) ? state.animals : [];
    // 位置とmoodだけを見た軽量な署名。中身が変わっていなければ再描画しない。
    const signature = animals.map((a) => `${a.id}:${a.x}:${a.y}:${a.mood}:${a.state}`).join('|');
    if (signature === lastAnimalsSignature) return false;
    lastAnimalsSignature = signature;
    if (layers.animals) layers.animals.innerHTML = renderAnimals(state);
    return true;
  }

  function render(state) {
    updateCamera();

    const placedHtml = renderPlacedAssets(state);
    const spotHtml = renderSpots(state);
    const gridHtml = renderGridOverlay();

    if (layers.terrain) layers.terrain.innerHTML = getTerrainHtml();
    if (layers.assets) layers.assets.innerHTML = placedHtml;
    if (layers.debug) layers.debug.innerHTML = `${gridHtml}${spotHtml}`;
    renderAnimalsOnly(state);

    return {
      paletteHtml: renderPalette(state),
      statusHtml: renderStatus(state),
      logHtml: renderEventLog(state, Boolean(state?.logExpanded)),
      badgeHtml: renderBadgePanel(state?.evaluatedBadges || []),
      shopHtml: renderShop(state),
      goalHtml: renderGoals(state),
      approvalHtml: renderApprovals(state),
      visibleRect: camera.getVisibleRect()
    };
  }

  return {
    setAssets,
    setSpots,
    setDebug,
    render,
    updateCamera,
    renderAnimalsOnly,
    renderPalette,
    renderStatus,
    renderEventLog,
    renderBadgePanel,
    renderShop
  };
}
