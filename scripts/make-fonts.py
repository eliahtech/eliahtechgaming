#!/usr/bin/env python3
"""Subset Poppins (SIL OFL 1.1) to Latin and write compressed WOFF files into public/fonts.
Usage: python3 scripts/make-fonts.py /path/to/Poppins-Regular.ttf /path/to/Poppins-Medium.ttf /path/to/Poppins-Bold.ttf
The generated files are committed, so this only needs re-running if you change weights or the character set."""
import sys, os
from fontTools import subset
from fontTools.ttLib import TTFont

UNICODES = list(range(0x20, 0x7F)) + list(range(0xA0, 0x100)) + list(range(0x2010, 0x2028)) + [0x2030, 0x2039, 0x203A, 0x20AC, 0x2122, 0x2190, 0x2191, 0x2192, 0x2193, 0x2212, 0x2713, 0x00D7]
WEIGHTS = {'Regular': 400, 'Medium': 500, 'Bold': 700}
out = os.path.join(os.path.dirname(__file__), '..', 'public', 'fonts')
os.makedirs(out, exist_ok=True)
for path in sys.argv[1:]:
    name = os.path.basename(path).split('-')[1].split('.')[0]
    opts = subset.Options(); opts.flavor = 'woff'; opts.layout_features = ['kern', 'liga', 'calt']; opts.name_IDs = [1, 2, 3, 4, 6]; opts.notdef_outline = True
    font = TTFont(path); sub = subset.Subsetter(opts); sub.populate(unicodes=UNICODES); sub.subset(font)
    target = os.path.join(out, f'poppins-{WEIGHTS[name]}.woff'); font.flavor = 'woff'; font.save(target)
    print(target, os.path.getsize(target) // 1024, 'KB')
