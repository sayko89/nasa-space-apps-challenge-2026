#!/usr/bin/env python3
"""
build_ortho.py — orbital image (HiRISE orthomosaic) draped on the site terrain.

Warps the USGS HiRISE orthomosaic of the site straight onto the site grid (the local eqc
projection in meta.json, extent = the terrain mesh, node to node), averaged to SIZE × SIZE
pixels, contrast-stretched (0.5–99.5 percentile) and saved as a JPEG:

  web/public/sites/<site>/ortho.jpg     SIZE × SIZE, row 0 = north edge, col 0 = west edge
  web/public/sites/<site>/ortho.json    extent, resolution, stretch, source and credit

The mosaics and the DTMs share the same control (MOLA), so the image lines up with the terrain.
Reads the source over HTTP (GDAL /vsicurl/): runs in GitHub Actions.

    python pipeline/build_ortho.py --site jezero
    python pipeline/build_ortho.py --site gale
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import subprocess
import tempfile
from pathlib import Path

import numpy as np
import rasterio
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SIZE = 4096

SOURCES = {
    'jezero': {
        'url': 'https://planetarymaps.usgs.gov/mosaic/mars2020_trn/HiRISE/JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first.tif',
        'title': 'Mars 2020 Terrain Relative Navigation HiRISE Orthorectified Image Mosaic (25 cm)',
        'creators': 'Fergason, R. L., Hare, T. M., Mayer, D. P., et al. (USGS Astrogeology)',
        'year': 2020, 'doi': 'https://doi.org/10.5066/P9QJDP48',
        'page': 'https://astrogeology.usgs.gov/search/map/Mars/Mars2020/JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first',
    },
    'gale': {
        'url': 'https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/MSL_Gale_Orthophoto_Mosaic_25cm_v3.tif',
        'title': 'MSL Gale Merged Orthophoto Mosaic 25cm (v3)',
        'creators': 'Calef III, F. J. & Parker, T. (USGS / PDS Annex)',
        'year': 2016, 'doi': None,
        'page': 'https://astrogeology.usgs.gov/search/map/mars_msl_gale_merged_orthophoto_mosaic_25cm',
    },
}


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('--site', required=True, choices=sorted(SOURCES))
    ap.add_argument('--size', type=int, default=SIZE)
    args = ap.parse_args(argv)
    src = SOURCES[args.site]
    site_dir = ROOT / 'web' / 'public' / 'sites' / args.site
    meta = json.loads((site_dir / 'meta.json').read_text())
    half = (meta['grid']['n'] - 1) * meta['grid']['cell_m'] / 2      # terrain mesh: node to node
    proj = meta['projection']['proj4'].replace('+no_defs=True', '+no_defs')

    with tempfile.TemporaryDirectory() as tmp:
        warped = Path(tmp) / 'ortho.tif'
        cmd = ['gdalwarp', '-q', '-overwrite', '-t_srs', proj,
               '-te', str(-half), str(-half), str(half), str(half), '-ts', str(args.size), str(args.size),
               '-r', 'average', '-dstnodata', '0', '-wm', '1024', '-multi',
               '-co', 'COMPRESS=DEFLATE', '/vsicurl/' + src['url'], str(warped)]
        print(' '.join(cmd), flush=True)
        subprocess.run(cmd, check=True)
        with rasterio.open(warped) as ds:
            a = ds.read(1).astype(np.float32)

    valid = a > 0
    cover = float(valid.mean())
    lo, hi = np.percentile(a[valid], [0.5, 99.5]) if valid.any() else (0, 255)
    img = np.clip((a - lo) / max(hi - lo, 1) * 255, 0, 255)
    img[~valid] = 0
    out = site_dir / 'ortho.jpg'
    Image.fromarray(img.astype(np.uint8), 'L').save(out, quality=82, optimize=True, progressive=True)

    info = {
        'format': 'martian-map-ortho/1', 'site': args.site, 'file': 'ortho.jpg',
        'size_px': args.size, 'extent_m': [-half, -half, half, half],
        'pixel_m': round(2 * half / args.size, 4),
        'order': 'row 0 = north edge, col 0 = west edge (same as grid.bin)',
        'coverage': round(cover, 4), 'stretch_dn': [float(lo), float(hi)],
        'source': {k: v for k, v in src.items() if k != 'url'} | {'url': src['url'], 'native_resolution_m': 0.25,
                                                                   'instrument': 'MRO HiRISE', 'license': 'public domain'},
        'generated_utc': dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds'),
        'generator': 'pipeline/build_ortho.py',
    }
    (site_dir / 'ortho.json').write_text(json.dumps(info, indent=1))
    print(f'{args.site}: {out.relative_to(ROOT)} {out.stat().st_size / 1e6:.1f} MB, '
          f'{info["pixel_m"]} m/px, coverage {cover:.1%}, stretch {lo:.0f}–{hi:.0f}')


if __name__ == '__main__':
    main()
