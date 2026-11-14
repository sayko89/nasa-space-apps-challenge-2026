#!/usr/bin/env python3
"""
build_track.py — the rover's own route through the site, and a few named places.

NASA's route maps for Curiosity (PIA23179 "Proposed Path up Mount Sharp", PIA26042 "Path to
Gediz Vallis Ridge and Beyond") draw the rover's path as a pale line over the orbital image
and label the regions it crosses. This writes the same two things for a site:

  segments  the rover's localized positions inside the site (NASA/JPL MMGIS waypoints),
            in drive order, split where the rover left the site
  labels    kind "sol"     first / last sol of each segment
            kind "place"   Jezero: Octavia E. Butler Landing (the rover's first position)
            kind "region"  Gale: the three stratigraphic levels of geology.json, each at the
                           cell of that level closest to the level's centre of mass.
                           These regions are DERIVED by this project (see build_gale_geology.py),
                           not NASA's mapped units — the label text says so in the app.

No place is positioned by hand: every coordinate comes from the waypoints or the grid.

    python pipeline/build_track.py --site jezero --rover m20
    python pipeline/build_track.py --site gale   --rover msl
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import math
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
ROVERS = {
    'm20': {'waypoints': 'pipeline/sources/m20/M20_waypoints.json', 'name': 'Perseverance',
            'credit': 'NASA/JPL-Caltech — Mars 2020 rover waypoints (MMGIS)'},
    'msl': {'waypoints': 'pipeline/sources/msl/MSL_waypoints.json', 'name': 'Curiosity',
            'credit': 'NASA/JPL-Caltech — MSL rover waypoints (MMGIS)'},
}


def local_xy(lat, lon, lat0, lon0, R):
    """Same equirectangular site frame as build_pov.py: x east, z south, metres."""
    return (R * math.cos(math.radians(lat0)) * math.radians(lon - lon0), -R * math.radians(lat - lat0))


def build_segments(features, lat0, lon0, R, half):
    """Waypoints in drive order → list of segments [[x, z, sol], …] inside the site."""
    pts = sorted(((int(f['properties']['site']), int(f['properties']['drive']), f['properties']) for f in features),
                 key=lambda t: t[:2])
    segments, cur = [], []
    for _, _, p in pts:
        x, z = local_xy(p['lat'], p['lon'], lat0, lon0, R)
        if abs(x) <= half and abs(z) <= half:
            cur.append([round(x, 1), round(z, 1), int(p['sol'])])
        elif cur:
            segments.append(cur); cur = []
    if cur:
        segments.append(cur)
    return [s for s in segments if len(s) >= 2]


def region_labels(geology, half):
    """One label per bedrock unit: the unit's cell nearest to its centre of mass."""
    n, cell = geology['grid']['n'], geology['grid']['cell_m']
    codes = np.concatenate([np.full(c, v, dtype=np.uint8) for v, c in geology['bedrock']['rle']]).reshape(n, n)
    out = []
    for code, name in enumerate(geology['bedrock']['units']):
        if not name:
            continue
        rows, cols = np.nonzero(codes == code)
        if rows.size < 50:
            continue
        r0, c0 = rows.mean(), cols.mean()
        k = int(np.argmin((rows - r0) ** 2 + (cols - c0) ** 2))
        out.append({'kind': 'region', 'text': name, 'x': round(float(cols[k] * cell - half), 1),
                    'z': round(float(rows[k] * cell - half), 1), 'code': code, 'derived': True})
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--site', default='jezero')
    ap.add_argument('--rover', default='m20', choices=sorted(ROVERS))
    args = ap.parse_args(argv)
    site_dir = ROOT / 'web' / 'public' / 'sites' / args.site
    meta = json.loads((site_dir / 'meta.json').read_text())
    R = meta['projection']['mars_radius_m']
    lat0, lon0 = meta['center']['lat_deg'], meta['center']['lon_deg_east']
    half = meta['grid']['span_m'] / 2
    rover = ROVERS[args.rover]
    feats = json.loads((ROOT / rover['waypoints']).read_text())['features']

    segments = build_segments(feats, lat0, lon0, R, half)
    if not segments:
        raise SystemExit(f'no {rover["name"]} waypoints inside site {args.site}')
    labels = []
    for seg in segments:
        labels.append({'kind': 'sol', 'text': f'sol {seg[0][2]}', 'x': seg[0][0], 'z': seg[0][1]})
        if seg[-1][2] != seg[0][2]:
            labels.append({'kind': 'sol', 'text': f'sol {seg[-1][2]}', 'x': seg[-1][0], 'z': seg[-1][1]})
    if args.rover == 'm20':
        first = min(feats, key=lambda f: (f['properties'].get('dist_total_m', 1e9), f['properties']['sol']))['properties']
        if first.get('dist_total_m', 1) == 0:
            x, z = local_xy(first['lat'], first['lon'], lat0, lon0, R)
            if abs(x) <= half and abs(z) <= half:
                # the rover's first sol label sits on the same spot — keep the place name only
                labels = [l for l in labels if not (l['kind'] == 'sol' and math.hypot(l['x'] - x, l['z'] - z) < 5)]
                labels.append({'kind': 'place', 'text': 'Octavia E. Butler Landing', 'x': round(x, 1), 'z': round(z, 1)})
    geo_path = site_dir / 'geology.json'
    if geo_path.exists():
        geology = json.loads(geo_path.read_text())
        if geology.get('source', {}).get('kind') == 'derived':
            labels += region_labels(geology, half)

    sols = [p[2] for s in segments for p in s]
    length = sum(math.hypot(b[0] - a[0], b[1] - a[1]) for s in segments for a, b in zip(s, s[1:]))
    out = {
        'format': 'martian-map-track/1', 'site': args.site, 'rover': rover['name'],
        'sols': [min(sols), max(sols)], 'length_m': round(length), 'points': sum(len(s) for s in segments),
        'segments': segments, 'labels': labels, 'credit': rover['credit'],
        'note': 'x east, z south, metres from the site centre; region labels are derived by this project',
        'generated_utc': dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds'),
        'generator': 'pipeline/build_track.py',
    }
    (site_dir / 'track.json').write_text(json.dumps(out, separators=(',', ':')))
    print(f'{args.site}: {len(segments)} segment(s), {out["points"]} points, {out["length_m"]} m, sols {out["sols"]}, '
          f'labels: {[l["text"] for l in labels]}')


if __name__ == '__main__':
    main()
