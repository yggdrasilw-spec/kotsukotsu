// 現状はcore-runtime.jsに実装をまとめているが、将来的にAnimalManagerだけを
// 独立したファイルへ切り出す時のための再エクスポート窓口(docs/06参照)。
export { AnimalManager } from './core-runtime.js';
