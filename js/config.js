import { FIREBASE_CONFIG } from './firebase-config.js';

export const CONFIG = {
  cellSize: 112,
  mapWidth: 100,
  mapHeight: 80,
  storageKey: 'kokotsu_forest_save_v1',
  minZoom: 0.85,
  maxZoom: 1.2,
  // クラスで1つ配布するGASのウェブアプリURL。先生がここへ貼り付ける
  gasBaseUrl: 'https://script.google.com/macros/s/AKfycbxbi3IegNDJ7nh3NhkKt0TudyFX_qCYs3H1r6CqeqQiDJChKtESg2tgJh07TzEc_LE8Wg/exec',
  // Firebase Firestoreリアルタイム同期設定
  firebase: FIREBASE_CONFIG
};
