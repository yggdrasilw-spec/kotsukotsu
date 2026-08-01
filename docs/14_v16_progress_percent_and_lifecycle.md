# v16 レビュー対応メモ

前回パックのレビューで指摘された「機能の部品は揃っているが、運用の核と演出の密度が足りない」
という点のうち、第1段階(最優先)と第2段階の一部に対応した。

## 直した根本バグ: 進行度が「%」ではなく生のclassPointsで判定されていた

`events.json` / `badges.json` / `shop.json` / `unlockCondition` / `assets.unlock` は
すべて「0〜100の割合(%)」で書かれている設計だったが、実装(`ForestCore.syncMilestones` /
`ShopManager.isUnlocked` / `canPlaceAsset` / `render.js`の解放判定)は、これを
**生のclassPointsとそのまま比較していた**。

これは `clearPoint`(先生が設定する「完全クリアに必要なクラスポイント」、既定1000)が
たまたま100のときしか正しく動かない状態で、先生が実際の運用値(1000など)を設定した瞬間に
「イベントが一生発生しない」「ショップが一生解放されない」という致命的な不具合になっていた。

### 直した内容
- `js/core-runtime.js` に `computeProgressPercent(state)` を新設。
  `classPoints ÷ clearPoint × 100`(0〜100にクランプ)を1箇所で計算する。
- ローカル単独時(GAS未接続)は `state.classInfo.clearPoint` の既定値を100にして、
  従来の体感バランスを維持したまま「%」に正式移行した。
- `ForestCore.syncMilestones` / `canPlaceAsset` / `ShopManager.isUnlocked` /
  `ShopManager.canBuy`(内部で`isUnlocked`経由) / `badge.js`の表示用評価 /
  `render.js`の `renderPalette` / `renderShop` を、すべて同じ `computeProgressPercent` 経由に統一。
  (表示側と判定側でロジックが分岐する、v15で一度直したのと同種の事故を再発させないため)

## events.json を5%刻み全区間(5〜100)で整備

20/35/40/45/55/65/70/75/85/90/95 を追加し、20イベント全て揃えた。
shop.json / assets.json の解放しきい値(10,15,25,30,35,40,45,50,55,60,65,70,75,80)と
一致させてあるので、「解放される瞬間」と「見た目の演出が起きる瞬間」がずれない。
バッジも30%・70%の節目(`badge_forest_04`/`05`)を追加し、10→50→100の3段だったものを
10→30→50→70→100の5段に。

## 森のライフサイクル(完全クリア/新しい森/過去の森)

`state` に以下を追加(`js/core-runtime.js`):
- `forestGeneration` / `forestStatus`(`growing`|`completed`) / `forestStartedAt` / `forestCompletedAt`
- `forestHistory`: 完成させた森の記録(`ForestCore.startNewForest()`で積む)

`syncMilestones()` が進行度100%到達を検知すると `forestStatus` を `completed` にし、
`buildForestSummary()`(年表つきスナップショット)を伴う `summary.forestCompleted` を返す。
`app.js` はこれを受けてカメラを引いて全景を見せ、エンディングモーダルを開く
(`docs/07_next_features.md` で触れられていた「エンディング演出」の第一版)。

`ForestCore.startNewForest()` は、完成済みの森だけを対象に:
- 今の森を `forestHistory` へアーカイブ
- `classPoints` / `completedEvents` / `placedAssets` / `animals` / `unlockedCategories` / `badges`
  (=「森そのものの成長」を表す値)だけをリセット
- `personalPoints` / `lifetimePoints` / `ownedAssets` / `shopPurchased` / 目標やありがとうのログなど
  (=「個人の頑張りの記録」)は引き継ぐ

という設計にした。実際に4月リセットでクラスコードごと作り直す(`gas/Code.gs`側)運用とは別に、
「1つのクラスの中で森を何周も育てる」ケースに対応したもの。GAS側の連携はまだ無いので、
クラス共有プレイでは今のところローカル(その端末)だけの完成判定・リセットになる。今後の課題。

## 起動画面ポップアップ(第一版)

`ForestCore.checkInToday()` / `getDailySummary()` を追加。連続ログイン日数・きのうの
活動ハイライト(activityLogから日付で抽出)・未読の「ありがとう」件数・はげましメッセージを
1回でまとめて返す。`app.js`の起動シーケンス末尾で1回だけ表示する(`#welcomeHost`)。
森が完成済みの状態でアプリを開いた場合は、この起動ポップアップの代わりに
エンディングモーダル(「新しい森をはじめる」への導線)を出す。

仕様にあった「イベント通知」の統合はまだ未着手(未読バッジ件数だけは出している)。

## まだ手を付けていない項目(レビュー原文の番号に対応)

- 5: UI方針(画像主体でよいと確認済み。SVG化は不要)
- 6: 子ども向け画面のさらなる情報整理
- 7: 「森の物語」の密度(共有している感・ありがとうがクラス全体に広がる感の強化)
- GAS側(`gas/Code.gs`)との森ライフサイクル連携(クラス全員で完成/リセットを共有する)
- teacher.html側での過去の森(forestHistory)の閲覧UI
