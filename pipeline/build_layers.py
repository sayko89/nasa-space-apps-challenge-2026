#!/usr/bin/env python3
"""
build_layers.py — extra Martian Map layers on the site grid.

Reads the raw sources fetched by pipeline/fetch_sources.py (pipeline/sources/) and writes
artifacts/moon-rover/public/sites/<site>/layers.json, sampled onto exactly the same grid as
grid.bin (meta.json: n, cell_m, local equirectangular projection):

  thermal_inertia   THEMIS-derived thermal inertia [J m^-2 K^-1 s^-1/2], 100 m source
                    (Edwards & Buz 2021, CC BY 4.0). Low = dust/sand, high = rock/bedrock.
  minerals          CRISM dominant-mineral map, 36 m source (Parente et al. 2021, CC BY 4.0).
                    Class + confidence decoded from the RGB key in the dataset README.
  rock_relief       Sub-cell relief from the 1 m HiRISE DTM [m]: in every 4 m cell, the
                    largest height difference left after removing the cell's best-fit plane.
                    Large boulders and rock outcrops show up; slope alone does not.

Encodings (JSON, no binary side files):
  continuous  {"scale","offset","n","b64"}: uint16 little-endian, value = raw*scale + offset,
              raw 0 = no data. Stored at n×n of the site grid.
  categorical {"classes":[...], "rle":[[code,count],...]} row-major, code 0 = no data / none.

    python pipeline/build_layers.py               # all layers whose source is present
"""
from __future__ import annotations

import argparse
import base64
import datetime as dt
import json
import math
from pathlib import Path

import numpy as np
import rasterio
from rasterio.crs import CRS
from rasterio.enums import Resampling
from rasterio.transform import from_origin
from rasterio.vrt import WarpedVRT

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'pipeline' / 'sources'

# CRISM mineral key (Jezero_readme.pdf, slide 5): name → (high-confidence RGB, medium-confidence RGB)
CRISM_KEY = [
    ('Olivine', (255, 0, 0), (153, 0, 0)),
    ('Mg-carbonate', (0, 255, 0), (0, 153, 0)),
    ('Fe/Mg-smectite', (0, 255, 255), (0, 153, 153)),
    ('Olivine + smectite', (255, 128, 114), (153, 77, 68)),
    ('Olivine/smectite + 2.2 µm', (128, 128, 0), (77, 77, 0)),
    ('Carbonate + 2.2 µm', (255, 215, 0), (153, 129, 0)),
    ('High-Ca pyroxene', (255, 128, 0), (153, 77, 0)),
    ('Low-Ca pyroxene', (218, 165, 32), (130, 99, 19)),
    ('Kaolinite', (139, 69, 19), (83, 41, 11)),
    ('Mg-smectite 2', (0, 0, 255), (0, 0, 153)),
]


def site_grid(site: str):
    meta = json.loads((ROOT / 'artifacts/moon-rover/public/sites' / site / 'meta.json').read_text())
    n, cell = meta['grid']['n'], meta['grid']['cell_m']
    R = meta['projection']['mars_radius_m']
    lat0, lon0 = meta['center']['lat_deg'], meta['center']['lon_deg_east']
    crs = CRS.from_proj4(f'+proj=eqc +lat_ts={lat0} +lat_0={lat0} +lon_0={lon0} +x_0=0 +y_0=0 +R={R} +units=m +no_defs')
    half = (n - 1) * cell / 2
    transform = from_origin(-half - cell / 2, half + cell / 2, cell, cell)
    return meta, n, cell, crs, transform


def warp(path: Path, n, crs, transform, resampling, band=None, nodata=None):
    with rasterio.open(path) as ds:
        nd = ds.nodata if nodata is None else nodata
        with WarpedVRT(ds, crs=crs, transform=transform, width=n, height=n, resampling=resampling,
                       src_nodata=nd, nodata=nd) as vrt:
            return vrt.read(band if band else None), nd


def rle(a: np.ndarray) -> list[list[int]]:
    flat = a.ravel()
    idx = np.flatnonzero(np.diff(flat)) + 1
    starts = np.concatenate([[0], idx])
    ends = np.concatenate([idx, [flat.size]])
    return [[int(flat[s]), int(e - s)] for s, e in zip(starts, ends)]


def pack_continuous(v: np.ndarray, valid: np.ndarray, step: float) -> dict:
    lo = float(np.floor(v[valid].min() / step) * step) - step
    q = np.zeros(v.shape, dtype='<u2')
    q[valid] = np.clip(np.round((v[valid] - lo) / step), 1, 65535).astype('<u2')
    return {'scale': step, 'offset': lo, 'n': int(v.shape[0]), 'b64': base64.b64encode(q.tobytes()).decode()}


def stats(v, valid):
    x = v[valid]
    return {'min': round(float(x.min()), 3), 'p50': round(float(np.median(x)), 3),
            'max': round(float(x.max()), 3), 'coverage': round(float(valid.mean()), 4)}


def thermal_inertia(n, crs, transform):
    path = SRC / 'themis_ti' / 'Jezero_Thermal_Inertia_v1.tiff'
    data, nd = warp(path, n, crs, transform, Resampling.bilinear, band=1, nodata=0)
    valid = np.isfinite(data) & (data > 0)
    return {
        'kind': 'continuous', 'unit': 'J m⁻² K⁻¹ s⁻½', 'label': 'Thermal inertia (THEMIS)',
        'dataType': 'thermal',
        'stats': stats(data, valid),
        'interpretation': [[0, 150, 'dust / fine sand'], [150, 300, 'sand, small clasts'],
                           [300, 600, 'coarse clasts, indurated'], [600, 1e9, 'rock / bedrock']],
        'interpretation_note': 'Rough classes after Putzig & Mellon (2007) and Fergason et al. (2006); guidance only.',
        **pack_continuous(data.astype(np.float64), valid, 1.0),
        'source': {'title': 'THEMIS-derived Thermal Inertia of Jezero Crater, Mars', 'creators': 'Edwards, C. S. & Buz, J.',
                   'year': 2021, 'doi': 'https://doi.org/10.5281/zenodo.4931348', 'license': 'CC BY 4.0',
                   'mission': '2001 Mars Odyssey / THEMIS', 'resolution_m': 100},
    }


def minerals(n, crs, transform):
    path = SRC / 'crism' / 'jezeroFinal.tif'
    rgb, _ = warp(path, n, crs, transform, Resampling.nearest, nodata=None)
    rgb = rgb[:3].astype(np.int16)
    code = np.zeros((n, n), dtype=np.uint8)       # 0 = not identified / outside
    conf = np.zeros((n, n), dtype=np.uint8)       # 2 = high, 1 = medium
    for k, (_, hi, med) in enumerate(CRISM_KEY, start=1):
        for c, col in ((2, hi), (1, med)):
            m = (np.abs(rgb[0] - col[0]) <= 2) & (np.abs(rgb[1] - col[1]) <= 2) & (np.abs(rgb[2] - col[2]) <= 2)
            code[m] = k
            conf[m] = c
    classes = ['none'] + [k[0] for k in CRISM_KEY]
    counts = {classes[k]: int((code == k).sum()) for k in range(1, len(classes)) if (code == k).any()}
    return {
        'kind': 'categorical', 'label': 'Minerals (CRISM)', 'dataType': 'spectral',
        'classes': classes,
        'colors': [[40, 40, 40]] + [list(k[1]) for k in CRISM_KEY],
        'rle': rle(code), 'confidence_rle': rle(conf),
        'cells': counts,
        'note': 'Mineral names are the closest match of each spectral prototype (dataset README). Medium-confidence pixels are kept and flagged.',
        'source': {'title': 'Map of the dominant mineralogy over and around the Mars2020 landing ellipse',
                   'creators': 'Parente, M., Saranathan, A. M., Itoh, Y., Tarnas, J. D., Seelos, F. P., Mustard, J. F.',
                   'year': 2021, 'doi': 'https://doi.org/10.5281/zenodo.5575824', 'license': 'CC BY 4.0',
                   'mission': 'Mars Reconnaissance Orbiter / CRISM', 'resolution_m': 36,
                   'scenes': ['HRL000040FF', 'FRT000047A3', 'FRT00005C5E', 'FRS00031442']},
    }


def rock_relief(n, cell, crs, transform):
    """Detrended max-min relief of the 1 m DTM inside each site cell."""
    path = SRC / 'hirise' / 'jezero_dtm_1m_window.tif'
    k = int(round(cell))                        # 1 m pixels per site cell side (4)
    fine_n = n * k
    half = (n - 1) * cell / 2
    fine_t = from_origin(-half - cell / 2, half + cell / 2, cell / k, cell / k)
    z, nd = warp(path, fine_n, crs, fine_t, Resampling.bilinear, band=1)
    z = z.astype(np.float64)
    bad = ~np.isfinite(z) | ((z == nd) if nd is not None else False) | (np.abs(z) > 1e5)
    z = z.reshape(n, k, n, k).transpose(0, 2, 1, 3).reshape(n, n, k * k)
    bad = bad.reshape(n, k, n, k).transpose(0, 2, 1, 3).reshape(n, n, k * k)
    # best-fit plane per cell: z = a + b*x + c*y over the k×k block
    yy, xx = np.mgrid[0:k, 0:k]
    A = np.stack([np.ones(k * k), xx.ravel(), yy.ravel()], 1)
    P = A @ np.linalg.pinv(A)                   # projection onto the plane
    zf = np.where(bad, np.nanmean(np.where(bad, np.nan, z), axis=2, keepdims=True), z)
    resid = zf - zf @ P.T
    relief = resid.max(axis=2) - resid.min(axis=2)
    valid = ~bad.any(axis=2) & np.isfinite(relief)
    relief = np.where(valid, relief, 0)
    return {
        'kind': 'continuous', 'unit': 'm', 'label': 'Rock relief (HiRISE 1 m DTM)', 'dataType': 'topographic',
        'stats': stats(relief, valid),
        'method': f'max−min of the 1 m DTM after removing each {cell:g} m cell\'s best-fit plane',
        'note': 'Proxy for boulders and rock outcrops. A 1 m DTM resolves features of a few metres; smaller rocks are not seen.',
        **pack_continuous(relief, valid, 0.01),
        'source': {'title': 'Mars 2020 Terrain Relative Navigation HiRISE DTM Mosaic (1 m)', 'creators': 'USGS Astrogeology',
                   'year': 2020, 'doi': 'https://doi.org/10.5066/P9REJ9JN', 'license': 'public domain',
                   'mission': 'Mars Reconnaissance Orbiter / HiRISE', 'resolution_m': 1},
    }


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--site', default='jezero')
    args = ap.parse_args(argv)
    meta, n, cell, crs, transform = site_grid(args.site)
    out = {'format': 'martian-map-layers/1', 'site': args.site,
           'grid': {'n': n, 'cell_m': cell, 'order': 'row-major; row 0 = north edge, col 0 = west edge'},
           'layers': {}}
    builders = [
        ('thermal_inertia', SRC / 'themis_ti' / 'Jezero_Thermal_Inertia_v1.tiff', lambda: thermal_inertia(n, crs, transform)),
        ('minerals', SRC / 'crism' / 'jezeroFinal.tif', lambda: minerals(n, crs, transform)),
        ('rock_relief', SRC / 'hirise' / 'jezero_dtm_1m_window.tif', lambda: rock_relief(n, cell, crs, transform)),
    ]
    for name, src, fn in builders:
        if not src.exists():
            print(f'  skip {name}: {src.relative_to(ROOT)} missing (run pipeline/fetch_sources.py)')
            continue
        layer = fn()
        out['layers'][name] = layer
        print(f'  {name}: {json.dumps(layer.get("stats") or layer.get("cells"))}')
    out['generated_utc'] = dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds')
    out['generator'] = 'pipeline/build_layers.py'
    path = ROOT / 'artifacts/moon-rover/public/sites' / args.site / 'layers.json'
    path.write_text(json.dumps(out, separators=(',', ':')))
    print(f'→ {path.relative_to(ROOT)} ({path.stat().st_size / 1e3:.0f} kB)')


if __name__ == '__main__':
    main()
