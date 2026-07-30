# 実装フロー（引き継ぎ版）

## いまの前提
- 1マス = 112px
- 画像サイズと占有マスは別管理
- 小物は1マスに複数置ける
- 森の状態は `js/core-runtime.js` が持つ
- 画面起動は `index.html` + `js/app.js`

## 実装済みの役割
- `assets.json` : 素材一覧
- `spots.json` : 置き場所一覧
- `map.json` : 森の骨格
- `events.json` : 成長イベント
- `js/core-runtime.js` : 保存・動物・ショップの中核
- `js/camera.js` : スクロールとズーム
- `js/placement.js` : 配置
- `js/render.js` : 描画
- `js/interaction.js` : クリック・ドラッグ
- `js/app.js` : 起動と接続
- `index.html` : 画面

## 次に足しやすいもの
- `js/season.js` の本格利用
- `js/badge.js` の画面
- `js/audio.js` の音イベント接続
- ショップの画面分離
- ミニマップ
- 動物の個別アニメーション
