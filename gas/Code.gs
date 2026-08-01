/**
 * コツコツの森 - GASバックエンド
 * docs/11_gas_backend_spec.md に対応する実装。
 *
 * ## CORSについて(重要)
 * GitHub Pages(他オリジン)からこのウェブアプリを叩くと、素朴に
 * `fetch(url, { headers: { 'Content-Type': 'application/json' } })` すると
 * プリフライト(OPTIONS)が飛び、GASはOPTIONSをうまく処理できないためCORSエラーになる。
 *
 * 対策:
 *  - フロント側(js/api-client.js)は `Content-Type: text/plain` で送る
 *    → 「シンプルリクエスト」扱いになりプリフライトが発生しない
 *  - GAS側は e.postData.contents を自分でJSON.parseする(text/plainで受けてもJSONとして中身を読める)
 *  - レスポンスは常にHTTP 200 + JSON本文にする(ok:true/false)。
 *    GAS自体が例外を投げてエラーページ(HTML)を返すと、フロント側のres.json()が失敗するため、
 *    doPost内は必ずtry/catchし、失敗時も respond({ok:false,...}) の形で返す
 *  - 万一OPTIONSが飛んできても落ちないよう doOptions を用意している
 *
 * ## 実装済みaction
 *  疎通: ping
 *  クラス/参加: createClass, joinClass
 *  同期: syncState
 *  森: placeAsset, removePlacedAsset, updateForestState, startNewForest
 *  (v16.1) ForestStateに forestGeneration/forestStatus/forestStartedAt/forestCompletedAt/forestHistory を追加。
 *  「完全クリア→次の森へ」をクラス全員で共有できるようにした(docs/14参照)。
 *  目標: createGoal, removeGoal, completeGoal, approveGoal, rejectGoal
 *  ありがとう: sendThanks
 *  ショップ: buyItem
 *  先生設定: setGoalSettings, setClearPoint
 *  (v22) クラス協力の意味づけ強化: 目標達成/承認のたびに announceContribution() が
 *  ActivityLogへ「誰が/何をして/森が何%育ったか」を記録する。5%の節目をまたいだ行動は
 *  type:'contribution_milestone' として actorName/points/progress を持つ特別な行にする
 *  (クライアント側で森イベント演出に「最後のひと押しは◯◯さんでした」を紐付けるため)。
 */

// ---- 設定 ----

const SHEET_NAMES = {
  CLASSES: 'Classes',
  STUDENTS: 'Students',
  GOALS: 'Goals',
  GOAL_LOG: 'GoalLog',
  PLACED_ASSETS: 'PlacedAssets',
  ACTIVITY_LOG: 'ActivityLog',
  THANKS: 'Thanks',
  FOREST_STATE: 'ForestState'
};

const SHEET_HEADERS = {
  // stalledDays/supportDays は児童一覧ダッシュボード(v20)の「停滞」「要支援」判定日数。
  // 先生が学級の実情に合わせて調整できるよう、固定値ではなくクラス単位の設定にした(v21)。
  Classes: ['classCode', 'teacherName', 'clearPoint', 'mapId', 'goalApprovalMode', 'maxGoals', 'createdAt', 'resetAt', 'active', 'stalledDays', 'supportDays'],
  // lastLoginAt/loginStreak は先生用ダッシュボード(児童一覧)のために追加(v20)。
  // syncStateがstudentId付きで呼ばれた「その日いちばん最初の1回」だけ更新する(書き込み頻度を抑えるため)。
  Students: ['studentId', 'classCode', 'nickname', 'personalPoints', 'lifetimePoints', 'ownedAssetsJson', 'shopPurchasedJson', 'inventoryJson', 'createdAt', 'lastLoginAt', 'loginStreak'],
  Goals: ['goalId', 'classCode', 'studentId', 'title', 'targetCount', 'createdAt', 'active'],
  GoalLog: ['logId', 'classCode', 'studentId', 'goalId', 'goalTitle', 'date', 'status', 'requestedAt', 'resolvedAt', 'points'],
  PlacedAssets: ['placedId', 'classCode', 'studentId', 'assetId', 'spotId', 'x', 'y', 'goalId', 'goalTitle', 'createdAt'],
  // actorName/points/progress は「クラス協力の意味づけ」強化(v22)で追加。
  // type: 'contribution'/'contribution_milestone' の行だけが使う(他のtypeは空欄のまま)。
  ActivityLog: ['logId', 'classCode', 'type', 'message', 'createdAt', 'actorName', 'points', 'progress'],
  Thanks: ['thanksId', 'classCode', 'fromStudentId', 'fromLabel', 'toName', 'date', 'createdAt'],
  // forestGeneration/forestStatus/forestStartedAt/forestCompletedAt/forestHistory は
  // 「クラス全員で同じ森を次代へつなぐ」ための追加列(docs/14参照)。
  // core-runtime.js側のstateフィールド名とできるだけ1対1にしてある。
  ForestState: ['classCode', 'classPoints', 'completedEvents', 'unlockedCategories', 'badges', 'animals',
    'forestGeneration', 'forestStatus', 'forestStartedAt', 'forestCompletedAt', 'forestHistory']
};

const CLASS_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789-_'; // 紛らわしい 0/O, 1/I/l は除外
const CLASS_CODE_LENGTH = 16;
const STUDENT_ID_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const STUDENT_ID_LENGTH = 8;
const ACTIVITY_LOG_LIMIT = 50;
const THANKS_LOG_LIMIT = 50;

// core-runtime.js のポイント定数と揃える(値がずれるとクライアント側のローカル計算と食い違うため)。
const POINTS_PER_PLACEMENT = 2;
const POINTS_PER_GOAL_COMPLETION = 20;

// 児童一覧ダッシュボード(v20)の判定日数のデフォルト値。クラスごとに上書き可能(v21)。
const DEFAULT_STALLED_DAYS = 3;
const DEFAULT_SUPPORT_DAYS = 2;

// ---- エントリポイント ----

function doGet(e) {
  return respond({ ok: true, data: { message: 'kokotsu_forest GAS is running' } });
}

// プリフライトが飛んできても素直に200を返す(通常はtext/plain送信のため発生しない想定)。
function doOptions(e) {
  return respond({ ok: true, data: {} });
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse((e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return respond({ ok: false, reason: 'invalid_json' });
  }

  const action = body.action;
  const classCode = body.classCode || null;
  const studentId = body.studentId || null;
  const payload = body.payload || {};

  const handler = ACTION_HANDLERS[action];
  if (!handler) {
    return respond({ ok: false, reason: 'unknown_action' });
  }

  // 書き込みを伴うactionは直列化する(同時に複数の児童が操作するため)。
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (err) {
    return respond({ ok: false, reason: 'lock_timeout' });
  }

  try {
    setupSheets(); // 初回アクセス時にヘッダーが無ければ作る(冪等)
    const result = handler({ classCode, studentId, payload });
    return respond(result);
  } catch (err) {
    return respond({ ok: false, reason: 'server_error', message: String((err && err.message) || err) });
  } finally {
    lock.releaseLock();
  }
}

// ---- アクションハンドラ一覧 ----

const ACTION_HANDLERS = {
  ping: handlePing,
  createClass: handleCreateClass,
  joinClass: handleJoinClass,
  syncState: handleSyncState,
  placeAsset: handlePlaceAsset,
  removePlacedAsset: handleRemovePlacedAsset,
  updateForestState: handleUpdateForestState,
  startNewForest: handleStartNewForest,
  createGoal: handleCreateGoal,
  removeGoal: handleRemoveGoal,
  completeGoal: handleCompleteGoal,
  approveGoal: handleApproveGoal,
  rejectGoal: handleRejectGoal,
  sendThanks: handleSendThanks,
  buyItem: handleBuyItem,
  setGoalSettings: handleSetGoalSettings,
  setClearPoint: handleSetClearPoint,
  setRosterThresholds: handleSetRosterThresholds
};

// ---- 疎通 ----

function handlePing() {
  return { ok: true, data: { pong: true, time: new Date().toISOString() } };
}

// ---- クラス / 参加 ----

function handleCreateClass({ payload }) {
  const teacherName = String(payload.teacherName || '').trim();
  const clearPoint = Number(payload.clearPoint) || 1000;
  const mapId = String(payload.mapId || 'kokotsu_forest_01');

  const classCode = generateUniqueCode(SHEET_NAMES.CLASSES, 'classCode', () => generateCode(CLASS_CODE_CHARS, CLASS_CODE_LENGTH));
  const now = new Date().toISOString();

  appendRow(SHEET_NAMES.CLASSES, {
    classCode, teacherName, clearPoint, mapId,
    goalApprovalMode: 'self', maxGoals: 3,
    createdAt: now, resetAt: '', active: true,
    stalledDays: DEFAULT_STALLED_DAYS, supportDays: DEFAULT_SUPPORT_DAYS
  });

  appendRow(SHEET_NAMES.FOREST_STATE, {
    classCode,
    classPoints: 0,
    completedEvents: JSON.stringify([]),
    unlockedCategories: JSON.stringify({}),
    badges: JSON.stringify([]),
    animals: JSON.stringify([]),
    forestGeneration: 1,
    forestStatus: 'growing',
    forestStartedAt: now,
    forestCompletedAt: '',
    forestHistory: JSON.stringify([])
  });

  return { ok: true, data: { classCode, clearPoint, mapId } };
}

function handleJoinClass({ classCode, studentId, payload }) {
  if (!classCode) return { ok: false, reason: 'classCode_required' };

  const klass = findRow(SHEET_NAMES.CLASSES, 'classCode', classCode);
  if (!klass || klass.active === false || klass.active === 'FALSE') {
    return { ok: false, reason: 'class_not_found' };
  }

  if (studentId) {
    const student = findRow(SHEET_NAMES.STUDENTS, 'studentId', studentId);
    if (student && student.classCode === classCode) {
      return { ok: true, data: { studentId, nickname: student.nickname, isNew: false } };
    }
    // 渡されたIDがこのクラスに存在しない場合は、新規発行にフォールバックする。
  }

  const nickname = String(payload.nickname || '').trim() || 'なまえみとうろく';
  const newStudentId = generateUniqueCode(SHEET_NAMES.STUDENTS, 'studentId', () => generateCode(STUDENT_ID_CHARS, STUDENT_ID_LENGTH));
  const now = new Date().toISOString();

  appendRow(SHEET_NAMES.STUDENTS, {
    studentId: newStudentId, classCode, nickname,
    personalPoints: 0, lifetimePoints: 0,
    ownedAssetsJson: JSON.stringify([]),
    shopPurchasedJson: JSON.stringify([]),
    inventoryJson: JSON.stringify({}),
    createdAt: now,
    lastLoginAt: '',
    loginStreak: 0
  });

  return { ok: true, data: { studentId: newStudentId, nickname, isNew: true } };
}

// ---- 同期(読み取り) ----

// クラス共有データをまとめて返す。児童個人のデータ(goals, ownedAssets等)は
// 呼び出し元のstudentIdの分だけ別で返す。
// 差分同期(sinceパラメータ)は今後の負荷次第で検討。当面は毎回全件で十分な規模想定。
function handleSyncState({ classCode, studentId }) {
  if (!classCode) return { ok: false, reason: 'classCode_required' };
  const klass = findRow(SHEET_NAMES.CLASSES, 'classCode', classCode);
  if (!klass) return { ok: false, reason: 'class_not_found' };

  const forestStateRow = findRow(SHEET_NAMES.FOREST_STATE, 'classCode', classCode) || {};
  const placedAssets = readAllRows(SHEET_NAMES.PLACED_ASSETS).filter((r) => r.classCode === classCode);
  const activityLog = readAllRows(SHEET_NAMES.ACTIVITY_LOG)
    .filter((r) => r.classCode === classCode)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .slice(-ACTIVITY_LOG_LIMIT);
  const thanksLog = readAllRows(SHEET_NAMES.THANKS)
    .filter((r) => r.classCode === classCode)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .slice(-THANKS_LOG_LIMIT);
  const goalLogPending = readAllRows(SHEET_NAMES.GOAL_LOG)
    .filter((r) => r.classCode === classCode && r.status === 'pending');
  // 先生用ページ(teacher.html)が承認待ち一覧に「だれの目標か」を表示するために使う。
  // 通常の児童画面はこの配列を使わない。
  const studentRows = readAllRows(SHEET_NAMES.STUDENTS).filter((r) => r.classCode === classCode);
  const students = studentRows.map((r) => ({ studentId: r.studentId, nickname: r.nickname }));

  let student = null;
  let myGoals = [];
  let myGoalLog = [];
  if (studentId) {
    student = findRow(SHEET_NAMES.STUDENTS, 'studentId', studentId);
    if (student) touchStudentLogin(student); // 今日はじめてのsyncStateなら来訪記録を更新する
    myGoals = readAllRows(SHEET_NAMES.GOALS).filter((r) => r.classCode === classCode && r.studentId === studentId && r.active !== false);
    myGoalLog = readAllRows(SHEET_NAMES.GOAL_LOG).filter((r) => r.classCode === classCode && r.studentId === studentId);
  }

  // 先生が呼んだとき(studentId無し)だけ、児童一覧ダッシュボード用の集計を作る。
  // 児童側の同期では使わないデータなので、無駄な全件読みを避けるため分岐している。
  const studentsRoster = studentId ? [] : buildStudentsRoster(classCode, studentRows, {
    stalledDays: klass.stalledDays,
    supportDays: klass.supportDays
  });

  return {
    ok: true,
    data: {
      classInfo: {
        classCode: klass.classCode,
        teacherName: klass.teacherName,
        clearPoint: Number(klass.clearPoint) || 1000,
        mapId: klass.mapId,
        goalApprovalMode: klass.goalApprovalMode || 'self',
        maxGoals: Number(klass.maxGoals) || 3,
        stalledDays: Number(klass.stalledDays) || DEFAULT_STALLED_DAYS,
        supportDays: Number(klass.supportDays) || DEFAULT_SUPPORT_DAYS
      },
      forestState: {
        classPoints: Number(forestStateRow.classPoints) || 0,
        completedEvents: safeParseJson(forestStateRow.completedEvents, []),
        unlockedCategories: safeParseJson(forestStateRow.unlockedCategories, {}),
        badges: safeParseJson(forestStateRow.badges, []),
        animals: safeParseJson(forestStateRow.animals, []),
        forestGeneration: Number(forestStateRow.forestGeneration) || 1,
        forestStatus: forestStateRow.forestStatus || 'growing',
        forestStartedAt: forestStateRow.forestStartedAt || null,
        forestCompletedAt: forestStateRow.forestCompletedAt || null,
        forestHistory: safeParseJson(forestStateRow.forestHistory, [])
      },
      placedAssets: placedAssets.map(stripRowMeta),
      activityLog: activityLog.map(stripRowMeta),
      thanksLog: thanksLog.map(stripRowMeta),
      goalLogPending: goalLogPending.map(stripRowMeta),
      students,
      studentsRoster,
      me: student ? {
        studentId: student.studentId,
        nickname: student.nickname,
        personalPoints: Number(student.personalPoints) || 0,
        lifetimePoints: Number(student.lifetimePoints) || 0,
        ownedAssets: safeParseJson(student.ownedAssetsJson, []),
        shopPurchased: safeParseJson(student.shopPurchasedJson, []),
        inventory: safeParseJson(student.inventoryJson, {}),
        goals: myGoals.map(stripRowMeta),
        goalLog: myGoalLog.map(stripRowMeta)
      } : null
    }
  };
}

// ---- 森: 配置 ----

function handlePlaceAsset({ classCode, studentId, payload }) {
  if (!classCode || !studentId) return { ok: false, reason: 'auth_required' };
  const { assetId, spotId, x, y, goalId, goalTitle } = payload;
  if (!assetId) return { ok: false, reason: 'assetId_required' };

  const placedId = Utilities.getUuid();
  const now = new Date().toISOString();
  // goalId/goalTitleは「置いたときに直前にクリアしていた目標」(クライアント側でstate.lastCompletedGoalを送る)。
  // 無くても配置自体は成立する(自由に置いた花、という扱いになる)。
  appendRow(SHEET_NAMES.PLACED_ASSETS, {
    placedId, classCode, studentId, assetId, spotId: spotId || '', x: x || 0, y: y || 0,
    goalId: goalId || '', goalTitle: goalTitle || '', createdAt: now
  });

  const classPoints = addClassPoints(classCode, POINTS_PER_PLACEMENT);
  addStudentPoints(studentId, POINTS_PER_PLACEMENT);

  return { ok: true, data: { placedId, pointsAwarded: POINTS_PER_PLACEMENT, classPoints } };
}

function handleRemovePlacedAsset({ classCode, payload }) {
  const { placedId } = payload;
  const row = findRow(SHEET_NAMES.PLACED_ASSETS, 'placedId', placedId);
  if (!row || row.classCode !== classCode) return { ok: false, reason: 'not_found' };
  getSheet(SHEET_NAMES.PLACED_ASSETS).deleteRow(row._row);
  return { ok: true, data: { placedId } };
}

// クライアント側で syncMilestones() (イベント/バッジ/動物の判定) を計算し終えた後、
// その結果のJSON塊をまとめてここに書き戻す。ゲームロジック自体はクライアントが正とする。
function handleUpdateForestState({ classCode, payload }) {
  const row = findRow(SHEET_NAMES.FOREST_STATE, 'classCode', classCode);
  if (!row) return { ok: false, reason: 'not_found' };
  const update = {};
  if ('classPoints' in payload) update.classPoints = Number(payload.classPoints) || 0;
  if ('completedEvents' in payload) update.completedEvents = JSON.stringify(payload.completedEvents || []);
  if ('unlockedCategories' in payload) update.unlockedCategories = JSON.stringify(payload.unlockedCategories || {});
  if ('badges' in payload) update.badges = JSON.stringify(payload.badges || []);
  if ('animals' in payload) update.animals = JSON.stringify(payload.animals || []);

  // forestStatusは「growing → completed」への一方向の遷移だけをここで許可する。
  // completed → growing への巻き戻しや forestGeneration を進めるのは
  // 専用の startNewForest action だけが行う。理由: 複数端末が同時に syncMilestones() を
  // 計算するため、ここで雑に上書きを許すと「新しい森が始まった直後に、まだ前の世代の
  // 完成を検知していない古い端末が completed で上書きしてしまう」事故になる。
  // それを防ぐため、送られてきた forestGeneration がサーバー側の現在世代と一致する
  // ときだけ反映する。
  const currentGeneration = Number(row.forestGeneration) || 1;
  const payloadGeneration = Number(payload.forestGeneration) || currentGeneration;
  if (payload.forestStatus === 'completed' && row.forestStatus !== 'completed' && payloadGeneration === currentGeneration) {
    update.forestStatus = 'completed';
    update.forestCompletedAt = payload.forestCompletedAt || new Date().toISOString();
  }

  updateRow(SHEET_NAMES.FOREST_STATE, row._row, update);
  return { ok: true, data: {} };
}

// ---- 森: ライフサイクル(次代へつなぐ) ----

// 「新しい森をはじめる」をクラス全員で共有するためのaction。
// completed状態のときだけ実行できる(サーバー側でも再確認し、二重リセットを防ぐ)。
// 今の森を forestHistory へアーカイブしてから、森そのものの成長を表す値
// (classPoints/completedEvents/unlockedCategories/badges/animals/配置物)をリセットする。
// 個人の頑張りの記録(Students シートの personalPoints 等)はここでは一切触らない。
function handleStartNewForest({ classCode }) {
  const forestRow = findRow(SHEET_NAMES.FOREST_STATE, 'classCode', classCode);
  if (!forestRow) return { ok: false, reason: 'not_found' };
  if (forestRow.forestStatus !== 'completed') return { ok: false, reason: 'not_completed' };

  const klass = findRow(SHEET_NAMES.CLASSES, 'classCode', classCode);
  const clearPoint = (klass && Number(klass.clearPoint)) || 1000;
  const generation = Number(forestRow.forestGeneration) || 1;
  const startedAt = forestRow.forestStartedAt || null;
  const completedAt = forestRow.forestCompletedAt || new Date().toISOString();

  const placedAssets = readAllRows(SHEET_NAMES.PLACED_ASSETS).filter((r) => r.classCode === classCode);

  // 年表は、この森の期間(forestStartedAt以降)に起きた forest_event/badge/unlock を
  // ActivityLogから時系列で復元する(core-runtime.jsのbuildForestTimelineと同じ考え方)。
  const TIMELINE_TYPES = { forest_event: true, badge: true, unlock: true };
  const timeline = readAllRows(SHEET_NAMES.ACTIVITY_LOG)
    .filter((r) => r.classCode === classCode && TIMELINE_TYPES[r.type])
    .filter((r) => !startedAt || new Date(r.createdAt) >= new Date(startedAt))
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .map((r) => ({ message: r.message, at: r.createdAt, type: r.type }));

  const classPoints = Number(forestRow.classPoints) || 0;
  const archived = {
    generation,
    mapId: klass ? klass.mapId : '',
    startedAt,
    completedAt,
    classPoints,
    clearPoint,
    progressPercent: clearPoint > 0 ? Math.min(100, Math.round((classPoints / clearPoint) * 1000) / 10) : 0,
    placedCount: placedAssets.length,
    eventCount: safeParseJson(forestRow.completedEvents, []).length,
    badgeCount: safeParseJson(forestRow.badges, []).length,
    animalCount: safeParseJson(forestRow.animals, []).length,
    timeline
  };

  const history = safeParseJson(forestRow.forestHistory, []);
  // 同じ世代が二重に積まれないようにしてから追加する(通信の再送・複数端末の同時操作対策)。
  const dedupedHistory = history.filter((h) => Number(h.generation) !== generation);
  dedupedHistory.push(archived);

  // 配置物は次の世代のために片付ける(森そのものをリセットするため)。行番号が大きい方から削除する。
  placedAssets
    .sort((a, b) => b._row - a._row)
    .forEach((r) => getSheet(SHEET_NAMES.PLACED_ASSETS).deleteRow(r._row));

  const now = new Date().toISOString();
  const nextGeneration = generation + 1;
  updateRow(SHEET_NAMES.FOREST_STATE, forestRow._row, {
    classPoints: 0,
    completedEvents: JSON.stringify([]),
    unlockedCategories: JSON.stringify({}),
    badges: JSON.stringify([]),
    animals: JSON.stringify([]),
    forestGeneration: nextGeneration,
    forestStatus: 'growing',
    forestStartedAt: now,
    forestCompletedAt: '',
    forestHistory: JSON.stringify(dedupedHistory)
  });

  appendActivityLog(classCode, 'new_forest', `🌱 ${nextGeneration}代目の森がはじまりました`);

  return { ok: true, data: { generation: nextGeneration, archived } };
}

// ---- 目標 ----

function handleCreateGoal({ classCode, studentId, payload }) {
  if (!classCode || !studentId) return { ok: false, reason: 'auth_required' };
  const title = String(payload.title || '').trim();
  if (!title) return { ok: false, reason: 'empty_title' };

  const klass = findRow(SHEET_NAMES.CLASSES, 'classCode', classCode);
  const maxGoals = (klass && Number(klass.maxGoals)) || 3;
  const activeCount = readAllRows(SHEET_NAMES.GOALS).filter((r) => r.classCode === classCode && r.studentId === studentId && r.active !== false).length;
  if (activeCount >= maxGoals) return { ok: false, reason: 'max_goals_reached' };

  const goalId = Utilities.getUuid();
  const targetCount = Math.max(1, Math.min(20, Math.round(Number(payload.targetCount) || 1)));
  const now = new Date().toISOString();
  appendRow(SHEET_NAMES.GOALS, { goalId, classCode, studentId, title, targetCount, createdAt: now, active: true });
  return { ok: true, data: { goalId, title, targetCount } };
}

function handleRemoveGoal({ classCode, studentId, payload }) {
  const row = findRow(SHEET_NAMES.GOALS, 'goalId', payload.goalId);
  if (!row || row.classCode !== classCode || row.studentId !== studentId) return { ok: false, reason: 'not_found' };
  updateRow(SHEET_NAMES.GOALS, row._row, { active: false });
  return { ok: true, data: { goalId: payload.goalId } };
}

function todayKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function handleCompleteGoal({ classCode, studentId, payload }) {
  if (!classCode || !studentId) return { ok: false, reason: 'auth_required' };
  const goal = findRow(SHEET_NAMES.GOALS, 'goalId', payload.goalId);
  if (!goal || goal.classCode !== classCode || goal.studentId !== studentId || goal.active === false) {
    return { ok: false, reason: 'goal_not_found' };
  }

  const now = new Date();
  const today = todayKey(now);
  const todaysEntries = readAllRows(SHEET_NAMES.GOAL_LOG).filter((r) => r.goalId === goal.goalId && r.date === today);
  const doneOrPending = todaysEntries.filter((r) => r.status === 'approved' || r.status === 'pending').length;
  if (doneOrPending >= Number(goal.targetCount)) return { ok: false, reason: 'already_completed_today' };

  const klass = findRow(SHEET_NAMES.CLASSES, 'classCode', classCode);
  const isTeacherMode = klass && klass.goalApprovalMode === 'teacher';

  const logId = Utilities.getUuid();
  const nowIso = now.toISOString();
  let pointsAwarded = 0;
  const status = isTeacherMode ? 'pending' : 'approved';

  appendRow(SHEET_NAMES.GOAL_LOG, {
    logId, classCode, studentId, goalId: goal.goalId, goalTitle: goal.title,
    date: today, status, requestedAt: nowIso, resolvedAt: isTeacherMode ? '' : nowIso, points: 0
  });

  if (!isTeacherMode) {
    pointsAwarded = POINTS_PER_GOAL_COMPLETION;
    const beforePercent = getProgressPercent(classCode);
    addClassPoints(classCode, pointsAwarded);
    addStudentPoints(studentId, pointsAwarded);
    const row = findRow(SHEET_NAMES.GOAL_LOG, 'logId', logId);
    if (row) updateRow(SHEET_NAMES.GOAL_LOG, row._row, { points: pointsAwarded });
    announceContribution(classCode, studentId, `「${goal.title}」の達成`, pointsAwarded, beforePercent);
  }

  return { ok: true, data: { logId, status, pointsAwarded, needsApproval: isTeacherMode } };
}

function handleApproveGoal({ classCode, payload }) {
  const row = findRow(SHEET_NAMES.GOAL_LOG, 'logId', payload.logId);
  if (!row || row.classCode !== classCode || row.status !== 'pending') return { ok: false, reason: 'not_found' };

  const pointsAwarded = POINTS_PER_GOAL_COMPLETION;
  const now = new Date().toISOString();
  const beforePercent = getProgressPercent(classCode);
  updateRow(SHEET_NAMES.GOAL_LOG, row._row, { status: 'approved', resolvedAt: now, points: pointsAwarded });
  addClassPoints(classCode, pointsAwarded);
  addStudentPoints(row.studentId, pointsAwarded);
  announceContribution(classCode, row.studentId, `「${row.goalTitle}」の承認`, pointsAwarded, beforePercent);
  return { ok: true, data: { logId: payload.logId, pointsAwarded } };
}

function handleRejectGoal({ classCode, payload }) {
  const row = findRow(SHEET_NAMES.GOAL_LOG, 'logId', payload.logId);
  if (!row || row.classCode !== classCode || row.status !== 'pending') return { ok: false, reason: 'not_found' };
  updateRow(SHEET_NAMES.GOAL_LOG, row._row, { status: 'rejected', resolvedAt: new Date().toISOString() });
  return { ok: true, data: { logId: payload.logId } };
}

// ---- ありがとう ----

// 通知(受信ポップアップ)は専用シートを持たず、クライアントが直近syncState以降の
// thanksLogの中から自分のnicknameがtoNameに一致する行を見つけて表示する方式にしている。
function handleSendThanks({ classCode, studentId, payload }) {
  if (!classCode || !studentId) return { ok: false, reason: 'auth_required' };
  const toName = String(payload.toName || '').trim();
  if (!toName) return { ok: false, reason: 'empty_name' };

  const now = new Date();
  const today = todayKey(now);
  const classThanks = readAllRows(SHEET_NAMES.THANKS)
    .filter((r) => r.classCode === classCode)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  if (classThanks.some((r) => r.date === today && r.toName === toName)) {
    return { ok: false, reason: 'already_sent_today' };
  }
  const last = classThanks[classThanks.length - 1];
  if (last && last.toName === toName) {
    return { ok: false, reason: 'same_as_last' };
  }

  const fromLabel = String(payload.fromLabel || 'わたし').trim();
  const thanksId = Utilities.getUuid();
  const nowIso = now.toISOString();
  appendRow(SHEET_NAMES.THANKS, { thanksId, classCode, fromStudentId: studentId, fromLabel, toName, date: today, createdAt: nowIso });
  appendActivityLog(classCode, 'thanks', `🧡 ${fromLabel}が${toName}さんに「ありがとう」を送りました`);

  return { ok: true, data: { thanksId } };
}

// ---- ショップ ----

// 価格・解放条件のチェックはクライアント側(ShopManager)ですでに行われている前提で、
// ここではpayloadの内容を信頼して所持ポイントの増減とインベントリ更新のみ行う。
// (教室で使う前提の非敵対的な環境を想定した簡易実装。厳密な検証はTODO)
function handleBuyItem({ classCode, studentId, payload }) {
  if (!classCode || !studentId) return { ok: false, reason: 'auth_required' };
  const student = findRow(SHEET_NAMES.STUDENTS, 'studentId', studentId);
  if (!student || student.classCode !== classCode) return { ok: false, reason: 'not_found' };

  const price = Math.max(0, Number(payload.price) || 0);
  const currentPoints = Number(student.personalPoints) || 0;
  if (currentPoints < price) return { ok: false, reason: 'not_enough_points' };

  const shopPurchased = safeParseJson(student.shopPurchasedJson, []);
  const ownedAssets = safeParseJson(student.ownedAssetsJson, []);
  if (payload.itemId && !shopPurchased.includes(payload.itemId)) shopPurchased.push(payload.itemId);
  if (payload.assetId && !ownedAssets.includes(payload.assetId)) ownedAssets.push(payload.assetId);

  const newPoints = currentPoints - price;
  updateRow(SHEET_NAMES.STUDENTS, student._row, {
    personalPoints: newPoints,
    shopPurchasedJson: JSON.stringify(shopPurchased),
    ownedAssetsJson: JSON.stringify(ownedAssets)
  });
  appendActivityLog(classCode, 'purchase', `🛍️「${payload.itemName || payload.assetId || payload.itemId}」を手に入れました`);

  return { ok: true, data: { personalPoints: newPoints } };
}

// ---- 先生設定 ----

function handleSetGoalSettings({ classCode, payload }) {
  const row = findRow(SHEET_NAMES.CLASSES, 'classCode', classCode);
  if (!row) return { ok: false, reason: 'not_found' };
  const update = {};
  if ('maxGoals' in payload) update.maxGoals = Math.max(1, Math.min(5, Math.round(Number(payload.maxGoals) || 3)));
  if ('approvalMode' in payload) update.goalApprovalMode = payload.approvalMode === 'teacher' ? 'teacher' : 'self';
  updateRow(SHEET_NAMES.CLASSES, row._row, update);
  return { ok: true, data: update };
}

function handleSetClearPoint({ classCode, payload }) {
  const row = findRow(SHEET_NAMES.CLASSES, 'classCode', classCode);
  if (!row) return { ok: false, reason: 'not_found' };
  const clearPoint = Math.max(1, Math.round(Number(payload.clearPoint) || 1000));
  updateRow(SHEET_NAMES.CLASSES, row._row, { clearPoint });
  return { ok: true, data: { clearPoint } };
}

// 児童一覧ダッシュボード(v20)の「停滞」「要支援」の判定日数。学級の実情に応じて先生が調整する(v21)。
function handleSetRosterThresholds({ classCode, payload }) {
  const row = findRow(SHEET_NAMES.CLASSES, 'classCode', classCode);
  if (!row) return { ok: false, reason: 'not_found' };
  const update = {
    stalledDays: Math.max(1, Math.min(14, Math.round(Number(payload.stalledDays) || DEFAULT_STALLED_DAYS))),
    supportDays: Math.max(1, Math.min(14, Math.round(Number(payload.supportDays) || DEFAULT_SUPPORT_DAYS)))
  };
  updateRow(SHEET_NAMES.CLASSES, row._row, update);
  return { ok: true, data: update };
}

// ---- ポイント加算ヘルパー ----

function addClassPoints(classCode, amount) {
  const row = findRow(SHEET_NAMES.FOREST_STATE, 'classCode', classCode);
  if (!row) return 0;
  const next = (Number(row.classPoints) || 0) + amount;
  updateRow(SHEET_NAMES.FOREST_STATE, row._row, { classPoints: next });
  return next;
}

// ---- 先生用ダッシュボード: 児童一覧(v20) ----

// core-runtime.jsのGoalManager.todayKey相当。日本の学校で使う前提なのでJSTで固定する
// (GASプロジェクトのタイムゾーン設定に依存させないため)。
function todayKeyJst(date) {
  return Utilities.formatDate(date || new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
}

// 'yyyy-MM-dd' 同士の日数差(key2 - key1)。両方JSTの日付キーである前提。
function daysBetweenKeys(key1, key2) {
  if (!key1 || !key2) return null;
  const d1 = new Date(key1 + 'T00:00:00+09:00');
  const d2 = new Date(key2 + 'T00:00:00+09:00');
  return Math.round((d2.getTime() - d1.getTime()) / 86400000);
}

// syncStateがstudentId付きで呼ばれるたび(20秒おきポーリングを含む)に毎回書き込むと
// シートへの書き込みが多すぎるため、「今日まだ記録していない」ときだけ更新する。
// 結果として書き込み頻度は1人1日1回程度になる。
function touchStudentLogin(student) {
  const today = todayKeyJst();
  const lastKey = student.lastLoginAt ? todayKeyJst(new Date(student.lastLoginAt)) : null;
  if (lastKey === today) return; // 今日はすでに記録済み

  const diff = daysBetweenKeys(lastKey, today);
  const streak = diff === 1 ? (Number(student.loginStreak) || 0) + 1 : 1;
  const nowIso = new Date().toISOString();

  updateRow(SHEET_NAMES.STUDENTS, student._row, { lastLoginAt: nowIso, loginStreak: streak });
  // 呼び出し元(handleSyncState内)がこの後 student をそのまま使わないので副作用の反映は不要だが、
  // 念のため揃えておく。
  student.lastLoginAt = nowIso;
  student.loginStreak = streak;
}

// 先生用ダッシュボードの児童一覧を組み立てる。
// status の優先度(高いほど先生が気にすべき): needs_support/never_opened > stalled >
// not_opened_today > no_goals > in_progress > good
// thresholds: { stalledDays, supportDays } — クラス設定で先生が調整できる(v21)。
function buildStudentsRoster(classCode, studentRows, thresholds) {
  const stalledDays = Math.max(1, Number(thresholds && thresholds.stalledDays) || DEFAULT_STALLED_DAYS);
  const supportDays = Math.max(1, Number(thresholds && thresholds.supportDays) || DEFAULT_SUPPORT_DAYS);

  const today = todayKeyJst();
  const recentKeys = [];
  for (let n = 0; n < stalledDays; n++) recentKeys.push(todayKeyJst(new Date(Date.now() - n * 86400000)));

  const goals = readAllRows(SHEET_NAMES.GOALS).filter((r) => r.classCode === classCode && r.active !== false);
  const goalLog = readAllRows(SHEET_NAMES.GOAL_LOG).filter((r) => r.classCode === classCode);

  const goalCountByStudent = {};
  goals.forEach((g) => {
    goalCountByStudent[g.studentId] = (goalCountByStudent[g.studentId] || 0) + 1;
  });

  const goalLogByStudent = {};
  goalLog.forEach((entry) => {
    (goalLogByStudent[entry.studentId] = goalLogByStudent[entry.studentId] || []).push(entry);
  });

  return studentRows.map((row) => {
    const lastLoginAt = row.lastLoginAt || null;
    const loginStreak = Number(row.loginStreak) || 0;
    const lastLoginKey = lastLoginAt ? todayKeyJst(new Date(lastLoginAt)) : null;
    const daysSinceLogin = lastLoginKey ? daysBetweenKeys(lastLoginKey, today) : null;

    const myLog = goalLogByStudent[row.studentId] || [];
    const activeGoalsCount = goalCountByStudent[row.studentId] || 0;
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
      studentId: row.studentId,
      nickname: row.nickname,
      lastLoginAt,
      loginStreak,
      daysSinceLogin,
      activeGoalsCount,
      todayAchieved,
      todayPending,
      status
    };
  });
}

function addStudentPoints(studentId, amount) {
  const row = findRow(SHEET_NAMES.STUDENTS, 'studentId', studentId);
  if (!row) return;
  updateRow(SHEET_NAMES.STUDENTS, row._row, {
    personalPoints: (Number(row.personalPoints) || 0) + amount,
    lifetimePoints: (Number(row.lifetimePoints) || 0) + amount
  });
}

function appendActivityLog(classCode, type, message, extra) {
  const logId = Utilities.getUuid();
  const row = Object.assign(
    { logId, classCode, type, message, createdAt: new Date().toISOString() },
    extra || {}
  );
  appendRow(SHEET_NAMES.ACTIVITY_LOG, row);
  trimActivityLog(classCode);
}

// クラスの森の進行度(%)。addClassPointsの前後でこれを比べることで
// 「今回の行動が5%の節目をまたいだか」を判定する(announceContribution参照)。
function getProgressPercent(classCode) {
  const forestRow = findRow(SHEET_NAMES.FOREST_STATE, 'classCode', classCode);
  const klass = findRow(SHEET_NAMES.CLASSES, 'classCode', classCode);
  const clearPoint = (klass && Number(klass.clearPoint)) || 1000;
  const classPoints = (forestRow && Number(forestRow.classPoints)) || 0;
  return clearPoint > 0 ? (classPoints / clearPoint) * 100 : 0;
}

// ---- クラス協力の意味づけ(v22) ----
// 目標達成・承認のたびに「誰が」「クラスの森をどれだけ」育てたかをActivityLogに残す。
// events.jsonは必ず5%刻みで作られている(docs/05_events_spec.md)ので、今回の行動で
// 5%の節目をまたいだかどうかだけ見れば、GAS側でevents.jsonの中身を持たなくても
// 「この行動が森のイベントを引き起こす最後のひと押しになったか」を判定できる。
// またいでいたら type:'contribution_milestone' として actorName/points/progress を記録し、
// クライアント側(core-runtime.js)がこれを使って、実際に発生したイベント演出に
// 「最後のひと押しは◯◯さんでした」を紐付ける。またいでいなければ通常の貢献ログにする。
function announceContribution(classCode, studentId, actionNoun, pointsAwarded, beforePercent) {
  if (!pointsAwarded) return;
  const student = findRow(SHEET_NAMES.STUDENTS, 'studentId', studentId);
  const nickname = (student && student.nickname) || 'クラスの子';
  const afterPercent = getProgressPercent(classCode);

  const beforeStep = Math.floor(Math.min(beforePercent, 100) / 5);
  const afterStep = Math.floor(Math.min(afterPercent, 100) / 5);

  if (afterStep > beforeStep) {
    const milestonePercent = Math.min(100, afterStep * 5);
    appendActivityLog(
      classCode, 'contribution_milestone',
      `🌟 ${nickname}さんの${actionNoun}が最後のひと押しになって、森が${milestonePercent}%まで育ちました！`,
      { actorName: nickname, points: pointsAwarded, progress: milestonePercent }
    );
  } else {
    appendActivityLog(
      classCode, 'contribution',
      `✅ ${nickname}さんが${actionNoun}をがんばりました（+${pointsAwarded}pt）`,
      { actorName: nickname, points: pointsAwarded, progress: Math.round(Math.min(afterPercent, 100)) }
    );
  }
}

// ActivityLogがクラスごとに50件を超えたら、古いものから削除する。
function trimActivityLog(classCode) {
  const rows = readAllRows(SHEET_NAMES.ACTIVITY_LOG)
    .filter((r) => r.classCode === classCode)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  if (rows.length <= ACTIVITY_LOG_LIMIT) return;
  const toDelete = rows.slice(0, rows.length - ACTIVITY_LOG_LIMIT);
  // 行番号が大きい方から消さないとズレるため降順に削除する。
  toDelete.sort((a, b) => b._row - a._row).forEach((r) => getSheet(SHEET_NAMES.ACTIVITY_LOG).deleteRow(r._row));
}

// ---- シート操作ヘルパー ----

function setupSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(SHEET_HEADERS).forEach((name) => {
    let sheet = ss.getSheetByName(name);
    if (!sheet) sheet = ss.insertSheet(name);
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(SHEET_HEADERS[name]);
      sheet.setFrozenRows(1);
      return;
    }
    // v16以前に作られたスプレッドシート(例: ForestStateに森ライフサイクル列が無い)を
    // 壊さずに追いつかせるための移行処理。既存列はそのまま、末尾に足りない列だけ追加する。
    migrateHeaders(sheet, SHEET_HEADERS[name]);
  });
}

function migrateHeaders(sheet, expectedHeaders) {
  const lastCol = sheet.getLastColumn();
  const existing = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  const missing = expectedHeaders.filter((h) => existing.indexOf(h) === -1);
  if (!missing.length) return;
  sheet.getRange(1, existing.length + 1, 1, missing.length).setValues([missing]);
}

function getSheet(name) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet) throw new Error('sheet_not_found:' + name);
  return sheet;
}

// シートの全行を { 列名: 値, _row: 実際の行番号 } の配列で返す。
// クラス・児童の規模を考えれば、当面は毎回全読みで十分(将来重くなったらキャッシュを検討)。
function readAllRows(name) {
  const sheet = getSheet(name);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0];
  return values.slice(1).map((row, i) => {
    const obj = { _row: i + 2 };
    headers.forEach((h, idx) => { obj[h] = row[idx]; });
    return obj;
  });
}

function findRow(name, key, value) {
  return readAllRows(name).find((r) => String(r[key]) === String(value)) || null;
}

function appendRow(name, obj) {
  const sheet = getSheet(name);
  const headers = SHEET_HEADERS[name];
  const row = headers.map((h) => (h in obj ? obj[h] : ''));
  sheet.appendRow(row);
}

function updateRow(name, rowIndex, obj) {
  const sheet = getSheet(name);
  const headers = SHEET_HEADERS[name];
  headers.forEach((h, idx) => {
    if (h in obj) sheet.getRange(rowIndex, idx + 1).setValue(obj[h]);
  });
}

function stripRowMeta(row) {
  const clone = Object.assign({}, row);
  delete clone._row;
  return clone;
}

function safeParseJson(value, fallback) {
  if (value === '' || value === null || value === undefined) return fallback;
  try {
    return JSON.parse(value);
  } catch (err) {
    return fallback;
  }
}

// ---- ID生成 ----

function generateCode(chars, length) {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
}

function generateUniqueCode(sheetName, key, generator, maxTries = 10) {
  for (let i = 0; i < maxTries; i++) {
    const code = generator();
    if (!findRow(sheetName, key, code)) return code;
  }
  throw new Error('code_generation_failed');
}

// ---- レスポンス ----

function respond(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
