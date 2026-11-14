"""
Relief shading for the 3D terrain: surface normals of the 1 m HiRISE DTM as a normal map.

  python pipeline/build_relief.py jezero gale

The 3D mesh is the 4 m grid (grid.bin), so lit by its own vertex normals it shows nothing smaller than ~8 m.
Here the same DTM is resampled onto a ~1 m grid covering exactly the same square as grid.bin and ortho.jpg (same
local projection as build_site.py) and its surface normals are encoded as an RGB normal map relative to the
horizontal plane:  R = east, G = north, B = up  (value = 127.5 × (n + 1)); image row 0 = north edge.
The scene gives the mesh flat (up) vertex normals and lights it with this map, so the shading is that of the 1 m
DTM — the measured relief, nothing invented; the mesh still carries the 4 m heights, shadows and silhouettes.
relief.json also records how much relief the 4 m mesh cannot show (1 m DTM − 4 m mesh). Output:
web/public/sites/<site>/relief.jpg (2048 × 2048) and relief.json.
"""
import json, os, sys
import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.fill import fillnodata
from rasterio.transform import from_origin
from rasterio.vrt import WarpedVRT
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
from build_site import local_crs, source_radius, to_gdal_path

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
N = 2048                                    # pixels across the site (≈ 1 m: the DTM's own posting)
SOURCES = {'jezero': 'pipeline/sources/hirise/jezero_dtm_1m_window.tif', 'gale': 'pipeline/sources/hirise/gale_dtm_1m_window.tif'}

def surface_normals(z, px):
    """Unit normals (east, north, up) of a height grid whose row 0 is the north edge and col 0 the west edge."""
    d_row, d_col = np.gradient(np.asarray(z, dtype=np.float64), px)
    dz_east, dz_north = d_col, -d_row                                # rows run north → south
    nrm = np.stack([-dz_east, -dz_north, np.ones_like(d_row)], -1)
    return nrm / np.linalg.norm(nrm, axis=-1, keepdims=True)

def encode_normals(nrm):
    """RGB = 127.5 · (n + 1): R east, G north, B up (the convention utils/relief.js decodes)."""
    return np.clip(np.round((nrm + 1) * 127.5), 0, 255).astype(np.uint8)

def build(site):
    sdir = os.path.join(ROOT, 'web', 'public', 'sites', site)
    meta = json.load(open(os.path.join(sdir, 'meta.json')))
    n4, cell4 = meta['grid']['n'], meta['grid']['cell_m']
    span = meta['grid']['span_m']; half = span / 2
    lat0, lon0 = meta['center']['lat_deg'], meta['center']['lon_deg_east']
    src = os.path.join(ROOT, SOURCES[site])
    with rasterio.open(to_gdal_path(src)) as ds:
        crs = local_crs(lat0, lon0, source_radius(ds.crs))
        px = span / N                                                 # pixel-is-area over exactly [−half, half]
        with WarpedVRT(ds, crs=crs, transform=from_origin(-half, half, px, px), width=N, height=N,
                       resampling=Resampling.bilinear, src_nodata=ds.nodata, nodata=ds.nodata) as vrt:
            band = vrt.read(1, masked=True)
    valid = ~np.ma.getmaskarray(band)
    z = np.ma.getdata(band).astype(np.float32)
    if (~valid).any(): z = fillnodata(z, mask=valid.astype(np.uint8), max_search_distance=64)
    # the 4 m mesh surface at the pixel centres (bilinear between grid nodes; nodes at −half + i·cell4)
    g = np.fromfile(os.path.join(sdir, 'grid.bin'), dtype='<f4').reshape(n4, n4).astype(np.float64)
    c = (np.arange(N) + 0.5) * px / cell4                             # pixel centre in node units (0 … n4−1)
    c = np.clip(c, 0, n4 - 1 - 1e-9); i0 = np.floor(c).astype(int); f = c - i0
    gr = g[i0] * (1 - f)[:, None] + g[i0 + 1] * f[:, None]           # rows (north → south)
    mesh = gr[:, i0] * (1 - f)[None, :] + gr[:, i0 + 1] * f[None, :]
    # grid.bin holds heights minus the site's median origin: compare like with like
    origin = float(np.median(z)) - float(np.median(mesh))
    resid = z.astype(np.float64) - origin - mesh
    resid -= np.median(resid)
    nrm = surface_normals(z, px)
    rgb = encode_normals(nrm)
    out = os.path.join(sdir, 'relief.jpg')
    Image.fromarray(rgb, 'RGB').save(out, quality=92, optimize=True)
    tilt = np.degrees(np.arccos(nrm[..., 2]))
    info = {'format': 'martian-map-relief/1', 'site': site, 'file': 'relief.jpg', 'size_px': N, 'pixel_m': round(px, 4),
            'encoding': 'normal map of the 1 m DTM relative to the horizontal; R east, G north, B up = 127.5·(n+1); row 0 = north, col 0 = west',
            'source': meta.get('source'), 'source_file': os.path.basename(src), 'nodata_filled_px': int((~valid).sum()),
            'residual_m': {'p1': round(float(np.percentile(resid, 1)), 3), 'p99': round(float(np.percentile(resid, 99)), 3),
                           'std': round(float(resid.std()), 3)},
            'slope_deg': {'median': round(float(np.median(tilt)), 2), 'p99': round(float(np.percentile(tilt, 99)), 2)},
            'note': 'residual_m = relief the 4 m mesh cannot show (1 m DTM minus the bilinear 4 m surface)',
            'generator': 'pipeline/build_relief.py'}
    json.dump(info, open(os.path.join(sdir, 'relief.json'), 'w'), indent=1)
    print(site, f'{os.path.getsize(out) / 1e6:.2f} MB', info['residual_m'], info['slope_deg'])

if __name__ == '__main__':
    for s in sys.argv[1:] or SOURCES: build(s)
