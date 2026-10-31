#!/usr/bin/env python3
"""
build_climate.py — Jezero hava sıcaklığı iklimolojisi (Perseverance MEDA).

Kaynak (CC BY 4.0):
  Hueso, R., Munguira, A., Sánchez-Lavega, A., de la Torre-Juárez, M.,
  Rodríguez-Manfredi, J. A., Lepinette, A., Vicente-Retortillo, Á., Lemmon, M.
  (2024). Derived environmental temperatures at Jezero crater from Air
  Temperature Sensors' measurements on the Perseverance rover (v2). Zenodo.
  https://doi.org/10.5281/zenodo.11198655
  İlgili makale: Munguira et al. (2024), JGR Planets.

Kullanılan dosyalar ("Processed data for analysis.zip", 22.7 MB):
  Fig 9/ATS_DER_5mins_averages.xlsx       SOL, LTST, sigma, mean  (1.45 m, 5 dk ortalama, K)
  Figs 4-7/Fourier_series_fit_145cm.xlsx  SOL, Ls, ...            (sol → Ls eşlemesi)

Çıktı: artifacts/moon-rover/public/sites/<site>/climate.json
  Ls dilimi (varsayılan 10°) × 288 LTST dilimi (5 dk) için, o dilimdeki tüm
  solların 5 dk ortalamalarının medyanı, %10 ve %90'lık değerleri ve sol sayısı.
  Veri ~1 Mars yılını kapsar (sol 16–700); "iklimoloji" = gözlenen yıl(lar).

Kullanım:
  pip install -r pipeline/requirements.txt
  python pipeline/build_climate.py                    # indirir (bir kez), önbelleğe alır
  python pipeline/build_climate.py --zip yol/Processed_data.zip
"""

from __future__ import annotations

import argparse
import datetime as _dt
import io
import json
import math
import os
import sys
import urllib.request
import zipfile

import numpy as np

try:
    from openpyxl import load_workbook
except ImportError:  # pragma: no cover
    sys.exit("openpyxl gerekli: pip install -r pipeline/requirements.txt")

ZIP_URL = ("https://zenodo.org/api/records/11198655/files/"
           "Processed%20data%20for%20analysis.zip/content")
ZIP_SIZE = 22664869
ATS_MEMBER = "Fig 9/ATS_DER_5mins_averages.xlsx"
FOURIER_MEMBER = "Figs 4-7/Fourier_series_fit_145cm.xlsx"
SLOTS = 288                     # 24 h / 5 min
SLOT_H = 24.0 / SLOTS

SOURCE = {
    "title": "Derived environmental temperatures at Jezero crater from Air Temperature "
             "Sensors' measurements on the Perseverance rover (v2)",
    "creators": "Hueso, Munguira, Sánchez-Lavega, de la Torre-Juárez, Rodríguez-Manfredi, "
                "Lepinette, Vicente-Retortillo, Lemmon",
    "year": 2024,
    "doi": "https://doi.org/10.5281/zenodo.11198655",
    "license": "CC-BY-4.0",
    "paper": "Munguira et al. (2024), One Martian Year of Near-Surface Temperatures at Jezero "
             "from MEDA measurements on Mars2020/Perseverance, JGR Planets",
    "files": [ATS_MEMBER, FOURIER_MEMBER],
}


def parse_args(argv=None):
    p = argparse.ArgumentParser(description="MEDA ATS → Jezero climate.json")
    p.add_argument("--site", default="jezero")
    p.add_argument("--zip", default=None, help="yerel 'Processed data for analysis.zip'")
    p.add_argument("--ls-bin", type=float, default=10.0, help="Ls dilim genişliği [°]")
    here = os.path.dirname(os.path.abspath(__file__))
    p.add_argument("--cache", default=os.path.join(here, ".cache"))
    p.add_argument("--out", default=os.path.join(here, "..", "artifacts", "moon-rover", "public", "sites"))
    return p.parse_args(argv)


def get_zip(args) -> bytes:
    if args.zip:
        with open(args.zip, "rb") as f:
            return f.read()
    os.makedirs(args.cache, exist_ok=True)
    cached = os.path.join(args.cache, "meda_processed_data.zip")
    if os.path.exists(cached) and os.path.getsize(cached) == ZIP_SIZE:
        print(f"[1/4] Önbellekten: {cached}")
        with open(cached, "rb") as f:
            return f.read()
    print(f"[1/4] İndiriliyor (22.7 MB, CC BY 4.0): {ZIP_URL}")
    with urllib.request.urlopen(ZIP_URL, timeout=120) as r:
        data = r.read()
    if len(data) != ZIP_SIZE:
        sys.exit(f"Beklenmeyen boyut: {len(data)} B (beklenen {ZIP_SIZE} B)")
    with open(cached, "wb") as f:
        f.write(data)
    return data


def read_sheet(zf: zipfile.ZipFile, member: str):
    """İlk sayfanın satırlarını (başlık hariç) döndürür; başlık → sütun indeksi."""
    wb = load_workbook(io.BytesIO(zf.read(member)), read_only=True, data_only=True)
    ws = wb.worksheets[0]
    it = ws.iter_rows(values_only=True)
    header = [str(h).strip() if h is not None else "" for h in next(it)]
    rows = list(it)
    wb.close()
    return {h: i for i, h in enumerate(header)}, rows


def sol_to_ls(fourier_cols, fourier_rows):
    """Fourier tablosundaki (SOL, Ls) çiftlerinden, ara sollar için aradeğerlemeli eşleme."""
    si, li = fourier_cols["SOL"], fourier_cols["Ls"]
    pairs = sorted((int(r[si]), float(r[li])) for r in fourier_rows
                   if r[si] is not None and r[li] is not None)
    sols = np.array([p[0] for p in pairs], dtype=float)
    # 360→0 sıçramasını DERECE üzerinde aç. Radyan↔derece gidiş-dönüşü 60.0'ı
    # 59.99999999999999 yapıp solu yanlış Ls dilimine düşürüyordu (gerçek veride
    # yakalandı: Ls 50–60/60–70 dilimlerinde 22/22 yerine 21/23 sol).
    ls = np.unwrap(np.array([p[1] for p in pairs], dtype=float), period=360.0)
    def f(sol):
        return float(np.interp(sol, sols, ls, left=np.nan, right=np.nan) % 360.0)
    return f, (int(sols[0]), int(sols[-1]))


def build(args) -> dict:
    zf = zipfile.ZipFile(io.BytesIO(get_zip(args)))
    print("[2/4] Tablolar okunuyor (ATS 5 dk ortalamaları ~290 bin satır, birkaç dakika sürebilir)")
    fcols, frows = read_sheet(zf, FOURIER_MEMBER)
    ls_of, (sol_lo, sol_hi) = sol_to_ls(fcols, frows)
    acols, arows = read_sheet(zf, ATS_MEMBER)
    for need in ("SOL", "LTST", "mean"):
        if need not in acols:
            sys.exit(f"ATS tablosunda '{need}' sütunu yok: {list(acols)}")
    si, ti, mi = acols["SOL"], acols["LTST"], acols["mean"]

    nbins = int(round(360.0 / args.ls_bin))
    cells = [[[] for _ in range(SLOTS)] for _ in range(nbins)]
    sols_in_bin = [set() for _ in range(nbins)]
    used = skipped = 0
    for r in arows:
        sol, t, m = r[si], r[ti], r[mi]
        if sol is None or t is None or m is None or (isinstance(m, float) and math.isnan(m)):
            skipped += 1
            continue
        ls = ls_of(float(sol))
        if math.isnan(ls):                    # Fourier tablosunun kapsamı dışı
            skipped += 1
            continue
        b = int(ls // args.ls_bin) % nbins
        s = int(round(float(t) / SLOT_H)) % SLOTS
        cells[b][s].append(float(m))
        sols_in_bin[b].add(int(sol))
        used += 1
    print(f"[3/4] {used} ölçüm kullanıldı, {skipped} boş/eşlenemeyen satır atlandı")

    def q(vals, p):
        return round(float(np.percentile(vals, p)), 1) if vals else None

    bins = []
    for b in range(nbins):
        bins.append({
            "ls0": round(b * args.ls_bin, 3), "ls1": round((b + 1) * args.ls_bin, 3),
            "nSols": len(sols_in_bin[b]),
            "median": [q(v, 50) for v in cells[b]],
            "p10": [q(v, 10) for v in cells[b]],
            "p90": [q(v, 90) for v in cells[b]],
        })

    out = {
        "format": "martian-map-climate/1",
        "site": args.site,
        "variable": "air temperature at 1.45 m (MEDA ATS, derived), 5-min means",
        "units": "K",
        "lsBinDeg": args.ls_bin,
        "ltstStepH": SLOT_H,
        "solRange": [sol_lo, sol_hi],
        "stats": "per (Ls bin, LTST slot): median / p10 / p90 over all sols in the bin",
        "source": SOURCE,
        "generated_utc": _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds"),
        "generator": "pipeline/build_climate.py",
        "bins": bins,
    }
    out_dir = os.path.abspath(os.path.join(args.out, args.site))
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, "climate.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    filled = sum(1 for b in bins for v in b["median"] if v is not None)
    print(f"[4/4] Yazıldı: {path} ({os.path.getsize(path) / 1024:.0f} KB, "
          f"{filled}/{nbins * SLOTS} hücre dolu)")
    return out


def main(argv=None):
    build(parse_args(argv))


if __name__ == "__main__":
    main()
