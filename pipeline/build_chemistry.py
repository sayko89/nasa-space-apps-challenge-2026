#!/usr/bin/env python3
"""
build_chemistry.py — ChemCam rock chemistry for the Gale (Mount Sharp boxwork) site.

Inputs (pipeline/fetch_chemistry.py, GitHub Actions):
  pipeline/sources/chem/moc_*.csv              ChemCam LIBS major-oxide compositions (PDS)
  pipeline/sources/chem/chemcam_geometry.json  per product: sol, SITE/DRIVE, site-frame az/el, focus distance
  pipeline/sources/msl/MSL_waypoints.json      Curiosity positions by SITE/DRIVE (MMGIS)

Where the laser hit: rover position (waypoint with the same SITE and the last DRIVE ≤ the
product's) + focus distance × cos(elevation) along the site-frame azimuth (site frame: x north,
y east, azimuth clockwise from north). The 0.8 m mast offset is ignored (< 1 grid cell).

Points of the same target on the same sol are averaged into one target. Each target gets the
units of its grid cell from geology.json, and the targets are summarised by stratigraphic level.

Output: web/public/sites/gale/chemistry.json (martian-map-chemistry/1)

    python pipeline/build_chemistry.py
"""
from __future__ import annotations

import csv
import datetime as dt
import json
import math
import re
import statistics as st
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'pipeline' / 'sources'
SITE = ROOT / 'web' / 'public' / 'sites' / 'gale'
R = 3_396_190.0

# MOC column positions (PDS label: value, ±error, RMSEP, shot stdev per oxide)
OXIDES = {'SiO2': 2, 'TiO2': 6, 'Al2O3': 10, 'FeOT': 14, 'MgO': 18, 'CaO': 22, 'Na2O': 26, 'K2O': 30, 'MnO': 34}
COL_SUM, COL_DIST = 38, 39


def num(v):
    try:
        x = float(v)
        return x if math.isfinite(x) else None
    except (TypeError, ValueError):
        return None


def decode_rle(rle, n):
    out = []
    for code, count in rle:
        out.extend([code] * count)
    assert len(out) == n * n
    return out


def main():
    meta = json.loads((SITE / 'meta.json').read_text())
    n, cell, span = meta['grid']['n'], meta['grid']['cell_m'], meta['grid']['span_m']
    lat0, lon0 = meta['center']['lat_deg'], meta['center']['lon_deg_east']
    geol = json.loads((SITE / 'geology.json').read_text())
    bed = decode_rle(geol['bedrock']['rle'], n)
    surf = decode_rle(geol['surface']['rle'], n)

    wp = [f['properties'] for f in json.loads((SRC / 'msl' / 'MSL_waypoints.json').read_text())['features']]
    by_site = defaultdict(list)
    for p in wp:
        by_site[p['site']].append(p)
    for v in by_site.values():
        v.sort(key=lambda p: p['drive'])

    gj = json.loads((SRC / 'chem' / 'chemcam_geometry.json').read_text())
    geo = {g['product'].upper(): g for g in gj['rows']}

    points, skipped = [], defaultdict(int)
    for f in sorted((SRC / 'chem').glob('moc_*.csv')):
        for r in csv.reader(f.read_text(encoding='latin-1').splitlines()):
            if not r or not re.match(r'(?i)^cl\d_\d{9}', r[0].strip()):
                continue
            g = geo.get(r[0].strip().upper())
            if not g or g.get('site') is None or g.get('site_az') is None or not g.get('focus_mm'):
                skipped['no geometry'] += 1
                continue
            cands = [p for p in by_site.get(g['site'], []) if p['drive'] <= g['drive']]
            if not cands:
                skipped['no rover position'] += 1
                continue
            rv = cands[-1]
            d_h = g['focus_mm'] / 1000 * math.cos(math.radians(g['site_el']))
            dn = d_h * math.cos(math.radians(g['site_az']))
            de = d_h * math.sin(math.radians(g['site_az']))
            x = R * math.cos(math.radians(lat0)) * math.radians(rv['lon'] - lon0) + de
            z = -R * math.radians(rv['lat'] - lat0) - dn
            if abs(x) > span / 2 or abs(z) > span / 2:
                skipped['outside site'] += 1
                continue
            ox = {k: num(r[i]) for k, i in OXIDES.items()}
            rmsep = {k: num(r[i + 2]) for k, i in OXIDES.items()}
            if ox['SiO2'] is None:
                skipped['no composition'] += 1
                continue
            points.append({'target': r[1].strip(), 'sol': g['sol'], 'x': x, 'z': z, 'ox': ox, 'rmsep': rmsep,
                           'sum': num(r[COL_SUM]), 'range_m': g['focus_mm'] / 1000})

    # one target = same name, same sol
    groups = defaultdict(list)
    for p in points:
        groups[(p['target'], p['sol'])].append(p)
    targets = []
    for (name, sol), ps in sorted(groups.items(), key=lambda kv: (kv[0][1], kv[0][0])):
        x = st.fmean(p['x'] for p in ps); z = st.fmean(p['z'] for p in ps)
        col = min(n - 1, max(0, round((x + span / 2) / cell)))
        row = min(n - 1, max(0, round((z + span / 2) / cell)))
        k = row * n + col
        ox = {o: round(st.fmean(v), 2) for o in OXIDES if (v := [p['ox'][o] for p in ps if p['ox'][o] is not None])}
        targets.append({
            'name': re.sub(r'(?i)_ccam$', '', name).replace('_', ' '), 'sol': sol, 'points': len(ps),
            'x': round(x, 1), 'z': round(z, 1), 'range_m': round(st.fmean(p['range_m'] for p in ps), 1),
            'oxides': ox, 'bedrock': bed[k], 'surface': surf[k],
        })

    # RMSEP: typical accuracy per oxide (median over points) — shown next to every value
    rmsep = {o: round(st.median(v), 2) for o in OXIDES if (v := [p['rmsep'][o] for p in points if p['rmsep'][o]])}

    def summary(field, units):
        out = []
        for code, unit in enumerate(units):
            ts = [t for t in targets if t[field] == code]
            if not unit or not ts:
                continue
            out.append({'code': code, 'name': unit, 'targets': len(ts), 'mean': {
                o: round(st.fmean(v), 2) for o in OXIDES if (v := [t['oxides'][o] for t in ts if o in t['oxides']])},
                'sd': {o: round(st.stdev(v), 2) for o in OXIDES if len(v := [t['oxides'][o] for t in ts if o in t['oxides']]) > 1}})
        return out

    out = {
        'format': 'martian-map-chemistry/1', 'site': 'gale', 'instrument': 'ChemCam LIBS (Curiosity)',
        'units': 'wt% oxide (FeOT = total iron as FeO)', 'oxides': list(OXIDES), 'rmsep': rmsep,
        'targets': targets,
        'by_bedrock': summary('bedrock', geol['bedrock']['units']),
        'by_surface': summary('surface', geol['surface']['units']),
        'location_method': 'rover position (MMGIS waypoint, same SITE, last DRIVE ≤ product) + focus distance '
                           '× cos(elevation) along site-frame azimuth; mast offset (~0.8 m) ignored',
        'stats': {'points': len(points), 'targets': len(targets), 'skipped': dict(skipped),
                  'sols': [min(t['sol'] for t in targets), max(t['sol'] for t in targets)] if targets else None},
        'source': {
            'title': 'MSL ChemCam LIBS RDR — major-oxide compositions (MOC)',
            'publisher': 'NASA PDS Geosciences Node', 'files': gj['moc_files'], 'url': gj['source'],
            'citation': 'Wiens, R. C., Maurice, S. et al. MSL ChemCam LIBS derived data (RDR); '
                        'calibration: Clegg, S. M. et al. (2017), Spectrochim. Acta B 129, 64-85',
            'license': 'public domain (NASA)',
        },
        'generated_utc': dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds'),
        'generator': 'pipeline/build_chemistry.py',
    }
    path = SITE / 'chemistry.json'
    path.write_text(json.dumps(out, separators=(',', ':')))
    print(f"{len(points)} points → {len(targets)} targets in site, skipped {dict(skipped)}")
    for s in out['by_bedrock']:
        print(f"  {s['name']:34s} n={s['targets']:3d}  " + ' '.join(f"{o} {s['mean'].get(o, 0):5.1f}" for o in ('SiO2', 'FeOT', 'MgO', 'CaO', 'MnO')))
    print(f'→ {path.relative_to(ROOT)} ({path.stat().st_size / 1e3:.0f} kB)')


if __name__ == '__main__':
    main()
