# GASデプロイ手順

## 1. スプレッドシートを用意
1. 新しいGoogleスプレッドシートを1つ作成（全クラス共有用）
2. 拡張機能 → Apps Script を開く
3. `Code.gs` の中身をこの `gas/Code.gs` の内容で置き換える

## 2. デプロイ
1. 右上「デプロイ」→「新しいデプロイ」
2. 種類: **ウェブアプリ**
3. 実行するユーザー: **自分**
4. アクセスできるユーザー: **全員**（Chromebookの児童アカウントも呼べるように）
5. デプロイ後に発行されるURL（`https://script.google.com/macros/s/.../exec`）を控える

## 3. シートの初期化
- シートは手動で作らなくてOK。`doPost` が最初に呼ばれたタイミングで `setupSheets()` が動き、
  `Classes / Students / Goals / GoalLog / PlacedAssets / ActivityLog / Thanks / ForestState`
  の8シートとヘッダー行を自動生成する
- 動作確認だけしたい場合は、後述の `ping` アクションを叩けば、シートを触らずに疎通確認できる

## 4. 動作確認（curlやPostmanで）

```bash
curl -X POST "<デプロイURL>" -d '{"action":"ping"}'
# => {"ok":true,"data":{"pong":true,"time":"..."}}

curl -X POST "<デプロイURL>" -d '{"action":"createClass","payload":{"teacherName":"やまだ先生","clearPoint":1000}}'
# => {"ok":true,"data":{"classCode":"XXXXXXXXXXXXXXXX","clearPoint":1000,"mapId":"kokotsu_forest_01"}}

curl -X POST "<デプロイURL>" -d '{"action":"joinClass","classCode":"<上で発行されたコード>","payload":{"nickname":"ゆうき"}}'
# => {"ok":true,"data":{"studentId":"XXXXXXXX","nickname":"ゆうき","isNew":true}}
```

## 5. コード修正を反映するとき
- Apps Scriptエディタでコードを更新しただけでは、既存のデプロイURLには反映されない
- 「デプロイ」→「デプロイを管理」→ 既存デプロイの鉛筆アイコン →「新しいバージョン」を選んで更新する
- URL自体は変わらないので、フロント側の設定は変えなくてよい

## 今後の追加
- `docs/11_gas_backend_spec.md` のアクション一覧のうち、`syncState` 以降がまだ未実装
- `Code.gs` の `ACTION_HANDLERS` にハンドラ関数を1つ足し、`handleXxx` を実装していく形で拡張する
