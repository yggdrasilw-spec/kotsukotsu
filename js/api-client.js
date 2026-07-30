// GASバックエンドとの通信をここに集約する。
// docs/11_gas_backend_spec.md / gas/Code.gs のaction一覧と1対1になっている。
//
// CORS対策(重要): Content-Typeを 'text/plain' にしてプリフライト(OPTIONS)を発生させない。
// 'application/json' にすると、GitHub Pages等の他オリジンからのfetchでCORSエラーになりやすい。
// (詳しくは gas/Code.gs 冒頭のコメント、gas/README.md を参照)

export class ApiClient {
  constructor({ baseUrl } = {}) {
    this.baseUrl = baseUrl || null;
  }

  setBaseUrl(url) {
    this.baseUrl = url;
  }

  isConfigured() {
    return Boolean(this.baseUrl);
  }

  async call(action, { classCode = null, studentId = null, payload = {} } = {}) {
    if (!this.baseUrl) {
      return { ok: false, reason: 'not_configured' };
    }
    try {
      const res = await fetch(this.baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action, classCode, studentId, payload })
      });
      if (!res.ok) {
        return { ok: false, reason: 'http_error', status: res.status };
      }
      // GASが例外でHTMLエラーページを返してしまった場合に備えて安全にパースする。
      const text = await res.text();
      try {
        return JSON.parse(text);
      } catch (err) {
        return { ok: false, reason: 'bad_response', message: text.slice(0, 200) };
      }
    } catch (err) {
      return { ok: false, reason: 'network_error', message: String((err && err.message) || err) };
    }
  }

  // ---- 疎通 ----
  ping() {
    return this.call('ping');
  }

  // ---- クラス / 参加 ----
  createClass({ teacherName, clearPoint, mapId } = {}) {
    return this.call('createClass', { payload: { teacherName, clearPoint, mapId } });
  }

  joinClass({ classCode, studentId, nickname } = {}) {
    return this.call('joinClass', { classCode, studentId, payload: { nickname } });
  }

  // ---- 同期 ----
  syncState({ classCode, studentId }) {
    return this.call('syncState', { classCode, studentId });
  }

  // ---- 森 ----
  placeAsset({ classCode, studentId, assetId, spotId, x, y }) {
    return this.call('placeAsset', { classCode, studentId, payload: { assetId, spotId, x, y } });
  }

  removePlacedAsset({ classCode, studentId, placedId }) {
    return this.call('removePlacedAsset', { classCode, studentId, payload: { placedId } });
  }

  updateForestState({ classCode, studentId, forestState }) {
    return this.call('updateForestState', { classCode, studentId, payload: forestState });
  }

  // ---- 目標 ----
  createGoal({ classCode, studentId, title, targetCount }) {
    return this.call('createGoal', { classCode, studentId, payload: { title, targetCount } });
  }

  removeGoal({ classCode, studentId, goalId }) {
    return this.call('removeGoal', { classCode, studentId, payload: { goalId } });
  }

  completeGoal({ classCode, studentId, goalId }) {
    return this.call('completeGoal', { classCode, studentId, payload: { goalId } });
  }

  approveGoal({ classCode, studentId, logId }) {
    return this.call('approveGoal', { classCode, studentId, payload: { logId } });
  }

  rejectGoal({ classCode, studentId, logId }) {
    return this.call('rejectGoal', { classCode, studentId, payload: { logId } });
  }

  // ---- ありがとう ----
  sendThanks({ classCode, studentId, toName, fromLabel }) {
    return this.call('sendThanks', { classCode, studentId, payload: { toName, fromLabel } });
  }

  // ---- ショップ ----
  buyItem({ classCode, studentId, itemId, assetId, itemName, price }) {
    return this.call('buyItem', { classCode, studentId, payload: { itemId, assetId, itemName, price } });
  }

  // ---- 先生設定 ----
  setGoalSettings({ classCode, studentId, maxGoals, approvalMode }) {
    return this.call('setGoalSettings', { classCode, studentId, payload: { maxGoals, approvalMode } });
  }

  setClearPoint({ classCode, studentId, clearPoint }) {
    return this.call('setClearPoint', { classCode, studentId, payload: { clearPoint } });
  }
}
