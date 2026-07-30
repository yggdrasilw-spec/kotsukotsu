# コツコツの森 引き継ぎ用パック

この zip は、次のチャットでそのまま実装を続けるための引き継ぎパックです。

## まず読む順番
1. `docs/00_START_HERE.md`
2. `docs/01_design_overview.md`
3. `docs/02_assets_spec.md`
4. `docs/03_spots_spec.md`
5. `docs/04_map_spec.md`
6. `docs/05_events_spec.md`
7. `docs/06_runtime_architecture.md`
8. `docs/07_next_features.md`

## いちばん大事な前提
- 1マス = 112px
- 画像サイズと占有マスは分ける
- 小物は1マスに複数配置可
- 森はグリッド管理だが、見た目は自然にする
- 進行は `events.json`
- 置き場所は `spots.json`
- 骨格は `map.json`
- 素材は `assets.json`
- 実行状態は `js/core-runtime.js`

## 実装の順番
1. 保存・復元
2. 描画
3. 配置
4. カメラ
5. イベント
6. 動物
7. 季節
8. ショップ
9. バッジ
10. 音

## 今回同梱したもの
- 設計MD
- JSONテンプレート
- 最低限のJS骨組み


## GAS連携(クラス共有)を追加
- `docs/11_gas_backend_spec.md` : 設計
- `gas/Code.gs` : GASバックエンド本体
- `gas/README.md` : デプロイ手順
- `js/api-client.js` : GAS通信ラッパー
- `js/class-sync.js` : クラス共有データとcore-runtimeの橋渡し
- 画面右上の「クラス連携」ボタンから接続(未接続でも今まで通りローカル単独で動作する)

## 追加した実装ファイル
- `index.html`
- `style.css`
- `js/app.js`
- `js/render.js`
- `js/camera.js`
- `js/placement.js`
- `js/interaction.js`
- `js/data-loader.js`
- `js/save.js`
- `js/animals.js`
- `js/shop.js`
- `js/season.js`
- `js/audio.js`
- `js/badge.js`
- `docs/09_implementation_flow.md`
