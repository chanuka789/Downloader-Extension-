"""Creates original demo photos (procedural landscapes) for store screenshots. No third-party content."""
import math, os, random, sys
from PIL import Image, ImageDraw, ImageFilter

out = sys.argv[1]; os.makedirs(out, exist_ok=True)

def lerp(a, b, t): return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))

def landscape(name, w, h, sky_top, sky_bottom, sun, layers, seed, moon=False):
    random.seed(seed)
    img = Image.new('RGB', (w, h))
    d = ImageDraw.Draw(img)
    for y in range(h):
        d.line([(0, y), (w, y)], fill=lerp(sky_top, sky_bottom, y / h))
    # sun / moon with glow
    glow = Image.new('RGB', (w, h), (0, 0, 0))
    gd = ImageDraw.Draw(glow)
    sx, sy, sr = int(w * sun[0]), int(h * sun[1]), int(min(w, h) * sun[2])
    gd.ellipse([sx - sr * 3, sy - sr * 3, sx + sr * 3, sy + sr * 3], fill=sun[3])
    glow = glow.filter(ImageFilter.GaussianBlur(sr * 1.6))
    img = Image.blend(img, Image.composite(glow, img, glow.convert('L')), 0.55)
    d = ImageDraw.Draw(img)
    d.ellipse([sx - sr, sy - sr, sx + sr, sy + sr], fill=(255, 250, 235) if not moon else (240, 240, 255))
    # stars
    if moon:
        for _ in range(int(w * h / 9000)):
            x, y = random.randint(0, w), random.randint(0, int(h * 0.6))
            r = random.choice([1, 1, 2])
            d.ellipse([x, y, x + r, y + r], fill=(255, 255, 255))
    # mountain / hill layers
    for i, (color, base, amp, rough) in enumerate(layers):
        pts = [(0, h)]
        x = 0
        y0 = h * base
        phase = random.random() * 10
        while x <= w + 20:
            y = y0 - amp * h * (0.55 * math.sin(x / w * rough + phase) + 0.3 * math.sin(x / w * rough * 2.7 + phase * 2) + 0.15 * random.random())
            pts.append((x, y)); x += max(4, w // 160)
        pts.append((w, h))
        d.polygon(pts, fill=color)
    # light haze
    img = img.filter(ImageFilter.SMOOTH_MORE)
    img.save(os.path.join(out, name), quality=92)

landscape('alpine-lake-4k.jpg', 3840, 2160, (32, 64, 140), (250, 170, 120), (0.7, 0.42, 0.05, (255, 190, 120)),
          [((96, 86, 140), 0.62, 0.22, 9), ((60, 58, 110), 0.72, 0.16, 13), ((36, 40, 80), 0.84, 0.10, 7), ((22, 30, 55), 0.95, 0.05, 5)], 1)
landscape('desert-dunes.jpg', 2400, 1600, (255, 140, 90), (255, 214, 150), (0.3, 0.38, 0.07, (255, 220, 160)),
          [((214, 120, 80), 0.7, 0.12, 5), ((190, 96, 64), 0.82, 0.1, 4), ((150, 70, 50), 0.95, 0.07, 3)], 2)
landscape('northern-night.jpg', 1920, 1080, (8, 12, 40), (40, 90, 120), (0.8, 0.22, 0.04, (120, 200, 255)),
          [((20, 40, 60), 0.68, 0.2, 11), ((12, 26, 42), 0.82, 0.14, 8), ((6, 14, 24), 0.95, 0.06, 6)], 3, moon=True)
landscape('forest-morning.jpg', 1080, 1350, (120, 190, 210), (230, 240, 210), (0.5, 0.3, 0.08, (255, 250, 200)),
          [((110, 160, 140), 0.6, 0.16, 8), ((70, 120, 100), 0.74, 0.14, 14), ((40, 84, 70), 0.88, 0.1, 18), ((24, 56, 48), 0.98, 0.06, 22)], 4)
landscape('coast-sunset.jpg', 2048, 1365, (90, 40, 120), (255, 120, 90), (0.55, 0.55, 0.08, (255, 150, 90)),
          [((40, 30, 80), 0.78, 0.05, 3), ((30, 20, 60), 0.9, 0.03, 2)], 5)
landscape('lavender-hills.jpg', 1600, 1000, (180, 160, 230), (250, 220, 230), (0.2, 0.3, 0.06, (255, 230, 240)),
          [((150, 120, 200), 0.6, 0.12, 6), ((120, 90, 170), 0.75, 0.12, 9), ((90, 60, 140), 0.9, 0.08, 5)], 6)
landscape('glacier-blue.jpg', 1080, 1080, (150, 210, 240), (235, 245, 255), (0.75, 0.25, 0.06, (255, 255, 255)),
          [((180, 205, 230), 0.55, 0.3, 7), ((120, 160, 200), 0.75, 0.18, 12), ((70, 110, 160), 0.92, 0.08, 9)], 7)
landscape('canyon-gold.jpg', 1920, 1280, (60, 120, 200), (255, 200, 140), (0.15, 0.25, 0.05, (255, 230, 170)),
          [((200, 110, 60), 0.62, 0.2, 4), ((170, 80, 45), 0.78, 0.18, 6), ((120, 55, 35), 0.94, 0.1, 5)], 8)
landscape('misty-peaks.jpg', 1350, 1080, (200, 210, 225), (245, 240, 235), (0.65, 0.35, 0.05, (255, 245, 230)),
          [((170, 180, 200), 0.55, 0.25, 10), ((130, 140, 165), 0.7, 0.2, 12), ((90, 100, 125), 0.86, 0.14, 8), ((60, 66, 85), 0.98, 0.06, 6)], 9)
landscape('tropical-dawn.jpg', 1080, 1920, (255, 120, 150), (255, 210, 140), (0.5, 0.45, 0.1, (255, 230, 170)),
          [((60, 140, 140), 0.8, 0.05, 3), ((30, 90, 100), 0.92, 0.04, 2)], 10)
print('ok')
