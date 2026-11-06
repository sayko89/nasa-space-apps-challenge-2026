#!/usr/bin/env python3
"""
fetch_chemistry.py — Curiosity ChemCam major-oxide compositions for the Gale (boxwork) site.

Downloads the ChemCam LIBS MOC tables (PDS Geosciences Node, MSL ChemCam RDR) that cover the
boxwork campaign, and for every product in them reads its PDS3 label to get where the laser
hit: the rover position (SITE, DRIVE), the pointing in the site frame (azimuth, elevation) and
the focus distance. Writes:

  pipeline/sources/chem/moc_<a>_<b>.csv            the MOC tables, as published
  pipeline/sources/chem/chemcam_geometry.json      one row per product: sol, site, drive,
                                                    site-frame az/el, focus distance (mm)

Needs network access (runs in GitHub Actions).

    python pipeline/fetch_chemistry.py
"""
from __future__ import annotations

import csv
import io
import json
import math
import re
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'pipeline' / 'sources' / 'chem'
BASE = 'https://pds-geosciences.wustl.edu/msl/msl-m-chemcam-libs-4_5-rdr-v1/mslccm_1xxx/data/'
MOC = ['moc_4489_4612', 'moc_4613_4709', 'moc_4710_4843']   # boxwork campaign: sols 4541–4844
UA = {'User-Agent': 'martian-map data pipeline (+https://github.com/sayko89/nasa-space-apps-challenge-2026)'}

# SCLK → sol (LMST), anchored on a label read by hand: cl5_802931734 = sol 4567, LMST 14:12:23.
SCLK0, SOL0 = 802931734.182, 4567 + (14 + 12 / 60 + 23 / 3600) / 24
SOL_S = 88775.244


def get(url: str) -> bytes | None:
    for attempt in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            err = e
        except Exception as e:  # noqa: BLE001
            err = e
        time.sleep(3 * (attempt + 1))
    raise RuntimeError(f'{url}: {err}')


def num(v):
    try:
        return float(str(v).strip().strip('"'))
    except ValueError:
        return None


def parse_label(txt: str) -> dict:
    out = {}
    m = re.search(r'PLANET_DAY_NUMBER\s*=\s*(\d+)', txt)
    out['sol'] = int(m.group(1)) if m else None
    m = re.search(r'ROVER_MOTION_COUNTER\s*=\s*\(\s*(\d+)\s*,\s*(\d+)', txt)
    out['site'], out['drive'] = (int(m.group(1)), int(m.group(2))) if m else (None, None)
    m = re.search(r'INSTRUMENT_FOCUS_DISTANCE\s*=\s*([-\d.]+)', txt)
    out['focus_mm'] = num(m.group(1)) if m else None
    # the GROUP whose REFERENCE_COORD_SYSTEM_NAME is SITE_FRAME holds the site-frame pointing
    for g in re.findall(r'GROUP\s*=\s*\w+(.*?)END_GROUP', txt, re.S):
        if re.search(r'REFERENCE_COORD_SYSTEM_NAME\s*=\s*"?SITE_FRAME', g):
            az = re.search(r'INSTRUMENT_AZIMUTH\s*=\s*([-\d.]+)', g)
            el = re.search(r'INSTRUMENT_ELEVATION\s*=\s*([-\d.]+)', g)
            if az and el:
                out['site_az'], out['site_el'] = num(az.group(1)), num(el.group(1))
                break
    m = re.search(r'LOCAL_TRUE_SOLAR_TIME\s*=\s*"?([\d:]+)', txt)
    out['ltst'] = m.group(1) if m else None
    return out


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    products = []
    for name in MOC:
        raw = get(f'{BASE}moc/{name}.csv')
        if raw is None:
            raise SystemExit(f'missing {name}.csv')
        (OUT / f'{name}.csv').write_bytes(raw)
        rows = list(csv.reader(io.StringIO(raw.decode('latin-1'))))
        for r in rows:
            if r and re.match(r'(?i)^cl\d_\d{9}', r[0].strip()):
                products.append(r[0].strip())
        print(f'{name}: {sum(1 for r in rows if r and re.match(r"(?i)^cl", r[0].strip()))} rows', flush=True)

    products = sorted(set(products))
    print(f'{len(products)} products; reading labels', flush=True)
    geo, missing = {}, []
    for i, p in enumerate(products):
        sclk = float(re.match(r'(?i)cl\d_(\d{9})', p).group(1))
        guess = int(SOL0 + (sclk - SCLK0) / SOL_S)
        name = p.lower().removesuffix('.csv').removesuffix('.tab')
        txt = None
        for sol in (guess, guess - 1, guess + 1):
            txt = get(f'{BASE}sol{sol:05d}/{name}.lbl')
            if txt:
                break
        if not txt:
            missing.append(p)
            continue
        g = parse_label(txt.decode('latin-1'))
        g['product'] = p
        geo[p] = g
        if i % 50 == 0:
            print(f'  {i}/{len(products)} {p} → sol {g["sol"]} site {g["site"]}/{g["drive"]}', flush=True)
        time.sleep(0.15)

    (OUT / 'chemcam_geometry.json').write_text(json.dumps(
        {'source': BASE, 'moc_files': MOC, 'n': len(geo), 'missing': missing, 'rows': list(geo.values())}, indent=1))
    print(f'labels: {len(geo)} read, {len(missing)} missing')


if __name__ == '__main__':
    main()
