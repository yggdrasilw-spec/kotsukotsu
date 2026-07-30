# map.json 設計

## ルール
- map全体は100×80マス
- 1マス = 112px
- 森はスクロール前提
- エリア、地形、イベント範囲を持つ
- 置き場所（スポット）の定義は持たない。スポットは常に `spots.json` が唯一の情報源

## 主な項目
- mapId
- name
- cellSize
- width
- height
- background
- view
- areas
- terrain
- eventZones
