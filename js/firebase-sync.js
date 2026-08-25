/**
 * コツコツの森 - Firebase Firestore リアルタイム同期層
 *
 * FirebaseClient(firebase-client.js)とForestCore(core-runtime.js)を
 * リアルタイムにバインドする同期モジュール。
 *
 * 従来のClassSync(class-sync.js)がGAS通信を担っていたのと同じ役割を、
 * Firestoreの onSnapshot リアルタイムリスナーで実現する。
 *
 * GASとの役割分担:
 *   - GAS (スプレッドシート): 先生が管理する名簿・クラス設定（確認・編集が容易）
 *   - Firebase (Firestore): ゲームのリアルタイム体験（配置、目標、ありがとう、森の進行）
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

  // ---- クラス参加（GASで作成済みのクラスにFirebase側でも接続） ----

  async joinClass({ classCode, studentId, nickname }) {
    if (!this.fb?.isReady()) return { ok: false, reason: 'firebase_not_ready' };
    this.saveLocalInfo({ classCode, studentId, nickname });
    return { ok: true };
  }

  // ---- リアルタイムリスナー開始 ----

  startListening() {
    if (!this.isConfigured() || this.listening) return;
    this.listening = true;

    const classCode = this.info.classCode;
    const studentId = this.info.studentId;

    // (1) 森の配置アイテム (PlacedAssets) - リアルタイムリスニング
    this.fb.listenPlacedAssets({
      classCode,
      onData: (list) => {
        // pendingPlacements にあるものは除外しない（サーバーから返ってきたら自然にマージされる）
        const currentState = this.core.getState();
        const localPending = [...this.pendingPlacements];

        // サーバーから来た配置をcore.stateにマージ
        const mergedAssets = [...list];
        // ローカルで配置中だがまだサーバーに反映されていないものを追加
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

    // (2) クラス情報・森の進行度 (ForestState)
    this.fb.listenClass({
      classCode,
      onData: (data) => {
        if (data?.forestState) {
          const fs = data.forestState;
          if (fs.classPoints !== undefined) this.core.setClassPoints(fs.classPoints);
          if (fs.completedEvents) this.core.setCompletedEvents(fs.completedEvents);
          if (fs.forestGeneration !== undefined) this.core.setForestGeneration(fs.forestGeneration);
          if (fs.forestStatus) this.core.setForestStatus(fs.forestStatus);
          this.onSync(this.core.getState());
        }
      },
      onError: (err) => {
        console.warn('[FirebaseSync] Class listener error:', err);
      }
    });

    // (3) ありがとうメッセージ - リアルタイム通知
    this.fb.listenThanks({
      classCode,
      onData: (list) => {
        // 自分宛の最新のありがとうを通知（直近5分以内のもの）
        const now = Date.now();
        const recentForMe = list.filter(t => {
          const age = now - new Date(t.createdAt).getTime();
          return t.toName === this.info.nickname && age < 5 * 60 * 1000;
        });
        if (recentForMe.length > 0) {
          this.onThanksReceived(recentForMe[0]);
        }
      },
      onError: (err) => {
        console.warn('[FirebaseSync] Thanks listener error:', err);
      }
    });

    // (4) 目標承認キュー（先生承認モード時）
    this.fb.listenGoals({
      classCode,
      studentId,
      onData: (goals) => {
        // 承認されたばかりの目標があれば通知
        const approved = goals.filter(g => g.status === 'approved' && g.studentId === studentId);
        if (approved.length > 0) {
          this.onGoalApproved(approved);
        }
      },
      onError: (err) => {
        console.warn('[FirebaseSync] Goals listener error:', err);
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
      await this.fb.setPlacedAsset({
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
      if (placedId) this.pendingPlacements.delete(placedId);
    } catch (err) {
      console.warn('[FirebaseSync] placeAsset failed:', err);
      if (placedId) {
        this.pendingPlacements.delete(placedId);
        this.core.discardPlacedAsset(placedId);
        this.onPlaceFailed();
      }
    }
    this.onSync(this.core.getState());
  }

  async pushRemovePlacedAsset({ placedId }) {
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

  async pushForestState() {
    if (!this.isConfigured()) return;
    const state = this.core.getState();
    try {
      await this.fb.updateForestState({
        classCode: this.info.classCode,
        forestState: {
          classPoints: state.classPoints || 0,
          completedEvents: state.completedEvents || [],
          forestGeneration: state.forestGeneration || 1,
          forestStatus: state.forestStatus || 'growing'
        }
      });
    } catch (err) {
      console.warn('[FirebaseSync] updateForestState failed:', err);
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

  async pushThanks({ toName, message }) {
    if (!this.isConfigured()) return;
    try {
      await this.fb.addThanks({
        classCode: this.info.classCode,
        fromStudentId: this.info.studentId,
        fromLabel: this.info.nickname,
        toName,
        message
      });
    } catch (err) {
      console.warn('[FirebaseSync] sendThanks failed:', err);
    }
  }

  async pushGoalCompletion({ goalId, goalTitle, autoApprove }) {
    if (!this.isConfigured()) return;
    try {
      const result = await this.fb.submitGoalCompletion({
        classCode: this.info.classCode,
        studentId: this.info.studentId,
        goalId,
        goalTitle,
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
