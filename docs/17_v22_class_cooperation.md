# v22: クラス協力の意味づけ強化

## 課題
- classPoints(クラス共有)は既に「誰が達成しても、みんなの森が育つ」構造だったが、
  「誰が育てたか」がクラスの誰にも見えていなかった。
  - `ActivityLog`(GAS共有)には thanks/purchase/new_forest しか送られておらず、
    目標達成・承認・森イベント・バッジは端末ローカルのログにしか残らなかった。

## やったこと(3つ、独立して有効)

### 1. 貢献ログの共有(gas/Code.gs)
- `ActivityLog` シートに `actorName` / `points` / `progress` 列を追加。
  - 既存シートは `migrateHeaders()` が起動時に自動で列を追記する(再デプロイ後、初回アクセスで反映)。
- `handleCompleteGoal`(自己判定モード)と `handleApproveGoal`(先生承認)から
  `announceContribution(classCode, studentId, actionNoun, pointsAwarded, beforePercent)` を呼ぶ。
  - 通常: `✅ ◯◯さんが「宿題」の達成をがんばりました（+20pt）` を `type:'contribution'` で記録。
  - 5%の節目をまたいだとき: `🌟 ◯◯さんの「宿題」の達成が最後のひと押しになって、森が10%まで育ちました！`
    を `type:'contribution_milestone'` として記録(`actorName`/`points`/`progress` 付き)。
  - events.jsonが必ず5%刻みで作られている前提(docs/05_events_spec.md)を利用しているので、
    GAS側にevents.jsonの中身(タイトル等)を複製せずに済んでいる。
- 配置(`handlePlaceAsset`)は頻度が高いため、あえて貢献ログには流していない
  (ログが埋まりすぎるのを避けるため)。

### 2.「最後のひと押し」演出(js/core-runtime.js, js/app.js, style.css)
- `core-runtime.js`
  - `ForestCore` に `_lastLocalActionAt` / `_lastLocalActionActor` を追加。
    `completeGoal()`(自己判定モード)と `placeAsset()` の直後にセットする。
  - `syncMilestones()` が新しい森イベントを検知したとき、`eventSummary.contributor` を決める:
    1. 直前(6秒以内)に自分がローカルで達成/配置していれば、その本人(自分)。
    2. そうでなければ、`state.activityLog` の中から `type:'contribution_milestone'` かつ
       `progress` が一致する行を探し、その `actorName` を採用(GAS経由でクラスメイトの行動が
       共有された場合)。見つからなければ `null`(バナーには何も足さない)。
- `app.js`
  - `showBanner()` に `contributorText` を追加。マイルストーンバナーの下に
    `.milestone-banner__contributor` チップとして表示。
  - `contributorLabel()`: 自分なら「あなたでした」、他の子なら「◯◯さんでした」に変換。
- ローカル単独プレイ(GAS未接続)でも、自分の行動で起きたイベントには
  「あなたでした」が出る(サーバー不要、上記1.のパスのみで成立)。

### 3.「クラスのちから」パネル(js/render.js, js/app.js, index.html, style.css)
- 新パネル `#classPowerPanel`(左サイドバー、ありがとうパネルの下。かんたん表示にもタブ追加)。
- `render.js` の `renderClassPower(state)` が `state.activityLog` から
  今日の `contribution` / `contribution_milestone` を集計し、
  - 「今日、クラスみんなで +◯◯pt」
  - 「🌟 今日は◯回、最後のひと押しがありました」
  - がんばった子チップ一覧(`◯◯さん ×2` のように、貢献回数の多い順)
  を表示する。
- GAS未接続(`state.classmates` が無い)ときは
  「🔒 クラスのみんなとつながると、今日のがんばりがここに集まるよ。」を表示。

## 動作確認
- Playwrightでローカル単独モードの一連の流れを確認済み:
  1. 目標を作成 → 達成 → 森イベント発生 → バナーに
     「🙌 最後のひと押しは、あなたでした！」が表示されることを確認。
  2. `classPowerPanel` がGAS未接続時にロック文言を出すことを確認。
  3. `node --check` で `gas/Code.gs` および `js/*.js` 全ファイルの構文エラー無しを確認。
- 未確認(要:実際のGASデプロイ環境):
  - 複数端末(複数の子)をまたいだ貢献ログの共有・「最後のひと押しは◯◯さんでした」の
    クロスデバイス表示。
  - `migrateHeaders()` による既存スプレッドシートへの列追加(理論上は他の列追加と
    同じ仕組みなので安全なはず。ただし実際のスプレッドシートで一度確認推奨)。

## 反映手順
1. `gas/Code.gs` の中身を、既存のGASプロジェクトのコードにまるごと置き換えて再デプロイ
   (「新しいデプロイ」で公開し直す。URLが変わる場合は `index.html`/`teacher.html` 側の
   接続情報は端末のlocalStorageに保存されているURLなので、URLが変わった場合だけ
   クラス連携をやり直す必要がある)。
2. 再デプロイ後、児童が1回アクセスすれば(`syncState`が`setupSheets()`を通るので)
   `ActivityLog` シートに新しい列が自動で追加される。
3. クライアント一式(`index.html`, `style.css`, `js/*.js`)を差し替える。
