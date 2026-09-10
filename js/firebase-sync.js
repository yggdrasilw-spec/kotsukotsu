/**
 * コツコツの森 - Firebase Firestore リアルタイム同期層
 *
 * FirebaseClient(firebase-client.js)とForestCore(core-runtime.js)を
 * リアルタイムにバインドする同期モジュール。
 * GASを一切使わず、Firestoreのリアルタイムリスナーと直接操作で完全に同期します。
 */

const LOCAL_CLASS_INFO_KEY = 'kokotsu_class_info_v2';

export class FirebaseSync {
  constructor({ firebaseClient, core, onSync, onPlaceFailed, onThanksReceived, onGoalApproved } = {}) {
    this.fb = firebaseClient;
    this.core = core;
    this.onSync = onSync || (() => {});
    this.onPlaceFailed = onPlaceFailed || (() => {});
    this.onThanksReceived = onThanksReceived || (() => {});
    this.onGoalApproved = onGoalApproved || (() => {});

    this.info = this.loadLocalInfo();
    this.listening = false;
    // 配置直後でまだFirestoreに反映されていないplacedIdを一時的に保持
    this.pendingPlacements = new Set();
    this.knownGoalLogStatus = new Map();
    this.seenThanks = new Set();
  }

  // ---- ローカル接続情報管理 ----

  loadLocalInfo() {
    try {
      const raw = window.localStorage.getItem(LOCAL_CLASS_INFO_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      return null;
    }
  }

  saveLocalInfo(info) {
    this.info = info;
    try {
      window.localStorage.setItem(LOCAL_CLASS_INFO_KEY, JSON.stringify(info));
    } catch (err) {
      // noop
    }
  }

  isConfigured() {
    return Boolean(this.fb?.isReady() && this.info?.classCode && this.info?.studentId);
  }

  getClassCode() {
    return this.info?.classCode || null;
  }

  getStudentId() {
    return this.info?.studentId || null;
  }

  getNickname() {
    return this.info?.nickname || null;
  }

  disconnect() {
    this.stopListening();
    this.info = null;
    try { window.localStorage.removeItem(LOCAL_CLASS_INFO_KEY); } catch (err) { /* noop */ }
  }

  // ---- クラス参加（Firestoreに接続・名簿登録） ----

  async joinClass({ classCode, studentId, nickname }) {
    if (!this.fb?.isReady()) return { ok: false, reason: 'firebase_not_ready' };
    const sid = studentId || this.info?.studentId || ('std_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7));
    const nick = nickname || this.info?.nickname || 'わたし';
    const check = await this.fb.getClass({ classCode });
    if (!check.ok) return check;
    this.stopListening();
    this.saveLocalInfo({ classCode, studentId: sid, nickname: nick });

    // 名簿に自分を登録
    await this.fb.setStudent({
      classCode,
      studentId: sid,
      data: {
        nickname: nick,
        joinedAt: new Date().toISOString()
      }
    });

    // ログイン来訪日数の記録
    await this.fb.touchStudentLogin(classCode, sid);

    this.startListening();
    return { ok: true, data: { classCode, studentId: sid, nickname: nick } };
  }

  // ---- リアルタイムリスナー開始 ----

  startListening() {
    if (!this.isConfigured() || this.listening) return;
    this.listening = true;
    this.core.sharedMode = true;
    this.core.state.sharedMode = true;
    this.knownGoalLogStatus.clear();
    let initialClass = true;
    let initialGoals = true;

    const classCode = this.info.classCode;
    const studentId = this.info.studentId;

    // 起動時のログイン記録
    this.fb.touchStudentLogin(classCode, studentId);

    // (1) 森の配置アイテム (PlacedAssets) - リアルタイムリスニング
    this.fb.listenPlacedAssets({
      classCode,
      onData: (list) => {
        const currentState = this.core.getState();
        const localPending = [...this.pendingPlacements];

        // サーバーから来た配置をcore.stateにマージ
        const mergedAssets = [...list];
        const serverIds = new Set(list.map(a => a.placedId));
        if (currentState.placedAssets) {
          currentState.placedAssets.forEach(a => {
            if (localPending.includes(a.placedId) && !serverIds.has(a.placedId)) {
              mergedAssets.push(a);
            }
          });
        }

        this.core.setPlacedAssets(mergedAssets);
        this.onSync(this.core.getState());
      },
      onError: (err) => {
        console.warn('[FirebaseSync] PlacedAssets listener error:', err);
      }
    });

    // (2) クラス情報・森の進行度 (ForestState & classInfo)
    this.fb.listenClass({
      classCode,
      onData: (data) => {
        const state = this.core.getState();
        if (data?.classInfo) {
          this.core.setClassInfo(data.classInfo);
          if (data.classInfo.goalApprovalMode) {
            state.goalSettings = state.goalSettings || {};
            state.goalSettings.approvalMode = data.classInfo.goalApprovalMode;
          }
          if (data.classInfo.maxGoals) {
            state.goalSettings = state.goalSettings || {};
            state.goalSettings.maxGoals = Number(data.classInfo.maxGoals) || 3;
          }
        }
        if (data?.forestState) {
          const fs = data.forestState;
          const generation = Number(fs.forestGeneration) || 1;
          if (initialClass || generation !== state.forestGeneration) {
            state.completedEvents = [];
            state.placedAssets = state.placedAssets.filter(p => !p.systemGenerated && !String(p.placedId).startsWith('auto_'));
            state.animals = [];
            this.core.animals.hydrate([]);
            this.core.pendingMilestoneSummary = null;
          }
          state.forestGeneration = generation;
          state.classPoints = Number(fs.classPoints) || 0;
          state.forestStatus = fs.forestStatus || 'growing';
          state.forestStartedAt = fs.forestStartedAt || state.forestStartedAt;
          state.forestCompletedAt = fs.forestCompletedAt || null;
          state.nextForestUnlocked = Boolean(fs.nextForestUnlocked);
          state.forestHistory = fs.forestHistory || [];
        }
        this.core.syncMilestones();
        if (initialClass) this.core.consumeMilestoneSummary();
        initialClass = false;
        this.core.persist();
        this.onSync(this.core.getState());
      },
      onError: (err) => {
        console.warn('[FirebaseSync] Class listener error:', err);
      }
    });

    // (3) 児童名簿・クラスメイト一覧
    this.fb.listenStudents({
      classCode,
      onData: (students) => {
        const myNickname = this.info?.nickname;
        const classmates = students
          .map((s) => s.nickname)
          .filter((name) => name && name !== myNickname);
        const directory = Object.fromEntries(
          students.filter((s) => s.studentId).map((s) => [s.studentId, s.nickname])
        );
        this.core.setClassmates(classmates);
        this.core.setStudentDirectory(directory);

        // 自分の最新ポイント等があればマージ
        const me = students.find(s => s.studentId === studentId);
        if (me && me.personalPoints !== undefined) {
          this.core.state.personalPoints = Number(me.personalPoints) || 0;
        }
        if (me) {
          for (const key of ['lifetimePoints', 'shopPurchased', 'ownedAssets', 'assetQuantities']) {
            if (me[key] !== undefined) this.core.state[key] = me[key];
          }
        }
        this.onSync(this.core.getState());
      },
      onError: (err) => {
        console.warn('[FirebaseSync] Students listener error:', err);
      }
    });

    this.fb.listenGoals({ classCode, studentId, onData: goals => {
      this.core.setGoals(goals.filter(g => g.active !== false).map(g => ({ ...g, id: g.goalId || g.id })));
      this.onSync(this.core.getState());
    }, onError: err => console.warn('[FirebaseSync] Goals:', err) });
    this.fb.listenGoalLog({ classCode, studentId, onData: entries => {
      const newlyApproved = entries.filter(e => e.status === 'approved' && this.knownGoalLogStatus.get(e.id) === 'pending');
      this.knownGoalLogStatus = new Map(entries.map(e => [e.id, e.status]));
      this.core.state.goalLog = entries;
      if (!initialGoals && newlyApproved.length) this.onGoalApproved(newlyApproved);
      initialGoals = false;
      this.core.persist();
      this.onSync(this.core.getState());
    }, onError: err => console.warn('[FirebaseSync] Goal log:', err) });

    // (4) ありがとうメッセージ - リアルタイム通知
    this.fb.listenThanks({
      classCode,
      onData: (list) => {
        const now = Date.now();
        const recentForMe = list.filter(t => {
          const age = now - new Date(t.createdAt).getTime();
          return t.toName === this.info?.nickname && age >= 0 && age < 30 * 1000 && !this.seenThanks.has(t.thanksId);
        });
        if (recentForMe.length > 0) {
          const t = recentForMe[recentForMe.length - 1];
          recentForMe.forEach(item => this.seenThanks.add(item.thanksId));
          this.onThanksReceived(t);
          const state = this.core.getState();
          state.notifications = Array.isArray(state.notifications) ? state.notifications : [];
          if (!state.notifications.some(n => n.id === `notif_${t.thanksId}`)) {
            state.notifications.push({
              id: `notif_${t.thanksId}`,
              type: 'thanks_received',
              message: `${t.fromLabel}さんから「ありがとう」が届きました！`,
              createdAt: t.createdAt,
              read: false
            });
            this.onSync(state);
          }
        }
      },
      onError: (err) => {
        console.warn('[FirebaseSync] Thanks listener error:', err);
      }
    });

    // (5) アクティビティログ
    this.fb.listenActivityLog({
      classCode,
      onData: (logs) => {
        if (Array.isArray(logs) && logs.length > 0) {
          const currentLog = this.core.getState().activityLog || [];
          const existingIds = new Set(currentLog.map(l => l.id || l.logId));
          const newEntries = logs
            .filter(l => !existingIds.has(l.logId))
            .map(l => ({ ...l, id: l.logId }));
          if (newEntries.length > 0) {
            this.core.state.activityLog = [...currentLog, ...newEntries]
              .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
              .slice(-50);
            this.onSync(this.core.getState());
          }
        }
      },
      onError: (err) => {
        console.warn('[FirebaseSync] ActivityLog listener error:', err);
      }
    });
  }

  stopListening() {
    if (this.fb) {
      this.fb.cleanup();
    }
    this.listening = false;
  }

  // ---- 書き込み系: Firestoreへ即時送信 ----

  async pushPlaceAsset({ placedId, assetId, spotId, x, y, goalId, goalTitle }) {
    if (!this.isConfigured()) return;
    if (placedId) this.pendingPlacements.add(placedId);

    try {
      const result = await this.fb.setPlacedAsset({
        classCode: this.info.classCode,
        placedId,
        data: {
          assetId,
          spotId: spotId || '',
          x: x || 0,
          y: y || 0,
          goalId: goalId || '',
          goalTitle: goalTitle || '',
          studentId: this.info.studentId,
          nickname: this.info.nickname,
          createdAt: new Date().toISOString()
        }
      });
      if (!result?.ok) {
        this.core.discardPlacedAsset(placedId);
        if (result?.data?.assetQuantities) this.core.state.assetQuantities = result.data.assetQuantities;
        this.onPlaceFailed();
      }
      if (placedId) this.pendingPlacements.delete(placedId);
    } catch (err) {
      console.warn('[FirebaseSync] placeAsset failed:', err);
      if (placedId) {
        this.pendingPlacements.delete(placedId);
        this.core.discardPlacedAsset(placedId);
        this.core.state.assetQuantities[assetId] = (Number(this.core.state.assetQuantities[assetId]) || 0) + 1;
        this.onPlaceFailed();
      }
    }
    this.onSync(this.core.getState());
  }

  async pushRemovePlacedAsset(placedId) {
    if (!this.isConfigured() || !placedId) return;
    try {
      await this.fb.deletePlacedAsset({
        classCode: this.info.classCode,
        placedId
      });
    } catch (err) {
      console.warn('[FirebaseSync] removePlacedAsset failed:', err);
    }
  }

  async pushBuyItem({ itemId, assetId, itemName, price }) {
    if (!this.isConfigured()) return;
    try {
      const result = await this.fb.buyItem({
        classCode: this.info.classCode,
        studentId: this.info.studentId,
        itemId,
        assetId,
        itemName,
        price,
        requestId: crypto.randomUUID()
      });
      if (result.ok && result.data) Object.assign(this.core.state, result.data);
      this.core.persist();
      return result;
    } catch (err) {
      console.warn('[FirebaseSync] pushBuyItem failed:', err);
      return { ok: false };
    }
  }

  async pushCreateGoal({ goal, title, targetCount }) {
    if (!this.isConfigured()) return;
    const g = goal || {
      id: 'g_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      title: title || '',
      targetCount: Number(targetCount) || 1
    };
    try {
      return await this.fb.createGoal({
        classCode: this.info.classCode,
        studentId: this.info.studentId,
        goal: g
      });
    } catch (err) {
      console.warn('[FirebaseSync] pushCreateGoal failed:', err);
      return { ok: false };
    }
  }

  async pushRemoveGoal(goalId) {
    if (!this.isConfigured() || !goalId) return;
    try {
      await this.fb.deleteGoal({
        classCode: this.info.classCode,
        goalId
      });
    } catch (err) {
      console.warn('[FirebaseSync] pushRemoveGoal failed:', err);
    }
  }

  async pushForestState() {
    if (!this.isConfigured()) return;
    const state = this.core.getState();
    try {
      await this.fb.updateForestState({
        classCode: this.info.classCode,
        forestState: {
          classPoints: state.classPoints || 0,
          completedEvents: state.completedEvents || [],
          unlockedCategories: state.unlockedCategories || {},
          badges: state.badges || [],
          animals: state.animals || [],
          forestGeneration: state.forestGeneration || 1,
          forestStatus: state.forestStatus || 'growing',
          forestStartedAt: state.forestStartedAt || new Date().toISOString(),
          forestCompletedAt: state.forestCompletedAt || null,
          nextForestUnlocked: Boolean(state.nextForestUnlocked)
        }
      });
    } catch (err) {
      console.warn('[FirebaseSync] updateForestState failed:', err);
    }
  }

  async pushStartNewForest() {
    if (!this.isConfigured()) return { ok: false, reason: 'not_configured' };
    try {
      const res = await this.fb.startNewForest({ classCode: this.info.classCode });
      return res;
    } catch (err) {
      console.warn('[FirebaseSync] pushStartNewForest failed:', err);
      return { ok: false };
    }
  }

  async pushForestCompleted() {
    if (!this.isConfigured()) return;
    const state = this.core.getState();
    try {
      await this.fb.updateForestState({
        classCode: this.info.classCode,
        forestState: {
          forestStatus: 'completed',
          forestCompletedAt: state.forestCompletedAt || new Date().toISOString(),
          forestGeneration: state.forestGeneration || 1
        }
      });
      await this.fb.addActivityLog({
        classCode: this.info.classCode,
        type: 'forest_complete',
        message: `🎉 ${state.forestGeneration || 1}代目の「コツコツの森」が完成しました！`,
        actorName: this.info.nickname
      });
    } catch (err) {
      console.warn('[FirebaseSync] pushForestCompleted failed:', err);
    }
  }

  async pushActivityLog({ type, message, actorName, points, progress }) {
    if (!this.isConfigured()) return;
    try {
      await this.fb.addActivityLog({
        classCode: this.info.classCode,
        type,
        message,
        actorName: actorName || this.info.nickname,
        points,
        progress
      });
    } catch (err) {
      console.warn('[FirebaseSync] addActivityLog failed:', err);
    }
  }

  async pushThanks({ toName, fromLabel, message = '' }) {
    if (!this.isConfigured()) return;
    try {
      await this.fb.addThanks({
        classCode: this.info.classCode,
        fromStudentId: this.info.studentId,
        fromLabel: fromLabel || this.info.nickname,
        toName,
        message
      });
      await this.fb.addActivityLog({
        classCode: this.info.classCode,
        type: 'thanks',
        message: `🧡 ${this.info.nickname}さんが${toName}さんに「ありがとう」を送りました`,
        actorName: this.info.nickname
      });
    } catch (err) {
      console.warn('[FirebaseSync] sendThanks failed:', err);
    }
  }

  async pushGoalCompletion({ goalId, goalTitle, autoApprove, requestId }) {
    if (!this.isConfigured()) return;
    try {
      const result = await this.fb.submitGoalCompletion({
        classCode: this.info.classCode,
        studentId: this.info.studentId,
        goalId,
        goalTitle,
        requestId,
        autoApprove
      });
      return result;
    } catch (err) {
      console.warn('[FirebaseSync] submitGoalCompletion failed:', err);
      return { ok: false };
    }
  }

  async pushGoalApproval({ logId, approve }) {
    if (!this.isConfigured()) return;
    try {
      await this.fb.resolveGoalApproval({
        classCode: this.info.classCode,
        logId,
        approve
      });
    } catch (err) {
      console.warn('[FirebaseSync] resolveGoalApproval failed:', err);
    }
  }
}
