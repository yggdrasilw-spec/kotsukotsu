import { computeProgressPercent } from './core-runtime.js';

function escapeHtml(text) {
  return String(text ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

// 固定文言(こちらで書いた漢字)にふりがなを付けるための小さなヘルパー。
// 表示/非表示自体はCSS側(#app.furigana-on)で切り替えるので、常にrubyを出力してよい。
// ※ユーザー入力(目標タイトルなど)には使わない。あくまでこちらの書いた文言専用。
function rb(kanji, reading) {
  return `<ruby>${kanji}<rt>${reading}</rt></ruby>`;
}

// asset.emoji があればプレースホルダーとして絵文字表示、無ければ実画像を使う。
// 本物の画像が揃ったら assets.json から emoji フィールドを外すだけで、
// ここは自動的に image 側へ切り替わる。
function resolveVisual(asset) {
  if (!asset) return { image: '' };
  return { image: asset.image ? `assets/${asset.image}` : '' };
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

function assetPosition(item, asset, cellSize, scale = 1) {
  const size = assetSize(asset, cellSize);
  const width = size.width * scale;
  const height = size.height * scale;
  const anchor = asset?.anchor || { x: 0.5, y: 1.0 };
  const worldX = Number(item.x || 0) * cellSize;
  const worldY = Number(item.y || 0) * cellSize;
  return {
    left: worldX - width * anchor.x,
    top: worldY - height * anchor.y,
    width,
    height
  };
}

// (v25) 中心のシンボルツリー専用の成長スケール。
// 森の開始時(進行度0%)は他の小物と同じグリッド1マス分の苗木として置かれ、
// 進行度が進むほど少しずつ大きくなり、完成(100%)時には森でいちばん大きい木
// (針葉樹: 4×5マス)よりも一回り大きい、6倍サイズのシンボルツリーになる。
function symbolTreeScale(progressPercent) {
  const p = Math.max(0, Math.min(100, Number(progressPercent) || 0));
  return 1 + (p / 100) * 5;
}

function makeNodeHtml({ id, title, image, className = '', left, top, width, height, layer, extraData = '', label = '', tileSize = null }) {
  const style = [
    `left:${left}px`,
    `top:${top}px`,
    `width:${width}px`,
    `height:${height}px`
  ];

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
    terrainDomSyncedHtml = null;
    lastPlacedSignature = null;
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
      const { image } = resolveVisual(asset);

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


  let placedNodesMap = new Map();

  function renderPlacedAssets(state) {
    if (!layers.assets) return;
    const placedAssets = Array.isArray(state?.placedAssets) ? state.placedAssets : [];
    const progressPercent = computeProgressPercent(state);
    const currentPlacedIds = new Set();

    placedAssets.forEach((item, index) => {
      const placedId = item.placedId || `placed-${index}`;
      currentPlacedIds.add(placedId);
      
      const asset = assetById.get(item.assetId) || null;
      const isSymbolTree = Boolean(item.isSymbolTree) || item.spotId === 'symbolTreeSpot';
      const scale = isSymbolTree ? symbolTreeScale(progressPercent) : 1;
      const pos = assetPosition(item, asset, camera.cellSize, scale);
      const { image } = resolveVisual(asset);
      const className = `forest-node forest-node--asset forest-node--${escapeHtml(asset?.type || 'unknown')}${isSymbolTree ? ' forest-node--symbol-tree' : ''}`;
      
      let el = placedNodesMap.get(placedId);
      if (!el) {
        el = document.createElement('div');
        layers.assets.appendChild(el);
        placedNodesMap.set(placedId, el);
      }
      
      if (el.className !== className) el.className = className;
      el.dataset.id = `placed-${index}`;
      el.dataset.layer = escapeHtml(asset?.layer || 'asset');
      el.title = escapeHtml(asset?.name || item.assetId || 'asset');
      el.dataset.placedId = escapeHtml(item.placedId || '');
      el.dataset.assetId = escapeHtml(item.assetId);

      const labelText = asset?.name || item.assetId;
      if (!el.firstChild) {
        const labelDiv = document.createElement('div');
        labelDiv.className = 'forest-node__label';
        labelDiv.textContent = labelText;
        el.appendChild(labelDiv);
      } else {
        if (el.firstChild.textContent !== labelText) {
          el.firstChild.textContent = labelText;
        }
      }

      el.style.left = `${pos.left}px`;
      el.style.top = `${pos.top}px`;
      el.style.width = `${pos.width}px`;
      el.style.height = `${pos.height}px`;
      
      if (image) {
        el.style.backgroundImage = `url('${image}')`;
        el.style.backgroundRepeat = 'no-repeat';
        el.style.backgroundSize = 'contain';
      } else {
        el.style.backgroundImage = '';
      }
    });

    for (const [placedId, el] of placedNodesMap.entries()) {
      if (!currentPlacedIds.has(placedId)) {
        el.remove();
        placedNodesMap.delete(placedId);
      }
    }
  }


  function renderAnimals(state) {
    const animals = Array.isArray(state?.animals) ? state.animals : [];
    return animals.map((animal) => {
      const asset = assetById.get(animal.assetId) || null;
      const pos = assetPosition(animal, asset, camera.cellSize);
      const { image } = resolveVisual(asset);
      return makeNodeHtml({
        id: animal.id,
        title: `${asset?.name || animal.assetId || 'animal'}`,
        image,
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

  // パレットの見出しラベル(asset.layer || asset.type の生の値 → 子ども向けの日本語)。
  // core-runtime.js の CATEGORY_LABELS(unlockedCategories用、bird/animal/fish/insectを
  // まとめて"動物"にする等の別目的の対応表)とは別に、パレット表示用にすべての区分を
  // 個別に持たせておく。
  const PALETTE_CATEGORY_LABELS = {
    ground: '地面', path: '小道', rock: '岩', flower: '花', mushroom: 'きのこ',
    bird: '小鳥', animal: '動物', fish: '魚', seed: '木の実', effect: 'きらきら', insect: '虫'
  };

  // (v24) 木・岩などの"大物"はクラスの進行度で自動的に配置されるようにしたため、
  // 児童が選ぶ小物だけをここに並べる(assets.json側で該当アセットをplaceable:falseにしてある)。
  // 表示は「下に長くスクロールしなくて済む」ことを優先し、カテゴリごとに大きなカードを
  // 縦に並べる代わりに、小さなピル(絵文字+名前)を折り返しながら並べる一覧に変更した。
  // カテゴリの区切りは見出しブロックではなく、行に混ざる小さなタグ文字にして面積を取らない。
  function renderPalette(state) {
    const owned = new Set([...(state?.ownedAssets || []), ...(state?.shopPurchased || [])]);
    const progress = computeProgressPercent(state);
    const shopItems = Array.isArray(state?.shopItems) ? state.shopItems : [];
    const shopAssetIds = new Set(shopItems.map((item) => item.assetId));

    const grouped = new Map();
    (assets || []).forEach((asset) => {
      // 最初からmap.json上に固定terrainとして存在するアセットや、進行度で自動配置される
      // 大物(木・岩など)はプレイヤーが選んで配置するものではないため、パレットに出さない。
      if (asset.placeable === false) return;
      const category = asset.layer || asset.type || 'misc';
      if (!grouped.has(category)) grouped.set(category, []);
      grouped.get(category).push(asset);
    });

    const parts = [];
    for (const [category, items] of grouped.entries()) {
      const usable = [];
      const locked = [];
      items.forEach((asset) => {
        const isOwned = owned.has(asset.id);
        const requiresShop = shopAssetIds.has(asset.id);
        const unlockedByProgress = progress >= Number(asset.unlock || 0);
        const canPlace = isOwned || (!requiresShop && unlockedByProgress);
        (canPlace ? usable : locked).push({ asset, isOwned, requiresShop, unlock: Number(asset.unlock || 0) });
      });
      if (!usable.length && !locked.length) continue;

      parts.push(`<span class="palette-tag">${escapeHtml(PALETTE_CATEGORY_LABELS[category] || category)}</span>`);

      parts.push(...usable.map(({ asset, isOwned }) => {
        const { image } = resolveVisual(asset);
        const thumb = `<span class="asset-pill__thumb" style="background-image:url('${image}')"></span>`;
        return `
          <button class="asset-card ${isOwned ? 'is-owned' : ''}"
                  data-select-asset="${escapeHtml(asset.id)}"
                  data-asset-type="${escapeHtml(asset.type || '')}"
                  title="${escapeHtml(asset.description || asset.name || asset.id)}">
            ${thumb}<span class="asset-card__name">${escapeHtml(asset.name || asset.id)}</span>
          </button>
        `;
      }));

      if (locked.length) {
        parts.push(`
          <details class="palette-locked-inline">
            <summary>🔒 ${locked.length}</summary>
            <div class="palette-section__locked-list">
              ${locked.map(({ asset, requiresShop, unlock }) => `<span class="asset-chip">${escapeHtml(asset.name || asset.id)}${requiresShop ? '（ショップ）' : `（解放 ${unlock}%）`}</span>`).join('')}
            </div>
          </details>
        `);
      }
    }

    if (!parts.length) return '<p class="muted">つかえるアイテムがまだありません。</p>';
    return `<div class="palette-flow">${parts.join('')}</div>`;
  }


  function renderShop(state) {
    const items = Array.isArray(state?.shopItems) ? state.shopItems : [];
    const progress = computeProgressPercent(state);
    const points = Number(state?.personalPoints || 0);
    const quantities = state?.assetQuantities || {};
    const selectedAssetId = state?.selectedAssetId || null;
    if (!items.length) return '<p class="muted">ショップ商品がまだありません。</p>';

    const sections = new Map();
    items.forEach((item) => {
      const category = item.category || 'misc';
      if (!sections.has(category)) sections.set(category, []);
      sections.get(category).push(item);
    });

    // stamp_card.htmlのスタンプピッカーと同じ「1行カルーセル」方式。
    // カテゴリが何点あっても常に1行に収まり、中央＝いま見ている商品として
    // 詳細（名前・価格・購入/配置ボタン、または解放条件）を下の.shop-detailに出す。
    // 実際の中央寄せ・ドラッグ・詳細更新はjs/shop-carousel.jsが担当するため、
    // ここでは各カードにdata属性で必要な情報を持たせるだけにとどめる。
    return [...sections.entries()].map(([category, entries]) => {
      const cardsHtml = entries.map((item) => {
        const price = Number(item?.price || 0);
        const qty = Number(quantities[item.assetId] || 0);
        const unlockProgress = Number(item?.unlockCondition?.progress || 0);
        const unlocked = progress >= unlockProgress;
        const canBuy = unlocked && points >= price;
        const isPlacing = selectedAssetId === item.assetId;
        const asset = assetById.get(item.assetId) || null;
        const { image } = resolveVisual(asset);
        const icon = `<div class="shop-card__icon" style="background-image:url('${image}')"></div>`;
        return `
          <div class="shop-carousel-item ${qty > 0 ? 'is-owned' : ''} ${unlocked ? '' : 'is-locked'} ${isPlacing ? 'is-placing' : ''}"
               data-shop-item
               data-id="${escapeHtml(item.id)}"
               data-asset-id="${escapeHtml(item.assetId)}"
               data-name="${escapeHtml(item.name || item.id)}"
               data-desc="${escapeHtml(item.description || '')}"
               data-price="${price}"
               data-qty="${qty}"
               data-unlocked="${unlocked ? '1' : '0'}"
               data-unlock-progress="${unlockProgress}"
               data-can-buy="${canBuy ? '1' : '0'}"
               data-is-placing="${isPlacing ? '1' : '0'}">
            ${icon}
            ${qty > 0 ? `<span class="shop-carousel-item__qty">×${qty}</span>` : ''}
          </div>
        `;
      }).join('');

      return `
        <section class="shop-section" data-shop-category="${escapeHtml(category)}">
          <h3>${escapeHtml(category)}</h3>
          <div class="shop-carousel">
            <button type="button" class="shop-carousel-arrow" data-shop-prev aria-label="まえの商品">‹</button>
            <div class="shop-carousel-viewport">
              <div class="shop-carousel-track" data-shop-track>${cardsHtml}</div>
            </div>
            <button type="button" class="shop-carousel-arrow" data-shop-next aria-label="つぎの商品">›</button>
          </div>
          <div class="shop-detail" data-shop-detail></div>
        </section>
      `;
    }).join('');
  }

  // 目標パネル: 一覧＋クリアボタン＋新規作成フォーム。
  // 目標カード1つぶんの「できた/待ち/あと」を、数字だけでなく丸の並びで見せる。
  // 低学年でも一瞬で「あと何回か」が分かるようにするための視覚化(文字は補助情報として残す)。
  function renderGoalDots(g) {
    const total = Math.max(1, Number(g.targetCount) || 1);
    let dots = '';
    for (let i = 0; i < total; i++) {
      if (i < g.done) dots += '<span class="goal-dot goal-dot--done">●</span>';
      else if (i < g.done + g.pending) dots += '<span class="goal-dot goal-dot--pending">◐</span>';
      else dots += '<span class="goal-dot goal-dot--empty">○</span>';
    }
    return `<div class="goal-dots">${dots}</div>`;
  }

  // 目標が複数あっても「今、全体でどれだけ進んでいるか」を1枚で見せるための小さなヘッダー。
  // 個々の目標カードより上に表示し、パーセントより「あと何個」を主役にする
  // (小さい子には割合よりも実際に残っている数のほうが分かりやすいため)。
  function renderGoalTodayHero(goals) {
    if (!goals.length) return '';
    const totalDone = goals.reduce((sum, g) => sum + g.done, 0);
    const totalPending = goals.reduce((sum, g) => sum + g.pending, 0);
    const totalTarget = goals.reduce((sum, g) => sum + g.targetCount, 0);
    const remaining = Math.max(0, totalTarget - totalDone - totalPending);
    const pct = totalTarget ? Math.round((totalDone / totalTarget) * 100) : 0;

    let sub;
    if (totalTarget > 0 && totalDone >= totalTarget) {
      sub = `<span class="goal-today-hero__sub goal-today-hero__sub--done">今日は${rb('全部', 'ぜんぶ')}できたよ！🎉</span>`;
    } else if (remaining === 1) {
      sub = `<span class="goal-today-hero__sub goal-today-hero__sub--last">あと<strong>1</strong>つ！</span>`;
    } else {
      sub = `<span class="goal-today-hero__sub">あと <strong>${remaining}</strong> つ</span>`;
    }
    const pendingNote = totalPending
      ? `<span class="goal-today-hero__pending">${rb('承認', 'しょうにん')}待ち ${totalPending}</span>`
      : '';

    return `
      <div class="goal-today-hero">
        <div class="goal-today-hero__ring" style="--pct: ${pct}%;">
          <span class="goal-today-hero__pct">${totalDone}/${totalTarget}</span>
        </div>
        <div class="goal-today-hero__text">
          <div class="goal-today-hero__label">${rb('今日', 'きょう')}のがんばり</div>
          ${sub}
          ${pendingNote}
        </div>
      </div>
    `;
  }

  function renderGoals(state) {
    const goals = Array.isArray(state?.goalsView) ? state.goalsView : [];
    const settings = state?.goalSettings || { maxGoals: 3, approvalMode: 'self' };
    const canAddMore = goals.length < Number(settings.maxGoals || 3);
    const confirmRemoveGoalId = state?.confirmRemoveGoalId || null;

    const hero = renderGoalTodayHero(goals);

    const rows = goals.length
      ? goals.map((g) => {
          const full = g.done + g.pending >= g.targetCount;
          const label = g.pending > 0 ? `${rb('承認', 'しょうにん')}待ち…` : full ? `きょうは${rb('達成', 'たっせい')}！` : 'クリア';
          // 「やめる」は取り消せない操作なので、1タップ目では消さずに
          // 「本当に消す？」の確認状態に切り替え、2タップ目で初めて削除する。
          // 誤タップでも「やめない」であっさり戻れるようにする。
          const removeActions = confirmRemoveGoalId === g.id
            ? `
              <button class="btn btn--danger btn--small" data-goal-remove-confirm="${escapeHtml(g.id)}">${rb('本当', 'ほんとう')}に${rb('消', 'け')}す</button>
              <button class="btn btn--ghost btn--small" data-goal-remove-cancel="${escapeHtml(g.id)}">やめない</button>
            `
            : `<button class="btn btn--ghost" data-goal-remove="${escapeHtml(g.id)}">やめる</button>`;
          return `
            <div class="goal-card${full ? ' goal-card--full' : ''}">
              <div class="goal-card__title">${escapeHtml(g.title)}</div>
              ${renderGoalDots(g)}
              <div class="goal-card__meta">きょう ${g.done}/${g.targetCount}${g.pending ? `（${rb('承認', 'しょうにん')}待ち ${g.pending}）` : ''}</div>
              <div class="goal-card__actions${confirmRemoveGoalId === g.id ? ' goal-card__actions--confirm' : ''}">
                <button class="btn" data-goal-complete="${escapeHtml(g.id)}" ${full ? 'disabled' : ''}>${label}</button>
                ${removeActions}
              </div>
            </div>
          `;
        }).join('')
      : `<p class="muted">まだ${rb('目標', 'もくひょう')}がありません。下から作ってみよう。</p>`;

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
          <button type="submit" class="btn">${rb('目標', 'もくひょう')}をつくる</button>
        </form>
      `
      : `<p class="muted">${rb('目標', 'もくひょう')}は${rb('最大', 'さいだい')}${Number(settings.maxGoals || 3)}${rb('個', 'こ')}までです。</p>`;

    const modeNote = settings.approvalMode === 'teacher'
      ? `<p class="muted">${rb('今', 'いま')}は${rb('先生', 'せんせい')}の${rb('承認', 'しょうにん')}があるとポイントがもらえます。</p>`
      : '';

    return `${hero}${rows}${form}${modeNote}`;
  }

  function renderStatus(state) {
    const personalPoints = Number(state?.personalPoints || 0);
    const lifetimePoints = Number(state?.lifetimePoints || 0);
    const classPoints = Number(state?.classPoints || 0);
    const clearPoint = Number(state?.classInfo?.clearPoint || 1000);
    const progressPercent = computeProgressPercent(state);
    const season = state?.settings?.season || 'spring';
    const ownedCount = Array.isArray(state?.ownedAssets) ? state.ownedAssets.length : 0;
    const placedCount = Array.isArray(state?.placedAssets) ? state.placedAssets.length : 0;
    const animalsCount = Array.isArray(state?.animals) ? state.animals.length : 0;
    const badgeCount = Array.isArray(state?.badges) ? state.badges.length : 0;
    return `
      <div class="stat-row"><span>所持ポイント</span><strong>${personalPoints}</strong></div>
      <div class="stat-row"><span>累積ポイント</span><strong>${lifetimePoints}</strong></div>
      <div class="stat-row"><span>クラスポイント</span><strong>${classPoints} / ${clearPoint}</strong></div>
      <div class="stat-row"><span>森の進み具合</span><strong>${Math.floor(progressPercent)}%</strong></div>
      <div class="stat-row"><span>森の代</span><strong>${Number(state?.forestGeneration || 1)}代目</strong></div>
      <div class="stat-row"><span>季節</span><strong>${escapeHtml(season)}</strong></div>
      <div class="stat-row"><span>所持アセット</span><strong>${ownedCount}</strong></div>
      <div class="stat-row"><span>配置数</span><strong>${placedCount}</strong></div>
      <div class="stat-row"><span>動物</span><strong>${animalsCount}</strong></div>
      <div class="stat-row"><span>バッジ</span><strong>${badgeCount}</strong></div>
    `;
  }

  // 「クラスのちから」パネル(クラス協力の意味づけ強化・v22)。
  // 個人の進行度ではなく、「今日、クラスみんなでどれだけ森を育てたか」を主役にする。
  // 目標達成/承認のたびにGAS側(announceContribution)がactivityLogへ
  // type:'contribution'/'contribution_milestone' で actorName/points/progress を記録してくれる
  // ので、ここではそれを今日の分だけ集計して見せる。
  function renderClassPower(state) {
    // GAS未接続(ローカル単独プレイ)では「クラス」という概念自体が無いので出さない。
    if (!Array.isArray(state?.classmates)) {
      return '<p class="muted">🔒 クラスのみんなとつながると、今日のがんばりがここに集まるよ。</p>';
    }

    const log = Array.isArray(state.activityLog) ? state.activityLog : [];
    const todayKey = formatDateKey(new Date());
    const todays = log.filter((e) => {
      if (e?.type !== 'contribution' && e?.type !== 'contribution_milestone') return false;
      return formatDateKey(new Date(e.createdAt)) === todayKey;
    });

    if (!todays.length) {
      return '<p class="muted">まだ今日の記録はありません。目標をクリアすると、ここにクラスみんなのがんばりが集まるよ。</p>';
    }

    const totalPoints = todays.reduce((sum, e) => sum + (Number(e.points) || 0), 0);
    const milestoneCount = todays.filter((e) => e.type === 'contribution_milestone').length;

    const countByName = new Map();
    for (const e of todays) {
      const name = e.actorName || 'クラスの子';
      countByName.set(name, (countByName.get(name) || 0) + 1);
    }
    const ranked = [...countByName.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
    const chips = ranked.map(([name, count]) => `
      <span class="class-power__chip">${escapeHtml(name)}さん<span class="class-power__chip-count">×${count}</span></span>
    `).join('');

    const milestoneNote = milestoneCount
      ? `<p class="class-power__milestone">🌟 今日は${milestoneCount}回、森が育つ「最後のひと押し」がありました</p>`
      : '';

    return `
      <div class="class-power">
        <div class="class-power__today">
          <span class="class-power__today-label">今日、クラスみんなで</span>
          <strong class="class-power__today-value">+${totalPoints}pt</strong>
        </div>
        ${milestoneNote}
        <div class="class-power__chips">${chips}</div>
      </div>
    `;
  }

  function formatDateKey(d) {
    if (Number.isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
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

    const unlocked = badges.filter((b) => b.unlocked);
    const locked = badges.filter((b) => !b.unlocked);

    const unlockedHtml = unlocked.length
      ? unlocked.map((badge) => `
          <div class="badge-card is-unlocked">
            <div class="badge-card__name">🏅 ${escapeHtml(badge.name || badge.id)}</div>
            <div class="badge-card__desc">${escapeHtml(badge.description || '')}</div>
          </div>
        `).join('')
      : '<p class="muted">まだバッジはありません。がんばろう！</p>';

    // 未達成バッジは、内容の説明文まで並べると重くなる上にネタバレにもなるので、
    // 「あと◯こ」の折りたたみに名前だけまとめる。
    const lockedHtml = locked.length
      ? `
        <details class="badge-panel__locked">
          <summary>🔒 あと${locked.length}つ（タップで見る）</summary>
          <div class="badge-panel__locked-list">
            ${locked.map((b) => `<span class="asset-chip">${escapeHtml(b.name || b.id)}</span>`).join('')}
          </div>
        </details>
      `
      : '';

    return `${unlockedHtml}${lockedHtml}`;
  }

  // 地形(terrain)は map.json 由来で実行中に変化しないため、初回だけ組み立てて
  // キャッシュする。毎フレーム同じ巨大HTMLを作り直すムダを無くす。
  let terrainHtmlCache = null;
  function getTerrainHtml() {
    if (terrainHtmlCache === null) terrainHtmlCache = renderTerrain(map);
    return terrainHtmlCache;
  }

  // 地形(terrain)はセッション中まず変化しない(mapは起動時に1回読み込むだけ)のに、
  // 以前は毎回のrender()でlayers.terrain.innerHTMLを丸ごと書き直していた。
  // これだと配置/購入/20秒おきの同期など「地形とは無関係な理由」でrefresh()される
  // たびに、地面や道の背景画像タイルを全部作り直す→再ペイントすることになり、
  // 低スペック機(Chromebook等)では一瞬タイルが抜けた「モザイク状」の表示になっていた。
  // 実際にterrainHtmlCacheの中身が変わった(=setAssets等でキャッシュがnullに戻された)
  // ときだけDOMへ反映するようにする。
  let terrainDomSyncedHtml = null;
  function applyTerrainIfChanged() {
    if (!layers.terrain) return;
    const html = getTerrainHtml();
    if (html === terrainDomSyncedHtml) return;
    layers.terrain.innerHTML = html;
    terrainDomSyncedHtml = html;
  }

  // 配置物(placedAssets)も、内容(何が/どこに置かれているか、シンボルツリーの
  // 成長度合い)が変わっていなければDOMを書き直さない。renderAnimalsOnlyと同じ考え方。
  let lastPlacedSignature = null;
  function applyPlacedAssetsIfChanged(state) {
    if (!layers.assets) return;
    const placedAssets = Array.isArray(state?.placedAssets) ? state.placedAssets : [];
    const progressPercent = computeProgressPercent(state);
    const signature = `${progressPercent}|${placedAssets.map((p) => `${p.placedId}:${p.assetId}:${p.x}:${p.y}`).join(',')}`;
    if (signature === lastPlacedSignature) return;
    lastPlacedSignature = signature;
    renderPlacedAssets(state);
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

    const spotHtml = renderSpots(state);
    const gridHtml = renderGridOverlay();

    applyTerrainIfChanged();
    applyPlacedAssetsIfChanged(state);
    if (layers.debug) layers.debug.innerHTML = `${gridHtml}${spotHtml}`;
    renderAnimalsOnly(state);

    return {
      statusHtml: renderStatus(state),
      logHtml: renderEventLog(state, Boolean(state?.logExpanded)),
      badgeHtml: renderBadgePanel(state?.evaluatedBadges || []),
      shopHtml: renderShop(state),
      goalHtml: renderGoals(state),
      classPowerHtml: renderClassPower(state),
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
    renderShop,
    renderClassPower
  };
}
