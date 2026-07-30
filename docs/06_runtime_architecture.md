# 実行構成

## 目的
設計ファイルを読み、森の状態を管理し、画面描画へ渡す。

## 構成
- `js/config.js`
- `js/core-runtime.js`
- `js/render.js`
- `js/camera.js`
- `js/placement.js`
- `js/interaction.js`
- `js/save.js`
- `js/animals.js`
- `js/shop.js`
- `js/season.js`
- `js/badge.js`
- `js/audio.js`

## データの流れ
1. `assets.json / spots.json / map.json / events.json` を読む
2. `core-runtime` が状態を持つ
3. `placement` がスポットに置く
4. `render` が描画する
5. `save` が保存する


## 現在の実装で実際に使っているファイル
- `index.html`
- `style.css`
- `js/app.js`
- `js/data-loader.js`
- `js/render.js`
- `js/camera.js`
- `js/placement.js`
- `js/interaction.js`
- `js/core-runtime.js`
- `js/season.js`
- `js/audio.js`
- `js/badge.js`
- `js/api-client.js`（GASとの通信ラッパー。docs/11参照）
- `js/class-sync.js`（クラス共有データとcore-runtimeを繋ぐ層）
- `gas/Code.gs`（GASバックエンド本体、フロントとは別プロジェクトとしてデプロイ）

## GAS連携について
- `docs/11_gas_backend_spec.md` に設計、`gas/README.md` にデプロイ手順がある
- `ForestCore`(core-runtime.js)自体は変更していない。`class-sync.js`が後付けで
  「GASが設定されていれば送る/取り込む」を行うだけなので、GAS未接続でも今まで通りローカル単独で動く
- 未実装: 先生用の設定画面(クラス作成UI、承認待ち一覧のクラス全体表示、clearPoint変更UI)は
  `window.prompt`によるごく簡易な導線のみ。次のステップで専用画面にする余地がある
