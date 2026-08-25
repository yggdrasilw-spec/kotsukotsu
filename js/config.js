import { FIREBASE_CONFIG } from './firebase-config.js';

export const CONFIG = {
  cellSize: 112,
  mapWidth: 100,
  mapHeight: 80,
  storageKey: 'kokotsu_forest_save_v1',
  minZoom: 0.85,
  maxZoom: 1.2,
  // Firebase Firestoreリアルタイム同期設定
  firebase: FIREBASE_CONFIG
};
