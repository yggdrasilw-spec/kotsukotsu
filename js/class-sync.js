// クラス共有データとGASバックエンドをつなぐ層。
// - ForestCore(core-runtime.js)自体は変更しない。既存のローカル完結ロジックはそのまま動く。
// - この層は「設定されていれば」追加でGASへ送る/GASから取り込む、という後付けの形にしてある。
// - 未設定(GAS未接続)なら何もせず、今まで通りローカル単独で動く。
//
// 置き場所の考え方(docs/11_gas_backend_spec.mdの線引きに対応):
//   - classCode, studentId, nickname, GASのURL → localStorageのみ(このファイルが管理)
//   - classPoints, placedAssets, activityLog 等の「クラス共有」データ → GASが正、ここでcore.stateへマージする
//   - personalPoints, goals 等の「個人」データ → GASにも保存されるが、今回はローカルのcore.stateも正として扱い、
//     矛盾したときはローカル優先(このアプリを開いている本人の手元の値を信じる)

const LOCAL_INFO_KEY = 'kokotsu_class_info_v1';

export class ClassSync {
  constructor({ apiClient, core, onSync } = {}) {
    this.apiClient = apiClient;
    this.core = core;
    this.onSync = onSync || (() => {});
    this.info = this.loadLocalInfo();
    this.lastPulledAt = null;
    this.timer = null;
    if (this.info?.baseUrl) this.apiClient.setBaseUrl(this.info.baseUrl);
  }

  loadLocalInfo() {
    try {
      const raw = window.localStorage.getItem(LOCAL_INFO_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      return null;
    }
  }

  saveLocalInfo(info) {
    this.info = info;
    try {
      window.localStorage.setItem(LOCAL_INFO_KEY, JSON.stringify(info));
    } catch (err) {
      // localStorageが使えない環境でも致命的にはしない。
    }
  }

  isConfigured() {
    return Boolean(this.info?.baseUrl && this.info?.classCode && this.info?.studentId);
  }

  disconnect() {
    this.stopAutoSync();
    this.info = null;
    try { window.localStorage.removeItem(LOCAL_INFO_KEY); } catch (err) { /* noop */ }
  }

  // ---- 先生: 新しいクラスを作って、自分も1人目として参加する ----
  async setupNewClass({ baseUrl, teacherName, clearPoint, nickname }) {
    this.apiClient.setBaseUrl(baseUrl);
    const created = await this.apiClient.createClass({ teacherName, clearPoint });
    if (!created.ok) return created;

    const joined = await this.apiClient.joinClass({ classCode: created.data.classCode, nickname });
    if (!joined.ok) return joined;

    this.saveLocalInfo({
      baseUrl, classCode: created.data.classCode, studentId: joined.data.studentId, nickname: joined.data.nickname
    });
    return { ok: true, data: { classCode: created.data.classCode, studentId: joined.data.studentId } };
  }

  // ---- 児童: 先生から聞いたクラスコードで参加する ----
  async joinExistingClass({ baseUrl, classCode, nickname }) {
    this.apiClient.setBaseUrl(baseUrl);
    const joined = await this.apiClient.joinClass({ classCode, nickname });
    if (!joined.ok) return joined;

    this.saveLocalInfo({ baseUrl, classCode, studentId: joined.data.studentId, nickname: joined.data.nickname });
    return joined;
  }

  // ---- 書き込み系: fire-and-forgetでGASへ送る(失敗してもローカルの体験は止めない) ----

  pushPlaceAsset({ assetId, spotId, x, y }) {
    if (!this.isConfigured()) return;
    this.apiClient.placeAsset({ ...this._ids(), assetId, spotId, x, y }).catch(() => {});
  }

  pushRemovePlacedAsset(placedId) {
    if (!this.isConfigured() || !placedId) return;
    this.apiClient.removePlacedAsset({ ...this._ids(), placedId }).catch(() => {});
  }

  pushCreateGoal({ title, targetCount }) {
    if (!this.isConfigured()) return;
    this.apiClient.createGoal({ ...this._ids(), title, targetCount }).catch(() => {});
  }

  pushRemoveGoal(goalId) {
    if (!this.isConfigured()) return;
    this.apiClient.removeGoal({ ...this._ids(), goalId }).catch(() => {});
  }

  pushCompleteGoal(goalId) {
    if (!this.isConfigured()) return;
    this.apiClient.completeGoal({ ...this._ids(), goalId }).catch(() => {});
  }

  pushApproveGoal(logId) {
    if (!this.isConfigured()) return;
    this.apiClient.approveGoal({ ...this._ids(), logId }).catch(() => {});
  }

  pushRejectGoal(logId) {
    if (!this.isConfigured()) return;
    this.apiClient.rejectGoal({ ...this._ids(), logId }).catch(() => {});
  }

  pushSendThanks({ toName, fromLabel }) {
    if (!this.isConfigured()) return;
    this.apiClient.sendThanks({ ...this._ids(), toName, fromLabel }).catch(() => {});
  }

  pushBuyItem({ itemId, assetId, itemName, price }) {
    if (!this.isConfigured()) return;
    this.apiClient.buyItem({ ...this._ids(), itemId, assetId, itemName, price }).catch(() => {});
  }

  pushSetGoalSettings({ maxGoals, approvalMode }) {
    if (!this.isConfigured()) return;
    this.apiClient.setGoalSettings({ ...this._ids(), maxGoals, approvalMode }).catch(() => {});
  }

  pushSetClearPoint(clearPoint) {
    if (!this.isConfigured()) return;
    this.apiClient.setClearPoint({ ...this._ids(), clearPoint }).catch(() => {});
  }

  _ids() {
    return { classCode: this.info.classCode, studentId: this.info.studentId };
  }

  // ---- 読み取り + マージ ----
  // クラス共有の値はGASを正として取り込み、必要ならローカルでイベント/バッジ判定を再計算する。
  // classPointsは「増える一方」の値なので、通信の順序でローカルが一時的に進んでいても
  // max(local, server)を採用すれば取りこぼしにならない。
  async pull() {
    if (!this.isConfigured()) return { ok: false, reason: 'not_configured' };
    const res = await this.apiClient.syncState({ classCode: this.info.classCode, studentId: this.info.studentId });
    if (!res.ok) return res;

    const state = this.core.getState();
    const { forestState, placedAssets, activityLog, thanksLog, goalLogPending } = res.data;

    // 新着の「ありがとう」で自分宛のものは、通知として積む(受信ポップアップ用)。
    const myNickname = this.info.nickname;
    const since = this.lastPulledAt;
    if (since && myNickname) {
      const incoming = thanksLog.filter((t) => t.toName === myNickname && new Date(t.createdAt) > new Date(since));
      for (const t of incoming) {
        state.notifications = Array.isArray(state.notifications) ? state.notifications : [];
        state.notifications.push({
          id: `notif_${t.thanksId}`,
          type: 'thanks_received',
          message: `${t.fromLabel}さんから「ありがとう」が届きました！`,
          createdAt: t.createdAt,
          read: false
        });
      }
    }

    state.classPoints = Math.max(Number(state.classPoints) || 0, Number(forestState.classPoints) || 0);
    state.completedEvents = Array.from(new Set([...(state.completedEvents || []), ...(forestState.completedEvents || [])]));
    state.badges = Array.from(new Set([...(state.badges || []), ...(forestState.badges || [])]));
    state.unlockedCategories = mergeMaxMap(state.unlockedCategories, forestState.unlockedCategories);
    if (Array.isArray(forestState.animals) && forestState.animals.length) {
      state.animals = forestState.animals;
    }

    // 配置物はクラス全員分をGASが正として持っているので、そのまま置き換える。
    state.placedAssets = (placedAssets || []).map((p) => ({
      assetId: p.assetId, spotId: p.spotId || null, x: Number(p.x) || 0, y: Number(p.y) || 0,
      placedId: p.placedId, studentId: p.studentId, createdAt: p.createdAt
    }));

    // ログ類はidで重複排除してマージ、新しい順に最大50件。
    state.activityLog = mergeById(state.activityLog, (activityLog || []).map((l) => ({ ...l, id: l.logId })), 50);
    state.thanksLog = mergeById(state.thanksLog, (thanksLog || []).map((t) => ({ ...t, id: t.thanksId })), 50);
    state.goalLogPendingShared = goalLogPending || []; // 先生の承認画面用(自分の分だけでなくクラス全体分)

    this.core.syncMilestones();
    this.core.persist();

    // 自分が計算した最新の共有状態を書き戻す(他の子の端末にも反映されるように)。
    this.apiClient.updateForestState({
      ...this._ids(),
      forestState: {
        classPoints: state.classPoints,
        completedEvents: state.completedEvents,
        unlockedCategories: state.unlockedCategories,
        badges: state.badges,
        animals: state.animals
      }
    }).catch(() => {});

    this.lastPulledAt = new Date().toISOString();
    this.onSync(state);
    return { ok: true };
  }

  startAutoSync(intervalMs = 20000) {
    this.stopAutoSync();
    this.pull();
    this.timer = window.setInterval(() => this.pull(), intervalMs);
  }

  stopAutoSync() {
    if (this.timer) window.clearInterval(this.timer);
    this.timer = null;
  }
}

function mergeMaxMap(a = {}, b = {}) {
  const out = { ...a };
  for (const [key, value] of Object.entries(b || {})) {
    out[key] = Math.max(Number(out[key]) || 0, Number(value) || 0);
  }
  return out;
}

function mergeById(localList = [], remoteList = [], limit = 50) {
  const map = new Map();
  for (const item of localList || []) map.set(item.id, item);
  for (const item of remoteList || []) map.set(item.id, item);
  return [...map.values()]
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .slice(-limit);
}
