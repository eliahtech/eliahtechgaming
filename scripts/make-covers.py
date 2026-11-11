#!/usr/bin/env python3
"""Generate the branded 1200x675 fallback covers in public/covers (one per category + default).
Run from the project root: python3 scripts/make-covers.py   (needs Pillow and numpy)
Used when a post has no featured image. Uploaded covers are never modified; they only get a CSS logo badge."""
import os
import numpy as np
from PIL import Image, ImageDraw

W, H = 1200, 675
ROOT = os.path.join(os.path.dirname(__file__), '..', 'public')
SOURCES = {  # category slug -> slide artwork
    'football-games-updates': 'football-1', 'psp-ppsspp-games': 'psp-1', 'android-games-mods': 'android-1',
    'game-installation-setup': 'installation-1', 'game-graphics-textures-mods': 'graphics-1',
    'tech-tips-tutorials': 'tech-1', 'ai-tools-tutorials': 'ai-1', 'default': 'tech-2',
}
logo = Image.open(os.path.join(ROOT, 'assets/branding/etg-logo.png')).convert('RGBA')
os.makedirs(os.path.join(ROOT, 'covers'), exist_ok=True)
for slug, src in SOURCES.items():
    art = Image.open(os.path.join(ROOT, f'slides/{src}.webp')).convert('RGB').resize((W, H), Image.LANCZOS).convert('RGBA')
    ys, xs = np.mgrid[0:H, 0:W]
    shade = np.clip(1.0 - xs / (W * 0.55), 0, 1) ** 1.3 * 0.78 + np.clip((ys - H * 0.62) / (H * 0.38), 0, 1) ** 1.5 * 0.55
    ov = np.zeros((H, W, 4), dtype=np.uint8); ov[..., :3] = (6, 18, 40); ov[..., 3] = (np.clip(shade, 0, 0.92) * 255).astype(np.uint8)
    img = Image.alpha_composite(art, Image.fromarray(ov, 'RGBA'))
    lh = 150; lw = int(logo.width * lh / logo.height)
    img.alpha_composite(logo.resize((lw, lh), Image.LANCZOS), (40, 30))
    ImageDraw.Draw(img).rectangle((0, H - 8, W, H), fill=(241, 184, 57))
    target = os.path.join(ROOT, 'covers', f'{slug}.webp')
    img.convert('RGB').save(target, quality=82, method=6)
    print(slug, os.path.getsize(target) // 1024, 'KB')

# Small logo-free tiles for the homepage "Explore gaming topics" grid (480x270).
for slug, src in SOURCES.items():
    art = Image.open(os.path.join(ROOT, f'slides/{src}.webp')).convert('RGB').resize((480, 270), Image.LANCZOS).convert('RGBA')
    ys = np.mgrid[0:270, 0:480][0]
    ov = np.zeros((270, 480, 4), dtype=np.uint8); ov[..., :3] = (6, 18, 40); ov[..., 3] = (np.clip((ys - 60) / 210, 0, 1) ** 1.4 * 0.9 * 255).astype(np.uint8)
    target = os.path.join(ROOT, 'covers', f'tile-{slug}.webp')
    Image.alpha_composite(art, Image.fromarray(ov, 'RGBA')).convert('RGB').save(target, quality=80, method=6)
    print('tile', slug, os.path.getsize(target) // 1024, 'KB')
