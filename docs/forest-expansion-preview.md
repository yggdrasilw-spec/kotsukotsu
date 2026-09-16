# 広がる森：動きの試作

## 本体への組み込み（2026-09-16）

`index.html` に `forest-expansion.js` を接続。固定背景を除去し、既存の `forestWorld` の中へ水彩草地・道・石・SVGの霧を配置した。

- 開放範囲は `core.getProgressPercent()` から算出。クラスの目標ポイントに対する割合で広がり、同じポイントなら同じ範囲になる。
- 霧の変化は900msで補間。「しずかに」または動きを減らす設定では即時反映。
- カメラは開放範囲と余白の内側に制限。全体表示は既存配置を含めた範囲に合わせる。
- 既存の手動配置の座標・保存データは維持し、その周辺も開放して引き続きアクセスできるようにした。
- 花とシンボルツリーの成長は既存のポイント連携を維持。
- 新規配置は霧の内側の明瞭な草地だけに制限。配置スポットへ寄せた後も再検証。ドラッグ購入は未開放の場所へのドロップ時に購入前に停止する。
- 本体の初期表示・ズーム・ドラッグをブラウザーで確認。`forest-expansion.mjs` と既存の3テストを通過。クラウドへの公開は未実施。

入口: `forest-expansion-preview.html`。ローカルHTTPサーバーから開く。

- 2800 × 2200 の共通座標に地面・道・木・花・霧を描画。
- ミラー反復した水彩草地に淡い色を重ねる。草地の反復感は今後の絵合わせ対象。
- 0〜100 の仮の成長量で霧を徐々に後退させる。実際のポイント・記録・保存とは未接続。
- ドラッグ、ホイール、2点ピンチ、拡大縮小ボタン、中心へ戻る、全体表示。
- 既存の木と花は仮素材。斜め上視点に合わせた素材、木立・石などの構図、最終的な霧の質感は次の調整対象。
- 画像を差し替える比較ではなく、既存の配置を維持したまま開放範囲を変える。

## 道と石の調整

- `forest-preview-landscape.js` に連続した曲線の道を定義。幅のゆらぎ、土の粒、縁の草、小石を固定シードで描画する。
- 既存 `path_01.png` は独立した装飾付きの道の絵で、接続用タイルではないため連結には使わない。色と草・小石の表現を参考にした。
- 既存 `rock_medium_01.png` と `rock_small_01.png` を再利用。苔色の薄い地面と花を添え、霧の後退で先の石が現れる。
- 成長する花は道の中心から55ワールド単位以内を避ける。
- ブラウザーで初期状態・成長100・拡大表示を確認。JavaScript構文と差分の空白チェックを実施。

## 新規素材

`assets/grass-watercolor-v3.png`。組み込み image_gen で生成。

### 生成プロンプト

Use case: stylized-concept. Asset: seamless repeating square ground texture for watercolor children's cooperative forest map. Warm pale yellow-green meadow, delicate watercolor paper grain, mossy soft variations, very sparse tiny grass strokes and miniature white wildflowers. Elevated overhead view of flat ground only. Entire image filled edge to edge with evenly lit grass. Seamless tileable edges on all four sides, uniform scale and illumination, low contrast, no central composition or vignette. Match warm Japanese botanical storybook illustration with translucent paint and subtle pencil detail. NO trees, shrubs, rocks, path, fog, sky, horizon, text, border, shadows from unseen trees or transparency. Most of surface quiet and open to overlay separate game objects.
