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

  // ---- クラス参加（Firestoreに接続・名簿登録） ----

  async joinClass({ classCode, studentId, nickname }) {
    if (!this.fb?.isReady()) return { ok: false, reason: 'firebase_not_ready' };
    const sid = studentId || 'std_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    this.saveLocalInfo({ classCode, studentId: sid, nickname });
    
    // 名簿に自分を登録
    await this.fb.setStudent({
      classCode,
      studentId: sid,
      data: {
        nickname: nickname || 'わたし',
        joinedAt: new Date().toISOString()
      }
    });

    this.startListening();
    return { ok: true, data: { classCode, studentId: sid, nickname } };
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
        if (data?.classInfo) {
          this.core.setClassInfo(data.classInfo);
        }
        if (data?.forestState) {
          const fs = data.forestState;
          if (fs.classPoints !== undefined) this.core.setClassPoints(fs.classPoints);
          if (fs.completedEvents) this.core.setCompletedEvents(fs.completedEvents);
          if (fs.forestGeneration !== undefined) this.core.setForestGeneration(fs.forestGeneration);
          if (fs.forestStatus) this.core.setForestStatus(fs.forestStatus);
          if (fs.nextForestUnlocked !== undefined) {
            this.core.state.nextForestUnlocked = Boolean(fs.nextForestUnlocked);
          }
        }
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
        const myStudentId = this.info?.studentId;
        const classmates = students
          .map((s) => s.nickname)
          .filter((name) => name && name !== myNickname);
        const directory = Object.fromEntries(
          students.filter((s) => s.studentId).map((s) => [s.studentId, s.nickname])
        );
        this.core.setClassmates(classmates);
        this.core.setStudentDirectory(directory);
        this.onSync(this.core.getState());
      },
      onError: (err) => {
        console.warn('[FirebaseSync] Students listener error:', err);
      }
    });

    // (4) ありがとうメッセージ - リアルタイム通知
    this.fb.listenThanks({
      classCode,
      onData: (list) => {
        const now = Date.now();
        const recentForMe = list.filter(t => {
          const age = now - new Date(t.createdAt).getTime();
          return t.toName === this.info.nickname && age < 30 * 1000;
        });
        if (recentForMe.length > 0) {
          this.onThanksReceived(recentForMe[0]);
        }
      },
      onError: (err) => {
        console.warn('[FirebaseSync] Thanks listener error:', err);
      }
    });

    // (5) 目標承認キュー（先生承認モード時）
    this.fb.listenApprovalQueue({
      classCode,
      onData: (queue) => {
        // 先生画面等で利用
      },
      onError: (err) => {
        console.warn('[FirebaseSync] ApprovalQueue listener error:', err);
      }
    });

    // (6) アクティビティログ
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

  async pushBuyItem({ itemId, assetId, itemName, price }) {
    if (!this.isConfigured()) return;
    try {
      await this.fb.addActivityLog({
        classCode: this.info.classCode,
        type: 'purchase',
        message: `🛍️ ${this.info.nickname}さんが「${itemName || assetId}」を手に入れました`,
        actorName: this.info.nickname
      });
    } catch (err) {
      console.warn('[FirebaseSync] pushBuyItem failed:', err);
    }
  }

  async pushCreateGoal({ goal }) {
    if (!this.isConfigured() || !goal) return;
    try {
      await this.fb.createGoal({
        classCode: this.info.classCode,
        studentId: this.info.studentId,
        goal
      });
    } catch (err) {
      console.warn('[FirebaseSync] pushCreateGoal failed:', err);
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
    if (!this.isConfigured()) return;
    const state = this.core.getState();
    try {
      await this.pushForestState();
      await this.fb.addActivityLog({
        classCode: this.info.classCode,
        type: 'new_forest',
        message: `🌱 ${state.forestGeneration || 1}代目の森がはじまりました`,
        actorName: this.info.nickname
      });
    } catch (err) {
      console.warn('[FirebaseSync] pushStartNewForest failed:', err);
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

  async pushThanks({ toName, message = '' }) {
    if (!this.isConfigured()) return;
    try {
      await this.fb.addThanks({
        classCode: this.info.classCode,
        fromStudentId: this.info.studentId,
        fromLabel: this.info.nickname,
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
      if (autoApprove) {
        // 森のクラスポイントも加算して更新
        await this.pushForestState();
        await this.fb.addActivityLog({
          classCode: this.info.classCode,
          type: 'goal',
          message: `✅ ${this.info.nickname}さんが「${goalTitle}」を達成しました（+20pt）`,
          actorName: this.info.nickname,
          points: 20
        });
      }
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
