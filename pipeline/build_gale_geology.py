#!/usr/bin/env python3
"""
build_gale_geology.py — unit map for the Mount Sharp boxwork site (Gale crater).

There is no published GIS geologic map of this part of Mount Sharp, so the two unit layers the
app needs are built from data we do have, and every unit says how it was made:

  bedrock  STRATIGRAPHIC LEVEL. Curiosity's own track separates the layers cleanly: before the
           boxwork campaign (sols < 4541) the rover was always below −3655 m, inside the boxwork
           terrain (sols 4541–4844) between −3655 m and −3595 m, and after it crossed the
           southernmost boxwork contact (sol ~4844, NASA Curiosity blog sols 4845–4851) always
           above. The layers on lower Mount Sharp are close to horizontal, so the elevation band
           Curiosity crossed is used as the boxwork-bearing layer, and the bands below and above
           as the sulfate unit under and over it. The thresholds are computed from the waypoints,
           not typed in. Lateral contacts of the boxwork terrain are not modelled (approximation).

  surface  TERRAIN CLASS from the 4 m site grid (MSL Gale merged 1 m DEM, averaged): relief
           against a 15 m Gaussian background. Ridge or butte crest (> +1 m), hollow or trough
           (< −1 m), steep slope (> 20°, also an EVA wall), smooth ground (the rest). The 2016
           merged DEM does not resolve the individual boxwork ridges (a few metres wide); these
           classes are the larger landforms around them.

Output: web/public/sites/gale/geology.json (same format as build_geology.py, martian-map-geology/1).

    python pipeline/build_gale_geology.py
"""
from __future__ import annotations

import datetime as dt
import json
import math
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / 'web' / 'public' / 'sites' / 'gale'
WAYPOINTS = ROOT / 'pipeline' / 'sources' / 'msl' / 'MSL_waypoints.json'

# Boxwork campaign on Curiosity's track (NASA Curiosity blog): first boxwork-bearing ground in
# mid-May 2025 (sol ~4541); "Farewell Boxwork" — crossed the southernmost contact before sol 4845.
BOXWORK_SOLS = (4541, 4844)
SIGMA_M = 15.0          # background scale for ridge / hollow relief
RELIEF_M = 1.0          # ridge / hollow threshold
STEEP_DEG = 20.0        # = NASA xEVA max walkable slope (marswalkProfile.js)

BEDROCK = ['', 'Sulfate unit below the boxwork', 'Boxwork-bearing layer', 'Sulfate unit above the boxwork']
SURFACE = ['', 'Smooth ground', 'Ridge or butte crest', 'Hollow or trough', 'Steep slope (>20°)']


def gaussian(a: np.ndarray, sigma: float) -> np.ndarray:
    """Separable Gaussian blur with reflected edges (numpy only)."""
    r = int(math.ceil(3 * sigma))
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2)
    k /= k.sum()
    out = a
    for axis in (0, 1):
        p = np.pad(out, [(r, r) if ax == axis else (0, 0) for ax in (0, 1)], mode='reflect')
        out = np.apply_along_axis(lambda v: np.convolve(v, k, mode='valid'), axis, p)
    return out


def majority3(a: np.ndarray, ncls: int) -> np.ndarray:
    """3×3 majority filter (keeps the centre on ties) — removes single-cell speckle."""
    n0, n1 = a.shape
    p = np.pad(a, 1, mode='edge')
    counts = np.zeros((ncls, n0, n1), np.int16)
    for dr in (-1, 0, 1):
        for dc in (-1, 0, 1):
            w = p[1 + dr:1 + dr + n0, 1 + dc:1 + dc + n1]
            for c in range(ncls):
                counts[c] += (w == c)
    best = counts.argmax(0).astype(np.uint8)
    keep = counts[a, np.arange(n0)[:, None], np.arange(n1)[None, :]] >= counts.max(0)
    return np.where(keep, a, best)


def rle(a: np.ndarray) -> list[list[int]]:
    flat = a.ravel()
    idx = np.flatnonzero(np.diff(flat)) + 1
    starts = np.concatenate([[0], idx]); ends = np.concatenate([idx, [flat.size]])
    return [[int(flat[s]), int(e - s)] for s, e in zip(starts, ends)]


def summarize(a: np.ndarray, units: list[str]):
    tot = a.size
    return [{'code': c, 'name': u, 'cells': int((a == c).sum()), 'pct': round(100 * (a == c).sum() / tot, 2)}
            for c, u in enumerate(units)]


def main():
    meta = json.loads((SITE / 'meta.json').read_text())
    n, cell = meta['grid']['n'], meta['grid']['cell_m']
    z = np.fromfile(SITE / 'grid.bin', dtype='<f4').reshape(n, n).astype(np.float64)

    # --- stratigraphic level from Curiosity's track
    wp = [f['properties'] for f in json.loads(WAYPOINTS.read_text())['features']]
    lo_s, hi_s = BOXWORK_SOLS
    inside = [p['elev_geoid'] for p in wp if lo_s <= p['sol'] <= hi_s]
    before = [p['elev_geoid'] for p in wp if lo_s - 200 <= p['sol'] < lo_s]
    after = [p['elev_geoid'] for p in wp if hi_s < p['sol'] <= hi_s + 200]
    base, top = min(inside), max(inside)
    # sanity: the track before / after must sit below / above the band, or the proxy fails
    assert max(before) <= base + 0.5, (max(before), base)
    assert not after or min(after) >= top - 0.5, (min(after), top)
    bed = np.where(z < base, 1, np.where(z <= top, 2, 3)).astype(np.uint8)

    # --- terrain class
    gy, gx = np.gradient(z, cell)
    slope = np.degrees(np.arctan(np.hypot(gx, gy)))
    rel = z - gaussian(z, SIGMA_M / cell)
    surf = np.ones((n, n), np.uint8)
    surf[rel > RELIEF_M] = 2
    surf[rel < -RELIEF_M] = 3
    surf = majority3(surf, len(SURFACE))
    surf[slope > STEEP_DEG] = 4

    out = {
        'format': 'martian-map-geology/1', 'site': 'gale',
        'grid': {'n': n, 'cell_m': cell, 'order': 'row-major; row 0 = north edge', 'encoding': 'rle [code, count]'},
        'sample': 'grid node',
        'surface': {'field': 'terrain class (DEM-derived)', 'units': SURFACE, 'summary': summarize(surf, SURFACE), 'rle': rle(surf)},
        'bedrock': {'field': 'stratigraphic level (elevation proxy)', 'units': BEDROCK, 'summary': summarize(bed, BEDROCK), 'rle': rle(bed)},
        'unmappedCells': 0,
        'source': {
            'kind': 'derived',
            'short': 'Derived: Curiosity track + MSL Gale DEM (this project)',
            'title': 'Stratigraphic level from the elevation band of Curiosity\'s boxwork campaign; '
                     'terrain class from the MSL Gale merged DEM',
            'method': {
                'boxwork_sols': list(BOXWORK_SOLS),
                'boxwork_layer_elev_m': [round(base, 1), round(top, 1)],
                'track_below_max_m': round(max(before), 1), 'track_above_min_m': round(min(after), 1) if after else None,
                'relief_sigma_m': SIGMA_M, 'relief_threshold_m': RELIEF_M, 'steep_deg': STEEP_DEG,
                'assumption': 'layers on lower Mount Sharp are close to horizontal; lateral boxwork contacts not modelled',
            },
            'inputs': ['NASA/JPL MMGIS Curiosity waypoints', 'Parker & Calef (2016) MSL Gale Merged DEM 1m v3'],
            'license': 'derived from public-domain NASA / USGS data',
        },
        'generated_utc': dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds'),
        'generator': 'pipeline/build_gale_geology.py',
    }
    path = SITE / 'geology.json'
    path.write_text(json.dumps(out, separators=(',', ':')))
    print(f'boxwork layer {base:.1f} … {top:.1f} m (track before ≤ {max(before):.1f}, after ≥ {min(after) if after else float("nan"):.1f})')
    for k in ('bedrock', 'surface'):
        print(k, [(u['name'], u['pct']) for u in out[k]['summary'] if u['cells']])
    print(f'→ {path.relative_to(ROOT)} ({path.stat().st_size / 1e3:.0f} kB)')


if __name__ == '__main__':
    main()
