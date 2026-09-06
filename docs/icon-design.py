# -*- coding: utf-8 -*-
"""生成「日报助手」新图标：清新绿渐变圆角方块 + 白色日报文档 + 完成勾徽章 + 像素点缀。"""
import math
from PIL import Image, ImageDraw

S = 1024  # 画布
R = 220   # 背景圆角半径


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def rounded_gradient_bg(size, radius, top, bottom):
    """带对角渐变的圆角方块（透明四角）。"""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    grad = Image.new("RGBA", (size, size))
    px = grad.load()
    # 对角线渐变：左上 top -> 右下 bottom
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2 * size - 2)
            px[x, y] = lerp(top, bottom, t) + (255,)
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    img.paste(grad, (0, 0), mask)
    return img


def main():
    img = rounded_gradient_bg(S, R, (82, 227, 173), (5, 138, 102))  # emerald 400 -> 600
    d = ImageDraw.Draw(img)

    # ---- 像素点缀（实色小方块，呼应像素风 UI）----
    pixels = [
        (150, 170, 26, (167, 243, 208)),   # 浅绿
        (214, 250, 26, (110, 231, 183)),
        (838, 160, 30, (209, 250, 229)),   # 更浅
        (880, 236, 22, (167, 243, 208)),
        (842, 760, 26, (110, 231, 183)),
        (170, 806, 30, (209, 250, 229)),
    ]
    for x, y, s, c in pixels:
        d.rectangle([x, y, x + s, y + s], fill=c)

    # ---- 白色日报文档（左移上移一点，给徽章留位）----
    dx0, dy0, dx1, dy1 = 268, 200, 700, 824
    d.rounded_rectangle([dx0, dy0, dx1, dy1], radius=56, fill=(255, 255, 255, 244))
    # 折角效果：右上角小三角用背景色盖出 + 画个浅绿折页
    fold = 96
    d.polygon([(dx1 - fold, dy0), (dx1, dy0 + fold), (dx1 - fold, dy0 + fold)],
              fill=(16, 185, 129, 255))
    d.polygon([(dx1 - fold, dy0), (dx1, dy0 + fold), (dx1 - fold, dy0 + fold)],
              outline=None)
    # 文档标题条（绿色短条）
    d.rounded_rectangle([dx0 + 64, dy0 + 96, dx0 + 264, dy0 + 136], radius=20,
                        fill=(16, 185, 129, 255))
    # 正文行（灰色长条，最后一行短）
    line_y = [dy0 + 208, dy0 + 292, dy0 + 376]
    for i, y in enumerate(line_y):
        w = 300 if i < 2 else 190
        d.rounded_rectangle([dx0 + 64, y, dx0 + 64 + w, y + 30], radius=15,
                            fill=(209, 213, 219, 255))

    # ---- 完成勾徽章（右下角，压在文档上）----
    cx, cy, cr = 700, 748, 148
    # 徽章底（深绿圆 + 白描边）
    d.ellipse([cx - cr, cy - cr, cx + cr, cy + cr], fill=(4, 120, 87, 255))
    d.ellipse([cx - cr, cy - cr, cx + cr, cy + cr], outline=(255, 255, 255, 255), width=16)
    # 对勾（白色粗线，像素感：用折线段）
    check = [(cx - 62, cy + 2), (cx - 16, cy + 52), (cx + 72, cy - 48)]
    d.line(check, fill=(255, 255, 255, 255), width=34, joint="curve")
    # 圆头端点
    for p in (check[0], check[2]):
        r = 17
        d.ellipse([p[0] - r, p[1] - r, p[0] + r, p[1] + r], fill=(255, 255, 255, 255))

    img.save("icon-source.png")

    # ---- 导出各尺寸 ----
    img.resize((512, 512), Image.LANCZOS).save("icon-512.png")
    # avatar：同设计，方形（UI 内使用）
    img.resize((512, 512), Image.LANCZOS).save("avatar-new.png")
    print("icon-source.png / icon-512.png / avatar-new.png 生成完毕")


if __name__ == "__main__":
    main()
