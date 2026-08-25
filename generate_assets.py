"""
コツコツの森 - 高品質 透過PNGアセット一括生成スクリプト
Pillow (PIL) を用いて、絵本風のやわらかいトーン＆マナーで全アセットを透過PNG (RGBA) として出力します。
"""
import os
import math
from PIL import Image, ImageDraw

ASSETS_DIR = os.path.join(os.path.dirname(__file__), 'assets')
os.makedirs(ASSETS_DIR, exist_ok=True)

def create_transparent_img(width, height):
    return Image.new('RGBA', (width, height), (0, 0, 0, 0))

# ---- 地形・道 ----

def generate_grass():
    w, h = 112, 112
    img = create_transparent_img(w, h)
    draw = ImageDraw.Draw(img)
    # 地面ベース
    draw.rectangle([0, 0, w, h], fill=(189, 228, 154, 255))
    # 優しい草のテクスチャ
    grass_color = (150, 204, 105, 180)
    for (x, y, r) in [(20, 30, 8), (80, 40, 7), (40, 80, 9), (90, 85, 6), (30, 70, 5), (65, 25, 5)]:
        draw.ellipse([x-r, y-r, x+r, y+r], fill=grass_color)
    # クローバー風
    draw.ellipse([68, 62, 78, 72], fill=(126, 191, 73, 200))
    draw.ellipse([76, 62, 86, 72], fill=(126, 191, 73, 200))
    draw.ellipse([72, 56, 82, 66], fill=(126, 191, 73, 200))
    img.save(os.path.join(ASSETS_DIR, 'grass_01.png'), 'PNG')
    print("Created grass_01.png")

def generate_path():
    w, h = 112, 112
    img = create_transparent_img(w, h)
    draw = ImageDraw.Draw(img)
    draw.rectangle([0, 0, w, h], fill=(237, 217, 180, 255))
    pebble_color = (201, 171, 123, 160)
    for (x, y, rx, ry) in [(24, 36, 6, 4), (72, 22, 5, 3), (88, 68, 7, 5), (40, 80, 5, 4), (56, 48, 8, 5)]:
        draw.ellipse([x-rx, y-ry, x+rx, y+ry], fill=pebble_color)
    img.save(os.path.join(ASSETS_DIR, 'path_01.png'), 'PNG')
    print("Created path_01.png")

def generate_pond():
    w, h = 560, 448
    img = create_transparent_img(w, h)
    draw = ImageDraw.Draw(img)
    # 影と土手
    draw.ellipse([40, 40, 520, 408], fill=(185, 159, 115, 200))
    draw.ellipse([60, 60, 500, 388], fill=(157, 191, 103, 180))
    # 水面
    draw.ellipse([80, 80, 480, 368], fill=(88, 181, 214, 255))
    # 水面のハイライト・グラデーション
    draw.ellipse([100, 90, 440, 280], fill=(128, 208, 232, 220))
    # 波紋
    draw.arc([160, 150, 260, 190], start=180, end=360, fill=(255, 255, 255, 180), width=4)
    draw.arc([300, 200, 420, 240], start=180, end=360, fill=(255, 255, 255, 180), width=4)
    draw.arc([180, 260, 320, 310], start=180, end=360, fill=(255, 255, 255, 160), width=4)
    # 睡蓮
    draw.ellipse([140, 210, 180, 235], fill=(77, 155, 75, 255))
    draw.ellipse([155, 205, 170, 220], fill=(255, 180, 207, 255))
    draw.ellipse([370, 270, 415, 300], fill=(77, 155, 75, 255))
    draw.ellipse([385, 265, 400, 280], fill=(255, 255, 255, 255))
    img.save(os.path.join(ASSETS_DIR, 'pond_medium_01.png'), 'PNG')
    print("Created pond_medium_01.png")

def generate_bridge():
    w, h = 448, 112
    img = create_transparent_img(w, h)
    draw = ImageDraw.Draw(img)
    # 影
    draw.rectangle([20, 30, 428, 95], fill=(45, 61, 34, 80))
    # 板
    for x in range(25, 420, 35):
        draw.rounded_rectangle([x, 15, x+30, 97], radius=4, fill=(196, 154, 101, 255), outline=(102, 70, 28, 255), width=2)
    # 欄干
    draw.rounded_rectangle([10, 8, 438, 20], radius=5, fill=(171, 130, 78, 255), outline=(78, 51, 20, 255), width=2)
    draw.rounded_rectangle([10, 92, 438, 104], radius=5, fill=(171, 130, 78, 255), outline=(78, 51, 20, 255), width=2)
    # 柱
    for x in [30, 224, 418]:
        draw.ellipse([x-8, 6, x+8, 22], fill=(196, 154, 101, 255), outline=(78, 51, 20, 255), width=2)
        draw.ellipse([x-8, 90, x+8, 106], fill=(196, 154, 101, 255), outline=(78, 51, 20, 255), width=2)
    img.save(os.path.join(ASSETS_DIR, 'bridge_medium_01.png'), 'PNG')
    print("Created bridge_medium_01.png")

def generate_rocks():
    # 小岩
    img_s = create_transparent_img(96, 80)
    draw_s = ImageDraw.Draw(img_s)
    draw_s.ellipse([10, 60, 86, 75], fill=(45, 61, 34, 80))
    draw_s.chord([15, 18, 81, 72], start=0, end=360, fill=(141, 153, 158, 255), outline=(90, 100, 104, 255), width=2)
    draw_s.chord([25, 20, 70, 50], start=0, end=360, fill=(208, 215, 219, 180))
    draw_s.ellipse([24, 56, 36, 68], fill=(120, 171, 72, 220))
    img_s.save(os.path.join(ASSETS_DIR, 'rock_small_01.png'), 'PNG')
    
    # 中岩
    img_m = create_transparent_img(168, 112)
    draw_m = ImageDraw.Draw(img_m)
    draw_m.ellipse([15, 85, 153, 108], fill=(45, 61, 34, 80))
    draw_m.chord([20, 20, 148, 100], start=0, end=360, fill=(140, 151, 156, 255), outline=(85, 95, 100, 255), width=3)
    draw_m.chord([40, 25, 128, 65], start=0, end=360, fill=(220, 226, 230, 180))
    draw_m.ellipse([30, 78, 52, 92], fill=(109, 163, 61, 230))
    draw_m.ellipse([125, 75, 145, 90], fill=(109, 163, 61, 230))
    img_m.save(os.path.join(ASSETS_DIR, 'rock_medium_01.png'), 'PNG')
    print("Created rock_small_01.png, rock_medium_01.png")

def generate_stump():
    img = create_transparent_img(112, 112)
    draw = ImageDraw.Draw(img)
    draw.ellipse([15, 90, 97, 108], fill=(45, 61, 34, 80))
    draw.polygon([(20, 60), (14, 100), (98, 100), (92, 60)], fill=(120, 80, 40, 255))
    draw.ellipse([22, 42, 90, 78], fill=(212, 180, 121, 255), outline=(105, 68, 32, 255), width=3)
    draw.ellipse([32, 48, 80, 72], fill=None, outline=(158, 123, 68, 255), width=2)
    draw.ellipse([44, 54, 68, 66], fill=None, outline=(158, 123, 68, 255), width=2)
    # 若葉
    draw.ellipse([76, 35, 92, 48], fill=(117, 191, 57, 255))
    img.save(os.path.join(ASSETS_DIR, 'stump_01.png'), 'PNG')
    print("Created stump_01.png")

# ---- 木々 ----

def generate_tree_oak():
    w, h = 336, 448
    img = create_transparent_img(w, h)
    draw = ImageDraw.Draw(img)
    # 影
    draw.ellipse([78, 410, 258, 440], fill=(45, 61, 34, 80))
    # 幹
    draw.polygon([(145, 260), (135, 425), (201, 425), (191, 260)], fill=(110, 73, 37, 255))
    # 枝
    draw.line([(155, 300), (100, 230)], fill=(110, 73, 37, 255), width=16)
    draw.line([(181, 290), (236, 220)], fill=(110, 73, 37, 255), width=16)
    # 濃い葉（背面）
    draw.ellipse([40, 110, 180, 250], fill=(70, 135, 31, 255))
    draw.ellipse([156, 100, 306, 245], fill=(70, 135, 31, 255))
    draw.ellipse([98, 40, 238, 180], fill=(70, 135, 31, 255))
    # 明るいもこもこ葉（前面）
    draw.ellipse([65, 155, 195, 285], fill=(108, 184, 57, 255))
    draw.ellipse([145, 145, 275, 275], fill=(108, 184, 57, 255))
    draw.ellipse([25, 90, 145, 210], fill=(154, 217, 89, 255))
    draw.ellipse([190, 80, 310, 200], fill=(154, 217, 89, 255))
    draw.ellipse([93, 65, 243, 215], fill=(154, 217, 89, 255))
    draw.ellipse([108, 20, 228, 140], fill=(154, 217, 89, 255))
    # どんぐり
    for (x, y) in [(110, 200), (210, 160), (150, 90)]:
        draw.ellipse([x-6, y-8, x+6, y+8], fill=(166, 116, 56, 255))
        draw.chord([x-7, y-10, x+7, y-2], start=180, end=360, fill=(99, 65, 27, 255))
    img.save(os.path.join(ASSETS_DIR, 'tree_oak_01.png'), 'PNG')
    print("Created tree_oak_01.png")

def generate_tree_birch():
    w, h = 224, 336
    img = create_transparent_img(w, h)
    draw = ImageDraw.Draw(img)
    draw.ellipse([57, 310, 167, 332], fill=(45, 61, 34, 80))
    # 白い幹
    draw.polygon([(102, 160), (96, 320), (128, 320), (122, 160)], fill=(245, 245, 240, 255), outline=(180, 180, 175, 255), width=2)
    # 黒い筋
    for y in [280, 230, 180]:
        draw.line([(100, y), (124, y-2)], fill=(64, 60, 57, 255), width=3)
    # 爽やかな葉
    draw.ellipse([35, 95, 125, 185], fill=(158, 219, 77, 255))
    draw.ellipse([99, 90, 189, 180], fill=(158, 219, 77, 255))
    draw.ellipse([57, 35, 167, 145], fill=(203, 240, 120, 255))
    draw.ellipse([77, 10, 147, 80], fill=(203, 240, 120, 255))
    img.save(os.path.join(ASSETS_DIR, 'tree_birch_01.png'), 'PNG')
    print("Created tree_birch_01.png")

def generate_tree_pine():
    w, h = 448, 560
    img = create_transparent_img(w, h)
    draw = ImageDraw.Draw(img)
    draw.ellipse([104, 520, 344, 555], fill=(45, 61, 34, 80))
    # 幹
    draw.polygon([(206, 380), (194, 535), (254, 535), (242, 380)], fill=(84, 55, 28, 255))
    # 段々の針葉
    draw.polygon([(224, 280), (50, 450), (398, 450)], fill=(28, 69, 31, 255))
    draw.polygon([(224, 180), (80, 340), (368, 340)], fill=(35, 82, 37, 255))
    draw.polygon([(224, 80), (110, 230), (338, 230)], fill=(55, 120, 55, 255))
    draw.polygon([(224, 15), (140, 120), (308, 120)], fill=(75, 150, 75, 255))
    img.save(os.path.join(ASSETS_DIR, 'tree_pine_01.png'), 'PNG')
    print("Created tree_pine_01.png")

def generate_tree_symbol():
    w, h = 112, 112
    img = create_transparent_img(w, h)
    draw = ImageDraw.Draw(img)
    # 聖なる光
    draw.ellipse([8, 0, 104, 96], fill=(255, 240, 150, 120))
    draw.ellipse([26, 100, 86, 110], fill=(45, 61, 34, 80))
    # 幹
    draw.polygon([(50, 60), (45, 105), (67, 105), (62, 60)], fill=(128, 86, 46, 255))
    # 豊かな葉
    draw.ellipse([14, 26, 58, 70], fill=(77, 158, 30, 255))
    draw.ellipse([54, 24, 98, 68], fill=(77, 158, 30, 255))
    draw.ellipse([30, 6, 82, 58], fill=(124, 209, 56, 255))
    draw.ellipse([36, 32, 76, 72], fill=(189, 245, 110, 255))
    # 花とお星さま
    for (x, y, color) in [(42, 38, (255, 125, 167, 255)), (70, 35, (255, 180, 67, 255)), (54, 22, (255, 125, 167, 255))]:
        draw.ellipse([x-4, y-4, x+4, y+4], fill=color)
        draw.ellipse([x-1, y-1, x+1, y+1], fill=(255, 255, 255, 255))
    # 頂点のきら星
    draw.polygon([(56, 2), (59, 10), (67, 10), (60, 15), (63, 23), (56, 18), (49, 23), (52, 15), (45, 10), (53, 10)], fill=(255, 235, 100, 255))
    img.save(os.path.join(ASSETS_DIR, 'tree_symbol_01.png'), 'PNG')
    print("Created tree_symbol_01.png")

# ---- 花・きのこ ----

def generate_flowers():
    # 小花
    img_s = create_transparent_img(64, 64)
    draw_s = ImageDraw.Draw(img_s)
    draw_s.line([(32, 60), (32, 32)], fill=(93, 163, 53, 255), width=3)
    draw_s.ellipse([18, 42, 28, 48], fill=(117, 191, 57, 255))
    draw_s.ellipse([36, 38, 46, 44], fill=(117, 191, 57, 255))
    # 花びら
    for angle in range(0, 360, 72):
        rad = math.radians(angle)
        px = 32 + int(10 * math.cos(rad))
        py = 28 + int(10 * math.sin(rad))
        draw_s.ellipse([px-7, py-7, px+7, py+7], fill=(255, 158, 194, 255))
    draw_s.ellipse([26, 22, 38, 34], fill=(255, 216, 77, 255))
    img_s.save(os.path.join(ASSETS_DIR, 'flower_small_01.png'), 'PNG')

    # 花のかたまり
    img_p = create_transparent_img(112, 112)
    draw_p = ImageDraw.Draw(img_p)
    draw_p.ellipse([14, 78, 98, 104], fill=(103, 166, 53, 180))
    # 花1 (オレンジ)
    for a in range(0, 360, 72):
        r = math.radians(a)
        draw_p.ellipse([30+int(8*math.cos(r))-6, 65+int(8*math.sin(r))-6, 30+int(8*math.cos(r))+6, 65+int(8*math.sin(r))+6], fill=(255, 162, 67, 255))
    draw_p.ellipse([26, 61, 34, 69], fill=(255, 224, 102, 255))
    # 花2 (ピンク大)
    for a in range(0, 360, 72):
        r = math.radians(a)
        draw_p.ellipse([56+int(10*math.cos(r))-7, 45+int(10*math.sin(r))-7, 56+int(10*math.cos(r))+7, 45+int(10*math.sin(r))+7], fill=(255, 125, 167, 255))
    draw_p.ellipse([51, 40, 61, 50], fill=(255, 241, 118, 255))
    # 花3 (水色)
    for a in range(0, 360, 72):
        r = math.radians(a)
        draw_p.ellipse([82+int(8*math.cos(r))-6, 68+int(8*math.sin(r))-6, 82+int(8*math.cos(r))+6, 68+int(8*math.sin(r))+6], fill=(117, 204, 240, 255))
    draw_p.ellipse([78, 64, 86, 72], fill=(255, 245, 157, 255))
    img_p.save(os.path.join(ASSETS_DIR, 'flower_patch_01.png'), 'PNG')
    print("Created flower_small_01.png, flower_patch_01.png")

def generate_mushrooms():
    # 小きのこ
    img_s = create_transparent_img(48, 48)
    draw_s = ImageDraw.Draw(img_s)
    draw_s.ellipse([8, 42, 40, 48], fill=(45, 61, 34, 80))
    draw_s.polygon([(20, 20), (18, 44), (30, 44), (28, 20)], fill=(245, 238, 220, 255))
    draw_s.chord([6, 8, 42, 34], start=180, end=360, fill=(235, 77, 75, 255))
    draw_s.ellipse([21, 14, 27, 20], fill=(255, 255, 255, 255))
    draw_s.ellipse([12, 19, 16, 23], fill=(255, 255, 255, 255))
    draw_s.ellipse([32, 19, 36, 23], fill=(255, 255, 255, 255))
    img_s.save(os.path.join(ASSETS_DIR, 'mushroom_small_01.png'), 'PNG')

    # きのこの群れ
    img_p = create_transparent_img(112, 112)
    draw_p = ImageDraw.Draw(img_p)
    draw_p.ellipse([14, 94, 98, 108], fill=(45, 61, 34, 80))
    # 茶きのこ
    draw_p.polygon([(32, 60), (30, 95), (42, 95), (40, 60)], fill=(242, 232, 211, 255))
    draw_p.chord([20, 42, 54, 76], start=180, end=360, fill=(176, 125, 70, 255))
    # 赤大きのこ
    draw_p.polygon([(52, 45), (48, 98), (68, 98), (64, 45)], fill=(247, 242, 228, 255))
    draw_p.chord([34, 18, 82, 66], start=180, end=360, fill=(235, 77, 75, 255))
    draw_p.ellipse([54, 26, 62, 34], fill=(255, 255, 255, 255))
    draw_p.ellipse([42, 34, 48, 40], fill=(255, 255, 255, 255))
    draw_p.ellipse([68, 34, 74, 40], fill=(255, 255, 255, 255))
    # 黄きのこ
    draw_p.polygon([(76, 65), (75, 96), (85, 96), (84, 65)], fill=(242, 232, 211, 255))
    draw_p.chord([66, 50, 94, 78], start=180, end=360, fill=(240, 180, 41, 255))
    img_p.save(os.path.join(ASSETS_DIR, 'mushroom_patch_01.png'), 'PNG')
    print("Created mushroom_small_01.png, mushroom_patch_01.png")

# ---- 森のいきもの ----

def generate_squirrel():
    w, h = 112, 112
    img = create_transparent_img(w, h)
    draw = ImageDraw.Draw(img)
    draw.ellipse([26, 98, 86, 110], fill=(45, 61, 34, 80))
    # ふわふわしっぽ
    draw.chord([10, 15, 65, 90], start=45, end=315, fill=(230, 138, 60, 255))
    draw.chord([20, 25, 55, 80], start=45, end=315, fill=(247, 185, 124, 255))
    # 体
    draw.ellipse([38, 52, 78, 100], fill=(230, 138, 60, 255))
    draw.ellipse([52, 62, 76, 94], fill=(255, 245, 234, 255))
    # 頭と耳
    draw.ellipse([50, 28, 86, 64], fill=(230, 138, 60, 255))
    draw.ellipse([52, 18, 64, 34], fill=(230, 138, 60, 255))
    draw.ellipse([68, 18, 80, 34], fill=(230, 138, 60, 255))
    # 目・鼻・ほっぺ
    draw.ellipse([70, 40, 78, 48], fill=(38, 27, 20, 255))
    draw.ellipse([73, 42, 76, 45], fill=(255, 255, 255, 255))
    draw.ellipse([82, 46, 86, 50], fill=(38, 27, 20, 255))
    draw.ellipse([64, 48, 72, 54], fill=(255, 153, 153, 160))
    # どんぐりを持つ手
    draw.ellipse([72, 64, 84, 74], fill=(166, 116, 56, 255))
    img.save(os.path.join(ASSETS_DIR, 'squirrel_01.png'), 'PNG')
    print("Created squirrel_01.png")

def generate_rabbit():
    w, h = 128, 128
    img = create_transparent_img(w, h)
    draw = ImageDraw.Draw(img)
    draw.ellipse([29, 110, 99, 124], fill=(45, 61, 34, 80))
    # しっぽ
    draw.ellipse([19, 86, 37, 104], fill=(245, 242, 235, 255))
    # 体
    draw.ellipse([32, 64, 84, 112], fill=(255, 255, 255, 255))
    # ながーい耳
    draw.ellipse([56, 8, 72, 56], fill=(255, 255, 255, 255))
    draw.ellipse([60, 14, 68, 50], fill=(255, 180, 207, 255))
    draw.ellipse([72, 8, 88, 56], fill=(255, 255, 255, 255))
    draw.ellipse([76, 14, 84, 50], fill=(255, 180, 207, 255))
    # 頭
    draw.ellipse([52, 34, 96, 78], fill=(255, 255, 255, 255))
    # 目・鼻・ほっぺ
    draw.ellipse([78, 50, 86, 58], fill=(56, 40, 33, 255))
    draw.ellipse([81, 52, 84, 55], fill=(255, 255, 255, 255))
    draw.ellipse([92, 54, 96, 58], fill=(255, 141, 161, 255))
    draw.ellipse([72, 58, 80, 64], fill=(255, 153, 179, 160))
    img.save(os.path.join(ASSETS_DIR, 'rabbit_01.png'), 'PNG')
    print("Created rabbit_01.png")

def generate_birds_and_others():
    # 小鳥
    img_b = create_transparent_img(64, 64)
    draw_b = ImageDraw.Draw(img_b)
    draw_b.ellipse([14, 16, 50, 48], fill=(117, 204, 240, 255))
    draw_b.ellipse([26, 26, 48, 46], fill=(255, 245, 200, 255))
    draw_b.polygon([(48, 28), (58, 32), (48, 36)], fill=(255, 180, 50, 255))
    draw_b.ellipse([38, 24, 44, 30], fill=(30, 30, 30, 255))
    draw_b.ellipse([40, 25, 42, 27], fill=(255, 255, 255, 255))
    img_b.save(os.path.join(ASSETS_DIR, 'bird_small_01.png'), 'PNG')

    # 小魚
    img_f = create_transparent_img(32, 32)
    draw_f = ImageDraw.Draw(img_f)
    draw_f.polygon([(6, 16), (0, 8), (0, 24)], fill=(255, 130, 100, 255))
    draw_f.ellipse([4, 8, 28, 24], fill=(255, 130, 100, 255))
    draw_f.ellipse([22, 12, 26, 16], fill=(30, 30, 30, 255))
    img_f.save(os.path.join(ASSETS_DIR, 'fish_small_01.png'), 'PNG')

    # カエル
    img_fr = create_transparent_img(72, 72)
    draw_fr = ImageDraw.Draw(img_fr)
    draw_fr.ellipse([14, 20, 58, 56], fill=(120, 195, 60, 255))
    draw_fr.ellipse([16, 10, 30, 24], fill=(120, 195, 60, 255))
    draw_fr.ellipse([42, 10, 56, 24], fill=(120, 195, 60, 255))
    draw_fr.ellipse([20, 14, 26, 20], fill=(20, 20, 20, 255))
    draw_fr.ellipse([46, 14, 52, 20], fill=(20, 20, 20, 255))
    draw_fr.ellipse([24, 34, 48, 52], fill=(240, 250, 180, 255))
    img_fr.save(os.path.join(ASSETS_DIR, 'frog_01.png'), 'PNG')

    # ちょうちょ
    img_bt = create_transparent_img(48, 48)
    draw_bt = ImageDraw.Draw(img_bt)
    draw_bt.ellipse([4, 6, 24, 26], fill=(255, 200, 80, 220))
    draw_bt.ellipse([24, 6, 44, 26], fill=(255, 200, 80, 220))
    draw_bt.ellipse([8, 22, 22, 38], fill=(255, 160, 60, 220))
    draw_bt.ellipse([26, 22, 40, 38], fill=(255, 160, 60, 220))
    draw_bt.ellipse([22, 10, 26, 36], fill=(60, 40, 20, 255))
    img_bt.save(os.path.join(ASSETS_DIR, 'butterfly_01.png'), 'PNG')

    # みつばち
    img_be = create_transparent_img(48, 48)
    draw_be = ImageDraw.Draw(img_be)
    draw_be.ellipse([10, 14, 38, 34], fill=(255, 215, 0, 255))
    draw_be.line([(20, 16), (20, 32)], fill=(40, 30, 20, 255), width=3)
    draw_be.line([(28, 16), (28, 32)], fill=(40, 30, 20, 255), width=3)
    draw_be.ellipse([16, 4, 28, 18], fill=(200, 240, 255, 180))
    draw_be.ellipse([24, 4, 36, 18], fill=(200, 240, 255, 180))
    img_be.save(os.path.join(ASSETS_DIR, 'bee_01.png'), 'PNG')

    # とんぼ
    img_df = create_transparent_img(48, 48)
    draw_df = ImageDraw.Draw(img_df)
    draw_df.line([(24, 10), (24, 42)], fill=(220, 50, 40, 255), width=4)
    draw_df.ellipse([20, 6, 28, 14], fill=(220, 50, 40, 255))
    draw_df.ellipse([4, 14, 44, 22], fill=(200, 240, 255, 160))
    img_df.save(os.path.join(ASSETS_DIR, 'dragonfly_01.png'), 'PNG')

    print("Created birds, fish, frog, insects")

# ---- 木の実・エフェクト・家具 ----

def generate_items_and_effects():
    # どんぐり
    img_ac = create_transparent_img(24, 24)
    draw_ac = ImageDraw.Draw(img_ac)
    draw_ac.ellipse([4, 6, 20, 22], fill=(166, 116, 56, 255))
    draw_ac.chord([3, 4, 21, 14], start=180, end=360, fill=(99, 65, 27, 255))
    img_ac.save(os.path.join(ASSETS_DIR, 'acorn_01.png'), 'PNG')

    # 木の実 (いちご)
    img_br = create_transparent_img(20, 20)
    draw_br = ImageDraw.Draw(img_br)
    draw_br.polygon([(10, 18), (3, 7), (17, 7)], fill=(235, 60, 75, 255))
    draw_br.ellipse([3, 5, 17, 10], fill=(235, 60, 75, 255))
    draw_br.ellipse([7, 2, 13, 6], fill=(70, 150, 40, 255))
    img_br.save(os.path.join(ASSETS_DIR, 'berry_01.png'), 'PNG')

    # まつぼっくり
    img_pc = create_transparent_img(24, 24)
    draw_pc = ImageDraw.Draw(img_pc)
    draw_pc.ellipse([4, 4, 20, 22], fill=(110, 70, 35, 255))
    for y in [8, 12, 16]:
        draw_pc.line([(6, y), (18, y)], fill=(140, 95, 50, 255), width=2)
    img_pc.save(os.path.join(ASSETS_DIR, 'pinecone_01.png'), 'PNG')

    # 葉っぱ
    img_lf = create_transparent_img(40, 40)
    draw_lf = ImageDraw.Draw(img_lf)
    draw_lf.chord([6, 6, 34, 34], start=30, end=210, fill=(130, 205, 70, 255))
    draw_lf.chord([6, 6, 34, 34], start=210, end=390, fill=(100, 180, 50, 255))
    img_lf.save(os.path.join(ASSETS_DIR, 'leaf_01.png'), 'PNG')

    # きらめき
    img_sp = create_transparent_img(32, 32)
    draw_sp = ImageDraw.Draw(img_sp)
    draw_sp.polygon([(16, 2), (18, 14), (30, 16), (18, 18), (16, 30), (14, 18), (2, 16), (14, 14)], fill=(255, 235, 100, 255))
    img_sp.save(os.path.join(ASSETS_DIR, 'sparkle_small_01.png'), 'PNG')

    # 光
    img_gl = create_transparent_img(112, 112)
    draw_gl = ImageDraw.Draw(img_gl)
    draw_gl.ellipse([10, 10, 102, 102], fill=(255, 250, 180, 140))
    draw_gl.ellipse([30, 30, 82, 82], fill=(255, 255, 220, 200))
    img_gl.save(os.path.join(ASSETS_DIR, 'glow_01.png'), 'PNG')

    # 虹
    img_rb = create_transparent_img(896, 448)
    draw_rb = ImageDraw.Draw(img_rb)
    colors = [
        (255, 100, 100, 180),
        (255, 175, 80, 180),
        (255, 235, 80, 180),
        (120, 220, 120, 180),
        (100, 190, 255, 180),
        (140, 120, 240, 180)
    ]
    for i, col in enumerate(colors):
        r_out = 430 - i * 16
        draw_rb.arc([448-r_out, 440-r_out, 448+r_out, 440+r_out], start=180, end=360, fill=col, width=16)
    img_rb.save(os.path.join(ASSETS_DIR, 'rainbow_01.png'), 'PNG')

    # ベンチ
    img_bn = create_transparent_img(112, 112)
    draw_bn = ImageDraw.Draw(img_bn)
    draw_bn.ellipse([16, 92, 96, 106], fill=(45, 61, 34, 80))
    draw_bn.rectangle([20, 50, 92, 60], fill=(160, 115, 70, 255), outline=(90, 60, 30, 255), width=2)
    draw_bn.rectangle([20, 66, 92, 76], fill=(160, 115, 70, 255), outline=(90, 60, 30, 255), width=2)
    draw_bn.line([(26, 60), (26, 96)], fill=(80, 80, 80, 255), width=4)
    draw_bn.line([(86, 60), (86, 96)], fill=(80, 80, 80, 255), width=4)
    img_bn.save(os.path.join(ASSETS_DIR, 'bench_01.png'), 'PNG')

    # ランタン
    img_lt = create_transparent_img(64, 64)
    draw_lt = ImageDraw.Draw(img_lt)
    draw_lt.ellipse([12, 12, 52, 52], fill=(255, 230, 130, 120))
    draw_lt.rectangle([22, 22, 42, 46], fill=(255, 245, 180, 255), outline=(80, 60, 40, 255), width=2)
    draw_lt.polygon([(20, 22), (32, 12), (44, 22)], fill=(80, 60, 40, 255))
    draw_lt.line([(32, 12), (32, 4)], fill=(120, 100, 70, 255), width=2)
    img_lt.save(os.path.join(ASSETS_DIR, 'lantern_01.png'), 'PNG')

    # たき火
    img_cf = create_transparent_img(112, 112)
    draw_cf = ImageDraw.Draw(img_cf)
    draw_cf.ellipse([26, 88, 86, 104], fill=(45, 61, 34, 80))
    draw_cf.line([(30, 92), (82, 82)], fill=(100, 65, 35, 255), width=8)
    draw_cf.line([(30, 82), (82, 92)], fill=(100, 65, 35, 255), width=8)
    draw_cf.polygon([(56, 35), (38, 85), (74, 85)], fill=(255, 80, 40, 240))
    draw_cf.polygon([(56, 50), (46, 85), (66, 85)], fill=(255, 200, 50, 255))
    img_cf.save(os.path.join(ASSETS_DIR, 'campfire_01.png'), 'PNG')

    print("Created items, effects, furniture")

if __name__ == '__main__':
    generate_grass()
    generate_path()
    generate_pond()
    generate_bridge()
    generate_rocks()
    generate_stump()
    generate_tree_oak()
    generate_tree_birch()
    generate_tree_pine()
    generate_tree_symbol()
    generate_flowers()
    generate_mushrooms()
    generate_squirrel()
    generate_rabbit()
    generate_birds_and_others()
    generate_items_and_effects()
    print("ALL PNG ASSETS GENERATED SUCCESSFULLY!")
