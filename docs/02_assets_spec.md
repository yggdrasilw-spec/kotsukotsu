# assets.json 設計

## ルール
- IDは英数字と `_`
- 画像サイズと占有マスを分ける
- 大物は固定サイズ
- 小物は1マス内に複数配置可

## 112px基準の目安
- 木: 224×336 / 336×448 / 448×560
- 花: 64×64 / 112×112
- きのこ: 48×48 / 112×112
- 岩: 96×80 / 168×112 / 224×168
- 池: 560×448 以上
- 橋: 448×112 前後
- リス: 112×112
- 鳥: 64×64 / 96×96
- 魚: 32×32 / 56×56
- 木の実・虫: 16〜32px

## 主なフィールド
- id
- type
- name
- image
- imageWidth
- imageHeight
- gridWidth
- gridHeight
- anchor
- layer
- animation
- price
- unlock
- stackable
- decorative
- collision
- variants
- description
