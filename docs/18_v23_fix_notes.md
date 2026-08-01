# v23 バグ修正メモ（5件の不具合対応）

## ① クラスコードが途中までしか入力されない

**原因**: `gas/Code.gs` の `CLASS_CODE_LENGTH` は `16` だが、`index.html` /
`teacher.html` の入力欄が `maxlength="12"` のままだった。桁数の不一致により、
スプレッドシートからコピーしたコードを貼り付けても途中で切れていた。

**修正**: 両ファイルの `maxlength` を `16` に統一。

- `index.html`: `#classCodeFieldInput`
- `teacher.html`: `#joinCodeInput`

## ② 完成演出でポップアップが映像に被る

**原因**: `showEndingModal()`（`js/app.js`）が最初からタイトル・統計・年表・
ボタンをすべて含む大きな白いカード＋暗い背景を画面中央に出しており、
森全体を見せるカメラ演出が完全に隠れていた。

**修正**: エンディングを2段階の表示にした。

- 再生開始時（`.ending-host` に `is-expanded` が付いていない状態）は、
  カードを画面下の小さな半透明の字幕バーだけにし、背景の暗幕も透明にする
  （`style.css` の `.ending-host:not(.is-expanded)` 系ルール）。タイトル・統計・
  年表・ボタンはこの間 `display:none`。
- ストーリーが最後のスライドまで進む（`slide.isFinal`）か、「文字でまとめて
  見る」を押すと `is-expanded` クラスが付き、これまで通りの中央カード表示
  （統計・年表・ボタン）に切り替わる（`js/app.js` の `renderStorySlide()` /
  `endingStoryToggleText` ハンドラ）。

## ③ 1000ポイントのはずが200点台で完成する

原因は2つが重なっていた。

**原因A**: `js/core-runtime.js`（`computeProgressPercent` / `getClearPoint` /
`defaultState().classInfo.clearPoint`）と `js/render.js`（`renderStatus`）の
`clearPoint` の既定値が **100** のままで、`teacher.html` の初期値・GAS側の
既定値（**1000**）と食い違っていた。サーバー同期前やクラス未接続の瞬間に
この100が使われ、実際より早く「完成」と判定されていた。

**修正**: 上記4箇所すべての既定値を `1000` に統一。

**原因B（本質的な原因）**: `js/class-sync.js` の `pull()` が、
「サーバー側の森の世代がローカルより進んでいる」場合しか考慮しておらず、
逆に「**自分が新しい森を始めた直後で、ローカルの世代がサーバーより進んでいる**」
場合の処理が抜けていた。この状態で20秒ごとの自動同期が走ると、前世代の
古い `classPoints`／`forestStatus:'completed'` を取り込んでしまい、リセットした
ばかりの森が古い点数でいきなり完成扱いに巻き戻る事故になっていた。

**修正**: `serverGeneration < localGeneration` の分岐を追加し、この場合は
サーバーからの値を一切マージせず、`pushStartNewForest()` を再送してサーバー側の
追いつきを促すだけにした。

## ④ 「新しい森を作る」が動かない

**原因**: ③の原因Bと同じ。新しい森を始めた直後に自動同期が前世代のデータを
巻き戻してしまい、「押しても進んだように見えない／固まる」という症状として
現れていた。

**修正**: ③の修正（`class-sync.js` の世代マージ処理）であわせて解消。

## ⑤ 新しい森への遷移は先生が解放する方式にしたい

**追加した仕組み**:

- `gas/Code.gs`: `ForestState` シートに `nextForestUnlocked` 列を追加
  （`SHEET_HEADERS`。既存シートにも `migrateHeaders` が自動で列を追加する）。
  - `handleCreateClass`: 新規クラス作成時は `false` で初期化。
  - `handleSyncState`: レスポンスの `forestState.nextForestUnlocked` として返す。
  - `handleStartNewForest`: `forestStatus==='completed'` かつ
    `nextForestUnlocked===true` のときだけ成功するように変更。次代へ進んだら
    再び `false` に戻し、世代ごとに先生の解放操作が必要になるようにした。
  - `handleReleaseNextForest`（新規）: 先生が呼ぶと `nextForestUnlocked` を
    `true` にする。`ACTION_HANDLERS` に `releaseNextForest` として登録。
- `js/api-client.js`: `releaseNextForest({ classCode })` を追加。
- `js/teacher.js` / `teacher.html`: 「森の記録」パネルに、完成済みかつ
  未解放のときだけ「次の森を解放する」ボタンを表示（`renderForestRecord`）。
  解放済みのときは「🔓 次の森に進めるようになっています」と表示する。
- `js/core-runtime.js`:
  - `defaultState()` に `nextForestUnlocked: true` を追加（ローカル単独プレイ
    では常に許可、先生がいるクラス接続時のみ意味を持つ）。
  - `startNewForest()` に、`state.classInfo.classCode` があるときだけ
    `nextForestUnlocked` を確認するガードを追加。ブロック時は
    `{ ok:false, reason:'waiting_for_teacher' }` を返す。次代へ進んだら
    クラス接続時のみ `false` に戻す。
- `js/class-sync.js`: `pull()` で `forestState.nextForestUnlocked` を
  ローカル状態に反映（世代一致／サーバー先行の両分岐）。
- `js/app.js`: エンディングモーダルに「先生の解放待ち」の案内文
  （`#endingWaitingForTeacher`）を追加。`nextForestUnlocked` が `false` の間は
  「新しい森をはじめる」ボタンを隠し、案内文を表示する
  （`updateEndingReleaseState()`。`refresh()` からも呼び、モーダル表示中に
  先生が解放しても即座に反映されるようにした）。

## ついでに: teacher.html の GAS URL 手打ちをやめて config.js を見るように変更

`teacher.html` の「GASのウェブアプリURLを入力」欄（`#baseUrlInput`）を削除し、
`js/teacher.js` が `js/config.js` の `CONFIG.gasBaseUrl` を読むようにした
（`index.html`／`js/app.js` と同じ方式）。これによりクラスを切り替えるたびに
URLを貼り直す必要がなくなった。`CONFIG.gasBaseUrl` が空の場合はメッセージを
出して処理を止める。

## 変更したファイル一覧

- `gas/Code.gs`
- `index.html`
- `teacher.html`
- `style.css`
- `js/app.js`
- `js/core-runtime.js`
- `js/render.js`
- `js/class-sync.js`
- `js/api-client.js`
- `js/teacher.js`
