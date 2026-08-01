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

  pushPlaceAsset({ assetId, spotId, x, y, goalId, goalTitle }) {
    if (!this.isConfigured()) return;
    this.apiClient.placeAsset({ ...this._ids(), assetId, spotId, x, y, goalId, goalTitle }).catch(() => {});
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

  // 「新しい森をはじめる」をクラス全員へ共有する。core.startNewForest()でローカルの
  // 反応を即座に返した直後に呼ぶ想定。実際のアーカイブ/リセットはサーバー側が正として行うため、
  // 失敗してもローカル体験は止めない(次回のpull()で世代がずれていれば追いつく)。
  async pushStartNewForest() {
    if (!this.isConfigured()) return { ok: false, reason: 'not_configured' };
    try {
      return await this.apiClient.startNewForest({ ...this._ids() });
    } catch (err) {
      return { ok: false, reason: 'network_error' };
    }
  }

  // 森の完成(forestStatus: 'completed')を検知した直後に、20秒周期のpull()を待たず
  // すぐにクラス全体へ伝える。他の子の端末でもエンディング演出がなるべく早く見えるように。
  pushForestCompleted() {
    if (!this.isConfigured()) return;
    const state = this.core.getState();
    if (state.forestStatus !== 'completed') return;
    this.apiClient.updateForestState({
      ...this._ids(),
      forestState: {
        forestStatus: 'completed',
        forestCompletedAt: state.forestCompletedAt,
        forestGeneration: state.forestGeneration
      }
    }).catch(() => {});
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
    const { forestState, placedAssets, activityLog, thanksLog, goalLogPending, classInfo, students, me } = res.data;

    // ありがとう機能の選択肢用に、自分以外のクラスメイトのニックネーム一覧を保存する。
    // studentDirectoryは「花などをタップしたときに誰が置いたか」の名前解決にも使う(core.resolveNickname参照)。
    if (Array.isArray(students)) {
      const myNickname = this.info?.nickname;
      state.classmates = students
        .map((s) => s.nickname)
        .filter((name) => name && name !== myNickname);
      state.studentDirectory = Object.fromEntries(
        students.filter((s) => s.studentId).map((s) => [s.studentId, s.nickname])
      );
    }

    // 自分の目標ログ(承認結果を含む)をサーバー正で取り込む。
    // 承認制モードでは先生がteacher.html(別画面)で承認するため、児童側のローカル状態だけでは
    // 「自分の目標が承認された」ことに気づけない。ここで取り込み、直近で承認された目標を
    // lastCompletedGoal に反映することで、その後の配置(花など)に正しく紐づくようにする。
    if (me && Array.isArray(me.goalLog)) {
      const remoteGoalLog = me.goalLog.map((g) => ({ ...g, id: g.logId }));

      // 承認制モードは「承認された瞬間」を児童側で直接は検知できない
      // (先生がteacher.htmlで承認するため)。pull()の前後でstatusが
      // pending→approvedに変わったログを見つけて、通知として積む。
      // これがないと、自己承認モードにはある「達成の演出」が
      // 承認制モードの子どもたちには一切届かないことになる。
      const previousById = new Map((state.goalLog || []).map((g) => [g.id, g]));
      for (const entry of remoteGoalLog) {
        const before = previousById.get(entry.id);
        if (before?.status === 'pending' && entry.status === 'approved') {
          state.notifications = Array.isArray(state.notifications) ? state.notifications : [];
          state.notifications.push({
            id: `notif_goalapproved_${entry.id}`,
            type: 'goal_approved',
            message: `「${entry.goalTitle}」が承認されました！`,
            points: Number(entry.points) || 0,
            createdAt: entry.resolvedAt || new Date().toISOString(),
            read: false
          });
        }
      }

      state.goalLog = mergeGoalLog(state.goalLog, remoteGoalLog);

      const latestApproved = remoteGoalLog
        .filter((g) => g.status === 'approved')
        .sort((a, b) => new Date(a.resolvedAt || a.requestedAt) - new Date(b.resolvedAt || b.requestedAt))
        .pop();
      if (latestApproved) {
        const already = state.lastCompletedGoal;
        const latestAt = new Date(latestApproved.resolvedAt || latestApproved.requestedAt);
        if (!already || !already.at || latestAt > new Date(already.at)) {
          state.lastCompletedGoal = {
            goalId: latestApproved.goalId,
            goalTitle: latestApproved.goalTitle,
            at: latestApproved.resolvedAt || latestApproved.requestedAt
          };
        }
      }
    }

    // クラス設定(先生がteacher.htmlで決めた値)をこの端末にも反映する。
    // これがないと、先生が承認モードや目標上限を変えても児童の画面には効かない。
    if (classInfo) {
      state.classInfo = {
        classCode: classInfo.classCode,
        teacherName: classInfo.teacherName || '',
        clearPoint: Number(classInfo.clearPoint) || 1000
      };
      state.goalSettings = state.goalSettings || {};
      state.goalSettings.approvalMode = classInfo.goalApprovalMode === 'teacher' ? 'teacher' : 'self';
      state.goalSettings.maxGoals = Number(classInfo.maxGoals) || state.goalSettings.maxGoals || 3;
    }

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

    // 森の世代(forestGeneration)を見て、通常のmaxマージか、世代の切り替えかを判定する。
    // classPointsは「増える一方」の値なのでmax(local, server)で取りこぼしを防げるが、
    // それが成り立つのは同じ世代の森を育てている間だけ。
    const serverGeneration = Number(forestState.forestGeneration) || 1;
    const localGeneration = Number(state.forestGeneration) || 1;

    if (serverGeneration > localGeneration) {
      // 他の端末が先に新しい森を始めていた。ローカルもその世代に合わせて丸ごと採用する。
      state.classPoints = Number(forestState.classPoints) || 0;
      state.completedEvents = Array.isArray(forestState.completedEvents) ? forestState.completedEvents : [];
      state.badges = Array.isArray(forestState.badges) ? forestState.badges : [];
      state.unlockedCategories = forestState.unlockedCategories || {};
      state.animals = Array.isArray(forestState.animals) ? forestState.animals : [];
      this.core.animals.hydrate(state.animals);
      state.forestGeneration = serverGeneration;
      state.forestStatus = forestState.forestStatus || 'growing';
      state.forestStartedAt = forestState.forestStartedAt || new Date().toISOString();
      state.forestCompletedAt = forestState.forestCompletedAt || null;
      state.progressPercent = 0;
      state.pendingMilestoneSummary = null;
      state.nextForestUnlocked = Boolean(forestState.nextForestUnlocked);
    } else if (serverGeneration < localGeneration) {
      // 自分の端末がさきほど「新しい森」を始めたばかりで、サーバー側の反映(pushStartNewForest)が
      // まだ追いついていないケース。ここで前世代のforestState(高いclassPoints/forestStatus:'completed'等)を
      // 取り込んでしまうと、リセットしたばかりの森が古いポイントでいきなり完成扱いに巻き戻ってしまう
      // 事故になる(「1000ポイントのはずが古い世代の点数で完成してしまう」「新しい森を作るが効かない
      // ように見える」不具合の原因だった)。サーバーがまだ古い世代である間はローカルの値を正として保持し、
      // 何もマージしない。念のためstartNewForestの共有を再送して、サーバー側の追いつきを促す。
      this.pushStartNewForest();
    } else {
      state.classPoints = Math.max(Number(state.classPoints) || 0, Number(forestState.classPoints) || 0);
      state.completedEvents = Array.from(new Set([...(state.completedEvents || []), ...(forestState.completedEvents || [])]));
      state.badges = Array.from(new Set([...(state.badges || []), ...(forestState.badges || [])]));
      state.unlockedCategories = mergeMaxMap(state.unlockedCategories, forestState.unlockedCategories);
      if (Array.isArray(forestState.animals) && forestState.animals.length) {
        state.animals = forestState.animals;
      }
      // 自分より先にサーバー側で完成が検知されていれば(他の子の端末が先に気づいた場合)取り込む。
      if (forestState.forestStatus === 'completed' && state.forestStatus !== 'completed') {
        state.forestStatus = 'completed';
        state.forestCompletedAt = forestState.forestCompletedAt || new Date().toISOString();
      }
      // 先生が「次の森を解放する」ボタンを押したかどうかはサーバーが正なので、そのまま取り込む。
      state.nextForestUnlocked = Boolean(forestState.nextForestUnlocked);
    }

    state.forestHistory = mergeForestHistory(state.forestHistory, forestState.forestHistory);

    // 配置物はクラス全員分をGASが正として持っているので、そのまま置き換える。
    // goalId/goalTitleは「置いたときに直前にクリアしていた目標」(pushPlaceAssetで送信、PlacedAssetsシートに保存)。
    // nicknameはここでは持たず、表示側で studentId -> studentDirectory を都度引く(名簿が後から更新されても最新反映されるように)。
    state.placedAssets = (placedAssets || []).map((p) => ({
      assetId: p.assetId, spotId: p.spotId || null, x: Number(p.x) || 0, y: Number(p.y) || 0,
      placedId: p.placedId, studentId: p.studentId, createdAt: p.createdAt,
      goalId: p.goalId || null, goalTitle: p.goalTitle || null
    }));

    // ログ類はidで重複排除してマージ、新しい順に最大50件。
    state.activityLog = mergeById(state.activityLog, (activityLog || []).map((l) => ({ ...l, id: l.logId })), 50);
    state.thanksLog = mergeById(state.thanksLog, (thanksLog || []).map((t) => ({ ...t, id: t.thanksId })), 50);
    state.goalLogPendingShared = goalLogPending || []; // 先生の承認画面用(自分の分だけでなくクラス全体分)

    this.core.syncMilestones();
    this.core.persist();

    // 自分が計算した最新の共有状態を書き戻す(他の子の端末にも反映されるように)。
    // forestStatus/forestCompletedAtも一緒に送るが、サーバー側は forestGeneration が
    // 一致するときだけ growing→completed の遷移を反映する(class-sync.js冒頭コメント参照)。
    this.apiClient.updateForestState({
      ...this._ids(),
      forestState: {
        classPoints: state.classPoints,
        completedEvents: state.completedEvents,
        unlockedCategories: state.unlockedCategories,
        badges: state.badges,
        animals: state.animals,
        forestStatus: state.forestStatus,
        forestCompletedAt: state.forestCompletedAt,
        forestGeneration: state.forestGeneration
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

// goalLogはrequestedAt/resolvedAtで管理しているのでmergeByIdのcreatedAtソートは使えない。
// サーバー側(承認/却下の結果)を優先して上書きするだけの単純なマージにする。
function mergeGoalLog(localList = [], remoteList = []) {
  const map = new Map();
  for (const item of localList || []) map.set(item.id, item);
  for (const item of remoteList || []) map.set(item.id, item);
  return [...map.values()];
}

// forestHistoryは世代(generation)ごとに1件のはずだが、複数端末が同時に持っている
// バージョンを突き合わせる際は、年表(timeline)がより詳しい方を残す。
function mergeForestHistory(localList = [], remoteList = []) {
  const map = new Map();
  for (const item of [...(Array.isArray(localList) ? localList : []), ...(Array.isArray(remoteList) ? remoteList : [])]) {
    if (!item || typeof item.generation !== 'number') continue;
    const existing = map.get(item.generation);
    if (!existing || (item.timeline || []).length > (existing.timeline || []).length) {
      map.set(item.generation, item);
    }
  }
  return [...map.values()].sort((a, b) => a.generation - b.generation);
}

function mergeById(localList = [], remoteList = [], limit = 50) {
  const map = new Map();
  for (const item of localList || []) map.set(item.id, item);
  for (const item of remoteList || []) map.set(item.id, item);
  return [...map.values()]
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .slice(-limit);
}
