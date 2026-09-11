# 神秘的な水彩の森・素材更新

以前の `tree_symbol_01.png` を `reference/tree_symbol_original.png` に保管し、淡い緑・桃色の花・金色の模様と光を共通の基準にしました。

内蔵 image_gen で38種類を生成し、`assets/` に保存しています。共通プロンプトと各素材の指定は `mystic-generation.json`、実際のプロンプトと生成元の保存先は `reference/*-generation.txt` に記録しています。生成画像への背景除去や縮小加工は行っていません。

シンボルツリーは0・20・40・60・80％を境に、芽・苗木・若木・大きな木・花咲く木の5枚を切り替えます。同じ段階内ではサイズを固定し、リセット時は芽に戻ります。

`tree-growing-v2.png` は完成したシンボルツリー、`flower-effort-v2.png` は花のまとまりと同じ画像です。旧JPEGは保管用として残しています。

HTTPサーバー経由で `docs/assets-preview.html` を開くと、素材一覧と背景色の切り替えで見た目を確認できます。

確認済み: `node tests/tree-growth.mjs`、`node tests/tree-rendering.mjs`、`node tests/forest-regression.mjs`。成長境界、描画での画像切り替え、リセット、既存の投稿・承認・購入・配置処理を確認しました。
