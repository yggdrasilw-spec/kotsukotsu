// ショップの「カテゴリごと1行カルーセル」を動かす部分。
// stamp_card.html の表紙スタンプピッカー（#stamp-picker-viewport / .stamp-carousel-track）
// を輸入し、ショップ用に以下の点だけ拡張している。
//   - 選択中(中央)のカードは「買う対象」であり、押したらすぐ選択が切り替わる
//     stamp_cardのピッカーとは違って、下の詳細パネル(.shop-detail)に
//     名前・価格・購入ボタン／解放条件をまとめて表示する。
//   - カテゴリが複数あるので、インデックスをカテゴリ名ごとに保持する
//     （Mapで持ち、再描画されてもスクロール位置を覚えている）。
//
// render.js 側は各商品カードに data-* 属性で情報を持たせるだけで、
// 実際の「中央寄せ計算・ドラッグ・詳細パネル更新」はすべてこちらが担当する。
// これにより render.js の役割（HTML文字列を組み立てるだけ）を崩さずに済む。

const ITEM_STEP = 66; // .shop-carousel-item の幅(52px) + 左右マージン(7px×2)

// カテゴリ名 -> 現在の中央インデックス。再描画（refresh）をまたいで保持する。
const carouselIndex = new Map();

function readItem(el) {
  return {
    el,
    id: el.dataset.id,
    name: el.dataset.name,
    desc: el.dataset.desc,
    price: Number(el.dataset.price || 0),
    owned: el.dataset.owned === '1',
    unlocked: el.dataset.unlocked === '1',
    unlockProgress: Number(el.dataset.unlockProgress || 0),
    canBuy: el.dataset.canBuy === '1'
  };
}

function renderDetail(detailEl, item) {
  if (!item) {
    detailEl.innerHTML = '';
    return;
  }
  let metaHtml;
  let buyHtml;
  if (item.owned) {
    metaHtml = `<div class="shop-detail__meta">購入ずみ</div>`;
    buyHtml = `<button type="button" class="btn shop-detail__buy" disabled>購入済み</button>`;
  } else if (!item.unlocked) {
    metaHtml = `<div class="shop-detail__meta">🔒 森の成長 ${item.unlockProgress}% で解放</div>`;
    buyHtml = `<button type="button" class="btn shop-detail__buy" disabled>まだひみつ</button>`;
  } else {
    metaHtml = `<div class="shop-detail__meta">${item.price}ポイント</div>`;
    buyHtml = `<button type="button" class="btn shop-detail__buy" data-buy-shop="${item.id}" ${item.canBuy ? '' : 'disabled'}>購入</button>`;
  }
  detailEl.innerHTML = `
    <div class="shop-detail__text">
      <div class="shop-detail__name">${item.name}</div>
      ${metaHtml}
    </div>
    ${buyHtml}
  `;
}

function updateVisual(section) {
  const track = section.querySelector('[data-shop-track]');
  const detail = section.querySelector('[data-shop-detail]');
  const prevBtn = section.querySelector('[data-shop-prev]');
  const nextBtn = section.querySelector('[data-shop-next]');
  const category = section.dataset.shopCategory;
  const cards = Array.from(track.children);
  if (!cards.length) return;

  let idx = carouselIndex.get(category) || 0;
  idx = Math.max(0, Math.min(cards.length - 1, idx));
  carouselIndex.set(category, idx);

  track.style.transform = `translateX(${-(idx * ITEM_STEP + ITEM_STEP / 2)}px)`;

  cards.forEach((el, i) => {
    const dist = Math.abs(i - idx);
    const scale = Math.max(0.55, 1 - dist * 0.18);
    const opacity = Math.max(0, 1 - dist * 0.32);
    el.style.transform = `scale(${scale})`;
    el.style.opacity = opacity;
    el.style.pointerEvents = dist > 4 ? 'none' : '';
    el.classList.toggle('is-center', i === idx);
  });

  if (prevBtn) prevBtn.disabled = idx === 0;
  if (nextBtn) nextBtn.disabled = idx === cards.length - 1;

  renderDetail(detail, readItem(cards[idx]));
}

function stepTo(section, nextIdx) {
  const track = section.querySelector('[data-shop-track]');
  const category = section.dataset.shopCategory;
  const count = track.children.length;
  const clamped = Math.max(0, Math.min(count - 1, nextIdx));
  if (clamped === carouselIndex.get(category)) return;
  carouselIndex.set(category, clamped);
  updateVisual(section);
}

function attachDrag(section) {
  const track = section.querySelector('[data-shop-track]');
  let drag = null;

  track.addEventListener('pointerdown', (e) => {
    drag = { startX: e.clientX, moved: false, pointerId: e.pointerId };
    track.classList.add('dragging');
    try { track.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
  });

  track.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const dx = e.clientX - drag.startX;
    if (Math.abs(dx) > 4) drag.moved = true;
    const category = section.dataset.shopCategory;
    const idx = carouselIndex.get(category) || 0;
    const base = -(idx * ITEM_STEP + ITEM_STEP / 2);
    track.style.transform = `translateX(${base + dx}px)`;
  });

  const endDrag = (e) => {
    if (!drag || (e.pointerId !== undefined && e.pointerId !== drag.pointerId)) return;
    const dx = e.clientX - drag.startX;
    track.classList.remove('dragging');
    const category = section.dataset.shopCategory;
    const idx = carouselIndex.get(category) || 0;
    drag = null;
    if (Math.abs(dx) > ITEM_STEP / 3) {
      stepTo(section, idx + (dx > 0 ? -1 : 1));
    } else {
      updateVisual(section);
    }
  };
  track.addEventListener('pointerup', endDrag);
  track.addEventListener('pointercancel', endDrag);

  // 中央以外のカードを直接タップしたら、それを中央に呼び寄せる
  // （購入はしない。購入は必ず下の詳細パネルのボタンから＝誤タップ防止）。
  track.addEventListener('click', (e) => {
    if (drag?.moved) return;
    const card = e.target.closest('[data-shop-item]');
    if (!card) return;
    const cards = Array.from(track.children);
    const i = cards.indexOf(card);
    if (i < 0) return;
    stepTo(section, i);
  });
}

function attachArrows(section) {
  const prevBtn = section.querySelector('[data-shop-prev]');
  const nextBtn = section.querySelector('[data-shop-next]');
  const category = section.dataset.shopCategory;
  prevBtn?.addEventListener('click', () => stepTo(section, (carouselIndex.get(category) || 0) - 1));
  nextBtn?.addEventListener('click', () => stepTo(section, (carouselIndex.get(category) || 0) + 1));
}

// refresh() で shopPanel の innerHTML を差し替えた直後に毎回呼ぶ。
// DOMは毎回作り直されるが、carouselIndexはモジュール内に残っているので
// 「さっき見ていた商品」がそのまま中央に来た状態で再描画される。
export function initShopCarousels(root) {
  const panel = root || document.getElementById('shopPanel');
  if (!panel) return;
  const sections = panel.querySelectorAll('[data-shop-category]');
  sections.forEach((section) => {
    attachDrag(section);
    attachArrows(section);
    updateVisual(section);
  });
}
