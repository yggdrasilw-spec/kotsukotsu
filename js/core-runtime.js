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
// (v25) それまで「メッセージだけで見た目は何も変わらない」イベントが半分近くあった
// (event_20/25/30/40/45/55/70/75/80/85/90/95等)ため、各イベントのメッセージ内容と
// data/assets.jsonのunlockしきい値に合わせて、対応する生き物が実際に出現するよう
// 一通り埋めた。bird/insectはspots.json側に元々枠(birdSpot, insectSpot)があったのに
// どのイベントからも呼ばれておらず、ずっと空きスポットのままになっていた。
const EVENT_AUTO_SPAWN = {
  event_40: { type: 'insect', count: 3 },        // 虫たちが集まりだす(ハチ・チョウ / unlock40)
  event_45: { type: 'insect', count: 2 },         // きのこが仲間を増やす(…とトンボ / unlock45)
  event_50: { type: 'fish', count: 2 },           // 池が現れる
  event_55: { type: 'bird', count: 2 },           // 小鳥がやってくる(unlock55)
  event_60: { type: 'animal_ground', count: 1 },  // リスがあらわれる(unlock60)
  event_70: { type: 'animal_ground', count: 2 },  // うさぎとかえるが遊びに来る(unlock70)
  event_85: { type: 'insect', count: 2 }          // 森じゅうがにぎやかになる
};

// 「木」「岩」は"大物"として、児童が選んで置くのではなく進行度(%)に応じて
// システム側が自動でspots.jsonの決まった場所へ配置する(v24)。
// (v25) 森の始まりに置いていた「進行度15%でtree_oak_01を即フルサイズ配置」は、
// 他のアセットに比べて大きすぎるうえ育つ演出も無く不自然だったため廃止。
// 代わりに中心の symbolTreeSpot に「シンボルツリー」を森の開始時から1本植え、
// 進行度に応じて少しずつ大きく描画する(見た目のスケーリングはrender.js側)。
// treeSpotは全部で3つ。以前はevent_15で1本+event_65で残り2本だったが、
// event_15を廃止したためevent_65でまとめて3本とも配置する。
// rockSpotは合計10だが、event_35の一度きりの演出なので控えめに4個だけ配置する。
// mushroom/effect(きらきら)スポットも同様にこれまで一度も自動配置されておらず
// 空のままだったため、対応するイベントに合わせて追加した。
const EVENT_AUTO_PLACE = {
  event_35: { spotType: 'rock', count: 4 },      // 岩が顔を出す
  event_45: { spotType: 'mushroom', count: 4 },  // きのこが仲間を増やす(unlock45)
  event_65: { spotType: 'tree', count: 3 },      // 新しい木が仲間入り
  event_75: { spotType: 'effect', count: 6 },    // 森が輝きだす
  event_80: { spotType: 'effect', count: 4 },    // 虹が出る
  event_95: { spotType: 'effect', count: 5 },    // 完成まであと少し
  event_100: { spotType: 'effect', count: 10 }   // 森の完成(フィナーレのきらめき)
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

// 進行度(%)の計算をここ一箇所にまとめる。
// events.json / badges.json / shop.json / assets.json の各しきい値は
// すべて「0〜100の割合」で書かれている前提なので、実際の判定は
// 生のclassPoints同士ではなく、必ずこの%へ変換してから比較する。
// clearPoint(完全クリアに必要なクラスポイント)は先生がteacher.htmlで
// 設定できる値(state.classInfo.clearPoint)で、GAS未接続のローカル単独時や
// サーバー同期前は既定値1000を使う(teacher.html/GAS側のデフォルトと揃える。
// 以前はここが100のままで、GAS側の1000と食い違って森が早期に完成扱いに
// なるバグがあった)。
export function computeProgressPercent(state) {
  const clearPoint = numberOrZero(state?.classInfo?.clearPoint) || 1000;
  const percent = (numberOrZero(state?.classPoints) / clearPoint) * 100;
  return clamp(Math.round(percent * 10) / 10, 0, 100);
}

// 起動画面ポップアップ用の一言。連続ログイン日数と、きのうの活動量に応じて変える。
function pickEncouragement(streak, yesterdayCount) {
  if (streak >= 7) return `${streak}日連続で森に来てくれてありがとう！すごい記録だね`;
  if (streak >= 3) return `${streak}日連続だね。その調子でコツコツ育てよう`;
  if (yesterdayCount > 0) return 'きのうもがんばったね。今日も森に会いにきてくれてありがとう';
  return '今日も森に来てくれてありがとう。コツコツ育てていこう';
}

// 実際の遊びの中でポイントを稼ぐ手段。
// 「10ポイント追加」ボタンはデバッグ用として残すが、本来はこちらが本流。
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
      // イベント発生・バッジ解放・アイテム解放の判定は、すべて classPoints÷clearPoint の「%」を基準にする
      // (computeProgressPercent参照)。classPoints自体は森ごとにリセットされる(startNewForest参照)。
      classPoints: 0,
      // クラスに関する設定。サーバー同期時はFirebaseSyncがFirestoreの値で上書きする。
      classInfo: {
        classCode: null,
        teacherName: '',
        // 完全クリア(=進行度100%)とみなすまでに必要なクラスポイント。先生がteacher.htmlで設定できる。
        // ローカル単独時はこの既定値(1000。teacher.html/Firebase側のデフォルトと揃えてある)がそのまま使われる。
        clearPoint: 1000
      },
      // 先生が「次の森を解放する」までは次の森へ進めない(v23)。ローカル単独時(先生がいない)は
      // 常にtrueのままにしておき、クラス接続時はFirebaseSyncがFirestoreの値で上書きする。
      nextForestUnlocked: true,
      // ---- 森のライフサイクル ----
      // 1つの森は進行度100%で「完成」する。完成後に子どもが「新しい森を始める」を選ぶと、
      // それまでの森は forestHistory に記録として残り、classPoints等の「森そのものの成長を
      // 表す値」だけが0に戻って次の森が始まる(個人の頑張りの記録=lifetimePoints等は消えない)。
      forestGeneration: 1,
      forestStatus: 'growing', // 'growing' | 'completed'
      forestStartedAt: null,
      forestCompletedAt: null,
      forestHistory: [], // 過去に完成させた森の記録 { generation, startedAt, completedAt, finalClassPoints, ... }
      // 起動画面ポップアップ(連続ログイン日数)用。
      lastLoginAt: null,
      loginStreak: 0,
      // (v25) 中心のシンボルツリーへズームインする「森のはじまり」演出を、
      // その世代でまだ見せていなければtrue→falseのまま。1回見せたらtrueにする
      // (startNewForest()で次の代ではまたfalseに戻す)。
      symbolTreeIntroShown: false,
      // 目標: 子どもが自分で作成する(先生設定で承認制に切替可能)。
      goalSettings: {
        maxGoals: 3,      // 先生設定。1〜5個。
        approvalMode: 'self' // 'self'(子ども自身の判定) | 'teacher'(先生承認制)
      },
      goals: [],   // { id, title, targetCount, createdAt, active }
      goalLog: [], // { id, goalId, goalTitle, date, status, requestedAt, resolvedAt, points }
      // 直近で「クリア」がポイントに反映された目標(承認不要ならcompleteGoal時、承認制ならapproveGoal時)。
      // 花などを配置した瞬間にこの値をスタンプすることで、「その花はどの目標のときに置いたか」を
      // ゆるく紐付ける(ポイント自体は共有のプールなので、厳密な出納ではなく「そのとき頑張っていた目標」という位置づけ)。
      lastCompletedGoal: null, // { goalId, goalTitle, at }
      // studentId -> nickname のクラス名簿。サーバー同期時にFirebaseSyncが埋める(ローカル単独時は空のまま)。
      studentDirectory: {},
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
      // ショップで買った「まだ配置していない在庫」の数。assetId -> 個数。
      // 購入するたびに+1、配置するたびに-1する(クラスポイントには影響しない)。
      assetQuantities: {},
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
        simpleMode: false,
        furigana: true,
        showSpots: true,
        // 低学年・支援級向けに、サイドパネルを1つずつ切り替えて見せる「かんたん表示」。
        // 既定はオフ(いままで通り全パネル表示)。子ども・先生がいつでも切り替えられる。
        simpleMode: false
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
      classInfo: {
        ...base.classInfo,
        ...(state?.classInfo || {})
      },
      forestHistory: Array.isArray(state?.forestHistory) ? state.forestHistory : base.forestHistory,
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
      // 旧バージョン(placedId/だれが/いつ/目標を持たない)のセーブデータからの移行。
      // タップ詳細ポップアップが開けるよう、無ければその場でplacedId等を補って埋める。
      // (だれが置いたか・どの目標かまでは当時の記録に無いので、そこは「記録なし」表示になる)
      placedAssets: (Array.isArray(state?.placedAssets) ? state.placedAssets : base.placedAssets).map((p, i) => ({
        ...p,
        placedId: p.placedId || `legacy_${i}_${Math.random().toString(36).slice(2, 7)}`,
        studentId: p.studentId ?? null,
        nickname: p.nickname ?? null,
        goalId: p.goalId ?? null,
        goalTitle: p.goalTitle ?? null
      })),
      ownedAssets: Array.isArray(state?.ownedAssets) ? state.ownedAssets : base.ownedAssets,
      assetQuantities: {
        ...base.assetQuantities,
        ...(state?.assetQuantities || {})
      },
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
    return this.items.filter((item) => this.isUnlocked(item, state));
  }

  isUnlocked(item, state) {
    // 「森レベルによる解放」= クラス全体の進行度(%)で決まる。個人の所持ポイントとは無関係。
    const progress = computeProgressPercent(state);
    const unlockProgress = Number(item?.unlockCondition?.progress || 0);
    if (progress < unlockProgress) return false;
    return true;
  }

  // 「一度でも買ったことがあるか」。購入回数の制限には使わない(何度でも買える)。
  // ショップカードに「持っている」バッジを出す判定にだけ使う表示用フラグ。
  isPurchased(item, state) {
    return Array.isArray(state?.shopPurchased) && state.shopPurchased.includes(item.id);
  }

  getQuantity(assetId, state) {
    return numberOrZero(state?.assetQuantities?.[assetId]);
  }

  // (v26) 購入は何度でもできる。1回買うごとに、そのアセットの「まだ配置していない在庫」が
  // 1個増える。配置するとその在庫を1個消費する(placeAsset参照)。ポイントが足りる限り、
  // 同じ商品を何個でも買って在庫を増やせる。
  canBuy(item, state) {
    if (!item) return false;
    if (!this.isUnlocked(item, state)) return false;
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
    if (!nextState.shopPurchased.includes(item.id)) {
      nextState.shopPurchased.push(item.id);
    }
    nextState.ownedAssets = Array.isArray(nextState.ownedAssets) ? nextState.ownedAssets : [];
    if (!nextState.ownedAssets.includes(item.assetId)) {
      nextState.ownedAssets.push(item.assetId);
    }
    nextState.assetQuantities = { ...(nextState.assetQuantities || {}) };
    nextState.assetQuantities[item.assetId] = numberOrZero(nextState.assetQuantities[item.assetId]) + 1;

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

// activityLog(GASから同期された分を含む)の中から、指定した進捗%(5%刻み)で
// 「最後のひと押し」になった行動(type: 'contribution_milestone')を探し、その actorName を返す。
// 新しい方から探す(同じ%の記録は基本1件だが、念のため)。見つからなければnull
// (GAS未接続、または貢献ログがまだ届いていない場合。banner側は表示を省略する)。
function findContributorForProgress(state, progress) {
  const log = Array.isArray(state?.activityLog) ? state.activityLog : [];
  for (let i = log.length - 1; i >= 0; i--) {
    const entry = log[i];
    if (entry?.type === 'contribution_milestone' && Number(entry.progress) === Number(progress)) {
      return entry.actorName || null;
    }
  }
  return null;
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
    // クラス協力の意味づけ強化(v22)用: 「直前にこの端末で自分が達成操作をした」ことを
    // 短時間だけ覚えておく。syncMilestones()がこの直後に新しいイベントを検知したら、
    // GASからの貢献ログが届くのを待たずに「最後のひと押しは自分」と即座に演出できる。
    this._lastLocalActionAt = 0;
    this._lastLocalActionActor = null;
    this.animals = new AnimalManager({ spots, assets });
    this.animals.hydrate(this.state.animals);
    this.shop = new ShopManager(shopItems);
    this.goalManager = new GoalManager();
    this.goalManager.ensureState(this.state);
    this.thanksManager = new ThanksManager();
    // 「今この端末を触っているのは誰か」。ローカル単独時は既定で「わたし」。
    // GAS接続済みならapp.js側からsetIdentity()で本人のstudentId/nicknameを渡す。
    this.identity = { studentId: null, nickname: 'わたし' };

    if (!this.state.forestStartedAt) {
      this.state.forestStartedAt = new Date().toISOString();
      this.persist();
    }
    // 既存のセーブデータ(v25より前に作られたもの)にはシンボルツリーが
    // まだ植わっていないので、読み込み時にも必ず確認して無ければ植える。
    this.ensureSymbolTree();
  }

  getState() {
    return this.state;
  }

  // (v25) 中心のsymbolTreeSpotに、まだ苗木が無ければ1本植える。
  // 森の開始時(コンストラクタ/startNewForest)の両方から呼ぶ、冪等な処理。
  // 大物の自動配置(autoPlaceAtSpotType)と違い、これは進行度に関係なく
  // 「森が始まった瞬間」に必ず1本存在させるためのもの。
  ensureSymbolTree() {
    const spot = (this.spots || []).find((s) => s.id === 'symbolTreeSpot');
    if (!spot) return null;
    this.state.placedAssets = Array.isArray(this.state.placedAssets) ? this.state.placedAssets : [];
    const already = this.state.placedAssets.find((p) => p.spotId === 'symbolTreeSpot');
    if (already) return already;
    const now = new Date();
    const item = {
      assetId: 'tree_symbol_01',
      spotId: spot.id,
      x: spot.x,
      y: spot.y,
      placedId: `symbol_${now.getTime()}_${Math.random().toString(36).slice(2, 7)}`,
      createdAt: now.toISOString(),
      studentId: null,
      nickname: '森',
      goalId: null,
      goalTitle: null,
      isSymbolTree: true
    };
    this.state.placedAssets.push(item);
    this.persist();
    return item;
  }

  // 「森のはじまり」ズームイン演出(js/app.js側)を、この代でまだ見せていないか。
  shouldShowSymbolTreeIntro() {
    return this.state.symbolTreeIntroShown !== true;
  }

  markSymbolTreeIntroShown() {
    this.state.symbolTreeIntroShown = true;
    this.persist();
  }

  setIdentity({ studentId = null, nickname = 'わたし' } = {}) {
    this.identity = { studentId: studentId || null, nickname: nickname || 'わたし' };
  }

  // 配置物のstudentIdから表示名を解決する。
  // - 自分が置いたもの(studentId無し、またはidentityと一致)は identity.nickname
  // - クラスメイトが置いたものは studentDirectory(pullで取得)から引く
  // - 名簿にまだ無ければ item.nickname(ローカルスタンプ分)にフォールバック
  resolveNickname(item) {
    if (!item) return 'わたし';
    if (item.isSymbolTree || item.spotId === 'symbolTreeSpot') return '森';
    if (!item.studentId) return item.nickname || 'わたし';
    if (this.identity?.studentId && item.studentId === this.identity.studentId) {
      return this.identity.nickname || item.nickname || 'わたし';
    }
    const dir = this.state.studentDirectory || {};
    return dir[item.studentId] || item.nickname || 'クラスの子';
  }

  // タップされた配置物1件ぶんの「だれが/いつ/どんな目標のときに」情報をまとめて返す。
  // js/render.js が付ける data-placed-id をそのまま渡せる。
  getPlacedAssetInfo(placedId) {
    const item = (Array.isArray(this.state.placedAssets) ? this.state.placedAssets : [])
      .find((p) => p.placedId === placedId);
    if (!item) return null;
    const asset = (this.assets || []).find((a) => a.id === item.assetId) || null;
    return {
      item,
      asset,
      nickname: this.resolveNickname(item),
      goalTitle: item.goalTitle || null,
      createdAt: item.createdAt || null
    };
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

      const progressPercent = computeProgressPercent(this.state);
      for (const event of sortEvents(this.events)) {
        if (progressPercent < numberOrZero(event?.progress)) continue;
        if (completedSet.has(event.id)) continue;
        completedSet.add(event.id);
        const eventSummary = {
          id: event.id,
          title: event.title || event.id,
          message: event.message || '',
          effect: event.effect || null,
          progress: numberOrZero(event.progress)
        };
        // 「最後のひと押し」が誰だったかを添える(クラス協力の意味づけ強化・v22)。
        // 1) 直前にこの端末で自分が達成/承認を叩いた直後なら、その本人(自分)。
        // 2) そうでなければ、GAS経由で共有された貢献ログ(contribution_milestone)から探す
        //    (他の子の行動でイベントが起きた場合。pull()がactivityLogをマージした後に
        //    syncMilestones()を呼ぶので、この時点でログは既に手元にある)。
        const justActedByMe = this._lastLocalActionAt && (Date.now() - this._lastLocalActionAt) < 6000;
        eventSummary.contributor = justActedByMe
          ? (this._lastLocalActionActor || null)
          : findContributorForProgress(this.state, eventSummary.progress);
        summary.newEvents.push(eventSummary);
        localChanged = true;

        // イベントの内容と実際の見た目を連動させる。
        // 例:「池が現れる」イベントで魚が湧く、「リスがあらわれる」で実際にリスが出る。
        const autoSpawn = EVENT_AUTO_SPAWN[event.id];
        if (autoSpawn) {
          const { spawned } = this.animals.spawnByType(autoSpawn.type, autoSpawn.count);
          if (spawned.length) {
            this.state.animals = this.animals.serialize();
            summary.autoSpawned = summary.autoSpawned || [];
            summary.autoSpawned.push(...spawned.map((a) => ({ assetId: a.assetId, x: a.x, y: a.y })));
            // このイベントで実際にどこに出現したか(カメラを注目させるのに使う)
            eventSummary.focus = { x: spawned[0].x, y: spawned[0].y };
          }
        }

        // 「木」「岩」などの大物の自動配置(v24)。児童の手を借りず見た目を進める。
        const autoPlace = EVENT_AUTO_PLACE[event.id];
        if (autoPlace) {
          const placedItems = this.autoPlaceAtSpotType(autoPlace.spotType, autoPlace.count);
          if (placedItems.length) {
            summary.autoPlaced = summary.autoPlaced || [];
            summary.autoPlaced.push(...placedItems);
            eventSummary.focus = eventSummary.focus || { x: placedItems[0].x, y: placedItems[0].y };
          }
        }
      }

      if (localChanged) {
        this.state.completedEvents = [...completedSet];
      }

      const evaluatedBadges = this.badgesCatalog.map((badge) => ({
        ...badge,
        unlocked: isBadgeUnlocked(badge, computeProgressPercent(this.state), completedSet)
      }));

      for (const badge of evaluatedBadges) {
        if (!badge.unlocked || earnedBadges.has(badge.id)) continue;
        earnedBadges.add(badge.id);
        const badgeSummary = {
          id: badge.id,
          name: badge.name || badge.id,
          description: badge.description || ''
        };
        summary.newBadges.push(badgeSummary);
        if (badge.reward) {
          const rewardResult = applyReward(this.state, badge.reward);
          summary.rewardPoints += rewardResult.pointsAdded;
          badgeSummary.reward = { points: rewardResult.pointsAdded, items: rewardResult.itemsAdded };
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

    // 画面(進行度バー等)がいつでも同じ値を参照できるよう、%をstateにもキャッシュしておく。
    const finalPercent = computeProgressPercent(this.state);
    this.state.progressPercent = finalPercent;

    // 完全クリア(100%)に到達した瞬間を検知する。applyOnce的に一度だけ発火させ、
    // エンディング演出(app.js側)に渡すためのスナップショットをsummaryに載せる。
    if (finalPercent >= 100 && this.state.forestStatus !== 'completed') {
      this.state.forestStatus = 'completed';
      this.state.forestCompletedAt = new Date().toISOString();
      pushActivityLog(this.state, {
        type: 'forest_complete',
        message: `🎉 ${numberOrZero(this.state.forestGeneration) || 1}代目の「コツコツの森」が完成しました！`
      });
      summary.forestCompleted = this.buildForestSummary();
    }

    return summary;
  }

  // エンディング画面・過去の森の振り返り用に、今の森の状態をひとまとめにする。
  buildForestSummary() {
    return {
      generation: numberOrZero(this.state.forestGeneration) || 1,
      mapId: this.state.mapId,
      startedAt: this.state.forestStartedAt,
      completedAt: this.state.forestCompletedAt,
      classPoints: numberOrZero(this.state.classPoints),
      clearPoint: this.getClearPoint(),
      progressPercent: computeProgressPercent(this.state),
      placedCount: Array.isArray(this.state.placedAssets) ? this.state.placedAssets.length : 0,
      eventCount: Array.isArray(this.state.completedEvents) ? this.state.completedEvents.length : 0,
      badgeCount: Array.isArray(this.state.badges) ? this.state.badges.length : 0,
      animalCount: Array.isArray(this.state.animals) ? this.state.animals.length : 0,
      timeline: this.buildForestTimeline()
    };
  }

  // 完成までに起きたイベントを発生順に並べる「森の年表」。
  // events.json自体には発生日時が無いので、activityLog(forest_event等)から日時つきで復元する。
  // v16まではforest_eventのみだったが、メルカリ風の「完成までの物語」らしさを出すため
  // バッジ獲得・ジャンル解放・新しい森の開始も年表に含め、種別ごとにアイコンを持たせて密度を上げる。
  buildForestTimeline() {
    const log = Array.isArray(this.state.activityLog) ? this.state.activityLog : [];
    const TIMELINE_TYPES = {
      forest_event: '🌲',
      badge: '🏅',
      unlock: '🌱',
      new_forest: '🌟'
    };
    return log
      .filter((entry) => entry && TIMELINE_TYPES[entry.type])
      .map((entry) => ({
        message: entry.message,
        at: entry.createdAt,
        type: entry.type,
        icon: TIMELINE_TYPES[entry.type]
      }));
  }

  // 「新しい森を始める」。完成済みの森のときだけ実行できる。
  // クラス接続時(state.classInfo.classCodeがある場合)は、さらに先生が
  // 「次の森を解放する」操作をするまでは進めない(v23)。ローカル単独時は
  // nextForestUnlockedが常にtrueのままなので、この条件は影響しない。
  // 森そのものの成長を表す値(classPoints/completedEvents/placedAssets/animals/
  // unlockedCategories/このシーズンで取ったバッジ)だけをリセットし、
  // 個人の頑張りの記録(personalPoints/lifetimePoints/購入済みアセット等)は引き継ぐ。
  startNewForest() {
    if (this.state.forestStatus !== 'completed') {
      return { ok: false, reason: 'not_completed' };
    }
    if (this.state.classInfo?.classCode && !this.state.nextForestUnlocked) {
      return { ok: false, reason: 'waiting_for_teacher' };
    }
    const archived = this.buildForestSummary();
    this.state.forestHistory = Array.isArray(this.state.forestHistory) ? this.state.forestHistory : [];
    this.state.forestHistory.push(archived);

    this.state.classPoints = 0;
    this.state.completedEvents = [];
    this.state.placedAssets = [];
    this.state.animals = [];
    this.animals.hydrate([]);
    this.state.unlockedCategories = clone(this.saveManager.defaultState().unlockedCategories);
    this.state.badges = [];
    this.state.forestGeneration = (numberOrZero(this.state.forestGeneration) || 1) + 1;
    this.state.forestStatus = 'growing';
    this.state.forestStartedAt = new Date().toISOString();
    this.state.forestCompletedAt = null;
    this.state.progressPercent = 0;
    // 新しい代でもまた苗木から始める。演出も次に開くタイミングでもう一度見せる。
    this.state.symbolTreeIntroShown = false;
    this.ensureSymbolTree();
    // 次の世代でもまた先生の解放操作が必要になるよう、ここで一旦falseに戻す。
    // (クラス未接続のローカル単独時はtrueのままにしておく)
    this.state.nextForestUnlocked = this.state.classInfo?.classCode ? false : true;
    this.pendingMilestoneSummary = null;

    pushActivityLog(this.state, {
      type: 'new_forest',
      message: `🌱 ${this.state.forestGeneration}代目の森がはじまりました`
    });
    this.persist();
    return { ok: true, archived, generation: this.state.forestGeneration };
  }

  getForestHistory() {
    return Array.isArray(this.state.forestHistory) ? this.state.forestHistory : [];
  }

  getForestSummary() {
    return this.buildForestSummary();
  }

  // ---- 起動画面ポップアップ(連続ログイン・きのうの出来事) ----

  // その日はじめての起動かどうかを判定し、連続ログイン日数を更新する。
  // 同じ日に何度アプリを開いても日数はカウントされない。
  checkInToday(now = new Date()) {
    const todayKey = GoalManager.todayKey(now);
    const previousLoginAt = this.state.lastLoginAt || null;
    const lastKey = previousLoginAt ? GoalManager.todayKey(new Date(previousLoginAt)) : null;
    if (lastKey === todayKey) {
      return { isNewDay: false, streak: numberOrZero(this.state.loginStreak) || 1, previousLoginAt };
    }
    const yesterdayKey = GoalManager.todayKey(new Date(now.getTime() - 24 * 60 * 60 * 1000));
    const streak = lastKey === yesterdayKey ? numberOrZero(this.state.loginStreak) + 1 : 1;
    this.state.loginStreak = streak;
    this.state.lastLoginAt = now.toISOString();
    this.persist();
    return { isNewDay: true, streak, previousLoginAt };
  }

  // 起動画面ポップアップの中身一式:「連続ログイン日数」「きのうの出来事」「はげまし」
  // 「未読の特別通知件数」をまとめて返す。app.js bootstrap側から1回だけ呼ばれる想定。
  getDailySummary(now = new Date()) {
    const { isNewDay, streak, previousLoginAt } = this.checkInToday(now);
    const yesterdayKey = GoalManager.todayKey(new Date(now.getTime() - 24 * 60 * 60 * 1000));
    const log = Array.isArray(this.state.activityLog) ? this.state.activityLog : [];
    const yesterdayEntries = log.filter((entry) => entry?.createdAt && GoalManager.todayKey(new Date(entry.createdAt)) === yesterdayKey);

    // 「イベント通知」の統合: 前回の起動から今回までの間に起きた、森・バッジ・ジャンル解放の
    // できごとをまとめて拾う。クラス共有プレイでは自分が見ていない間に他の子の行動で
    // 進んだ分もここに含まれるため、「きのう」だけでは拾えない見逃しを補う。
    const NOTIFICATION_TYPES = new Set(['forest_event', 'badge', 'unlock', 'forest_complete', 'new_forest']);
    const sinceLastVisit = previousLoginAt
      ? log.filter((entry) => entry?.createdAt && new Date(entry.createdAt) > new Date(previousLoginAt))
      : [];
    const eventNotifications = sinceLastVisit
      .filter((entry) => NOTIFICATION_TYPES.has(entry.type))
      .slice(-5)
      .reverse()
      .map((entry) => entry.message);

    const unread = (Array.isArray(this.state.notifications) ? this.state.notifications : []).filter((n) => !n.read);
    return {
      isNewDay,
      streak,
      yesterdayCount: yesterdayEntries.length,
      yesterdayHighlights: yesterdayEntries.slice(-3).reverse().map((e) => e.message),
      // 統合後の見出し用データ。eventNotificationsが1件でもあればそちらを優先表示し、
      // 無ければ従来通り「きのうのできごと」にフォールバックする(app.js側で判定)。
      eventNotifications,
      eventNotificationCount: eventNotifications.length,
      unreadCount: unread.length,
      progressPercent: this.getProgressPercent(),
      clearPoint: this.getClearPoint(),
      forestGeneration: numberOrZero(this.state.forestGeneration) || 1,
      forestStatus: this.state.forestStatus,
      encouragement: pickEncouragement(streak, yesterdayEntries.length)
    };
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
  // - ショップに商品があるアセット: assetQuantities に在庫が1個以上あること(=買ってまだ置いていない分がある)
  // - ショップに商品がないアセット（地面・道など無料の地形）: classPoints が unlock 以上であればOK
  isAssetOwned(assetId) {
    const owned = new Set([
      ...(Array.isArray(this.state.ownedAssets) ? this.state.ownedAssets : []),
      ...(Array.isArray(this.state.shopPurchased) ? this.state.shopPurchased : [])
    ]);
    return owned.has(assetId);
  }

  // 購入したがまだ配置していない「在庫」の数。ショップで買うたびに+1、配置するたびに-1する。
  getAssetQuantity(assetId) {
    return numberOrZero(this.state.assetQuantities?.[assetId]);
  }

  canPlaceAsset(assetId) {
    const asset = (this.assets || []).find((a) => a.id === assetId);
    if (!asset) return false;
    // pond_medium_01 / bridge_medium_01 のように、最初からmap.json上に
    // 固定terrainとして存在するアセットは、二重配置を防ぐため常に不可。
    if (asset.placeable === false) return false;

    const requiresShop = (this.shop.items || []).some((item) => item.assetId === assetId);
    if (requiresShop) {
      // (v26) 「持っている(=買ったことがある)」だけでは配置できない。
      // 買った分の在庫(assetQuantities)が残っている間だけ配置できる。
      return this.getAssetQuantity(assetId) > 0;
    }

    const threshold = numberOrZero(asset.unlock);
    return this.getProgressPercent() >= threshold;
  }

  // 完全クリアに必要なクラスポイント。先生設定(state.classInfo.clearPoint)が無ければ既定1000。
  getClearPoint() {
    return numberOrZero(this.state?.classInfo?.clearPoint) || 1000;
  }

  // 現在の進行度(0〜100の%)。events.json / badges.json / shop.json / assets.json の
  // しきい値はすべてこの%と比較する。
  getProgressPercent() {
    return computeProgressPercent(this.state);
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

  // 「木」「岩」のような大物を、児童の操作なしにspots.jsonの決まった場所へ
  // システムが自動で置く(v24)。手動のplaceAssetと違い、所持チェック(canPlaceAsset)は
  // 行わない(そもそも児童のパレットには出さないassetなので判定不要)し、
  // ポイントも加算しない(自動演出であって、児童の頑張りの記録ではないため)。
  autoPlaceAtSpotType(spotType, count = 1) {
    const progressPercent = computeProgressPercent(this.state);
    const candidateSpots = (this.spots || []).filter((spot) => spot.type === spotType);
    const placed = [];
    let remaining = count;

    for (const spot of candidateSpots) {
      if (remaining <= 0) break;
      const maxCount = numberOrZero(spot.maxCount) || 1;
      while (this.countPlacedAtSpot(spot.id) < maxCount && remaining > 0) {
        const allowIds = Array.isArray(spot.allow) ? spot.allow : [];
        const allowed = allowIds
          .map((id) => this.assets.find((a) => a.id === id))
          .filter((asset) => asset && numberOrZero(asset.unlock) <= progressPercent);
        if (!allowed.length) break;
        const asset = allowed[Math.floor(Math.random() * allowed.length)];

        const now = new Date();
        const item = {
          assetId: asset.id,
          spotId: spot.id,
          x: spot.x,
          y: spot.y,
          placedId: `auto_${now.getTime()}_${Math.random().toString(36).slice(2, 7)}`,
          createdAt: now.toISOString(),
          studentId: null,
          nickname: '森',
          goalId: null,
          goalTitle: null
        };
        this.state.placedAssets = Array.isArray(this.state.placedAssets) ? this.state.placedAssets : [];
        this.state.placedAssets.push(item);
        placed.push(item);
        remaining -= 1;
      }
    }
    return placed;
  }

  placeAsset(assetId, spotId, x, y) {
    if (!this.canPlaceAsset(assetId)) {
      return { ok: false, reason: 'not_owned' };
    }
    if (spotId && !this.isSpotAvailable(spotId)) {
      return { ok: false, reason: 'spot_full' };
    }
    const now = new Date();
    const goal = this.state.lastCompletedGoal;
    const item = {
      assetId,
      spotId,
      x,
      y,
      // サーバー同期時はFirestoreのplacedIdで同期される。
      // ローカル単独時もタップ詳細表示のキーとして使えるよう、その場でも発行しておく。
      placedId: `local_${now.getTime()}_${Math.random().toString(36).slice(2, 7)}`,
      createdAt: now.toISOString(),
      studentId: this.identity?.studentId || null,
      nickname: this.identity?.nickname || 'わたし',
      goalId: goal?.goalId || null,
      goalTitle: goal?.goalTitle || null
    };
    this.state.placedAssets = Array.isArray(this.state.placedAssets) ? this.state.placedAssets : [];
    this.state.placedAssets.push(item);

    // (v26) 配置そのものではポイントは増えない(以前はここでawardPointsしていたが、
    // 「配置し放題でクラスポイントが無限に増える」不具合の原因だったため廃止)。
    // ポイントを得る手段は目標達成(completeGoal/approveGoal)や動物の発見のみに一本化する。
    // ショップで買った分の在庫を1個消費する(在庫が無いアセットは上のcanPlaceAssetで弾かれている)。
    const requiresShop = (this.shop.items || []).some((it) => it.assetId === assetId);
    if (requiresShop) {
      this.state.assetQuantities = this.state.assetQuantities || {};
      this.state.assetQuantities[assetId] = Math.max(0, this.getAssetQuantity(assetId) - 1);
    }
    this._lastLocalActionAt = Date.now();
    this._lastLocalActionActor = this.identity?.nickname || 'わたし';
    this.syncMilestones();
    this.persist();
    return { ok: true, ...item };
  }

  removePlacedAsset(index) {
    if (!Array.isArray(this.state.placedAssets)) return false;
    if (index < 0 || index >= this.state.placedAssets.length) return false;
    this.state.placedAssets.splice(index, 1);
    this.persist();
    return true;
  }

  // 配置直後にサーバーへ送信した結果、本物のplacedId(GAS発行)が返ってきたら差し替える。
  // ローカルで仮発行したplacedId(local_...)のままだと、以後のpull()で届く
  // サーバー側のリストと同一物として突き合わせられないため。
  replacePlacedAssetId(oldPlacedId, newPlacedId) {
    const item = (this.state.placedAssets || []).find((p) => p.placedId === oldPlacedId);
    if (!item || !newPlacedId) return false;
    item.placedId = newPlacedId;
    this.persist();
    return true;
  }

  // サーバーへの送信が失敗した配置を取り消す。送れていないのに端末側にだけ
  // 見えている状態を残さない(=あとで消えて見える不具合を防ぐ)ため。
  discardPlacedAsset(placedId) {
    const list = this.state.placedAssets || [];
    const index = list.findIndex((p) => p.placedId === placedId);
    if (index === -1) return false;
    list.splice(index, 1);
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

  setPlacedAssets(placedAssets) {
    if (!Array.isArray(placedAssets)) return;
    this.state.placedAssets = placedAssets;
    this.syncMilestones();
    this.persist();
  }

  setClassPoints(points) {
    const num = Number(points) || 0;
    this.state.classPoints = num;
    this.syncMilestones();
    this.persist();
  }

  setCompletedEvents(events) {
    if (!Array.isArray(events)) return;
    this.state.completedEvents = events;
    this.syncMilestones();
    this.persist();
  }

  setForestGeneration(gen) {
    const num = Number(gen) || 1;
    this.state.forestGeneration = num;
    this.persist();
  }

  setForestStatus(status) {
    if (typeof status === 'string') {
      this.state.forestStatus = status;
      this.persist();
    }
  }

  setGoals(goals) {
    if (!Array.isArray(goals)) return;
    this.state.goals = goals;
    this.persist();
  }

  setClassInfo(classInfo) {
    if (!classInfo || typeof classInfo !== 'object') return;
    this.state.classInfo = {
      ...this.state.classInfo,
      ...classInfo
    };
    if (classInfo.goalApprovalMode) {
      this.goalManager.setApprovalMode(this.state, classInfo.goalApprovalMode);
    }
    if (classInfo.maxGoals) {
      this.goalManager.setMaxGoals(this.state, classInfo.maxGoals);
    }
    this.persist();
  }

  setClassmates(classmates) {
    if (Array.isArray(classmates)) {
      this.state.classmates = classmates;
      this.persist();
    }
  }

  setStudentDirectory(directory) {
    if (directory && typeof directory === 'object') {
      this.state.studentDirectory = directory;
      this.persist();
    }
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

  getGoal(goalId) {
    return this.listGoals().find((g) => g.id === goalId) || null;
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
      // 承認不要(self判定)モードはこの時点でポイントが確定するので、
      // 「直前にクリアした目標」として次の配置にスタンプされるようにする。
      // 承認制の場合はapproveGoal()側で承認が下りたタイミングでスタンプする。
      if (!result.needsApproval) {
        this.state.lastCompletedGoal = { goalId: result.entry.goalId, goalTitle: title, at: result.entry.resolvedAt };
        // 承認不要(self判定)モードは、この瞬間に自分の行動でポイントが確定する。
        // syncMilestones()が直後にイベント発生を検知したら「自分」を最後のひと押しとして扱う。
        this._lastLocalActionAt = Date.now();
        this._lastLocalActionActor = this.identity?.nickname || 'わたし';
      }
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
      // 承認制の場合はここでポイントが確定するので、ここで初めて「直前にクリアした目標」を更新する。
      this.state.lastCompletedGoal = { goalId: result.entry.goalId, goalTitle: result.entry.goalTitle, at: result.entry.resolvedAt };
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
