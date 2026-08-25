import { FirebaseClient } from './firebase-client.js';

const LOCAL_KEY = 'kokotsu_teacher_info_v1';

function byId(id) {
  return document.getElementById(id);
}

function loadInfo() {
  try {
    const raw = window.localStorage.getItem(LOCAL_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    return null;
  }
}

function saveInfo(info) {
  try {
    window.localStorage.setItem(LOCAL_KEY, JSON.stringify(info));
  } catch (err) {
    // localStorageが使えなくても致命的にはしない
  }
}

function clearInfo() {
  try {
    window.localStorage.removeItem(LOCAL_KEY);
  } catch (err) {
    // noop
  }
}

function showMessage(text) {
  const el = byId('appMessage');
  if (!text) {
    el.style.display = 'none';
    return;
  }
  el.textContent = text;
  el.style.display = 'block';
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function formatDate(iso) {
  if (!iso) return '記録なし';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '記録なし';
  return d.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' });
}

const TIMELINE_ICONS = { forest_event: '🌲', badge: '🏅', unlock: '🌱' };

// status → 表示ラベル/色/並び順。数字が小さいほど先生が気にすべき優先度が高い。
const ROSTER_STATUS_META = {
  needs_support:    { order: 0, label: '🚩 お休みが続いています',        cls: 'roster-card--support' },
  never_opened:     { order: 0, label: '🚩 まだ一度も開いていません',    cls: 'roster-card--support' },
  stalled:          { order: 1, label: '😐 最近、達成の記録がありません', cls: 'roster-card--stalled' },
  not_opened_today: { order: 2, label: '💤 今日はまだ開いていません',    cls: 'roster-card--waiting' },
  no_goals:         { order: 3, label: '🌱 目標が設定されていません',    cls: 'roster-card--waiting' },
  in_progress:      { order: 4, label: '🙂 今日はまだ達成前',           cls: 'roster-card--progress' },
  good:             { order: 5, label: '✅ 今日の目標を達成ずみ',        cls: 'roster-card--good' }
};

// 先生が「気になる子だけ表示」をONにしたときに残す対象(=様子見が要りそうな状態)。
const ROSTER_ATTENTION_STATUSES = new Set(['needs_support', 'never_opened', 'stalled', 'not_opened_today', 'no_goals']);

function rosterLastSeenLabel(entry) {
  if (entry.daysSinceLogin === null) return '記録なし';
  if (entry.daysSinceLogin === 0) return '今日';
  if (entry.daysSinceLogin === 1) return 'きのう';
  return `${entry.daysSinceLogin}日前`;
}

// 児童一覧ダッシュボードを描画する。
function renderStudentRoster(roster, { attentionOnly = false } = {}) {
  const list = Array.isArray(roster) ? roster : [];

  const counts = { needs_support: 0, never_opened: 0, stalled: 0, not_opened_today: 0, no_goals: 0 };
  list.forEach((entry) => {
    if (entry.status in counts) counts[entry.status] += 1;
  });
  const attentionTotal = counts.needs_support + counts.never_opened + counts.stalled + counts.not_opened_today + counts.no_goals;

  byId('rosterSummary').innerHTML = attentionTotal
    ? `
      <span class="roster-chip roster-chip--support">🚩 要支援 ${counts.needs_support + counts.never_opened}人</span>
      <span class="roster-chip roster-chip--stalled">😐 停滞 ${counts.stalled}人</span>
      <span class="roster-chip roster-chip--waiting">💤 未起動 ${counts.not_opened_today}人</span>
      <span class="roster-chip roster-chip--waiting">🌱 目標なし ${counts.no_goals}人</span>
    `
    : `<span class="roster-chip roster-chip--good">✅ 全員、順調です</span>`;

  const sorted = [...list].sort((a, b) => {
    const oa = ROSTER_STATUS_META[a.status]?.order ?? 9;
    const ob = ROSTER_STATUS_META[b.status]?.order ?? 9;
    if (oa !== ob) return oa - ob;
    return String(a.nickname).localeCompare(String(b.nickname), 'ja');
  });

  const visible = attentionOnly ? sorted.filter((e) => ROSTER_ATTENTION_STATUSES.has(e.status)) : sorted;

  if (!visible.length) {
    byId('studentRoster').innerHTML = attentionOnly
      ? '<p class="muted">気になる子はいません。</p>'
      : '<p class="muted">まだ参加している児童がいません。</p>';
    return;
  }

  byId('studentRoster').innerHTML = visible.map((entry) => {
    const meta = ROSTER_STATUS_META[entry.status] || { label: '', cls: '' };
    const goalsLabel = entry.activeGoalsCount
      ? `今日 ${entry.todayAchieved}/${entry.activeGoalsCount} 達成${entry.todayPending ? `（承認待ち${entry.todayPending}）` : ''}`
      : '目標なし';
    return `
      <div class="roster-card ${meta.cls}">
        <div class="roster-card__top">
          <span class="roster-card__name">${escapeHtml(entry.nickname)}</span>
          <span class="roster-card__status">${meta.label}</span>
        </div>
        <div class="roster-card__stats">
          <span>🔥 連続${entry.loginStreak}日</span>
          <span>🕘 最終アクセス: ${escapeHtml(rosterLastSeenLabel(entry))}</span>
          <span>🎯 ${escapeHtml(goalsLabel)}</span>
        </div>
      </div>
    `;
  }).join('');
}

// 過去の森(forestHistory)を新しい世代が上に来る順で並べ、折りたたみ式の年表つきで表示する。
function renderForestRecord({ forestState }) {
  const generation = Number(forestState?.forestGeneration) || 1;
  const isCompleted = forestState?.forestStatus === 'completed';
  const status = isCompleted ? '完成ずみ' : '育成中';

  let releaseHtml = '';
  if (isCompleted) {
    releaseHtml = forestState?.nextForestUnlocked
      ? `<p class="forest-now__unlocked">🔓 次の森に進めるようになっています</p>`
      : `
        <div class="button-row" style="margin-top:8px;">
          <button id="btnReleaseNextForest" class="btn btn--accent">次の森を解放する</button>
        </div>
        <p class="muted" style="margin-top:4px;">押すと、児童が「新しい森をはじめる」を実行できるようになります。</p>
      `;
  }

  byId('forestNow').innerHTML = `
    <div class="forest-now__current">🌳 <strong>${generation}代目</strong>の森 — ${escapeHtml(status)}</div>
    ${releaseHtml}
  `;

  const history = Array.isArray(forestState?.forestHistory) ? [...forestState.forestHistory] : [];
  history.sort((a, b) => (Number(b.generation) || 0) - (Number(a.generation) || 0));

  if (!history.length) {
    byId('forestHistoryList').innerHTML = '<p class="muted">まだ完成した森はありません。</p>';
    return;
  }

  byId('forestHistoryList').innerHTML = history.map((entry) => {
    const timelineHtml = (entry.timeline || []).length
      ? entry.timeline.map((t) => `<li>${TIMELINE_ICONS[t.type] || '🌲'} ${escapeHtml(t.message)}</li>`).join('')
      : '<li class="muted">記録が見つかりませんでした</li>';
    return `
      <details class="forest-history-item">
        <summary>${entry.generation}代目の森（${escapeHtml(formatDate(entry.startedAt))} 〜 ${escapeHtml(formatDate(entry.completedAt))}）</summary>
        <div class="forest-history-item__stats">
          <span>クラスポイント ${Math.floor(entry.classPoints || 0)} / ${Math.floor(entry.clearPoint || 0)}</span>
          <span>置いた数 ${entry.placedCount || 0}</span>
          <span>できごと ${entry.eventCount || 0}</span>
          <span>バッジ ${entry.badgeCount || 0}</span>
        </div>
        <ul class="forest-history-item__timeline">${timelineHtml}</ul>
      </details>
    `;
  }).join('');
}

async function main() {
  const firebaseClient = new FirebaseClient();
  let info = loadInfo();
  let studentsMap = new Map();
  let lastRoster = [];

  const connectView = byId('connectView');
  const dashboardView = byId('dashboardView');

  function setView(configured) {
    connectView.style.display = configured ? 'none' : 'grid';
    dashboardView.style.display = configured ? 'grid' : 'none';
  }

  function startRealtimeListeners(classCode) {
    firebaseClient.cleanup();

    // (1) クラス情報・森の進行度
    firebaseClient.listenClass({
      classCode,
      onData: (data) => {
        if (!data) return;
        showMessage('');
        const classInfo = data.classInfo || {};
        const forestState = data.forestState || {};

        byId('classCodeDisplay').textContent = classInfo.classCode || classCode;
        byId('approvalModeSelect').value = classInfo.goalApprovalMode === 'teacher' ? 'teacher' : 'self';
        byId('maxGoalsInput').value = classInfo.maxGoals || 3;
        byId('clearPointSettingInput').value = classInfo.clearPoint || 1000;
        byId('stalledDaysInput').value = classInfo.stalledDays || 3;
        byId('supportDaysInput').value = classInfo.supportDays || 2;

        renderForestRecord({ forestState: { ...forestState, clearPoint: classInfo.clearPoint } });
      },
      onError: (err) => {
        console.warn('[teacher] listenClass error:', err);
      }
    });

    // (2) 児童一覧名簿ダッシュボード
    firebaseClient.listenStudentsRoster({
      classCode,
      onData: (roster) => {
        lastRoster = roster || [];
        renderStudentRoster(lastRoster, { attentionOnly: byId('rosterFilterToggle').checked });
      },
      onError: (err) => {
        console.warn('[teacher] listenStudentsRoster error:', err);
      }
    });

    // (3) 児童名簿（名前解決用）
    firebaseClient.listenStudents({
      classCode,
      onData: (students) => {
        studentsMap = new Map((students || []).map(s => [s.studentId, s.nickname || 'だれか']));
      },
      onError: (err) => {
        console.warn('[teacher] listenStudents error:', err);
      }
    });

    // (4) 承認待ちキュー
    firebaseClient.listenApprovalQueue({
      classCode,
      onData: (pending) => {
        const list = Array.isArray(pending) ? pending : [];
        byId('approvalList').innerHTML = list.length
          ? list.map((entry) => {
              const studentName = studentsMap.get(entry.studentId) || 'だれか';
              return `
                <div class="goal-card">
                  <div class="goal-card__title">${escapeHtml(studentName)}さん: ${escapeHtml(entry.goalTitle || '')}</div>
                  <div class="goal-card__meta">${escapeHtml(entry.date || '')} に達成報告</div>
                  <div class="goal-card__actions">
                    <button class="btn" data-approve="${escapeHtml(entry.logId)}">承認</button>
                    <button class="btn btn--ghost" data-reject="${escapeHtml(entry.logId)}">却下</button>
                  </div>
                </div>
              `;
            }).join('')
          : '<p class="muted">承認待ちの目標はありません。</p>';
      },
      onError: (err) => {
        console.warn('[teacher] listenApprovalQueue error:', err);
      }
    });

    // (5) 活動ログ
    firebaseClient.listenActivityLog({
      classCode,
      onData: (logs) => {
        const activity = Array.isArray(logs) ? logs.slice(-20).reverse() : [];
        byId('activityList').innerHTML = activity.length
          ? activity.map((a) => `<div class="log-item">${escapeHtml(a.message || a.type || '')}</div>`).join('')
          : '<p class="muted">まだ記録がありません。</p>';
      },
      onError: (err) => {
        console.warn('[teacher] listenActivityLog error:', err);
      }
    });
  }

  // クラス作成
  byId('btnCreateClass').addEventListener('click', async () => {
    const teacherName = byId('teacherNameInput').value.trim();
    const clearPoint = Number(byId('clearPointInput').value) || 1000;
    const generatedClassCode = 'c_' + Math.random().toString(36).slice(2, 6).toUpperCase();

    if (!firebaseClient.isReady()) {
      showMessage('Firebaseに接続できません。firebase-config.jsを確認してください。');
      return;
    }

    await firebaseClient.createClass({
      classCode: generatedClassCode,
      teacherName,
      clearPoint,
      mapId: 'kokotsu_forest_01',
      maxGoals: 3,
      goalApprovalMode: 'self'
    });

    info = { classCode: generatedClassCode };
    saveInfo(info);
    setView(true);
    startRealtimeListeners(generatedClassCode);
  });

  // 既存クラス管理
  byId('btnManageClass').addEventListener('click', async () => {
    const classCode = byId('joinCodeInput').value.trim();
    if (!classCode) {
      showMessage('クラスコードを入力してください。');
      return;
    }

    if (!firebaseClient.isReady()) {
      showMessage('Firebaseに接続できません。');
      return;
    }

    const check = await firebaseClient.getClass({ classCode });
    if (!check.ok) {
      showMessage('クラスが見つかりませんでした。クラスコードを確認してください。');
      return;
    }

    info = { classCode };
    saveInfo(info);
    setView(true);
    startRealtimeListeners(classCode);
  });

  // 切断
  byId('btnDisconnect').addEventListener('click', () => {
    firebaseClient.cleanup();
    info = null;
    clearInfo();
    setView(false);
  });

  // 更新ボタン
  byId('btnRefresh').addEventListener('click', () => {
    if (info?.classCode) {
      startRealtimeListeners(info.classCode);
    }
  });

  // 次の森の解放
  byId('forestNow').addEventListener('click', async (event) => {
    if (!event.target.closest?.('#btnReleaseNextForest')) return;
    if (!info?.classCode) return;
    await firebaseClient.releaseNextForest({ classCode: info.classCode });
    showMessage('次の森を解放しました✨');
    setTimeout(() => showMessage(''), 3000);
  });

  // 気になる子フィルター
  byId('rosterFilterToggle').addEventListener('change', (event) => {
    renderStudentRoster(lastRoster, { attentionOnly: event.target.checked });
  });

  // 設定保存
  byId('btnSaveSettings').addEventListener('click', async () => {
    if (!info?.classCode) return;
    const approvalMode = byId('approvalModeSelect').value;
    const maxGoals = Number(byId('maxGoalsInput').value) || 3;
    const clearPoint = Number(byId('clearPointSettingInput').value) || 1000;
    const stalledDays = Number(byId('stalledDaysInput').value) || 3;
    const supportDays = Number(byId('supportDaysInput').value) || 2;

    await firebaseClient.updateClassSettings({
      classCode: info.classCode,
      settings: {
        classCode: info.classCode,
        goalApprovalMode: approvalMode,
        maxGoals,
        clearPoint,
        stalledDays,
        supportDays
      }
    });

    showMessage('設定を保存しました✨');
    setTimeout(() => showMessage(''), 3000);
  });

  // 目標の承認 / 却下
  byId('approvalList').addEventListener('click', async (event) => {
    const approveBtn = event.target.closest?.('[data-approve]');
    if (approveBtn && info?.classCode) {
      const logId = approveBtn.dataset.approve;
      await firebaseClient.resolveGoalApproval({ classCode: info.classCode, logId, approve: true });
      return;
    }
    const rejectBtn = event.target.closest?.('[data-reject]');
    if (rejectBtn && info?.classCode) {
      const logId = rejectBtn.dataset.reject;
      await firebaseClient.resolveGoalApproval({ classCode: info.classCode, logId, approve: false });
    }
  });

  if (info?.classCode) {
    setView(true);
    startRealtimeListeners(info.classCode);
  } else {
    setView(false);
  }
}

main();

