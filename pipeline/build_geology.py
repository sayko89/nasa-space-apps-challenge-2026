#!/usr/bin/env python3
"""
build_geology.py — Jezero jeoloji birimleri → site gridi (Aşama 6, bilim durakları).

Kaynak (CC BY 4.0, makalenin 18 Temmuz 2025 düzeltmesiyle):
  Stack, K. M., Williams, N. R., Calef, F., et al. (2020). Photogeologic Map of
  the Perseverance Rover Field Site in Jezero Crater Constructed by the Mars 2020
  Science Team. Space Science Reviews 216, 127.
  https://doi.org/10.1007/s11214-020-00739-x
  Ek dosya: 11214_2020_739_MOESM3_ESM.zip (shapefile, CaltechAUTHORS a7qs5-xhq84)

Shapefile: M2020_JEZ_geology_edited_equi0_allquads_v6_archive.{shp,shx,dbf,prj}
  Projeksiyon: Mars2000 Equidistant Cylindrical, clon=0, standart paralel 0,
  küre R=3396190 m → X = R·λ, Y = R·φ (radyan).
  Alanlar: quadname, SurfUName (yüzey birimi), BedrkUName (ana kaya birimi).
  Her poligon iki haritanın kesişimidir: bir hücre = bir (yüzey, ana kaya) çifti.

Yerel grid (build_site.py ile birebir aynı):
  +proj=eqc +lat_ts=φ0 +lat_0=φ0 +lon_0=λ0 +R → x = R·cosφ0·(λ−λ0), y = R·(φ−φ0)
  Kaynak eqc'den doğrusal: x = cosφ0·(X − R·λ0), y = Y − R·φ0
  Düğüm (satır r, sütun c): x = −span/2 + c·cell, y = +span/2 − r·cell (satır 0 = kuzey).

Rasterleştirme: her poligonun TÜM halkaları (dış + delikler) birlikte çift-tek
(even-odd) kuralıyla taranır; örnek noktası = düğüm (hücre merkezi). Kesişen
poligon yoksa kod 0 (haritalanmamış).

Çıktı: artifacts/moon-rover/public/sites/<site>/geology.json
  surface.rle / bedrock.rle: satır-öncelikli [kod, adet] çiftleri (n×n hücre)
  surface.units / bedrock.units: kod → birim adı (0 = "" haritalanmamış/boş)

Kullanım:
  pip install -r pipeline/requirements.txt
  python pipeline/build_geology.py                  # indirir (bir kez), önbelleğe alır
  python pipeline/build_geology.py --zip yol/11214_2020_739_MOESM3_ESM.zip
"""

from __future__ import annotations

import argparse
import datetime as _dt
import io
import json
import math
import os
import sys
import urllib.error
import urllib.request
import zipfile

import numpy as np

import struct

ZIP_URL = ("https://authors.library.caltech.edu/api/records/a7qs5-xhq84/files/"
           "11214_2020_739_MOESM3_ESM.zip/content")
ZIP_SIZE = 3476604
SHP_STEM = "M2020_JEZ_geology_edited_equi0_allquads_v6_archive"
R_MARS = 3396190.0

SOURCE = {
    "title": "Photogeologic Map of the Perseverance Rover Field Site in Jezero Crater "
             "Constructed by the Mars 2020 Science Team",
    "creators": "Stack, K. M., Williams, N. R., Calef, F., et al.",
    "year": 2020,
    "journal": "Space Science Reviews 216, 127",
    "doi": "https://doi.org/10.1007/s11214-020-00739-x",
    "license": "CC-BY-4.0",
    "license_note": "Makale 18 Temmuz 2025 düzeltmesiyle CC BY 4.0 altında yeniden lisanslandı.",
    "files": ["11214_2020_739_MOESM3_ESM.zip", SHP_STEM + ".shp"],
}


def parse_args(argv=None):
    p = argparse.ArgumentParser(description="Stack et al. 2020 geoloji haritası → geology.json")
    p.add_argument("--site", default="jezero")
    p.add_argument("--zip", default=None, help="yerel 11214_2020_739_MOESM3_ESM.zip")
    here = os.path.dirname(os.path.abspath(__file__))
    p.add_argument("--cache", default=os.path.join(here, ".cache"))
    p.add_argument("--out", default=os.path.join(here, "..", "artifacts", "moon-rover", "public", "sites"))
    return p.parse_args(argv)


def get_zip(args) -> bytes:
    if args.zip:
        with open(args.zip, "rb") as f:
            return f.read()
    os.makedirs(args.cache, exist_ok=True)
    cached = os.path.join(args.cache, "stack2020_geology.zip")
    if os.path.exists(cached) and os.path.getsize(cached) == ZIP_SIZE:
        print(f"[1/4] Önbellekten: {cached}")
        with open(cached, "rb") as f:
            return f.read()
    print(f"[1/4] İndiriliyor (3.5 MB, CC BY 4.0): {ZIP_URL}")
    # CaltechAUTHORS, Python'un varsayılan User-Agent'ını (Python-urllib) 403 ile reddediyor.
    req = urllib.request.Request(ZIP_URL, headers={
        "User-Agent": "Mozilla/5.0 (martian-map pipeline; +https://github.com/ugurfurkanyesil-rgb/final)",
        "Accept": "application/zip,application/octet-stream,*/*",
    })
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            data = r.read()
    except urllib.error.HTTPError as e:
        sys.exit(f"İndirme başarısız (HTTP {e.code}). Dosyayı tarayıcıyla indirip şöyle verin:\n"
                 f"  {ZIP_URL}\n"
                 f"  python pipeline/build_geology.py --zip <indirilen>/11214_2020_739_MOESM3_ESM.zip")
    if len(data) != ZIP_SIZE:
        sys.exit(f"Beklenmeyen boyut: {len(data)} B (beklenen {ZIP_SIZE} B)")
    with open(cached, "wb") as f:
        f.write(data)
    return data


# ---- Minimal ESRI shapefile okuyucu (yalnızca Polygon/PolygonZ/PolygonM + DBF) ----
# pyshp sürümleri boş (0 noktalı) poligon kayıtlarında farklı davranıyor (3.x hata
# fırlatıyor; bu arşivde böyle kayıtlar var). Biçim basit olduğundan kendimiz okuyoruz:
# ESRI Shapefile Technical Description (1998).
POLY_TYPES = (5, 15, 25)


def parse_shp(data: bytes):
    """Her kayıt için (parts, points[Nx2]) ya da None (null/boş/poligon olmayan)."""
    if len(data) < 100 or struct.unpack(">i", data[:4])[0] != 9994:
        raise ValueError("geçersiz .shp başlığı")
    out, off = [], 100
    while off + 8 <= len(data):
        _num, clen = struct.unpack(">ii", data[off:off + 8])
        body = data[off + 8: off + 8 + 2 * clen]
        off += 8 + 2 * clen
        if len(body) < 4:
            out.append(None); continue
        st = struct.unpack("<i", body[:4])[0]
        if st not in POLY_TYPES or len(body) < 44:
            out.append(None); continue
        nparts, npts = struct.unpack("<ii", body[36:44])
        if nparts <= 0 or npts <= 0:
            out.append(None); continue
        parts = list(struct.unpack(f"<{nparts}i", body[44:44 + 4 * nparts]))
        p0 = 44 + 4 * nparts
        pts = np.frombuffer(body, dtype="<f8", count=2 * npts, offset=p0).reshape(npts, 2)
        out.append((parts, pts))
    return out


def parse_dbf(data: bytes, encoding="latin-1"):
    """dBase III: (alan adları, kayıt listesi[str])."""
    nrec, hlen, rlen = struct.unpack("<IHH", data[4:12])
    fields, off = [], 32
    while data[off] != 0x0D:
        name = data[off:off + 11].split(b"\0", 1)[0].decode("ascii")
        fields.append((name, data[off + 16]))
        off += 32
    recs = []
    for r in range(nrec):
        base = hlen + r * rlen
        pos, row = base + 1, []          # ilk bayt: silinme işareti
        for _name, ln in fields:
            row.append(data[pos:pos + ln].decode(encoding, "replace").strip())
            pos += ln
        recs.append(row)
    return [f[0] for f in fields], recs


def open_shapefile(zbytes: bytes):
    """Döner: (shapes, field_names, records, prj)."""
    zf = zipfile.ZipFile(io.BytesIO(zbytes))
    names = {os.path.basename(n): n for n in zf.namelist() if not n.endswith("/")}
    need = [SHP_STEM + e for e in (".shp", ".dbf", ".prj")]
    missing = [n for n in need if n not in names]
    if missing:
        sys.exit(f"Arşivde eksik dosya: {missing}")
    rd = lambda e: zf.read(names[SHP_STEM + e])  # noqa: E731
    shapes = parse_shp(rd(".shp"))
    fields, recs = parse_dbf(rd(".dbf"))
    if len(shapes) != len(recs):
        sys.exit(f".shp {len(shapes)} kayıt, .dbf {len(recs)} kayıt — uyuşmuyor")
    return shapes, fields, recs, rd(".prj").decode("latin-1")


def check_prj(prj: str) -> None:
    """Varsayılan projeksiyonu doğrula: eqc, merkez boylamı 0, std paralel 0, R=3396190."""
    import re
    p = prj.replace(" ", "").lower()

    def num(key):
        m = re.search(r'"' + key + r'",(-?[0-9.]+)', p)
        return float(m.group(1)) if m else None

    sph = re.search(r'spheroid\[[^,]*,([0-9.]+)', p)
    ok = ("equidistant_cylindrical" in p
          and sph is not None and abs(float(sph.group(1)) - R_MARS) < 1
          and num("central_meridian") == 0.0 and num("standard_parallel_1") == 0.0
          and num("false_easting") in (None, 0.0) and num("false_northing") in (None, 0.0))
    if not ok:
        sys.exit(f"Beklenmeyen projeksiyon (.prj):\n{prj}")


def local_xy(X: np.ndarray, Y: np.ndarray, lat0: float, lon0: float):
    """Kaynak eqc(clon0, lat_ts0) metre → yerel gerçek ölçekli eqc metre."""
    c = math.cos(math.radians(lat0))
    return c * (X - R_MARS * math.radians(lon0)), Y - R_MARS * math.radians(lat0)


def rasterize_even_odd(rings: list[np.ndarray], n: int, cell: float) -> np.ndarray:
    """Halkaların (yerel x,y; kapalı) birleşimini çift-tek kuralıyla tarar.
    Düğüm (r, c) için örnek noktası x=−h+c·cell, y=h−r·cell (h = (n−1)·cell/2).
    Döner: (n, n) bool."""
    h = (n - 1) * cell / 2.0
    mask = np.zeros((n, n), dtype=bool)
    xa = np.concatenate([r[:-1, 0] for r in rings]); ya = np.concatenate([r[:-1, 1] for r in rings])
    xb = np.concatenate([r[1:, 0] for r in rings]); yb = np.concatenate([r[1:, 1] for r in rings])
    ymin = np.minimum(ya, yb); ymax = np.maximum(ya, yb)
    if ymax.max() < -h or ymin.min() > h:
        return mask
    r0 = max(0, int(math.floor((h - ymax.max()) / cell)))
    r1 = min(n - 1, int(math.ceil((h - ymin.min()) / cell)))
    cols_x = -h + np.arange(n) * cell
    for r in range(r0, r1 + 1):
        y = h - r * cell
        # yarı açık kural: ya<=y<yb veya yb<=y<ya (köşe çift sayımını önler)
        sel = (ya <= y) != (yb <= y)
        if not sel.any():
            continue
        t = (y - ya[sel]) / (yb[sel] - ya[sel])
        xs = np.sort(xa[sel] + t * (xb[sel] - xa[sel]))
        # her düğüm için solundaki kesişim sayısı tek mi?
        k = np.searchsorted(xs, cols_x, side="right")
        mask[r] = (k % 2) == 1
    return mask


def rle(a: np.ndarray) -> list[list[int]]:
    flat = a.ravel()
    if flat.size == 0:
        return []
    idx = np.flatnonzero(np.diff(flat)) + 1
    starts = np.concatenate([[0], idx]); ends = np.concatenate([idx, [flat.size]])
    return [[int(flat[s]), int(e - s)] for s, e in zip(starts, ends)]


def build_grids(shapes, fields, recs, n: int, cell: float, lat0: float, lon0: float):
    for need in ("SurfUName", "BedrkUName"):
        if need not in fields:
            sys.exit(f"DBF'de '{need}' alanı yok: {fields}")
    si, bi = fields.index("SurfUName"), fields.index("BedrkUName")
    h = (n - 1) * cell / 2.0
    surf = np.zeros((n, n), dtype=np.uint8); bed = np.zeros((n, n), dtype=np.uint8)
    owner = np.full((n, n), -1, dtype=np.int32)
    s_units, b_units = [""], [""]
    used = 0
    skipped_empty = 0
    for i, (shp, rec) in enumerate(zip(shapes, recs)):
        if shp is None:
            skipped_empty += 1
            continue
        parts, pts = shp
        x, y = local_xy(pts[:, 0], pts[:, 1], lat0, lon0)
        if x.max() < -h or x.min() > h or y.max() < -h or y.min() > h:
            continue
        xy = np.column_stack([x, y])
        bounds = list(parts) + [len(pts)]
        rings = [xy[a:b] for a, b in zip(bounds[:-1], bounds[1:]) if b - a >= 4]
        m = rasterize_even_odd(rings, n, cell)
        if not m.any():
            continue
        clash = m & (owner >= 0)
        if clash.any():
            print(f"  uyarı: kayıt {i} {int(clash.sum())} hücrede kayıt {int(owner[clash][0])} ile örtüşüyor (sonraki kazanır)")
        sname = str(rec[si] or "").strip(); bname = str(rec[bi] or "").strip()
        if sname not in s_units: s_units.append(sname)
        if bname not in b_units: b_units.append(bname)
        surf[m] = s_units.index(sname); bed[m] = b_units.index(bname); owner[m] = i
        used += 1
    if skipped_empty:
        print(f"  {skipped_empty} boş/null poligon kaydı atlandı")
    if len(s_units) > 255 or len(b_units) > 255:
        sys.exit("255'ten fazla birim — uint8 yetmez")
    return surf, bed, s_units, b_units, used, int((owner < 0).sum())


def summarize(grid: np.ndarray, units: list[str]) -> list[dict]:
    cnt = np.bincount(grid.ravel(), minlength=len(units))
    tot = grid.size
    return [{"code": k, "name": u, "cells": int(cnt[k]), "pct": round(100 * cnt[k] / tot, 2)}
            for k, u in enumerate(units)]


def build(args) -> dict:
    out_dir = os.path.abspath(os.path.join(args.out, args.site))
    meta_path = os.path.join(out_dir, "meta.json")
    if not os.path.exists(meta_path):
        sys.exit(f"{meta_path} yok — önce pipeline/build_site.py çalıştırın.")
    with open(meta_path, encoding="utf-8") as f:
        meta = json.load(f)
    n, cell = meta["grid"]["n"], meta["grid"]["cell_m"]
    lat0, lon0 = meta["center"]["lat_deg"], meta["center"]["lon_deg_east"]
    if abs(meta.get("projection", {}).get("mars_radius_m", R_MARS) - R_MARS) > 1:
        sys.exit("Site yarıçapı shapefile küresiyle (3396190 m) aynı değil")

    shapes, fields, recs, prj = open_shapefile(get_zip(args))
    check_prj(prj)
    print(f"[2/4] {len(shapes)} poligon; {n}×{n} grid, {cell} m (merkez {lat0}°K {lon0}°D)")
    surf, bed, s_units, b_units, used, empty = build_grids(shapes, fields, recs, n, cell, lat0, lon0)
    print(f"[3/4] {used} poligon pencereyle kesişti; {empty} hücre haritalanmamış")

    out = {
        "format": "martian-map-geology/1",
        "site": args.site,
        "grid": {"n": n, "cell_m": cell, "order": "row-major; row 0 = north edge", "encoding": "rle [code, count]"},
        "sample": "hücre merkezi (düğüm), çift-tek kuralı",
        "surface": {"field": "SurfUName", "units": s_units, "summary": summarize(surf, s_units), "rle": rle(surf)},
        "bedrock": {"field": "BedrkUName", "units": b_units, "summary": summarize(bed, b_units), "rle": rle(bed)},
        "unmappedCells": empty,
        "source": SOURCE,
        "generated_utc": _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds"),
        "generator": "pipeline/build_geology.py",
    }
    path = os.path.join(out_dir, "geology.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"[4/4] Yazıldı: {path} ({os.path.getsize(path) / 1024:.0f} KB)")
    for layer in ("bedrock", "surface"):
        for u in out[layer]["summary"]:
            if u["cells"]:
                print(f"    {layer:8s} {u['pct']:6.2f}%  {u['name'] or '(boş)'}")
    return out


def main(argv=None):
    build(parse_args(argv))


if __name__ == "__main__":
    main()
