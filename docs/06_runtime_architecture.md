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
- 先生用の設定画面・承認待ち一覧(クラス全体)・clearPoint変更は `teacher.html` / `js/teacher.js` に分離した(2024年整理)。
  `index.html`(児童画面)側からは「先生用: 承認待ち」パネルと先生承認制チェックボックスを削除済み。
  `class-sync.js` の `pull()` が `classInfo`(承認モード/目標上限/clearPoint)をサーバーから取り込み、
  児童端末の `state.goalSettings` に反映するので、先生が teacher.html で変更した設定は自動的に児童側にも効く。
- `js/teacher.js` は `ForestCore` を使わず `ApiClient` を直接呼ぶ軽量な別画面。ローカル保存キーは
  `kokotsu_teacher_info_v1`(児童側の `kokotsu_class_info_v1` とは別)
- `gas/Code.gs` の `handleSyncState` に `students`(studentId→nickname一覧)を追加した。teacher.htmlが
  承認待ち一覧に「だれの目標か」を表示するために使う。既存デプロイには反映されないので、
  `gas/README.md` の手順で再デプロイ(新しいバージョン)が必要
- 未実装: `clearPoint`(森がそろうまでのクラスポイント)は teacher.html から設定できるが、
  児童画面にはまだ進捗表示(あと◯ポイント、等)がない。次のステップの候補

## 配置物タップ詳細ポップアップ(v16)
- `docs/13_placed_info_popup.md` 参照。花などをタップすると「だれが/いつ/どんな目標をクリアして」を表示する。
- `gas/Code.gs` の `PlacedAssets` シートに `goalId`/`goalTitle` 列を追加した。既存デプロイのシートには
  自動反映されないため、`docs/13_placed_info_popup.md` の手順で手動追加が必要。
