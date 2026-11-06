#!/usr/bin/env python3
"""
fetch_gale.py — sources for the second site: Mount Sharp boxwork, Gale crater.

1. Downloads Curiosity's waypoints (NASA/JPL MMGIS) to pipeline/sources/msl/MSL_waypoints.json.
2. Picks the site centre from Curiosity's own track during the boxwork campaign: among the
   waypoints driven on or after BOXWORK_FIRST_SOL, the waypoint whose square window of the site
   size contains the most of them. The rover was there, so the site is where the boxwork
   science actually happened and where Curiosity's cameras saw the ground.
3. Writes pipeline/sources/msl/gale_center.json (lat, lon and how they were chosen).

The DTM window and the site grid are cut afterwards (.github/workflows/fetch-gale.yml).
Needs network access (runs in GitHub Actions).

    python pipeline/fetch_gale.py
"""
from __future__ import annotations

import json
import math
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'pipeline' / 'sources' / 'msl'
WAYPOINTS = 'https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints.json'
UA = {'User-Agent': 'martian-map data pipeline (+https://github.com/sayko89/nasa-space-apps-challenge-2026)'}

R = 3_396_190.0
# Curiosity reached the boxwork-bearing layer in spring 2025: it drilled "Altadena" there on
# sol 4567 (8 June 2025) after imaging the first ridges in mid-May (NASA, 23 June 2025).
BOXWORK_FIRST_SOL = 4540
SITE_SPAN_M = 2044.0          # 512 nodes × 4 m, as build_site.py
MARGIN_M = 150.0              # keep the track this far inside the edge


def get(url: str) -> bytes:
    for attempt in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001
            if attempt == 3:
                raise
            print(f'  retry {attempt + 1}: {e}', flush=True)
            time.sleep(10 * (attempt + 1))


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    raw = get(WAYPOINTS)
    (OUT / 'MSL_waypoints.json').write_bytes(raw)
    feats = json.loads(raw)['features']
    pts = [f['properties'] for f in feats]
    print(f'{len(pts)} waypoints, sols {pts[0]["sol"]}…{pts[-1]["sol"]}')

    box = [p for p in pts if p['sol'] >= BOXWORK_FIRST_SOL]
    if not box:
        raise SystemExit(f'no waypoints after sol {BOXWORK_FIRST_SOL}')
    half = SITE_SPAN_M / 2 - MARGIN_M

    def inside(c, p):
        x = R * math.cos(math.radians(c['lat'])) * math.radians(p['lon'] - c['lon'])
        z = R * math.radians(p['lat'] - c['lat'])
        return abs(x) <= half and abs(z) <= half

    best = max(box, key=lambda c: (sum(inside(c, p) for p in box), -c['sol']))
    covered = [p for p in box if inside(best, p)]
    # centre the window on the covered part of the track (mean of min/max), then re-count
    lat = (min(p['lat'] for p in covered) + max(p['lat'] for p in covered)) / 2
    lon = (min(p['lon'] for p in covered) + max(p['lon'] for p in covered)) / 2
    c = {'lat': lat, 'lon': lon}
    covered = [p for p in box if inside(c, p)]
    info = {
        'lat': round(lat, 6), 'lon': round(lon, 6),
        'rule': f'window of {SITE_SPAN_M:g} m (minus {MARGIN_M:g} m margin) holding the most Curiosity waypoints '
                f'driven on or after sol {BOXWORK_FIRST_SOL} (boxwork campaign), centred on them',
        'waypoints_after_first_sol': len(box),
        'waypoints_in_site': len(covered),
        'sols_in_site': [min(p['sol'] for p in covered), max(p['sol'] for p in covered)],
        'elev_geoid_m': [round(min(p['elev_geoid'] for p in covered), 1), round(max(p['elev_geoid'] for p in covered), 1)],
        'latest_waypoint': {k: pts[-1][k] for k in ('RMC', 'sol', 'lat', 'lon')},
        'source': WAYPOINTS,
    }
    (OUT / 'gale_center.json').write_text(json.dumps(info, indent=2))
    print(json.dumps(info, indent=2))


if __name__ == '__main__':
    main()
