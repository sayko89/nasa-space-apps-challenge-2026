#!/usr/bin/env python3
"""
build_pov.py — rover ground-level views inside the site (Perseverance or Curiosity).

For every rover position (site/drive) in the rover's MMGIS waypoints that lies inside the
site grid, looks up the images the rover took there in NASA's public raw-image feed and keeps
the near-horizontal Navcam / Mastcam(-Z) frames with their pointing.

  --rover m20   Perseverance: pipeline/sources/m20/M20_waypoints.json, Mars 2020 feed
  --rover msl   Curiosity:    pipeline/sources/msl/MSL_waypoints.json, MSL raw_image_items API Writes web/public/sites/<site>/pov.json:

  { format: 'martian-map-pov/2', stations: [ { rmc, sol, x, z, lat, lon, yaw,
      frames: [ { az, mastAz, el, camera, small, medium, link, sol, utc } ] } ] }

  x, z   site metres (east, south) of the rover position
  az     approximate pointing azimuth from north = mast azimuth (rover frame) + rover yaw

The app shows, for a science stop, the frames from the nearest rover position that look
toward the stop. Images are loaded from mars.nasa.gov by the browser (credit NASA/JPL-Caltech);
only the metadata is stored here. Needs network access (runs in GitHub Actions).

    python pipeline/build_pov.py                          # Jezero, Perseverance
    python pipeline/build_pov.py --site gale --rover msl  # Mount Sharp, Curiosity
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
MSL_FEED = ('https://mars.nasa.gov/api/v1/raw_image_items/?order=sol%20desc&per_page=100&page={page}'
            '&condition_1=msl:mission&condition_2={sol}:sol:gte&condition_3={sol}:sol:lte')
MSL_CAMERAS = ('NAV_LEFT_B', 'NAV_RIGHT_B', 'NAV_LEFT_A', 'NAV_RIGHT_A', 'MAST_LEFT', 'MAST_RIGHT')
ROVERS = {
    'm20': {'waypoints': 'pipeline/sources/m20/M20_waypoints.json',
            'credit': 'NASA/JPL-Caltech (Mars 2020 Perseverance raw images)', 'name': 'Perseverance'},
    'msl': {'waypoints': 'pipeline/sources/msl/MSL_waypoints.json',
            'credit': 'NASA/JPL-Caltech/MSSS (Mars Science Laboratory Curiosity raw images)', 'name': 'Curiosity'},
}


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


def m20_frames(sol):
    """Mars 2020 feed → [(site, drive, camera, mastAz, mastEl, small, medium, link, utc)]."""
    out = []
    for im in get_json(FEED.format(sol=sol)).get('images') or []:
        cam = (im.get('camera') or {}).get('instrument', '')
        ext = im.get('extended') or {}
        files = im.get('image_files') or {}
        if cam in CAMERAS and files.get('medium'):
            out.append((im.get('site'), im.get('drive'), cam, num(ext.get('mastAz')), num(ext.get('mastEl')),
                        files.get('small'), files['medium'], im.get('link'), im.get('date_taken_utc')))
    return out


def msl_frames(sol, stats):
    """MSL raw_image_items API → same tuples. Pointing from extended.mast_az/mast_el, or else from
    camera_vector (rover frame: x forward, y right, z down) when the feed gives it."""
    out, page = [], 0
    while True:
        j = get_json(MSL_FEED.format(sol=sol, page=page))
        items = j.get('items') or []
        for im in items:
            cam = im.get('instrument') or ''
            stats['seen'] = stats.get('seen', 0) + 1
            if cam not in MSL_CAMERAS or im.get('is_thumbnail'):
                continue
            ext = im.get('extended') or {}
            az, el = num(ext.get('mast_az')), num(ext.get('mast_el'))
            if az is None or el is None:
                v = im.get('camera_vector')
                try:
                    v = [float(t) for t in str(v).strip('()[] ').split(',')] if v else None
                except ValueError:
                    v = None
                if v and len(v) == 3:
                    az = math.degrees(math.atan2(v[1], v[0])) % 360
                    el = -math.degrees(math.asin(max(-1.0, min(1.0, v[2] / (math.hypot(*v) or 1)))))
                    stats['from_vector'] = stats.get('from_vector', 0) + 1
            if az is None or el is None:
                stats['no_pointing'] = stats.get('no_pointing', 0) + 1
                continue
            url = im.get('https_url') or im.get('url')
            out.append((im.get('site'), im.get('drive'), cam, az, el, url, url,
                        'https://mars.nasa.gov' + (im.get('link') or ''), im.get('date_taken')))
        if not j.get('more') or not items:
            return out
        page += 1
        time.sleep(0.3)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--site', default='jezero')
    ap.add_argument('--rover', default='m20', choices=sorted(ROVERS))
    ap.add_argument('--max-frames', type=int, default=24, help='per rover position, spread over azimuth')
    args = ap.parse_args(argv)
    site_dir = ROOT / 'web/public/sites' / args.site
    meta = json.loads((site_dir / 'meta.json').read_text())
    R = meta['projection']['mars_radius_m']
    lat0, lon0 = meta['center']['lat_deg'], meta['center']['lon_deg_east']
    half = meta['grid']['span_m'] / 2
    rover = ROVERS[args.rover]
    wp = json.loads((ROOT / rover['waypoints']).read_text())

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
    errors, stats = {}, {}
    for sol in sols:
        try:
            frames = m20_frames(sol) if args.rover == 'm20' else msl_frames(sol, stats)
        except Exception as e:  # noqa: BLE001
            errors[sol] = repr(e)
            print(f'sol {sol}: FAILED {e}', flush=True)
            continue
        n = 0
        for site_no, drive_no, cam, az, el, small, medium, link, utc in frames:
            try:
                key = (int(site_no), int(drive_no))
            except (TypeError, ValueError):
                stats['no_site_drive'] = stats.get('no_site_drive', 0) + 1
                continue
            st = stations.get(key)
            if not st or az is None or el is None or not (-25 <= el <= 10):
                continue
            st['frames'].append({
                'az': round((az + st['yaw']) % 360, 1), 'mastAz': round(az, 3), 'el': round(el, 3), 'camera': cam,
                'small': small, 'medium': medium, 'link': link, 'sol': sol, 'utc': utc,
            })
            n += 1
        print(f'sol {sol}: {n} frames', flush=True)
        time.sleep(0.5)
    if stats:
        print('feed stats:', json.dumps(stats))

    out = []
    for st in stations.values():
        fr = st['frames']
        if not fr:
            continue
        # keep one frame per ~15° of azimuth, preferring Mastcam-Z colour, then el closest to −8°
        fr.sort(key=lambda f: (round(f['az'] / 15), 0 if f['camera'].startswith(('MCZ', 'MAST')) else 1, abs(f['el'] + 8)))
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
        'credit': rover['credit'], 'rover': rover['name'],
        'stations': out, 'errors': errors,
    }, separators=(',', ':')))
    print(f'{len(out)} rover positions with frames, {sum(len(s["frames"]) for s in out)} frames, {len(errors)} errors')


if __name__ == '__main__':
    main()
