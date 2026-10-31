#!/usr/bin/env python3
"""
build_pov.py — Perseverance ground-level views inside the site.

For every rover position (site/drive) in pipeline/sources/m20/M20_waypoints.json that lies
inside the site grid, looks up the images Perseverance took there in NASA's public Mars 2020
raw-image feed and keeps the near-horizontal Navcam and Mastcam-Z frames with their
pointing. Writes artifacts/moon-rover/public/sites/<site>/pov.json:

  { format: 'martian-map-pov/2', stations: [ { rmc, sol, x, z, lat, lon, yaw,
      frames: [ { az, mastAz, el, camera, small, medium, link, sol, utc } ] } ] }

  x, z   site metres (east, south) of the rover position
  az     approximate pointing azimuth from north = mast azimuth (rover frame) + rover yaw

The app shows, for a science stop, the frames from the nearest rover position that look
toward the stop. Images are loaded from mars.nasa.gov by the browser (credit NASA/JPL-Caltech);
only the metadata is stored here. Needs network access (runs in GitHub Actions).

    python pipeline/build_pov.py
"""
from __future__ import annotations

import argparse
import json
import math
import re
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FEED = 'https://mars.nasa.gov/rss/api/?feed=raw_images&category=mars2020&feedtype=json&sol={sol}'
UA = {'User-Agent': 'martian-map data pipeline (+https://github.com/sayko89/nasa-space-apps-challenge-2026)'}
CAMERAS = ('NAVCAM_LEFT', 'NAVCAM_RIGHT', 'MCZ_LEFT', 'MCZ_RIGHT')


def get_json(url: str):
    for attempt in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                return json.load(r)
        except Exception as e:  # noqa: BLE001
            if attempt == 2:
                raise
            print(f'  retry {attempt + 1}: {e}', flush=True)
            time.sleep(5 * (attempt + 1))


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--site', default='jezero')
    ap.add_argument('--max-frames', type=int, default=24, help='per rover position, spread over azimuth')
    args = ap.parse_args(argv)
    site_dir = ROOT / 'artifacts/moon-rover/public/sites' / args.site
    meta = json.loads((site_dir / 'meta.json').read_text())
    R = meta['projection']['mars_radius_m']
    lat0, lon0 = meta['center']['lat_deg'], meta['center']['lon_deg_east']
    half = meta['grid']['span_m'] / 2
    wp = json.loads((ROOT / 'pipeline/sources/m20/M20_waypoints.json').read_text())

    stations = {}
    for f in wp['features']:
        p = f['properties']
        x = R * math.cos(math.radians(lat0)) * math.radians(p['lon'] - lon0)
        z = -R * math.radians(p['lat'] - lat0)
        if abs(x) > half or abs(z) > half:
            continue
        stations[(int(p['site']), int(p['drive']))] = {
            'rmc': p['RMC'], 'sol': int(p['sol']), 'x': round(x, 2), 'z': round(z, 2),
            'lat': p['lat'], 'lon': p['lon'], 'yaw': num(p.get('yaw')) or 0.0, 'frames': [],
        }
    sols = sorted({s['sol'] for s in stations.values()})
    # images at a position can be taken on later sols, before the next drive
    sols = sorted({s + d for s in sols for d in range(0, 3)})
    errors = {}
    for sol in sols:
        try:
            feed = get_json(FEED.format(sol=sol))
        except Exception as e:  # noqa: BLE001
            errors[sol] = repr(e)
            print(f'sol {sol}: FAILED {e}', flush=True)
            continue
        n = 0
        for im in feed.get('images') or []:
            cam = (im.get('camera') or {}).get('instrument', '')
            if cam not in CAMERAS:
                continue
            try:
                key = (int(im.get('site')), int(im.get('drive')))
            except (TypeError, ValueError):
                continue
            st = stations.get(key)
            ext = im.get('extended') or {}
            az, el = num(ext.get('mastAz')), num(ext.get('mastEl'))
            if not st or az is None or el is None or not (-25 <= el <= 10):
                continue
            files = im.get('image_files') or {}
            if not files.get('medium'):
                continue
            st['frames'].append({
                'az': round((az + st['yaw']) % 360, 1), 'mastAz': az, 'el': el, 'camera': cam,
                'small': files.get('small'), 'medium': files['medium'], 'link': im.get('link'),
                'sol': sol, 'utc': im.get('date_taken_utc'),
            })
            n += 1
        print(f'sol {sol}: {n} frames', flush=True)
        time.sleep(0.5)

    out = []
    for st in stations.values():
        fr = st['frames']
        if not fr:
            continue
        # keep one frame per ~15° of azimuth, preferring Mastcam-Z colour, then el closest to −8°
        fr.sort(key=lambda f: (round(f['az'] / 15), 0 if f['camera'].startswith('MCZ') else 1, abs(f['el'] + 8)))
        keep, seen = [], set()
        for f in fr:
            b = round(f['az'] / 15) % 24
            if b in seen:
                continue
            seen.add(b)
            keep.append(f)
        st['frames'] = sorted(keep, key=lambda f: f['az'])[: args.max_frames]
        out.append(st)
    out.sort(key=lambda s: (s['sol'], s['rmc']))
    (site_dir / 'pov.json').write_text(json.dumps({
        'format': 'martian-map-pov/2',
        'note': 'Frame azimuth ≈ mast azimuth + rover yaw (from north, clockwise); approximate.',
        'credit': 'NASA/JPL-Caltech (Mars 2020 Perseverance raw images)',
        'stations': out, 'errors': errors,
    }, separators=(',', ':')))
    print(f'{len(out)} rover positions with frames, {sum(len(s["frames"]) for s in out)} frames, {len(errors)} errors')


if __name__ == '__main__':
    main()
