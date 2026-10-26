#!/usr/bin/env python3
"""生成图片贴纸包 assets/stickers/*.png（可复现）。

设计：圆角卡片 + 柔和渐变底 + 大号颜文字/大字 + 中文说明。
- 不依赖外部素材，纯 Pillow 绘制，MIT 可用
- 输出 128x128 PNG，供 tools/build.mjs 内联进客户端 bundle
"""
from __future__ import annotations

import json
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "stickers")

SIZE = 128
PAD = 8

# 柔和双色底（深 → 浅）
PALETTES = [
    ((255, 214, 165), (255, 245, 225)),  # 奶油橙
    ((255, 190, 205), (255, 240, 244)),  # 樱花粉
    ((186, 224, 255), (238, 248, 255)),  # 天空蓝
    ((197, 235, 205), (240, 252, 244)),  # 薄荷绿
    ((226, 205, 255), (247, 240, 255)),  # 薰衣草
    ((255, 236, 170), (255, 251, 230)),  # 柠檬黄
]

KAOMOJI = [
    ("(＾▽＾)", "开心"),
    ("(´,,•ω•,,)", "可爱"),
    ("(＾ω＾)", "加油"),
    ("(╥﹏╥)", "委屈"),
    ("(￣▽￣)", "得意"),
    ("(⊙_⊙)", "震惊"),
    ("(￣ ￣|||)", "无语"),
    ("(づ￣ ³￣)づ", "贴贴"),
    ("(￣ー￣)", "谢谢"),
    ("(˘ω˘)", "晚安"),
    ("(＃`Д´)", "生气"),
    ("(´• ω •`)", "委屈"),
    ("(≧▽≦)", "好耶"),
    ("(￣ω￣;)", "尴尬"),
    ("(☆▽☆)", "星星眼"),
    ("(´；ω；`)", "想哭"),
    ("(＠_＠)", "蹦跳"),
    ("(¬_¬)", "怀疑"),
]

TEXTS = [
    ("好耶！", (255, 214, 165)),
    ("收到！", (186, 224, 255)),
    ("在的～", (197, 235, 205)),
    ("贴贴", (255, 190, 205)),
    ("太强了", (226, 205, 255)),
    ("摸鱼中", (255, 236, 170)),
    ("冲鸭！", (255, 214, 165)),
    ("抱抱", (255, 190, 205)),
    ("晚安", (186, 224, 255)),
    ("早安", (255, 236, 170)),
    ("awsl", (255, 190, 205)),
    ("绝了", (197, 235, 205)),
    ("救命", (255, 214, 165)),
    ("？？？", (226, 205, 255)),
    ("好家伙", (186, 224, 255)),
    ("谢谢", (197, 235, 205)),
    ("辛苦了", (255, 236, 170)),
    ("我悟了", (226, 205, 255)),
]


def find_font(candidates: list[str], size: int) -> ImageFont.FreeTypeFont:
    for path in candidates:
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


FONT_CN = [
    r"C:\Windows\Fonts\msyhbd.ttc",
    r"C:\Windows\Fonts\msyh.ttc",
    r"C:\Windows\Fonts\simhei.ttf",
]
FONT_MONO = [
    r"C:\Windows\Fonts\msyh.ttc",
    r"C:\Windows\Fonts\simhei.ttf",
    r"C:\Windows\Fonts\seguisym.ttf",
]


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def rounded_card(bg_from, bg_to):
    """圆角渐变卡片（白底合成，避免透明角变黑）。返回 (结果图, draw)。"""
    gradient = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    gdraw = ImageDraw.Draw(gradient)
    for y in range(SIZE):
        color = lerp(bg_from, bg_to, y / (SIZE - 1))
        gdraw.line([(0, y), (SIZE, y)], fill=color + (255,))
    mask = Image.new("L", (SIZE, SIZE), 0)
    mdraw = ImageDraw.Draw(mask)
    mdraw.rounded_rectangle([0, 0, SIZE - 1, SIZE - 1], radius=24, fill=255)
    out = Image.new("RGBA", (SIZE, SIZE), (255, 255, 255, 255))
    out.paste(gradient, (0, 0), mask)
    return out, ImageDraw.Draw(out)


def fit_font(text, paths, start, minimum, max_width):
    size = start
    while size > minimum:
        font = find_font(paths, size)
        if font.getlength(text) <= max_width:
            return font
        size -= 1
    return find_font(paths, minimum)


def draw_centered(draw, box, text, font, fill):
    left, top, right, bottom = box
    bbox = draw.textbbox((0, 0), text, font=font)
    w = bbox[2] - bbox[0]
    h = bbox[3] - bbox[1]
    x = left + (right - left - w) / 2 - bbox[0]
    y = top + (bottom - top - h) / 2 - bbox[1]
    draw.text((x, y), text, font=font, fill=fill)


def make_kaomoji(index, text, caption, palette):
    bg_from, bg_to = palette
    img, draw = rounded_card(bg_from, bg_to)
    font_main = fit_font(text, FONT_MONO, 30, 12, SIZE - PAD * 5)
    draw_centered(draw, (PAD, 18, SIZE - PAD, SIZE - 38), text, font_main, (58, 44, 34))
    font_cap = find_font(FONT_CN, 17)
    draw_centered(draw, (PAD, SIZE - 38, SIZE - PAD, SIZE - 10), caption, font_cap, (96, 70, 52))
    return img


def make_text(index, text, palette):
    bg_from, _ = palette
    img, draw = rounded_card(bg_from, (255, 252, 245))
    font_main = fit_font(text, FONT_CN, 34, 16, SIZE - PAD * 5)
    draw_centered(draw, (PAD, 14, SIZE - PAD, SIZE - 14), text, font_main, (52, 40, 30))
    return img


def main():
    os.makedirs(OUT, exist_ok=True)
    manifest = []
    idx = 0
    for i, (text, caption) in enumerate(KAOMOJI):
        idx += 1
        img = make_kaomoji(idx, text, caption, PALETTES[i % len(PALETTES)])
        name = f"sticker-{idx:02d}.png"
        img.convert("RGB").save(os.path.join(OUT, name), optimize=True, colors=64)
        manifest.append({"id": name[:-4], "group": "颜文字", "caption": caption, "file": name})
    for i, (text, bg) in enumerate(TEXTS):
        idx += 1
        img = make_text(idx, text, (bg, (255, 252, 245)))
        name = f"sticker-{idx:02d}.png"
        img.convert("RGB").save(os.path.join(OUT, name), optimize=True, colors=64)
        manifest.append({"id": name[:-4], "group": "文字", "caption": text, "file": name})
    print(f"[stickers] {len(manifest)} 张 → {OUT}")
    total = sum(os.path.getsize(os.path.join(OUT, m["file"])) for m in manifest)
    print(f"[stickers] 合计 {total / 1024:.1f} KB")
    with open(os.path.join(OUT, "manifest.json"), "w", encoding="utf-8") as handle:
        json.dump(manifest, handle, ensure_ascii=False, indent=2)
    print("[stickers] manifest.json 已写入")


if __name__ == "__main__":
    main()
