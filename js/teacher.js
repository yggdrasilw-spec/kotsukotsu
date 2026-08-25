import { ApiClient } from './api-client.js';
import { CONFIG } from './config.js';
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

// 児童一覧ダッシュボードを描画する。roster: buildStudentsRoster()(GAS側)が返す配列。
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
// 仕様の「過去の森も振り返れる」に対応する(docs/14参照)。
function renderForestRecord({ forestState }) {
  const generation = Number(forestState?.forestGeneration) || 1;
  const isCompleted = forestState?.forestStatus === 'completed';
  const status = isCompleted ? '完成ずみ' : '育成中';
  const clearPoint = Number(forestState?.clearPoint) || 0;

  // (v23) 完成済みで、まだ先生が解放していなければ「次の森を解放する」ボタンを出す。
  // 児童側はこのボタンが押されるまで「新しい森をはじめる」を実行できない。
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
  const apiClient = new ApiClient();
  let info = loadInfo();
  let autoTimer = null;

  const connectView = byId('connectView');
  const dashboardView = byId('dashboardView');
  let lastRoster = [];

  // GASのURLはconfig.js(js/config.js の CONFIG.gasBaseUrl)で一元管理する。
  // 児童側(index.html)と同じ設定を見るようにして、先生が毎回手打ちしなくて済むようにする。
  if (!CONFIG.gasBaseUrl) {
    showMessage('config.js に gasBaseUrl が設定されていません。js/config.js を確認してください。');
    return;
  }
  apiClient.setBaseUrl(CONFIG.gasBaseUrl);

  function setView(configured) {
    connectView.style.display = configured ? 'none' : 'grid';
    dashboardView.style.display = configured ? 'grid' : 'none';
  }

  function stopAuto() {
    if (autoTimer) window.clearInterval(autoTimer);
    autoTimer = null;
  }

  function startAuto() {
    stopAuto();
    autoTimer = window.setInterval(refreshDashboard, 15000);
  }

  async function refreshDashboard() {
    if (!info) return;
    const res = await apiClient.syncState({ classCode: info.classCode });
    if (!res.ok) {
      showMessage(`読み込みに失敗しました: ${res.reason || 'unknown_error'}`);
      return;
    }
    showMessage('');
    const { classInfo, goalLogPending, activityLog, students, studentsRoster, forestState } = res.data;

    byId('classCodeDisplay').textContent = classInfo.classCode;
    byId('approvalModeSelect').value = classInfo.goalApprovalMode === 'teacher' ? 'teacher' : 'self';
    byId('maxGoalsInput').value = classInfo.maxGoals || 3;
    byId('clearPointSettingInput').value = classInfo.clearPoint || 1000;
    byId('stalledDaysInput').value = classInfo.stalledDays || 3;
    byId('supportDaysInput').value = classInfo.supportDays || 2;

    renderForestRecord({ forestState: { ...forestState, clearPoint: classInfo.clearPoint } });
    lastRoster = Array.isArray(studentsRoster) ? studentsRoster : [];
    renderStudentRoster(lastRoster, { attentionOnly: byId('rosterFilterToggle').checked });

    const nicknameOf = (studentId) => {
      const found = (students || []).find((s) => s.studentId === studentId);
      return found ? found.nickname : 'だれか';
    };

    const pending = Array.isArray(goalLogPending) ? goalLogPending : [];
    byId('approvalList').innerHTML = pending.length
      ? pending.map((entry) => `
          <div class="goal-card">
            <div class="goal-card__title">${escapeHtml(nicknameOf(entry.studentId))}さん: ${escapeHtml(entry.goalTitle || '')}</div>
            <div class="goal-card__meta">${escapeHtml(entry.date)} に達成報告</div>
            <div class="goal-card__actions">
              <button class="btn" data-approve="${escapeHtml(entry.logId)}">承認</button>
              <button class="btn btn--ghost" data-reject="${escapeHtml(entry.logId)}">却下</button>
            </div>
          </div>
        `).join('')
      : '<p class="muted">承認待ちの目標はありません。</p>';

    const activity = Array.isArray(activityLog) ? activityLog.slice(-20).reverse() : [];
    byId('activityList').innerHTML = activity.length
      ? activity.map((a) => `<div class="log-item">${escapeHtml(a.message || a.type || '')}</div>`).join('')
      : '<p class="muted">まだ記録がありません。</p>';
  }

  byId('btnCreateClass').addEventListener('click', async () => {
    const teacherName = byId('teacherNameInput').value.trim();
    const clearPoint = Number(byId('clearPointInput').value) || 1000;
    const generatedClassCode = 'c_' + Math.random().toString(36).slice(2, 6).toUpperCase();

    if (firebaseClient.isReady()) {
      await firebaseClient.createClass({ classCode: generatedClassCode, teacherName, clearPoint });
    }

    if (CONFIG.gasBaseUrl) {
      apiClient.createClass({ teacherName, clearPoint }).catch(() => {});
    }

    info = { classCode: generatedClassCode };
    saveInfo(info);
    setView(true);
    await refreshDashboard();
    startAuto();
  });

  byId('btnManageClass').addEventListener('click', async () => {
    const classCode = byId('joinCodeInput').value.trim();
    if (!classCode) { showMessage('クラスコードを入力してください。'); return; }

    let exists = false;
    if (firebaseClient.isReady()) {
      const fbCheck = await firebaseClient.getClass({ classCode });
      if (fbCheck.ok) exists = true;
    }

    if (!exists && CONFIG.gasBaseUrl) {
      const res = await apiClient.syncState({ classCode });
      if (res.ok) exists = true;
    }

    if (!exists && !firebaseClient.isReady()) {
      showMessage('クラスが見つかりませんでした。クラスコードを確認してください。');
      return;
    }

    info = { classCode };
    saveInfo(info);
    setView(true);
    await refreshDashboard();
    startAuto();
  });

  byId('btnDisconnect').addEventListener('click', () => {
    stopAuto();
    info = null;
    clearInfo();
    setView(false);
  });

  byId('btnRefresh').addEventListener('click', refreshDashboard);

  byId('forestNow').addEventListener('click', async (event) => {
    if (!event.target.closest?.('#btnReleaseNextForest')) return;
    if (!info) return;
    if (firebaseClient.isReady()) {
      await firebaseClient.updateForestState({
        classCode: info.classCode,
        forestState: { nextForestUnlocked: true }
      });
    }
    if (CONFIG.gasBaseUrl) {
      apiClient.releaseNextForest({ classCode: info.classCode }).catch(() => {});
    }
    showMessage('');
    refreshDashboard();
  });

  byId('rosterFilterToggle').addEventListener('change', (event) => {
    renderStudentRoster(lastRoster, { attentionOnly: event.target.checked });
  });

  byId('btnSaveSettings').addEventListener('click', async () => {
    if (!info) return;
    const approvalMode = byId('approvalModeSelect').value;
    const maxGoals = Number(byId('maxGoalsInput').value) || 3;
    const clearPoint = Number(byId('clearPointSettingInput').value) || 1000;
    const stalledDays = Number(byId('stalledDaysInput').value) || 3;
    const supportDays = Number(byId('supportDaysInput').value) || 2;

    if (firebaseClient.isReady()) {
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
    }

    if (CONFIG.gasBaseUrl) {
      apiClient.setGoalSettings({ classCode: info.classCode, maxGoals, approvalMode }).catch(() => {});
      apiClient.setClearPoint({ classCode: info.classCode, clearPoint }).catch(() => {});
      apiClient.setRosterThresholds({ classCode: info.classCode, stalledDays, supportDays }).catch(() => {});
    }

    showMessage('設定を保存しました✨');
    setTimeout(() => showMessage(''), 3000);
    refreshDashboard();
  });

  const firebaseClient = new FirebaseClient();

  byId('approvalList').addEventListener('click', async (event) => {
    const approveBtn = event.target.closest?.('[data-approve]');
    if (approveBtn) {
      const logId = approveBtn.dataset.approve;
      await apiClient.approveGoal({ classCode: info.classCode, logId });
      if (firebaseClient.isReady()) {
        await firebaseClient.resolveGoalApproval({ classCode: info.classCode, logId, approve: true });
      }
      refreshDashboard();
      return;
    }
    const rejectBtn = event.target.closest?.('[data-reject]');
    if (rejectBtn) {
      const logId = rejectBtn.dataset.reject;
      await apiClient.rejectGoal({ classCode: info.classCode, logId });
      if (firebaseClient.isReady()) {
        await firebaseClient.resolveGoalApproval({ classCode: info.classCode, logId, approve: false });
      }
      refreshDashboard();
    }
  });

  if (info) {
    setView(true);
    await refreshDashboard();
    startAuto();
  } else {
    setView(false);
  }
}

main();
