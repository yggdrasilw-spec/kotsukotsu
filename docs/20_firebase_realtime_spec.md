# Firebase Firestore リアルタイム同期 設計仕様書

## 1. 概要と役割分担

「コツコツの森」では、先生の管理体験と児童のゲーム体験を両立するため、**GAS（Google Apps Script / スプレッドシート）** と **Firebase（Cloud Firestore）** のハイブリッド構成を採用しています。

```
+-------------------------------------------------------------+
|                      コツコツの森 システム構成               |
+-------------------------------------------------------------+
               |                                  |
               v                                  v
+-------------------------------+  +-------------------------------+
|  先生の管理 (GAS / Sheets)    |  |  リアルタイム同期 (Firestore)  |
+-------------------------------+  +-------------------------------+
| ・クラス作成 & クラスコード発行 |  | ・森の配置 (PlacedAssets)      |
| ・児童名簿 (Students) の管理  |  | ・目標達成 & 承認キュー (Goals) |
| ・学級目標・設定のバックアップ |  | ・ありがとう (Thanks) 通知    |
| ・スプレッドシート上での編集  |  | ・森の進行度 (ForestState)     |
+-------------------------------+  +-------------------------------+
```

---

## 2. Firestore コレクション設計

### 1. `classes/{classCode}` (クラス基本・森の進行状態)
```json
{
  "classCode": "AB12CD",
  "teacherName": "山田先生",
  "clearPoint": 1000,
  "forestState": {
    "classPoints": 240,
    "completedEvents": ["event_01", "event_02"],
    "forestGeneration": 1,
    "forestStatus": "growing",
    "forestStartedAt": "2026-08-25T12:00:00.000Z"
  },
  "updatedAt": "2026-08-25T12:30:00.000Z"
}
```

### 2. `classes/{classCode}/placedAssets/{placedId}` (森に置かれたアセット)
```json
{
  "placedId": "pl_1787658000_abc",
  "assetId": "flower_small_01",
  "spotId": "flowerMeadow",
  "x": 22,
  "y": 15,
  "studentId": "std_1234",
  "nickname": "ゆうき",
  "goalId": "goal_01",
  "goalTitle": "読書を10ページ",
  "createdAt": "2026-08-25T12:30:00.000Z"
}
```

### 3. `classes/{classCode}/thanks/{thanksId}` (ありがとうメッセージ)
```json
{
  "thanksId": "thx_1787658000_xyz",
  "fromStudentId": "std_1234",
  "fromLabel": "ゆうき",
  "toName": "さくら",
  "message": "てつだってくれてありがとう！",
  "createdAt": "2026-08-25T12:35:00.000Z"
}
```

### 4. `classes/{classCode}/goalLog/{logId}` (目標達成・承認キュー)
```json
{
  "logId": "glog_1787658000_def",
  "studentId": "std_1234",
  "goalId": "goal_01",
  "goalTitle": "計算ドリル1ページ",
  "status": "approved",
  "requestedAt": "2026-08-25T12:20:00.000Z",
  "resolvedAt": "2026-08-25T12:25:00.000Z",
  "points": 20
}
```

---

## 3. クライアント実装構成

- `js/firebase-config.js`: Firebaseプロジェクト接続設定
- `js/firebase-client.js`: Firestore SDK初期化、`onSnapshot` リアルタイムリスナー、ドキュメント操作
- `js/firebase-sync.js`: `ForestCore`（状態管理）とFirestoreのリアルタイム同期層
- `js/app.js`: 児童画面でのリスナー起動、リアルタイム通知（ありがとうポップアップ、先生承認通知、配置同期）
- `js/teacher.js`: 先生画面での承認キューのリアルタイム処理
