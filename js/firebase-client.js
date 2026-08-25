/**
 * コツコツの森 - Firebase (Firestore) クライアントモジュール
 * CDN経由のFirebase v10 ES Modulesを読み込み、Firestoreの初期化とリアルタイムリスナーを提供します。
 */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js';
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';

import { FIREBASE_CONFIG } from './firebase-config.js';

const LOCAL_FIREBASE_CONFIG_KEY = 'kokotsu_firebase_config_v1';

export class FirebaseClient {
  constructor() {
    this.app = null;
    this.db = null;
    this.config = this.loadConfig();
    this.unsubscribers = [];
    if (this.config && this.config.apiKey) {
      this.init(this.config);
    }
  }

  loadConfig() {
    try {
      const raw = window.localStorage.getItem(LOCAL_FIREBASE_CONFIG_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.apiKey) return parsed;
      }
    } catch (err) {
      // noop
    }
    // デフォルトで組み込みのFIREBASE_CONFIGを使用
    return FIREBASE_CONFIG || null;
  }

  saveConfig(config) {
    this.config = config;
    try {
      window.localStorage.setItem(LOCAL_FIREBASE_CONFIG_KEY, JSON.stringify(config));
    } catch (err) {
      // noop
    }
    return this.init(config);
  }

  init(config) {
    try {
      if (!config || !config.apiKey || !config.projectId) {
        return false;
      }
      this.app = initializeApp(config);
      this.db = getFirestore(this.app);
      return true;
    } catch (err) {
      console.warn('[FirebaseClient] Init error or already initialized:', err);
      if (this.app) {
        this.db = getFirestore(this.app);
        return true;
      }
      return false;
    }
  }

  isReady() {
    return Boolean(this.db);
  }

  // ---- リアルタイム同期リスナー登録 ----

  listenClass({ classCode, onData, onError }) {
    if (!this.db || !classCode) return () => {};
    const ref = doc(this.db, 'classes', classCode);
    const unsub = onSnapshot(ref, (snap) => {
      if (snap.exists()) {
        onData(snap.data());
      }
    }, onError);
    this.unsubscribers.push(unsub);
    return unsub;
  }

  listenPlacedAssets({ classCode, onData, onError }) {
    if (!this.db || !classCode) return () => {};
    const colRef = collection(this.db, 'classes', classCode, 'placedAssets');
    const unsub = onSnapshot(colRef, (snapshot) => {
      const list = [];
      snapshot.forEach((d) => {
        list.push({ placedId: d.id, ...d.data() });
      });
      onData(list);
    }, onError);
    this.unsubscribers.push(unsub);
    return unsub;
  }

  listenActivityLog({ classCode, onData, onError, maxItems = 50 }) {
    if (!this.db || !classCode) return () => {};
    const colRef = collection(this.db, 'classes', classCode, 'activityLog');
    const q = query(colRef, orderBy('createdAt', 'desc'), limit(maxItems));
    const unsub = onSnapshot(q, (snapshot) => {
      const list = [];
      snapshot.forEach((d) => {
        list.push({ logId: d.id, ...d.data() });
      });
      onData(list);
    }, onError);
    this.unsubscribers.push(unsub);
    return unsub;
  }

  listenThanks({ classCode, onData, onError, maxItems = 30 }) {
    if (!this.db || !classCode) return () => {};
    const colRef = collection(this.db, 'classes', classCode, 'thanks');
    const q = query(colRef, orderBy('createdAt', 'desc'), limit(maxItems));
    const unsub = onSnapshot(q, (snapshot) => {
      const list = [];
      snapshot.forEach((d) => {
        list.push({ thanksId: d.id, ...d.data() });
      });
      onData(list);
    }, onError);
    this.unsubscribers.push(unsub);
    return unsub;
  }

  listenGoals({ classCode, studentId, onData, onError }) {
    if (!this.db || !classCode) return () => {};
    const colRef = collection(this.db, 'classes', classCode, 'goals');
    const q = studentId
      ? query(colRef, where('studentId', '==', studentId))
      : colRef;
    const unsub = onSnapshot(q, (snapshot) => {
      const list = [];
      snapshot.forEach((d) => {
        list.push({ goalId: d.id, ...d.data() });
      });
      onData(list);
    }, onError);
    this.unsubscribers.push(unsub);
    return unsub;
  }

  listenApprovalQueue({ classCode, onData, onError }) {
    if (!this.db || !classCode) return () => {};
    const colRef = collection(this.db, 'classes', classCode, 'goalLog');
    const q = query(colRef, where('status', '==', 'pending'), orderBy('requestedAt', 'asc'));
    const unsub = onSnapshot(q, (snapshot) => {
      const list = [];
      snapshot.forEach((d) => {
        list.push({ logId: d.id, ...d.data() });
      });
      onData(list);
    }, onError);
    this.unsubscribers.push(unsub);
    return unsub;
  }

  listenStudents({ classCode, onData, onError }) {
    if (!this.db || !classCode) return () => {};
    const colRef = collection(this.db, 'classes', classCode, 'students');
    const unsub = onSnapshot(colRef, (snapshot) => {
      const list = [];
      snapshot.forEach((d) => {
        list.push({ studentId: d.id, ...d.data() });
      });
      onData(list);
    }, onError);
    this.unsubscribers.push(unsub);
    return unsub;
  }

  // 全リスナー解除
  cleanup() {
    this.unsubscribers.forEach((u) => {
      try { u(); } catch (err) { /* noop */ }
    });
    this.unsubscribers = [];
  }

  // ---- 書込み操作 ----

  async createClass({ classCode, teacherName, clearPoint = 1000, maxGoals = 3, goalApprovalMode = 'self' }) {
    if (!this.db || !classCode) return { ok: false };
    const ref = doc(this.db, 'classes', classCode);
    const now = new Date().toISOString();
    await setDoc(ref, {
      classInfo: {
        classCode,
        teacherName: teacherName || '',
        clearPoint,
        maxGoals,
        goalApprovalMode,
        createdAt: now
      },
      forestState: {
        classPoints: 0,
        completedEvents: [],
        forestGeneration: 1,
        forestStatus: 'growing',
        forestStartedAt: now,
        forestCompletedAt: null,
        nextForestUnlocked: true
      },
      updatedAt: now
    }, { merge: true });
    return { ok: true, classCode };
  }

  async getClass({ classCode }) {
    if (!this.db || !classCode) return { ok: false };
    const ref = doc(this.db, 'classes', classCode);
    const snap = await getDoc(ref);
    if (!snap.exists()) return { ok: false, reason: 'not_found' };
    return { ok: true, data: snap.data() };
  }

  async updateClassSettings({ classCode, settings }) {
    if (!this.db || !classCode || !settings) return { ok: false };
    const ref = doc(this.db, 'classes', classCode);
    await setDoc(ref, {
      classInfo: settings,
      updatedAt: new Date().toISOString()
    }, { merge: true });
    return { ok: true };
  }

  async setStudent({ classCode, studentId, data }) {
    if (!this.db || !classCode || !studentId) return { ok: false };
    const ref = doc(this.db, 'classes', classCode, 'students', studentId);
    await setDoc(ref, {
      ...data,
      studentId,
      lastSeenAt: new Date().toISOString()
    }, { merge: true });
    return { ok: true };
  }

  async createGoal({ classCode, studentId, goal }) {
    if (!this.db || !classCode || !goal || !goal.id) return { ok: false };
    const ref = doc(this.db, 'classes', classCode, 'goals', goal.id);
    await setDoc(ref, {
      ...goal,
      studentId,
      createdAt: new Date().toISOString()
    });
    return { ok: true };
  }

  async deleteGoal({ classCode, goalId }) {
    if (!this.db || !classCode || !goalId) return { ok: false };
    const ref = doc(this.db, 'classes', classCode, 'goals', goalId);
    await deleteDoc(ref);
    return { ok: true };
  }

  async setPlacedAsset({ classCode, placedId, data }) {
    if (!this.db || !classCode || !placedId) return { ok: false };
    const ref = doc(this.db, 'classes', classCode, 'placedAssets', placedId);
    await setDoc(ref, {
      ...data,
      updatedAt: new Date().toISOString()
    }, { merge: true });
    return { ok: true };
  }

  async deletePlacedAsset({ classCode, placedId }) {
    if (!this.db || !classCode || !placedId) return { ok: false };
    const ref = doc(this.db, 'classes', classCode, 'placedAssets', placedId);
    await deleteDoc(ref);
    return { ok: true };
  }

  async updateForestState({ classCode, forestState }) {
    if (!this.db || !classCode) return { ok: false };
    const ref = doc(this.db, 'classes', classCode);
    await setDoc(ref, {
      forestState,
      updatedAt: new Date().toISOString()
    }, { merge: true });
    return { ok: true };
  }

  async addActivityLog({ classCode, type, message, actorName, points, progress }) {
    if (!this.db || !classCode) return { ok: false };
    const logId = 'log_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    const ref = doc(this.db, 'classes', classCode, 'activityLog', logId);
    await setDoc(ref, {
      logId,
      type,
      message,
      actorName: actorName || '',
      points: points || 0,
      progress: progress || 0,
      createdAt: new Date().toISOString()
    });
    return { ok: true, logId };
  }

  async addThanks({ classCode, fromStudentId, fromLabel, toName, message = '' }) {
    if (!this.db || !classCode) return { ok: false };
    const thanksId = 'thx_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    const ref = doc(this.db, 'classes', classCode, 'thanks', thanksId);
    await setDoc(ref, {
      thanksId,
      fromStudentId,
      fromLabel,
      toName,
      message,
      createdAt: new Date().toISOString()
    });
    return { ok: true, thanksId };
  }

  async submitGoalCompletion({ classCode, studentId, goalId, goalTitle, autoApprove = true }) {
    if (!this.db || !classCode) return { ok: false };
    const logId = 'glog_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    const ref = doc(this.db, 'classes', classCode, 'goalLog', logId);
    const status = autoApprove ? 'approved' : 'pending';
    const now = new Date().toISOString();
    await setDoc(ref, {
      logId,
      studentId,
      goalId,
      goalTitle,
      status,
      requestedAt: now,
      resolvedAt: autoApprove ? now : '',
      points: 20
    });
    return { ok: true, logId, status };
  }

  async resolveGoalApproval({ classCode, logId, approve = true }) {
    if (!this.db || !classCode || !logId) return { ok: false };
    const ref = doc(this.db, 'classes', classCode, 'goalLog', logId);
    const status = approve ? 'approved' : 'rejected';
    await updateDoc(ref, {
      status,
      resolvedAt: new Date().toISOString()
    });
    return { ok: true };
  }
}
