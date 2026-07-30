// 現状はcore-runtime.jsに実装をまとめているが、将来的にSaveManagerだけを
// 独立したファイルへ切り出す時のための再エクスポート窓口(docs/06参照)。
export { SaveManager } from './core-runtime.js';
