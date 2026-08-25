# コツコツの森 プロジェクト概要と設計ドキュメント

## まず読む順番
1. `docs/00_START_HERE.md`
2. `docs/01_design_overview.md`
3. `docs/20_firebase_realtime_spec.md` (Firebaseリアルタイム同期設計)
4. `docs/11_gas_backend_spec.md` (GAS/スプレッドシート管理設計)
5. `docs/02_assets_spec.md`
6. `docs/06_runtime_architecture.md`

## いちばん大事な前提
- 1マス = 112px
- 描画エンジン: `js/render.js` (Keyed DOM Syncによる60fps差分更新・チラつきゼロ)
- 素材: `assets/` 配下の透過PNG画像群（絵本風イラスト）
- リアルタイム同期: `js/firebase-client.js` & `js/firebase-sync.js` (Firestore `onSnapshot`)
- 先生管理・名簿: `gas/Code.gs` & `js/api-client.js` (Googleスプレッドシート連携)
- 進行: `data/events.json`
- 置き場所: `data/spots.json`
- 骨格: `data/map.json`
- 定義: `data/assets.json`
- 実行状態: `js/core-runtime.js`

## バックエンドのハイブリッド構成
- **先生の管理（GAS / Googleスプレッドシート）**:
  - `docs/11_gas_backend_spec.md` : 設計
  - `gas/Code.gs` : GASバックエンド本体
  - `js/api-client.js` : GAS通信ラッパー
  - `js/class-sync.js` : クラス管理とcore-runtimeの橋渡し
- **リアルタイム・ゲーム同期（Firebase Firestore）**:
  - `docs/20_firebase_realtime_spec.md` : 設計
  - `js/firebase-config.js` : Firebase接続構成設定
  - `js/firebase-client.js` : Firestore通信クライアント
  - `js/firebase-sync.js` : リアルタイム同期層（森配置・目標・ありがとう・成長）

## 主要ファイル一覧
- `index.html`: 児童用メイン画面（かんたん目標スタンプ、ありがとう通知、サウンド設定）
- `teacher.html`: 先生用ダッシュボード（名簿・要支援アラート・リアルタイム承認）
- `style.css`: 絵本風・温かみのあるウッド＆オーガニックデザイン
- `js/app.js`: クライアントメイン制御
- `js/render.js`: Keyed DOM Sync差分描画エンジン
- `js/audio.js`: 効果音（SE）および環境音（BGM）マネージャー
- `assets/`: 絵本風イラスト・透過PNG画像アセット群
