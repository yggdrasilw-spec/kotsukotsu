import { isBadgeUnlocked, computeProgressPercent } from './core-runtime.js';

// バッジパネルの表示専用。実際の進行(バッジ獲得・報酬付与)は
// core-runtime.js の ForestCore.syncMilestones() が行う。
// こちらは状態を変更しない、表示のための評価のみ。
// 判定ロジック自体は isBadgeUnlocked() を共有しているので、
// 「表示上は未達成なのに実際は達成扱い」のような食い違いは起きない。
export class BadgeManager {
  constructor(badges = []) {
    this.badges = Array.isArray(badges) ? badges : [];
  }

  setBadges(badges) {
    this.badges = Array.isArray(badges) ? badges : [];
  }

  evaluate(state) {
    const percent = computeProgressPercent(state);
    const completedEvents = new Set(state?.completedEvents || []);
    return this.badges.map((badge) => ({
      ...badge,
      unlocked: isBadgeUnlocked(badge, percent, completedEvents)
    }));
  }
}
