/*
  コツコツの森 core runtime
  - 保存 / 読込
  - 動物の出現と簡易移動
  - ショップ
  - 進行状態の共有
  - 成長イベント / バッジの自動反映
*/

function clone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

// events.json の演出テキストと、実際のゲーム内変化を紐付けるテーブル。
// 例えば「50% 池が現れる」なら魚が、「60% リスがあらわれる」なら実際に
// 小動物が自動的に出現するようにする(これまではテキストだけで見た目は変わらなかった)。
const EVENT_AUTO_SPAWN = {
  event_50: { type: 'fish', count: 2 },
  event_60: { type: 'animal_ground', count: 1 }
};

// バッジの解放判定ロジック。core-runtime(進行を確定させる側)と
// badge.js(表示用に評価するだけの側)の両方から使われる、副作用の無い純粋関数。
// これを共有することで、片方だけ直して食い違う、という事故を防ぐ。
export function isBadgeUnlocked(badge, progressPoints, completedEventIds) {
  const threshold = numberOrZero(badge?.condition?.progress);
  const requiredEvents = Array.isArray(badge?.condition?.completedEvents) ? badge.condition.completedEvents : [];
  const completedSet = completedEventIds instanceof Set ? completedEventIds : new Set(completedEventIds || []);
  return numberOrZero(progressPoints) >= threshold && requiredEvents.every((ev) => completedSet.has(ev));
}

function numberOrZero(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// 実際の遊びの中でポイントを稼ぐ手段。
// 「10ポイント追加」ボタンはデバッグ用として残すが、本来はこちらが本流。
const POINTS_PER_PLACEMENT = 2;
const POINTS_PER_ANIMAL_DISCOVERY = 3;
// 目標を1回達成したときに獲得するポイント。
const POINTS_PER_GOAL_COMPLETION = 20;
const MAX_GOALS_LIMIT = 5;

export class SaveManager {
  constructor(storageKey = 'kokotsu_forest_save_v1') {
    this.storageKey = storageKey;
  }

  defaultState() {
    return {
      version: '0.2',
      mapId: 'kokotsu_forest_01',
      // 個人ポイント: 所持ポイント。ショップで消費する。
      personalPoints: 0,
      // 個人の累積ポイント: 一度稼いだら減らない、その子自身の頑張りの記録。
      lifetimePoints: 0,
      // クラスポイント: 森の成長そのものを表す。全員の獲得ポイントがそのまま積み上がる、消費されない値。
      // イベント発生・バッジ解放・アイテム解放の判定は、すべてこの値を基準にする。
      classPoints: 0,
      // 目標: 子どもが自分で作成する(先生設定で承認制に切替可能)。
      goalSettings: {
        maxGoals: 3,      // 先生設定。1〜5個。
        approvalMode: 'self' // 'self'(子ども自身の判定) | 'teacher'(先生承認制)
      },
      goals: [],   // { id, title, targetCount, createdAt, active }
      goalLog: [], // { id, goalId, goalTitle, date, status, requestedAt, resolvedAt, points }
      activityLog: [],  // { id, type, message, createdAt } - クラス全員が見る最新ログ(最大50件)
      thanksLog: [],    // { id, toName, fromLabel, date, createdAt } - 「ありがとう」送信の記録
      notifications: [], // { id, type, message, createdAt, read } - 受信者向けの特別ポップアップ用キュー
      completedEvents: [],
      unlockedCategories: {
        tree: 0,
        flower: 0,
        mushroom: 0,
        pond: 0,
        animal: 0,
        path: 0,
        bridge: 0,
        rock: 0
      },
      placedAssets: [],
      ownedAssets: [],
      inventory: {
        acorn: 0,
        berry: 0,
        leaf: 0,
        sparkle: 0
      },
      settings: {
        season: 'spring',
        bgm: true,
        sfx: true,
        zoom: 1,
        cameraX: 50,
        cameraY: 40,
        showGrid: false,
        showSpots: true
      },
      animals: [],
      shopPurchased: [],
      badges: []
    };
  }

  load() {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) return this.defaultState();
      const parsed = JSON.parse(raw);
      return this.mergeWithDefault(parsed);
    } catch (error) {
      console.warn('[SaveManager] load failed:', error);
      return this.defaultState();
    }
  }

  save(state) {
    try {
      const normalized = this.mergeWithDefault(state);
      localStorage.setItem(this.storageKey, JSON.stringify(normalized));
      return true;
    } catch (error) {
      console.warn('[SaveManager] save failed:', error);
      return false;
    }
  }

  clear() {
    localStorage.removeItem(this.storageKey);
  }

  mergeWithDefault(state) {
    const base = this.defaultState();
    // 旧バージョン(progressPointsのみ)のセーブデータからの移行。
    // 当時は「個人ポイント」も「クラスポイント」も区別が無かったため、
    // 同じ値だったものとして3つのフィールドへ分配する。
    let migrated = {};
    if (state && state.progressPoints !== undefined && state.classPoints === undefined) {
      const legacy = numberOrZero(state.progressPoints);
      migrated = { personalPoints: legacy, lifetimePoints: legacy, classPoints: legacy };
    }
    return {
      ...base,
      ...state,
      ...migrated,
      unlockedCategories: {
        ...base.unlockedCategories,
        ...(state?.unlockedCategories || {})
      },
      inventory: {
        ...base.inventory,
        ...(state?.inventory || {})
      },
      settings: {
        ...base.settings,
        ...(state?.settings || {})
      },
      goalSettings: {
        ...base.goalSettings,
        ...(state?.goalSettings || {})
      },
      goals: Array.isArray(state?.goals) ? state.goals : base.goals,
      goalLog: Array.isArray(state?.goalLog) ? state.goalLog : base.goalLog,
      activityLog: Array.isArray(state?.activityLog) ? state.activityLog : base.activityLog,
      thanksLog: Array.isArray(state?.thanksLog) ? state.thanksLog : base.thanksLog,
      notifications: Array.isArray(state?.notifications) ? state.notifications : base.notifications,
      placedAssets: Array.isArray(state?.placedAssets) ? state.placedAssets : base.placedAssets,
      ownedAssets: Array.isArray(state?.ownedAssets) ? state.ownedAssets : base.ownedAssets,
      completedEvents: Array.isArray(state?.completedEvents) ? state.completedEvents : base.completedEvents,
      animals: Array.isArray(state?.animals) ? state.animals : base.animals,
      shopPurchased: Array.isArray(state?.shopPurchased) ? state.shopPurchased : base.shopPurchased,
      badges: Array.isArray(state?.badges) ? state.badges : base.badges
    };
  }
}

export class AnimalManager {
  constructor({ spots = [], assets = [] } = {}) {
    this.spots = spots;
    this.assets = assets;
    this.animals = [];
    this.lastTickAt = 0;
  }

  hydrate(savedAnimals = []) {
    this.animals = Array.isArray(savedAnimals) ? [...savedAnimals] : [];
    return this.animals;
  }

  spawnFromSpot(spot, assetId, extra = {}) {
    const id = `${assetId}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const animal = {
      id,
      assetId,
      spotId: spot.id,
      area: spot.area,
      state: extra.state || 'idle',
      direction: extra.direction || 'right',
      mood: extra.mood || 'normal',
      x: spot.x,
      y: spot.y,
      lastMoveAt: 0,
      moveCooldownMs: extra.moveCooldownMs || 12000,
      discovered: false
    };
    this.animals.push(animal);
    return animal;
  }

  countAtSpot(spotId) {
    return this.animals.filter((animal) => animal.spotId === spotId).length;
  }

  // spot.maxCount を守りながら生成する。
  // 既に満員のspotはスキップし、空きがあるspotにだけ振り分ける。
  spawnByType(type, count = 1) {
    const candidates = this.spots.filter((spot) => spot.type === type);
    const result = [];
    let remaining = count;

    for (const spot of candidates) {
      if (remaining <= 0) break;
      const maxCount = Math.max(1, Number(spot.maxCount || 1));
      let occupied = this.countAtSpot(spot.id);
      while (occupied < maxCount && remaining > 0) {
        const asset = this.pickAssetForSpot(spot);
        if (!asset) break;
        result.push(this.spawnFromSpot(spot, asset.id));
        occupied += 1;
        remaining -= 1;
      }
    }

    return { spawned: result, requested: count, shortBy: remaining };
  }

  pickAssetForSpot(spot) {
    const allowed = Array.isArray(spot.allow) ? spot.allow : [];
    if (allowed.length === 0) return null;
    const candidates = this.assets.filter((asset) => allowed.includes(asset.id) || allowed.includes(asset.type));
    if (candidates.length === 0) return null;
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  tick(now = Date.now()) {
    const delta = now - this.lastTickAt;
    this.lastTickAt = now;
    if (delta < 500) return this.animals;

    this.animals = this.animals.map((animal) => {
      if (now - (animal.lastMoveAt || 0) < (animal.moveCooldownMs || 12000)) {
        return animal;
      }

      const jitterX = Math.random() < 0.5 ? -1 : 1;
      const jitterY = Math.random() < 0.5 ? -1 : 1;
      const moveX = animal.state === 'fly' ? jitterX * 0.4 : jitterX * 0.15;
      const moveY = animal.state === 'fly' ? jitterY * 0.3 : jitterY * 0.08;

      return {
        ...animal,
        x: animal.x + moveX,
        y: animal.y + moveY,
        direction: moveX >= 0 ? 'right' : 'left',
        lastMoveAt: now
      };
    });

    return this.animals;
  }

  clickAnimal(animalId) {
    let isNewDiscovery = false;
    this.animals = this.animals.map((animal) => {
      if (animal.id !== animalId) return animal;
      isNewDiscovery = !animal.discovered;
      return {
        ...animal,
        mood: 'happy',
        state: animal.state === 'idle' ? 'bounce' : animal.state,
        lastMoveAt: 0,
        discovered: true
      };
    });
    return { animals: this.animals, isNewDiscovery };
  }

  serialize() {
    return [...this.animals];
  }
}

export class ShopManager {
  constructor(items = []) {
    this.items = Array.isArray(items) ? items : [];
  }

  setItems(items) {
    this.items = Array.isArray(items) ? items : [];
  }

  listAvailable(state) {
    return this.items.filter((item) => this.isUnlocked(item, state) && !this.isPurchased(item, state));
  }

  isUnlocked(item, state) {
    // 「森レベルによる解放」= クラス全体の進行度で決まる。個人の所持ポイントとは無関係。
    const progress = Number(state?.classPoints || 0);
    const unlockProgress = Number(item?.unlockCondition?.progress || 0);
    if (progress < unlockProgress) return false;
    return true;
  }

  isPurchased(item, state) {
    return Array.isArray(state?.shopPurchased) && state.shopPurchased.includes(item.id);
  }

  canBuy(item, state) {
    if (!item) return false;
    if (this.isPurchased(item, state)) return false;
    const price = Number(item.price || 0);
    const points = Number(state?.personalPoints || 0);
    return points >= price;
  }

  buy(itemId, state) {
    const item = this.items.find((it) => it.id === itemId);
    if (!item) {
      return { ok: false, reason: 'item_not_found' };
    }
    if (!this.canBuy(item, state)) {
      return { ok: false, reason: 'not_enough_points_or_locked' };
    }

    const nextState = clone(state);
    // 購入で減るのは「所持ポイント」だけ。クラスポイント(森の成長)と累積ポイント(頑張りの記録)は減らさない。
    nextState.personalPoints = Math.max(0, Number(nextState.personalPoints || 0) - Number(item.price || 0));
    nextState.shopPurchased = Array.isArray(nextState.shopPurchased) ? nextState.shopPurchased : [];
    nextState.shopPurchased.push(item.id);
    nextState.ownedAssets = Array.isArray(nextState.ownedAssets) ? nextState.ownedAssets : [];
    if (!nextState.ownedAssets.includes(item.assetId)) {
      nextState.ownedAssets.push(item.assetId);
    }

    return { ok: true, state: nextState, item };
  }
}

// 目標(1日◯回やる、達成したら報告する)を管理する。
// - 目標は子どもが自分で作る。数の上限だけ先生が決める(goalSettings.maxGoals)。
// - 達成の記録は日付ごとにリセットされる。データとしては「その日の分の記録が何件あるか」を
//   goalLog から数えるだけで、明示的なリセット処理は書かない(日付が変われば自然に0件になる)。
// - 承認制(goalSettings.approvalMode === 'teacher')のときは、達成報告は一旦 pending として
//   記録され、先生が1件ずつ approve/reject するまでポイントは付与されない。
export class GoalManager {
  static todayKey(date = new Date()) {
    const y = date.getFullYear();
    const m = `${date.getMonth() + 1}`.padStart(2, '0');
    const d = `${date.getDate()}`.padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  ensureState(state) {
    state.goalSettings = state.goalSettings || {};
    state.goalSettings.maxGoals = clamp(Math.round(numberOrZero(state.goalSettings.maxGoals) || 3), 1, MAX_GOALS_LIMIT);
    state.goalSettings.approvalMode = state.goalSettings.approvalMode === 'teacher' ? 'teacher' : 'self';
    state.goals = Array.isArray(state.goals) ? state.goals : [];
    state.goalLog = Array.isArray(state.goalLog) ? state.goalLog : [];
  }

  listGoals(state) {
    this.ensureState(state);
    return state.goals.filter((g) => g.active !== false);
  }

  createGoal(state, { title, targetCount = 1 } = {}) {
    this.ensureState(state);
    const cleanTitle = String(title || '').trim();
    if (!cleanTitle) return { ok: false, reason: 'empty_title' };
    if (this.listGoals(state).length >= state.goalSettings.maxGoals) {
      return { ok: false, reason: 'max_goals_reached' };
    }
    const goal = {
      id: `goal_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      title: cleanTitle,
      targetCount: clamp(Math.round(Number(targetCount) || 1), 1, 20),
      createdAt: new Date().toISOString(),
      active: true
    };
    state.goals.push(goal);
    return { ok: true, goal };
  }

  removeGoal(state, goalId) {
    this.ensureState(state);
    const goal = state.goals.find((g) => g.id === goalId);
    if (!goal) return false;
    goal.active = false;
    return true;
  }

  setMaxGoals(state, count) {
    this.ensureState(state);
    state.goalSettings.maxGoals = clamp(Math.round(Number(count) || 1), 1, MAX_GOALS_LIMIT);
  }

  setApprovalMode(state, mode) {
    this.ensureState(state);
    state.goalSettings.approvalMode = mode === 'teacher' ? 'teacher' : 'self';
  }

  // 今日この目標が「何回終わっていて(done)」「何回承認待ちか(pending)」を数える。
  // 日付が変われば todayKey が変わるので、これだけで自動的に毎日リセットされる。
  getTodayStatus(state, goalId, now = new Date()) {
    this.ensureState(state);
    const today = GoalManager.todayKey(now);
    const entries = state.goalLog.filter((e) => e.goalId === goalId && e.date === today);
    const done = entries.filter((e) => e.status === 'approved').length;
    const pending = entries.filter((e) => e.status === 'pending').length;
    return { done, pending };
  }

  // 「クリアボタン」が押されたときの唯一の入り口。
  requestCompletion(state, goalId, now = new Date()) {
    this.ensureState(state);
    const goal = state.goals.find((g) => g.id === goalId && g.active !== false);
    if (!goal) return { ok: false, reason: 'goal_not_found' };
    const { done, pending } = this.getTodayStatus(state, goalId, now);
    if (done + pending >= goal.targetCount) {
      return { ok: false, reason: 'already_completed_today' };
    }
    const isTeacherMode = state.goalSettings.approvalMode === 'teacher';
    const entry = {
      id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      goalId,
      goalTitle: goal.title,
      date: GoalManager.todayKey(now),
      status: isTeacherMode ? 'pending' : 'approved',
      requestedAt: now.toISOString(),
      resolvedAt: isTeacherMode ? null : now.toISOString(),
      points: 0
    };
    state.goalLog.push(entry);

    let pointsAwarded = 0;
    if (!isTeacherMode) {
      pointsAwarded = awardPoints(state, POINTS_PER_GOAL_COMPLETION);
      entry.points = pointsAwarded;
    }
    return { ok: true, entry, pointsAwarded, needsApproval: isTeacherMode };
  }

  listPendingApprovals(state) {
    this.ensureState(state);
    return state.goalLog
      .filter((e) => e.status === 'pending')
      .sort((a, b) => new Date(a.requestedAt) - new Date(b.requestedAt));
  }

  // 承認は1件ずつ。一括承認はしない(仕様どおり)。
  approve(state, logId, now = new Date()) {
    this.ensureState(state);
    const entry = state.goalLog.find((e) => e.id === logId && e.status === 'pending');
    if (!entry) return { ok: false, reason: 'not_found' };
    entry.status = 'approved';
    entry.resolvedAt = now.toISOString();
    const pointsAwarded = awardPoints(state, POINTS_PER_GOAL_COMPLETION);
    entry.points = pointsAwarded;
    return { ok: true, entry, pointsAwarded };
  }

  reject(state, logId, now = new Date()) {
    this.ensureState(state);
    const entry = state.goalLog.find((e) => e.id === logId && e.status === 'pending');
    if (!entry) return { ok: false, reason: 'not_found' };
    entry.status = 'rejected';
    entry.resolvedAt = now.toISOString();
    return { ok: true, entry };
  }
}

// 「ありがとう」ボタン。
// - 1人に対しては1日1回まで。
// - 直前に送った相手と同じ人へは連続で送れない(日をまたいでも)。
// 実際に複数の児童がいるわけではない今のローカル単独状態でも、
// ルールと記録のフォーマットはGAS接続後にそのまま使える形にしてある。
export class ThanksManager {
  canSend(state, toName, now = new Date()) {
    const name = String(toName || '').trim();
    if (!name) return { ok: false, reason: 'empty_name' };
    const log = Array.isArray(state.thanksLog) ? state.thanksLog : [];
    const today = GoalManager.todayKey(now);
    if (log.some((e) => e.date === today && e.toName === name)) {
      return { ok: false, reason: 'already_sent_today' };
    }
    const last = log[log.length - 1];
    if (last && last.toName === name) {
      return { ok: false, reason: 'same_as_last' };
    }
    return { ok: true, name };
  }

  send(state, toName, fromLabel = 'わたし', now = new Date()) {
    const check = this.canSend(state, toName, now);
    if (!check.ok) return check;
    state.thanksLog = Array.isArray(state.thanksLog) ? state.thanksLog : [];
    const entry = {
      id: `thanks_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      toName: check.name,
      fromLabel,
      date: GoalManager.todayKey(now),
      createdAt: now.toISOString()
    };
    state.thanksLog.push(entry);
    return { ok: true, entry };
  }
}

function sortEvents(events = []) {
  return [...events].sort((a, b) => {
    const progressDiff = numberOrZero(a?.progress) - numberOrZero(b?.progress);
    if (progressDiff !== 0) return progressDiff;
    return numberOrZero(a?.priority) - numberOrZero(b?.priority);
  });
}

// ポイントを獲得するときの唯一の入り口。
// 「個人ポイント獲得 → そのまま同じ数だけクラスポイントも加算」という仕様どおり、
// 3つのフィールドを常に一緒に増やす。減らす処理(ショップ購入)はここを通らない。
function awardPoints(state, points) {
  const amount = numberOrZero(points);
  if (!amount) return 0;
  state.personalPoints = Math.max(0, numberOrZero(state.personalPoints) + amount);
  state.lifetimePoints = Math.max(0, numberOrZero(state.lifetimePoints) + amount);
  state.classPoints = Math.max(0, numberOrZero(state.classPoints) + amount);
  return amount;
}

const ACTIVITY_LOG_LIMIT = 50;

// クラス全員に見える最新ログ。ホームでは1〜3件、ログ画面では最大50件まで。
// 「最新50件まで」を保つため、上限を超えたら古いものから捨てる。
function pushActivityLog(state, { type, message }) {
  state.activityLog = Array.isArray(state.activityLog) ? state.activityLog : [];
  state.activityLog.push({
    id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    type,
    message,
    createdAt: new Date().toISOString()
  });
  if (state.activityLog.length > ACTIVITY_LOG_LIMIT) {
    state.activityLog = state.activityLog.slice(-ACTIVITY_LOG_LIMIT);
  }
}

function applyReward(state, reward = {}) {
  let pointsAdded = 0;
  const itemsAdded = {};

  const rewardPoints = numberOrZero(reward?.points);
  if (rewardPoints) {
    pointsAdded += awardPoints(state, rewardPoints);
  }

  const rewardItems = reward?.items && typeof reward.items === 'object' ? reward.items : {};
  state.inventory = state.inventory || {};
  for (const [key, value] of Object.entries(rewardItems)) {
    const amount = numberOrZero(value);
    if (!amount) continue;
    state.inventory[key] = Math.max(0, numberOrZero(state.inventory[key]) + amount);
    itemsAdded[key] = (itemsAdded[key] || 0) + amount;
  }

  return { pointsAdded, itemsAdded };
}

// unlockedCategories ({ tree, flower, mushroom, pond, animal, path, bridge })
// と assets.json の対応表。
// - ほとんどは asset.type がそのままカテゴリ名
// - bird / animal / fish の3 type は、まとめて "animal" カテゴリとして扱う
// - path だけ type は "terrain" のままなので layer:"path" で見分ける
// （events.json / shop.json にカテゴリの明示的な対応が無いための暫定ルール。
//   意図と違う場合はこの対応表を書き換えれば挙動を変えられる）
const TYPE_TO_CATEGORY = {
  tree: 'tree',
  flower: 'flower',
  mushroom: 'mushroom',
  pond: 'pond',
  bridge: 'bridge',
  bird: 'animal',
  animal: 'animal',
  fish: 'animal',
  insect: 'animal',
  rock: 'rock'
};

const CATEGORY_LABELS = {
  tree: '木', flower: '花', mushroom: 'きのこ', pond: '池',
  animal: '動物', path: '小道', bridge: '橋', rock: '岩'
};

function categoryForAsset(asset) {
  if (!asset) return null;
  if (asset.layer === 'path') return 'path';
  // stump_01 は type:"terrain" だが layer:"rock" なので、layer側でも拾う
  if (asset.layer === 'rock') return 'rock';
  return TYPE_TO_CATEGORY[asset.type] || null;
}

export class ForestCore {
  constructor({ assets = [], spots = [], shopItems = [], storageKey } = {}) {
    this.saveManager = new SaveManager(storageKey);
    this.state = this.saveManager.load();
    this.assets = assets;
    this.spots = spots;
    this.events = [];
    this.badgesCatalog = [];
    this.pendingMilestoneSummary = null;
    this.animals = new AnimalManager({ spots, assets });
    this.animals.hydrate(this.state.animals);
    this.shop = new ShopManager(shopItems);
    this.goalManager = new GoalManager();
    this.goalManager.ensureState(this.state);
    this.thanksManager = new ThanksManager();
  }

  getState() {
    return this.state;
  }

  setAssets(assets) {
    this.assets = Array.isArray(assets) ? assets : [];
    this.animals.assets = this.assets;
  }

  setSpots(spots) {
    this.spots = Array.isArray(spots) ? spots : [];
    this.animals.spots = this.spots;
  }

  setEvents(events) {
    this.events = Array.isArray(events) ? events : [];
    return this.syncMilestones();
  }

  setBadges(badges) {
    this.badgesCatalog = Array.isArray(badges) ? badges : [];
    return this.syncMilestones();
  }

  setShopItems(items) {
    this.shop.setItems(items);
  }

  consumeMilestoneSummary() {
    const summary = this.pendingMilestoneSummary;
    this.pendingMilestoneSummary = null;
    return summary;
  }

  syncMilestones() {
    const summary = {
      newEvents: [],
      newBadges: [],
      newCategories: [],
      rewardPoints: 0,
      rewardItems: {}
    };

    let changed = false;
    let safety = 0;

    do {
      let localChanged = false;
      this.state.completedEvents = Array.isArray(this.state.completedEvents) ? this.state.completedEvents : [];
      this.state.badges = Array.isArray(this.state.badges) ? this.state.badges : [];
      const completedSet = new Set(this.state.completedEvents);
      const earnedBadges = new Set(this.state.badges);

      for (const event of sortEvents(this.events)) {
        if (numberOrZero(this.state.classPoints) < numberOrZero(event?.progress)) continue;
        if (completedSet.has(event.id)) continue;
        completedSet.add(event.id);
        summary.newEvents.push({
          id: event.id,
          title: event.title || event.id,
          message: event.message || '',
          effect: event.effect || null
        });
        localChanged = true;

        // イベントの内容と実際の見た目を連動させる。
        // 例:「池が現れる」イベントで魚が湧く、「リスがあらわれる」で実際にリスが出る。
        const autoSpawn = EVENT_AUTO_SPAWN[event.id];
        if (autoSpawn) {
          const { spawned } = this.animals.spawnByType(autoSpawn.type, autoSpawn.count);
          if (spawned.length) {
            this.state.animals = this.animals.serialize();
            summary.autoSpawned = summary.autoSpawned || [];
            summary.autoSpawned.push(...spawned.map((a) => a.assetId));
          }
        }
      }

      if (localChanged) {
        this.state.completedEvents = [...completedSet];
      }

      const evaluatedBadges = this.badgesCatalog.map((badge) => ({
        ...badge,
        unlocked: isBadgeUnlocked(badge, this.state.classPoints, completedSet)
      }));

      for (const badge of evaluatedBadges) {
        if (!badge.unlocked || earnedBadges.has(badge.id)) continue;
        earnedBadges.add(badge.id);
        summary.newBadges.push({
          id: badge.id,
          name: badge.name || badge.id,
          description: badge.description || ''
        });
        if (badge.reward) {
          const rewardResult = applyReward(this.state, badge.reward);
          summary.rewardPoints += rewardResult.pointsAdded;
          for (const [key, value] of Object.entries(rewardResult.itemsAdded)) {
            summary.rewardItems[key] = (summary.rewardItems[key] || 0) + value;
          }
        }
        localChanged = true;
      }

      if (localChanged) {
        this.state.badges = [...earnedBadges];
        changed = true;
      } else {
        changed = false;
      }

      safety += 1;
    } while (changed && safety < 6);

    // イベント・バッジで進行度が動いた後の最終状態を基準に、
    // カテゴリ（tree/flower/mushroom/pond/animal/path/bridge）の解放を判定する。
    // 「そのカテゴリの素材を1つでも置ける状態になった」= 解放、という単純なルール。
    for (const asset of this.assets || []) {
      const category = categoryForAsset(asset);
      if (!category) continue;
      if (!this.canPlaceAsset(asset.id)) continue;
      if (this.setCategoryLevel(category, 1)) {
        summary.newCategories.push({ category });
      }
    }

    this.pendingMilestoneSummary = summary;

    for (const ev of summary.newEvents) {
      pushActivityLog(this.state, { type: 'forest_event', message: `🌲「${ev.title}」が起きました` });
    }
    for (const badge of summary.newBadges) {
      pushActivityLog(this.state, { type: 'badge', message: `🏅「${badge.name}」を獲得しました` });
    }
    for (const cat of summary.newCategories) {
      const label = CATEGORY_LABELS[cat.category] || cat.category;
      pushActivityLog(this.state, { type: 'unlock', message: `🌱 ${label}が解放されました` });
    }

    return summary;
  }

  addPoints(points) {
    awardPoints(this.state, points);
    this.syncMilestones();
    this.persist();
    return this.state.classPoints;
  }

  setCategoryLevel(category, level = 1) {
    this.state.unlockedCategories = this.state.unlockedCategories || {};
    const current = numberOrZero(this.state.unlockedCategories[category] || 0);
    const next = Math.max(current, numberOrZero(level || 1));
    this.state.unlockedCategories[category] = next;
    return next !== current;
  }

  unlockCategory(category, level = 1) {
    this.setCategoryLevel(category, level);
    this.persist();
  }

  // そのアセットを今この状態で「選択・配置してよいか」を判定する唯一の場所。
  // - ショップに商品があるアセット: ownedAssets に入っている（＝購入済み）ことが必要
  // - ショップに商品がないアセット（地面・道など無料の地形）: classPoints が unlock 以上であればOK
  isAssetOwned(assetId) {
    const owned = new Set([
      ...(Array.isArray(this.state.ownedAssets) ? this.state.ownedAssets : []),
      ...(Array.isArray(this.state.shopPurchased) ? this.state.shopPurchased : [])
    ]);
    return owned.has(assetId);
  }

  canPlaceAsset(assetId) {
    const asset = (this.assets || []).find((a) => a.id === assetId);
    if (!asset) return false;
    // pond_medium_01 / bridge_medium_01 のように、最初からmap.json上に
    // 固定terrainとして存在するアセットは、二重配置を防ぐため常に不可。
    if (asset.placeable === false) return false;
    if (this.isAssetOwned(assetId)) return true;

    const requiresShop = (this.shop.items || []).some((item) => item.assetId === assetId);
    if (requiresShop) return false;

    const threshold = numberOrZero(asset.unlock);
    return numberOrZero(this.state.classPoints) >= threshold;
  }

  // spotId ごとに、今何個置かれているかを placedAssets から動的に数える。
  // spots.json 側の occupied フィールドは静的なテンプレート値なので、
  // ここでは実際の配置状況から毎回計算し直す（削除したら自動的に空きが戻る）。
  countPlacedAtSpot(spotId) {
    if (!spotId) return 0;
    const placedAssets = Array.isArray(this.state.placedAssets) ? this.state.placedAssets : [];
    return placedAssets.filter((item) => item.spotId === spotId).length;
  }

  isSpotAvailable(spotId) {
    if (!spotId) return true;
    const spot = (this.spots || []).find((s) => s.id === spotId);
    if (!spot) return true;
    const maxCount = numberOrZero(spot.maxCount) || 1;
    return this.countPlacedAtSpot(spotId) < maxCount;
  }

  placeAsset(assetId, spotId, x, y) {
    if (!this.canPlaceAsset(assetId)) {
      return { ok: false, reason: 'not_owned' };
    }
    if (spotId && !this.isSpotAvailable(spotId)) {
      return { ok: false, reason: 'spot_full' };
    }
    const item = { assetId, spotId, x, y };
    this.state.placedAssets = Array.isArray(this.state.placedAssets) ? this.state.placedAssets : [];
    this.state.placedAssets.push(item);

    // 配置そのものが進行の主な手段になる。
    awardPoints(this.state, POINTS_PER_PLACEMENT);
    this.syncMilestones();
    this.persist();
    return { ok: true, ...item, pointsAwarded: POINTS_PER_PLACEMENT };
  }

  removePlacedAsset(index) {
    if (!Array.isArray(this.state.placedAssets)) return false;
    if (index < 0 || index >= this.state.placedAssets.length) return false;
    this.state.placedAssets.splice(index, 1);
    this.persist();
    return true;
  }

  buy(itemId) {
    const result = this.shop.buy(itemId, this.state);
    if (!result.ok) return result;
    this.state = result.state;
    pushActivityLog(this.state, { type: 'purchase', message: `🛍️「${result.item.name || result.item.id}」を手に入れました` });
    this.syncMilestones();
    this.persist();
    return result;
  }

  spawnAnimal(type, count = 1) {
    const { spawned, shortBy } = this.animals.spawnByType(type, count);
    this.state.animals = this.animals.serialize();
    if (spawned.length) this.persist();
    return { spawned, shortBy, ok: spawned.length > 0 };
  }

  clickAnimal(animalId) {
    const { isNewDiscovery } = this.animals.clickAnimal(animalId);
    this.state.animals = this.animals.serialize();

    let pointsAwarded = 0;
    if (isNewDiscovery) {
      pointsAwarded = POINTS_PER_ANIMAL_DISCOVERY;
      awardPoints(this.state, pointsAwarded);
      this.syncMilestones();
    }
    this.persist();
    return { isNewDiscovery, pointsAwarded };
  }

  tick(now = Date.now()) {
    this.animals.tick(now);
    this.state.animals = this.animals.serialize();
    return this.state.animals;
  }

  setSeason(season) {
    this.state.settings = this.state.settings || {};
    this.state.settings.season = season;
    this.persist();
  }

  setZoom(zoom) {
    this.state.settings = this.state.settings || {};
    this.state.settings.zoom = zoom;
    this.persist();
  }

  setCamera(x, y) {
    this.state.settings = this.state.settings || {};
    this.state.settings.cameraX = x;
    this.state.settings.cameraY = y;
    this.persist();
  }

  setUIFlag(name, value) {
    this.state.settings = this.state.settings || {};
    this.state.settings[name] = value;
    this.persist();
  }

  // ---- 目標(goal) ----

  listGoals() {
    return this.goalManager.listGoals(this.state);
  }

  getGoalSettings() {
    this.goalManager.ensureState(this.state);
    return this.state.goalSettings;
  }

  getGoalStatus(goalId) {
    return this.goalManager.getTodayStatus(this.state, goalId);
  }

  createGoal(title, targetCount = 1) {
    const result = this.goalManager.createGoal(this.state, { title, targetCount });
    if (result.ok) this.persist();
    return result;
  }

  removeGoal(goalId) {
    const ok = this.goalManager.removeGoal(this.state, goalId);
    if (ok) this.persist();
    return ok;
  }

  // 先生用: 目標の上限数(1〜5)。
  setMaxGoals(count) {
    this.goalManager.setMaxGoals(this.state, count);
    this.persist();
  }

  // 先生用: 'self'(子ども自身の判定) か 'teacher'(先生承認制)。
  setGoalApprovalMode(mode) {
    this.goalManager.setApprovalMode(this.state, mode);
    this.persist();
  }

  // 「クリア」ボタン。self判定モードなら即ポイント付与、先生承認制なら承認待ちになる。
  completeGoal(goalId) {
    const result = this.goalManager.requestCompletion(this.state, goalId);
    if (result.ok) {
      const title = result.entry.goalTitle;
      pushActivityLog(this.state, {
        type: 'goal',
        message: result.needsApproval
          ? `⏳「${title}」の達成を報告しました（承認待ち）`
          : `✅「${title}」を達成しました（+${result.pointsAwarded}pt）`
      });
      this.syncMilestones();
      this.persist();
    }
    return result;
  }

  listPendingApprovals() {
    return this.goalManager.listPendingApprovals(this.state);
  }

  approveGoal(logId) {
    const result = this.goalManager.approve(this.state, logId);
    if (result.ok) {
      pushActivityLog(this.state, {
        type: 'goal_approved',
        message: `👍「${result.entry.goalTitle}」が承認されました（+${result.pointsAwarded}pt）`
      });
      this.syncMilestones();
      this.persist();
    }
    return result;
  }

  rejectGoal(logId) {
    const result = this.goalManager.reject(this.state, logId);
    if (result.ok) {
      pushActivityLog(this.state, {
        type: 'goal_rejected',
        message: `「${result.entry.goalTitle}」の達成報告は今回見送りになりました`
      });
      this.persist();
    }
    return result;
  }

  // ---- ログ・ありがとう ----

  // limit=3 でホーム用、limit=50(デフォルト)でログ画面用。新しい順。
  listRecentActivity(limit = 50) {
    const log = Array.isArray(this.state.activityLog) ? this.state.activityLog : [];
    return log.slice(-limit).reverse();
  }

  sendThanks(toName, fromLabel = 'わたし') {
    const result = this.thanksManager.send(this.state, toName, fromLabel);
    if (result.ok) {
      pushActivityLog(this.state, {
        type: 'thanks',
        message: `🧡 ${fromLabel}が${result.entry.toName}さんに「ありがとう」を送りました`
      });
      this.persist();
    }
    return result;
  }

  // デモ用: GAS接続後は他の児童からの送信で自動的に発火する。
  // 単独ローカル動作の今は、受信ポップアップの見た目を確認するためのプレビュー。
  previewIncomingThanks(fromLabel = 'ともだち') {
    this.state.notifications = Array.isArray(this.state.notifications) ? this.state.notifications : [];
    const notification = {
      id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      type: 'thanks_received',
      message: `${fromLabel}さんから「ありがとう」が届きました！`,
      createdAt: new Date().toISOString(),
      read: false
    };
    this.state.notifications.push(notification);
    pushActivityLog(this.state, { type: 'thanks_received', message: `🧡 ${fromLabel}さんから「ありがとう」が届きました` });
    this.persist();
    return notification;
  }

  // 未読の特別ポップアップを取り出して既読にする。
  consumeNotifications() {
    const all = Array.isArray(this.state.notifications) ? this.state.notifications : [];
    const unread = all.filter((n) => !n.read);
    if (unread.length) {
      this.state.notifications = all.map((n) => ({ ...n, read: true }));
      this.persist();
    }
    return unread;
  }

  persist() {
    this.saveManager.save(this.state);
  }

  reset() {
    this.state = this.saveManager.defaultState();
    this.animals.hydrate([]);
    this.goalManager.ensureState(this.state);
    this.pendingMilestoneSummary = null;
    this.persist();
  }
}


export function createForestCoreFromData({ assets, spots, shopItems, storageKey } = {}) {
  return new ForestCore({ assets, spots, shopItems, storageKey });
}
