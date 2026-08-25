/**
 * コツコツの森 - Firebase (Firestore) クライアントモジュール
 * CDN経由のFirebase v10 ES Modulesを読み込み、Firestoreの初期化とリアルタイムリスナー・データ操作を提供します。
 * GAS（Google Apps Script）を完全代替するバックエンド層です。
 */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js';
import {
  getFirestore,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  writeBatch,
  runTransaction
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';

import { FIREBASE_CONFIG } from './firebase-config.js';

const LOCAL_FIREBASE_CONFIG_KEY = 'kokotsu_firebase_config_v1';

const DEFAULT_STALLED_DAYS = 3;
const DEFAULT_SUPPORT_DAYS = 2;
const POINTS_PER_PLACEMENT = 2;
const POINTS_PER_GOAL_COMPLETION = 20;

function todayKeyJst(date) {
  const d = date || new Date();
  const jstDate = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
  const y = jstDate.getFullYear();
  const m = String(jstDate.getMonth() + 1).padStart(2, '0');
  const day = String(jstDate.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function daysBetweenKeys(key1, key2) {
  if (!key1 || !key2) return null;
  const d1 = new Date(key1 + 'T00:00:00+09:00');
  const d2 = new Date(key2 + 'T00:00:00+09:00');
  return Math.round((d2.getTime() - d1.getTime()) / 86400000);
}

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
      // 新しい順で取得したものを時系列順にして返す
      onData(list.reverse());
    }, onError);
    this.unsubscribers.push(unsub);
    return unsub;
  }

  listenThanks({ classCode, onData, onError, maxItems = 50 }) {
    if (!this.db || !classCode) return () => {};
    const colRef = collection(this.db, 'classes', classCode, 'thanks');
    const q = query(colRef, orderBy('createdAt', 'desc'), limit(maxItems));
    const unsub = onSnapshot(q, (snapshot) => {
      const list = [];
      snapshot.forEach((d) => {
        list.push({ thanksId: d.id, ...d.data() });
      });
      onData(list.reverse());
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

  // 先生画面用: 児童一覧名簿ダッシュボードのリアルタイム集計リスナー
  listenStudentsRoster({ classCode, onData, onError }) {
    if (!this.db || !classCode) return () => {};

    let students = [];
    let goals = [];
    let goalLog = [];
    let classInfo = {};

    const recompute = () => {
      const stalledDays = Math.max(1, Number(classInfo.stalledDays) || DEFAULT_STALLED_DAYS);
      const supportDays = Math.max(1, Number(classInfo.supportDays) || DEFAULT_SUPPORT_DAYS);
      const today = todayKeyJst();
      const recentKeys = [];
      for (let n = 0; n < stalledDays; n++) {
        recentKeys.push(todayKeyJst(new Date(Date.now() - n * 86400000)));
      }

      const activeGoals = goals.filter((g) => g.active !== false);
      const goalCountByStudent = {};
      activeGoals.forEach((g) => {
        goalCountByStudent[g.studentId] = (goalCountByStudent[g.studentId] || 0) + 1;
      });

      const goalLogByStudent = {};
      goalLog.forEach((entry) => {
        (goalLogByStudent[entry.studentId] = goalLogByStudent[entry.studentId] || []).push(entry);
      });

      const roster = students.map((s) => {
        const lastLoginAt = s.lastLoginAt || null;
        const loginStreak = Number(s.loginStreak) || 0;
        const lastLoginKey = lastLoginAt ? todayKeyJst(new Date(lastLoginAt)) : null;
        const daysSinceLogin = lastLoginKey ? daysBetweenKeys(lastLoginKey, today) : null;

        const myLog = goalLogByStudent[s.studentId] || [];
        const activeGoalsCount = goalCountByStudent[s.studentId] || 0;
        const todayAchieved = myLog.filter((e) => e.date === today && e.status === 'approved').length;
        const todayPending = myLog.filter((e) => e.date === today && e.status === 'pending').length;
        const recentAchieved = myLog.filter((e) => recentKeys.indexOf(e.date) !== -1 && e.status === 'approved').length;

        let status = 'good';
        if (daysSinceLogin === null) status = 'never_opened';
        else if (daysSinceLogin >= supportDays) status = 'needs_support';
        else if (daysSinceLogin >= 1) status = 'not_opened_today';
        else if (activeGoalsCount === 0) status = 'no_goals';
        else if (recentAchieved === 0) status = 'stalled';
        else if (todayAchieved === 0) status = 'in_progress';

        return {
          studentId: s.studentId,
          nickname: s.nickname,
          lastLoginAt,
          loginStreak,
          daysSinceLogin,
          activeGoalsCount,
          todayAchieved,
          todayPending,
          status
        };
      });

      onData(roster);
    };

    const unsubClass = onSnapshot(doc(this.db, 'classes', classCode), (snap) => {
      if (snap.exists()) {
        classInfo = snap.data().classInfo || {};
        recompute();
      }
    }, onError);

    const unsubStudents = onSnapshot(collection(this.db, 'classes', classCode, 'students'), (snap) => {
      students = [];
      snap.forEach((d) => students.push({ studentId: d.id, ...d.data() }));
      recompute();
    }, onError);

    const unsubGoals = onSnapshot(collection(this.db, 'classes', classCode, 'goals'), (snap) => {
      goals = [];
      snap.forEach((d) => goals.push({ goalId: d.id, ...d.data() }));
      recompute();
    }, onError);

    const unsubGoalLog = onSnapshot(collection(this.db, 'classes', classCode, 'goalLog'), (snap) => {
      goalLog = [];
      snap.forEach((d) => goalLog.push({ logId: d.id, ...d.data() }));
      recompute();
    }, onError);

    const unsubAll = () => {
      unsubClass();
      unsubStudents();
      unsubGoals();
      unsubGoalLog();
    };
    this.unsubscribers.push(unsubAll);
    return unsubAll;
  }

  // 全リスナー解除
  cleanup() {
    this.unsubscribers.forEach((u) => {
      try { u(); } catch (err) { /* noop */ }
    });
    this.unsubscribers = [];
  }

  // ---- クラス作成・管理 ----

  async createClass({ classCode, teacherName, clearPoint = 1000, mapId = 'kokotsu_forest_01', maxGoals = 3, goalApprovalMode = 'self', stalledDays = 3, supportDays = 2 }) {
    if (!this.db || !classCode) return { ok: false };
    const ref = doc(this.db, 'classes', classCode);
    const now = new Date().toISOString();

    await setDoc(ref, {
      classInfo: {
        classCode,
        teacherName: teacherName || '',
        clearPoint: Number(clearPoint) || 1000,
        mapId: mapId || 'kokotsu_forest_01',
        maxGoals: Number(maxGoals) || 3,
        goalApprovalMode: goalApprovalMode || 'self',
        stalledDays: Number(stalledDays) || DEFAULT_STALLED_DAYS,
        supportDays: Number(supportDays) || DEFAULT_SUPPORT_DAYS,
        createdAt: now,
        active: true
      },
      forestState: {
        classPoints: 0,
        completedEvents: [],
        unlockedCategories: {},
        badges: [],
        animals: [],
        forestGeneration: 1,
        forestStatus: 'growing',
        forestStartedAt: now,
        forestCompletedAt: null,
        forestHistory: [],
        nextForestUnlocked: false
      },
      updatedAt: now
    }, { merge: true });

    // シンボルツリーを自動配置
    await this.ensureSymbolTreePlaced(classCode);

    return { ok: true, data: { classCode, clearPoint, mapId } };
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

  // シンボルツリー初期配置の保証（冪等）
  async ensureSymbolTreePlaced(classCode) {
    if (!this.db || !classCode) return;
    const ref = doc(this.db, 'classes', classCode, 'placedAssets', 'placed_symbol_tree');
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        placedId: 'placed_symbol_tree',
        classCode,
        studentId: '',
        assetId: 'tree_symbol_01',
        spotId: 'symbolTreeSpot',
        x: 50,
        y: 26,
        goalId: '',
        goalTitle: '',
        nickname: 'コツコツの森',
        createdAt: new Date().toISOString()
      });
    }
  }

  // ---- 児童データ管理・ログイン記録 ----

  async setStudent({ classCode, studentId, data }) {
    if (!this.db || !classCode || !studentId) return { ok: false };
    const ref = doc(this.db, 'classes', classCode, 'students', studentId);
    await setDoc(ref, {
      studentId,
      ...data,
      lastSeenAt: new Date().toISOString()
    }, { merge: true });
    return { ok: true };
  }

  // 1日1回の来訪記録（loginStreak）更新
  async touchStudentLogin(classCode, studentId) {
    if (!this.db || !classCode || !studentId) return;
    const ref = doc(this.db, 'classes', classCode, 'students', studentId);
    try {
      const snap = await getDoc(ref);
      if (!snap.exists()) return;
      const student = snap.data();

      const today = todayKeyJst();
      const lastKey = student.lastLoginAt ? todayKeyJst(new Date(student.lastLoginAt)) : null;
      if (lastKey === today) return; // 今日は記録済み

      const diff = daysBetweenKeys(lastKey, today);
      const streak = diff === 1 ? (Number(student.loginStreak) || 0) + 1 : 1;
      const nowIso = new Date().toISOString();

      await updateDoc(ref, {
        lastLoginAt: nowIso,
        loginStreak: streak,
        lastSeenAt: nowIso
      });
    } catch (err) {
      console.warn('[FirebaseClient] touchStudentLogin error:', err);
    }
  }

  // ---- 目標管理 ----

  async createGoal({ classCode, studentId, goal }) {
    if (!this.db || !classCode || !goal || !goal.id) return { ok: false };
    const ref = doc(this.db, 'classes', classCode, 'goals', goal.id);
    await setDoc(ref, {
      ...goal,
      goalId: goal.id,
      studentId,
      active: true,
      createdAt: new Date().toISOString()
    });
    return { ok: true };
  }

  async deleteGoal({ classCode, goalId }) {
    if (!this.db || !classCode || !goalId) return { ok: false };
    const ref = doc(this.db, 'classes', classCode, 'goals', goalId);
    await updateDoc(ref, { active: false });
    return { ok: true };
  }

  // 目標達成の提出（自己承認 or 先生承認待ち）
  async submitGoalCompletion({ classCode, studentId, goalId, goalTitle, autoApprove = true }) {
    if (!this.db || !classCode) return { ok: false };
    const logId = 'glog_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    const ref = doc(this.db, 'classes', classCode, 'goalLog', logId);
    const status = autoApprove ? 'approved' : 'pending';
    const now = new Date();
    const nowIso = now.toISOString();
    const today = todayKeyJst(now);

    await setDoc(ref, {
      logId,
      classCode,
      studentId,
      goalId,
      goalTitle,
      date: today,
      status,
      requestedAt: nowIso,
      resolvedAt: autoApprove ? nowIso : '',
      points: autoApprove ? POINTS_PER_GOAL_COMPLETION : 0
    });

    if (autoApprove) {
      // ポイント加算と貢献ログ記録
      await this.awardGoalPointsAndAnnounce({ classCode, studentId, goalTitle, points: POINTS_PER_GOAL_COMPLETION, actionNoun: `「${goalTitle}」の達成` });
    }

    return { ok: true, logId, status };
  }

  // 先生による目標の承認 / 却下
  async resolveGoalApproval({ classCode, logId, approve = true }) {
    if (!this.db || !classCode || !logId) return { ok: false };
    const ref = doc(this.db, 'classes', classCode, 'goalLog', logId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return { ok: false, reason: 'not_found' };
    const logData = snap.data();

    const status = approve ? 'approved' : 'rejected';
    const nowIso = new Date().toISOString();

    await updateDoc(ref, {
      status,
      resolvedAt: nowIso,
      points: approve ? POINTS_PER_GOAL_COMPLETION : 0
    });

    if (approve) {
      await this.awardGoalPointsAndAnnounce({
        classCode,
        studentId: logData.studentId,
        goalTitle: logData.goalTitle,
        points: POINTS_PER_GOAL_COMPLETION,
        actionNoun: `「${logData.goalTitle}」の承認`
      });
    }

    return { ok: true };
  }

  // ポイント付与＆5%節目到達判定と活動ログ追加
  async awardGoalPointsAndAnnounce({ classCode, studentId, goalTitle, points, actionNoun }) {
    try {
      const classRef = doc(this.db, 'classes', classCode);
      const studentRef = doc(this.db, 'classes', classCode, 'students', studentId);

      let beforePercent = 0;
      let afterPercent = 0;
      let nickname = 'クラスの子';
      let clearPoint = 1000;

      await runTransaction(this.db, async (txn) => {
        const classSnap = await txn.get(classRef);
        const studentSnap = await txn.get(studentRef);

        if (!classSnap.exists()) return;
        const classData = classSnap.data();
        clearPoint = Number(classData.classInfo?.clearPoint) || 1000;
        const currentClassPoints = Number(classData.forestState?.classPoints) || 0;
        beforePercent = clearPoint > 0 ? (currentClassPoints / clearPoint) * 100 : 0;

        const nextClassPoints = currentClassPoints + points;
        afterPercent = clearPoint > 0 ? (nextClassPoints / clearPoint) * 100 : 0;

        txn.update(classRef, {
          'forestState.classPoints': nextClassPoints,
          updatedAt: new Date().toISOString()
        });

        if (studentSnap.exists()) {
          const studentData = studentSnap.data();
          nickname = studentData.nickname || nickname;
          const currentPersonal = Number(studentData.personalPoints) || 0;
          const currentLifetime = Number(studentData.lifetimePoints) || 0;
          txn.update(studentRef, {
            personalPoints: currentPersonal + points,
            lifetimePoints: currentLifetime + points
          });
        }
      });

      // 5%の節目をまたいだか判定
      const beforeStep = Math.floor(Math.min(beforePercent, 100) / 5);
      const afterStep = Math.floor(Math.min(afterPercent, 100) / 5);

      if (afterStep > beforeStep) {
        const milestonePercent = Math.min(100, afterStep * 5);
        await this.addActivityLog({
          classCode,
          type: 'contribution_milestone',
          message: `🌟 ${nickname}さんの${actionNoun}が最後のひと押しになって、森が${milestonePercent}%まで育ちました！`,
          actorName: nickname,
          points,
          progress: milestonePercent
        });
      } else {
        await this.addActivityLog({
          classCode,
          type: 'contribution',
          message: `✅ ${nickname}さんが${actionNoun}をがんばりました（+${points}pt）`,
          actorName: nickname,
          points
        });
      }
    } catch (err) {
      console.warn('[FirebaseClient] awardGoalPointsAndAnnounce error:', err);
    }
  }

  // ---- 配置物管理 ----

  async setPlacedAsset({ classCode, placedId, data }) {
    if (!this.db || !classCode || !placedId) return { ok: false };
    const ref = doc(this.db, 'classes', classCode, 'placedAssets', placedId);
    await setDoc(ref, {
      ...data,
      placedId,
      updatedAt: new Date().toISOString()
    }, { merge: true });

    // 配置時のポイント加算（+2pt）
    if (data.studentId) {
      try {
        const classRef = doc(this.db, 'classes', classCode);
        const studentRef = doc(this.db, 'classes', classCode, 'students', data.studentId);
        await runTransaction(this.db, async (txn) => {
          const classSnap = await txn.get(classRef);
          const studentSnap = await txn.get(studentRef);
          if (classSnap.exists()) {
            const currentPoints = Number(classSnap.data().forestState?.classPoints) || 0;
            txn.update(classRef, {
              'forestState.classPoints': currentPoints + POINTS_PER_PLACEMENT,
              updatedAt: new Date().toISOString()
            });
          }
          if (studentSnap.exists()) {
            const currentPersonal = Number(studentSnap.data().personalPoints) || 0;
            const currentLifetime = Number(studentSnap.data().lifetimePoints) || 0;
            txn.update(studentRef, {
              personalPoints: currentPersonal + POINTS_PER_PLACEMENT,
              lifetimePoints: currentLifetime + POINTS_PER_PLACEMENT
            });
          }
        });
      } catch (err) {
        console.warn('[FirebaseClient] place points error:', err);
      }
    }

    return { ok: true };
  }

  async deletePlacedAsset({ classCode, placedId }) {
    if (!this.db || !classCode || !placedId) return { ok: false };
    const ref = doc(this.db, 'classes', classCode, 'placedAssets', placedId);
    await deleteDoc(ref);
    return { ok: true };
  }

  // ---- ショップ購入 ----

  async buyItem({ classCode, studentId, itemId, assetId, itemName, price = 0 }) {
    if (!this.db || !classCode || !studentId) return { ok: false };
    const studentRef = doc(this.db, 'classes', classCode, 'students', studentId);
    const snap = await getDoc(studentRef);
    if (!snap.exists()) return { ok: false, reason: 'not_found' };

    const student = snap.data();
    const currentPoints = Number(student.personalPoints) || 0;
    if (currentPoints < price) return { ok: false, reason: 'not_enough_points' };

    const shopPurchased = Array.isArray(student.shopPurchased) ? [...student.shopPurchased] : [];
    const ownedAssets = Array.isArray(student.ownedAssets) ? [...student.ownedAssets] : [];

    if (itemId && !shopPurchased.includes(itemId)) shopPurchased.push(itemId);
    if (assetId && !ownedAssets.includes(assetId)) ownedAssets.push(assetId);

    const newPoints = currentPoints - price;
    await updateDoc(studentRef, {
      personalPoints: newPoints,
      shopPurchased,
      ownedAssets
    });

    await this.addActivityLog({
      classCode,
      type: 'purchase',
      message: `🛍️ ${student.nickname || 'だれか'}が「${itemName || assetId || itemId}」を手に入れました`,
      actorName: student.nickname || ''
    });

    return { ok: true, data: { personalPoints: newPoints } };
  }

  // ---- 森の状態・ライフサイクル管理 ----

  async updateForestState({ classCode, forestState }) {
    if (!this.db || !classCode) return { ok: false };
    const ref = doc(this.db, 'classes', classCode);
    await setDoc(ref, {
      forestState,
      updatedAt: new Date().toISOString()
    }, { merge: true });
    return { ok: true };
  }

  // 先生用: 次の森の解放（nextForestUnlocked: true）
  async releaseNextForest({ classCode }) {
    if (!this.db || !classCode) return { ok: false };
    const ref = doc(this.db, 'classes', classCode);
    await setDoc(ref, {
      forestState: { nextForestUnlocked: true },
      updatedAt: new Date().toISOString()
    }, { merge: true });

    await this.addActivityLog({
      classCode,
      type: 'teacher_release',
      message: '🔓 先生が次の森に進めるようにしました'
    });

    return { ok: true };
  }

  // 「新しい森をはじめる」: 年表アーカイブ、配置物リセット、シンボルツリー再配置、世代インクリメント
  async startNewForest({ classCode }) {
    if (!this.db || !classCode) return { ok: false, reason: 'not_ready' };

    const classRef = doc(this.db, 'classes', classCode);
    const snap = await getDoc(classRef);
    if (!snap.exists()) return { ok: false, reason: 'not_found' };

    const classData = snap.data();
    const forestRow = classData.forestState || {};
    const classInfo = classData.classInfo || {};

    if (forestRow.forestStatus !== 'completed') {
      return { ok: false, reason: 'not_completed' };
    }
    if (forestRow.nextForestUnlocked !== true) {
      return { ok: false, reason: 'not_released' };
    }

    const generation = Number(forestRow.forestGeneration) || 1;
    const clearPoint = Number(classInfo.clearPoint) || 1000;
    const startedAt = forestRow.forestStartedAt || null;
    const completedAt = forestRow.forestCompletedAt || new Date().toISOString();
    const classPoints = Number(forestRow.classPoints) || 0;

    // 配置物一覧を取得
    const placedAssetsSnap = await getDocs(collection(this.db, 'classes', classCode, 'placedAssets'));
    const placedAssets = [];
    placedAssetsSnap.forEach(d => placedAssets.push({ id: d.id, ...d.data() }));

    // 年表作成（ActivityLogから）
    const logSnap = await getDocs(collection(this.db, 'classes', classCode, 'activityLog'));
    const TIMELINE_TYPES = { forest_event: true, badge: true, unlock: true };
    const timeline = [];
    logSnap.forEach(d => {
      const log = d.data();
      if (TIMELINE_TYPES[log.type]) {
        if (!startedAt || new Date(log.createdAt) >= new Date(startedAt)) {
          timeline.push({ message: log.message, at: log.createdAt, type: log.type });
        }
      }
    });
    timeline.sort((a, b) => new Date(a.at) - new Date(b.at));

    const archived = {
      generation,
      mapId: classInfo.mapId || 'kokotsu_forest_01',
      startedAt,
      completedAt,
      classPoints,
      clearPoint,
      progressPercent: clearPoint > 0 ? Math.min(100, Math.round((classPoints / clearPoint) * 1000) / 10) : 0,
      placedCount: placedAssets.length,
      eventCount: (forestRow.completedEvents || []).length,
      badgeCount: (forestRow.badges || []).length,
      animalCount: (forestRow.animals || []).length,
      timeline
    };

    const history = Array.isArray(forestRow.forestHistory) ? [...forestRow.forestHistory] : [];
    const dedupedHistory = history.filter((h) => Number(h.generation) !== generation);
    dedupedHistory.push(archived);

    // 配置物をバッチ削除
    const batch = writeBatch(this.db);
    placedAssetsSnap.forEach(docSnap => {
      batch.delete(docSnap.ref);
    });
    await batch.commit();

    // 新しい世代でリセット
    const now = new Date().toISOString();
    const nextGeneration = generation + 1;

    await setDoc(classRef, {
      forestState: {
        classPoints: 0,
        completedEvents: [],
        unlockedCategories: {},
        badges: [],
        animals: [],
        forestGeneration: nextGeneration,
        forestStatus: 'growing',
        forestStartedAt: now,
        forestCompletedAt: null,
        forestHistory: dedupedHistory,
        nextForestUnlocked: false
      },
      updatedAt: now
    }, { merge: true });

    // シンボルツリーを再配置
    await this.ensureSymbolTreePlaced(classCode);

    await this.addActivityLog({
      classCode,
      type: 'new_forest',
      message: `🌱 ${nextGeneration}代目の森がはじまりました`
    });

    return { ok: true, data: { generation: nextGeneration, archived } };
  }

  // ---- ログ・メッセージ ----

  async addActivityLog({ classCode, type, message, actorName, points, progress }) {
    if (!this.db || !classCode) return { ok: false };
    const logId = 'log_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    const ref = doc(this.db, 'classes', classCode, 'activityLog', logId);
    await setDoc(ref, {
      logId,
      classCode,
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
    const now = new Date();
    await setDoc(ref, {
      thanksId,
      classCode,
      fromStudentId: fromStudentId || '',
      fromLabel: fromLabel || 'わたし',
      toName,
      message,
      date: todayKeyJst(now),
      createdAt: now.toISOString()
    });
    return { ok: true, thanksId };
  }
}
