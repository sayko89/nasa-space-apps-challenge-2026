#!/usr/bin/env python3
"""
build_pov.py — Perseverance ground-level panoramas inside the site.

For every rover waypoint (pipeline/sources/m20/M20_waypoints.json) that lies inside the
site grid and has a 360° Navcam mosaic, downloads the mosaic from NASA's MMGIS server,
scales it to a web-friendly width and writes

  artifacts/moon-rover/public/sites/<site>/pov/<RMC>.jpg
  artifacts/moon-rover/public/sites/<site>/pov.json   index with position (site x/z, m),
                                                       sol, azimuth / elevation extent

so the app can show "what the crew will see" at each science stop: the panorama taken
closest to it, turned toward the stop. Needs network access (runs in GitHub Actions).

    python pipeline/build_pov.py [--width 2048]
"""
from __future__ import annotations

import argparse
import io
import json
import math
import time
import urllib.request
from pathlib import Path

from PIL import Image

Image.MAX_IMAGE_PIXELS = None
ROOT = Path(__file__).resolve().parent.parent
MMGIS = 'https://mars.nasa.gov/mmgis-maps/M20/'
UA = {'User-Agent': 'Mozilla/5.0 (martian-map data pipeline; +https://github.com/sayko89/nasa-space-apps-challenge-2026)'}


def get(url: str) -> bytes:
    for attempt in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=180) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001
            if attempt == 3:
                raise
            print(f'  retry {attempt + 1}: {e}')
            time.sleep(5 * (attempt + 1))
    raise RuntimeError(url)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--site', default='jezero')
    ap.add_argument('--width', type=int, default=2048)
    args = ap.parse_args(argv)
    site_dir = ROOT / 'artifacts/moon-rover/public/sites' / args.site
    meta = json.loads((site_dir / 'meta.json').read_text())
    R = meta['projection']['mars_radius_m']
    lat0, lon0 = meta['center']['lat_deg'], meta['center']['lon_deg_east']
    half = meta['grid']['span_m'] / 2
    wp = json.loads((ROOT / 'pipeline/sources/m20/M20_waypoints.json').read_text())
    out_dir = site_dir / 'pov'
    out_dir.mkdir(parents=True, exist_ok=True)
    index, errors = [], {}
    for f in wp['features']:
        p = f['properties']
        x = R * math.cos(math.radians(lat0)) * math.radians(p['lon'] - lon0)   # east [m]
        z = -R * math.radians(p['lat'] - lat0)                                  # south [m]
        if abs(x) > half or abs(z) > half:
            continue
        pano = next((im for im in p.get('images') or [] if im.get('isPanoramic')), None)
        if not pano:
            continue
        name = f"{p['RMC']}.jpg"
        dst = out_dir / name
        if not dst.exists():
            try:
                im = Image.open(io.BytesIO(get(MMGIS + pano['url']))).convert('RGB')
            except Exception as e:  # noqa: BLE001
                errors[p['RMC']] = repr(e)
                print(f"{p['RMC']}: FAILED {e}")
                continue
            h = round(im.height * args.width / im.width)
            im.resize((args.width, h), Image.LANCZOS).save(dst, quality=72, optimize=True, progressive=True)
            print(f"{p['RMC']} sol {p['sol']}: {im.width}×{im.height} → {args.width}×{h}, {dst.stat().st_size // 1024} kB")
        index.append({
            'rmc': p['RMC'], 'sol': p['sol'], 'x': round(x, 2), 'z': round(z, 2),
            'lat': p['lat'], 'lon': p['lon'], 'yaw': p.get('yaw'),
            'file': f'pov/{name}',
            'az': [float(pano['azmin']), float(pano['azmax'])],
            'el': [float(pano['elmin']), float(pano['elmax'])],
            'source': MMGIS + pano['url'],
        })
    (site_dir / 'pov.json').write_text(json.dumps({
        'format': 'martian-map-pov/1',
        'note': 'Navcam 360° cylindrical mosaics; azimuth measured clockwise from north in the rover site frame.',
        'credit': 'NASA/JPL-Caltech (Mars 2020 Perseverance Navcam mosaics, MMGIS)',
        'panoramas': index, 'errors': errors,
    }, indent=1))
    print(f'{len(index)} panoramas, {len(errors)} errors')


if __name__ == '__main__':
    main()
