# GASバックエンド / クラス構造 設計

## 目的
今の実装は「1ブラウザ＝1つの完結した森」。これを「1クラス＝1つの森を、複数の児童が共有する」形にするための土台。

## 方針
- スプレッドシートは1つ。全クラスで共有し、`classCode` 列で区別する
- GASは `doPost(e)` を単一窓口にし、`{ action, classCode, studentId, payload }` を受けて分岐する
- フロントの `core-runtime.js` のメソッド名とAPIの `action` 名はできるだけ1対1にする（将来のテーマ追加でも迷わないように）
- 通信は非同期。オフラインでも動くよう、ローカルキャッシュ→再接続時に同期、を基本にする

---

## データの線引き

### クラス共有（Sheets側が正、全員に配信）
- classPoints / completedEvents / unlockedCategories
- placedAssets（森に置かれた物）
- activityLog（全員が見る最新ログ、最大50件）
- thanksLog（ありがとうの送受信記録）
- badges（クラス全体の達成）
- animals（森にいる動物）
- goalLogのうち承認待ち一覧（先生が承認するため全員分見える必要がある）
- clearPoint（完全クリアポイント、先生設定）

### 児童個人（Sheets側に保存、studentIdで分離）
- nickname
- personalPoints / lifetimePoints
- goals / goalSettings
- ownedAssets / shopPurchased / inventory

### ローカルのみ（localStorage、サーバーに送らない）
- studentId（8文字英数字）
- settings（season表示上の一時状態を除くUI設定, bgm/sfx, zoom, cameraX/Y, showGrid, showSpots）
- lastSeenLogAt（起動ポップアップ用）

---

## Sheets構成（1スプレッドシート）

| シート名 | 主キー | 主な列 |
|---|---|---|
| Classes | classCode | classCode, teacherName, clearPoint, createdAt, resetAt, mapId, active |
| Students | studentId | studentId, classCode, nickname, personalPoints, lifetimePoints, createdAt |
| Goals | goalId | goalId, classCode, studentId, title, targetCount, createdAt, active |
| GoalLog | logId | logId, classCode, studentId, goalId, goalTitle, date, status, requestedAt, resolvedAt, points |
| PlacedAssets | placedId | placedId, classCode, studentId, assetId, spotId, x, y, createdAt |
| ActivityLog | logId | logId, classCode, type, message, createdAt |
| Thanks | thanksId | thanksId, classCode, fromStudentId, fromLabel, toName, date, createdAt |
| ForestState | classCode | classPoints, completedEvents(JSON), unlockedCategories(JSON), badges(JSON), animals(JSON) |

- `classCode`: 16文字（英数字＋記号）、クラス作成時にGAS側で生成
- `studentId`: 8文字英数字、初回参加時にGAS側で生成しクライアントへ返す→localStorageに保存
- 4月リセット: `Classes.active=false` にして、`resetAt` を記録。過去の森として参照可能な状態で残す（物理削除しない）。新しい森は新しい `classCode` で開始

---

## APIアクション一覧（doPost）

| action | 用途 | 対応する core-runtime メソッド |
|---|---|---|
| createClass | 先生がクラス作成、classCode発行 | - |
| joinClass | 児童IDで参加／新規児童ID発行 | - |
| syncState | 差分取得（前回同期時刻以降のクラス共有データ） | - |
| placeAsset | アセット配置 | placeAsset |
| removePlacedAsset | 配置取り消し | removePlacedAsset |
| createGoal / removeGoal | 目標作成・削除 | createGoal / removeGoal |
| completeGoal | 達成報告 | completeGoal |
| approveGoal / rejectGoal | 先生承認 | approveGoal / rejectGoal |
| sendThanks | ありがとう送信 | sendThanks |
| buyItem | ショップ購入 | buy |
| spawnAnimal / clickAnimal | 動物 | spawnAnimal / clickAnimal |
| setGoalSettings | 目標数・承認モード設定（先生） | goalManager経由 |
| setClearPoint | 完全クリアポイント設定（先生） | - |

- 同時書き込みは `LockService.getScriptLock()` で直列化する
- レスポンスは常に `{ ok, data, reason }` 形式。エラー時もHTTP200＋`ok:false`で返す（Apps Scriptの制約を踏まえた設計）

---

## フロント側の変更方針

- 新規 `js/api-client.js`: GAS WebアプリURLへの `fetch` ラッパー。全アクションをここに集約
- `SaveManager` の役割を変更:
  - 個人・ローカル設定 → 従来通りlocalStorageに即時保存
  - クラス共有データ → ローカルキャッシュとして保持しつつ、アクション実行後にAPIへ送信 → 一定間隔（例: 15秒）または画面フォーカス時に `syncState` でクラス全体の最新状態を取得しマージ
- `ForestCore` 自体のロジック（`placeAsset`や`completeGoal`等の判定）は変更しない。呼び出し後にAPI送信を追加するラッパー層として `api-client.js` を挟む形にし、**既存ロジックを壊さない**方針を守る

---

## 実装順序（提案）
1. GASプロジェクト作成、Sheets雛形作成、`doPost`の空実装（pingできるだけ）
2. `createClass` / `joinClass` のみ実装 → クラスコード発行・児童ID発行の動作確認
3. `syncState`（読み取り専用）を実装 → クラス共有データを取得できる状態にする
4. 書き込み系アクション（placeAsset, completeGoal など）を1つずつ追加
5. フロント側 `api-client.js` を作り、まず「配置」1機能だけをGAS経由に繋ぎ替えて動作確認
6. 残りのアクションを順次繋ぎ替え
