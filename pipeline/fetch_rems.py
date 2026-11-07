#!/usr/bin/env python3
"""
fetch_rems.py — Curiosity REMS air temperature, reduced to 5-minute LTST means.

Source: REMS MODRDR (environmental magnitudes corrected for factors that influence the
measurements), PDS Atmospheres Node, volume mslrem_1001. Column AMBIENT_TEMP = "Estimated
ambient air temperature" (K), with a 9-character confidence string (MODRDR6.FMT):
  byte 7 = operational range (1 = error < 5 K), byte 8 = observation reliability (1 = reliable).

For every sol in [--first, --last] this downloads the sol's MODRDR table (~12 MB at 1 Hz),
keeps only reliable readings, and reduces them on the fly to 5-minute LTST slots. Nothing
but the reduced table is kept:

  pipeline/sources/rems/rems_5min.csv.gz   sol, slot (0-287), ls, n, mean (all reliable),
                                          n_strict, mean_strict (reliable AND error < 5 K)
  pipeline/sources/rems/rems_manifest.json sols requested / found / missing, counts

Ls is computed per row from UTC (label START_TIME + spacecraft-clock offset) with the
Mars24 algorithm (Allison & McEwen 2000) — the same constants as web/src/utils/marsTime.js.

Needs network access (runs in GitHub Actions).

    python pipeline/fetch_rems.py --first 4175 --last 4843
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import gzip
import io
import json
import math
import re
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'pipeline' / 'sources' / 'rems'
BASE = 'https://atmos.nmsu.edu/PDS/data/mslrem_1001/DATA/'
UA = {'User-Agent': 'martian-map data pipeline (+https://github.com/sayko89/nasa-space-apps-challenge-2026)'}
SLOTS = 288
SLOT_H = 24.0 / SLOTS

# ---------------------------------------------------------------- Mars24 (Allison & McEwen 2000)
J2000 = 2451545.0
D2R = math.pi / 180
PBS = [(0.0071, 2.2353, 49.409), (0.0057, 2.7543, 168.173), (0.0039, 1.1177, 191.837),
       (0.0037, 15.7866, 21.736), (0.0021, 2.1354, 15.704), (0.0020, 2.4694, 95.528),
       (0.0018, 32.8493, 49.095)]


def tt_minus_utc(t: dt.datetime) -> float:
    # REMS data start in 2012: TAI-UTC was 35 s until 2015-07-01, 36 s until 2017-01-01, 37 s since.
    if t < dt.datetime(2012, 7, 1, tzinfo=dt.timezone.utc):
        return 34 + 32.184
    if t < dt.datetime(2015, 7, 1, tzinfo=dt.timezone.utc):
        return 35 + 32.184
    if t < dt.datetime(2017, 1, 1, tzinfo=dt.timezone.utc):
        return 36 + 32.184
    return 37 + 32.184


def solar_longitude(t: dt.datetime) -> float:
    """UTC datetime → Ls [deg]."""
    jd = 2440587.5 + t.timestamp() / 86400
    j = jd + tt_minus_utc(t) / 86400 - J2000
    m = ((19.3870 + 0.52402075 * j) % 360) * D2R
    fms = (270.3863 + 0.52403840 * j) % 360
    pbs = sum(a * math.cos(((0.985626 * j / tau) + phi) * D2R) for a, tau, phi in PBS)
    eoc = ((10.691 + 3.0e-7 * j) * math.sin(m) + 0.6230 * math.sin(2 * m) + 0.0500 * math.sin(3 * m)
           + 0.0050 * math.sin(4 * m) + 0.0005 * math.sin(5 * m) + pbs)
    return (fms + eoc) % 360


# ---------------------------------------------------------------- download helpers
def get(url: str, tries: int = 5) -> bytes | None:
    err = None
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=180) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            err = e
        except Exception as e:  # noqa: BLE001
            err = e
        time.sleep(4 * (attempt + 1))
    raise RuntimeError(f'{url}: {err}')


def ranges() -> list[tuple[int, int, str]]:
    html = get(BASE).decode('latin-1')
    out = sorted({(int(a), int(b), f'SOL_{a}_{b}') for a, b in re.findall(r'SOL_(\d{5})_(\d{5})', html)})
    return out


def parse_time(s: str) -> dt.datetime:
    s = s.strip().strip('"').rstrip('Z')
    fmt = '%Y-%m-%dT%H:%M:%S.%f' if '.' in s else '%Y-%m-%dT%H:%M:%S'
    return dt.datetime.strptime(s, fmt).replace(tzinfo=dt.timezone.utc)


def reduce_sol(sol: int, folder: str) -> dict:
    """Download one sol's MODRDR table and reduce it to 5-min slots. Returns a summary dict."""
    base = f'{BASE}{folder}/SOL{sol:05d}/'
    listing = get(base)
    if listing is None:
        return {'sol': sol, 'status': 'no folder'}
    names = sorted(set(re.findall(r'RME_\d+RMD[A-Z0-9_]+\.(?:TAB|LBL)', listing.decode('latin-1'))))
    tabs = [n for n in names if n.endswith('.TAB')]
    if not tabs:
        return {'sol': sol, 'status': 'no MODRDR'}
    slots: dict[tuple[int, int], list[float]] = {}   # (ltst sol, slot) → [sum, n, sum_s, n_s, ls]
    rows = rel = strict = 0
    for tab in tabs:                                 # usually one per sol; take all versions' latest only
        lbl = get(base + tab[:-4] + '.LBL')
        if lbl is None:
            continue
        lt = lbl.decode('latin-1')
        t0 = parse_time(re.search(r'START_TIME\s*=\s*(\S+)', lt).group(1))
        c0 = float(re.search(r'SPACECRAFT_CLOCK_START_COUNT\s*=\s*"?([\d.]+)', lt).group(1))
        raw = get(base + tab)
        if raw is None:
            continue
        ls_cache: dict[int, float] = {}
        for r in csv.reader(io.StringIO(raw.decode('latin-1'))):
            if len(r) < 17:
                continue
            rows += 1
            try:
                amb = float(r[15])
            except ValueError:
                continue
            flag = r[16].strip().strip('"').strip()
            if amb <= 0 or len(flag) < 9 or flag[8] != '1':
                continue
            rel += 1
            m = re.match(r'\s*(\d+)\s+(\d+):(\d+):(\d+)', r[2].strip().strip('"'))
            if not m:
                continue
            lsol, hh, mm, ss = map(int, m.groups())
            h = hh + mm / 60 + ss / 3600
            s = int(round(h / SLOT_H))
            if s == SLOTS:
                s, lsol = 0, lsol + 1
            key = (lsol, s)
            acc = slots.get(key)
            if acc is None:
                try:
                    clk = float(r[0])
                except ValueError:
                    clk = c0
                minute = int(clk // 3600)
                if minute not in ls_cache:
                    ls_cache[minute] = solar_longitude(t0 + dt.timedelta(seconds=clk - c0))
                acc = slots[key] = [0.0, 0, 0.0, 0, ls_cache[minute]]
            acc[0] += amb; acc[1] += 1
            if flag[7] != '0':
                acc[2] += amb; acc[3] += 1
                strict += 1
        break                                        # one table per sol
    out = [(k[0], k[1], round(v[4], 3), v[1], round(v[0] / v[1], 3),
            v[3], round(v[2] / v[3], 3) if v[3] else '') for k, v in sorted(slots.items())]
    return {'sol': sol, 'status': 'ok', 'rows': rows, 'reliable': rel, 'strict': strict, 'slots': out}


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('--first', type=int, required=True)
    ap.add_argument('--last', type=int, required=True)
    ap.add_argument('--workers', type=int, default=6)
    args = ap.parse_args(argv)
    OUT.mkdir(parents=True, exist_ok=True)

    rg = ranges()
    print(f'{len(rg)} sol ranges, last {rg[-1][2]}', flush=True)

    def folder(sol):
        for a, b, name in rg:
            if a <= sol <= b:
                return name
        return None

    sols = [s for s in range(args.first, args.last + 1) if folder(s)]
    results, t0 = [], time.time()
    with ThreadPoolExecutor(args.workers) as ex:
        futs = {ex.submit(reduce_sol, s, folder(s)): s for s in sols}
        for i, f in enumerate(as_completed(futs), 1):
            s = futs[f]
            try:
                r = f.result()
            except Exception as e:  # noqa: BLE001
                r = {'sol': s, 'status': f'error: {e}'}
            results.append(r)
            if i % 25 == 0 or i == len(sols):
                print(f'  {i}/{len(sols)} sols · {time.time() - t0:.0f} s · last sol {s}: {r["status"]}', flush=True)

    results.sort(key=lambda r: r['sol'])
    with gzip.open(OUT / 'rems_5min.csv.gz', 'wt', newline='') as f:
        w = csv.writer(f)
        w.writerow(['sol', 'slot', 'ls', 'n', 'mean_k', 'n_strict', 'mean_strict_k'])
        for r in results:
            for row in r.get('slots', []):
                w.writerow(row)
    ok = [r for r in results if r['status'] == 'ok']
    man = {
        'source': BASE, 'product': 'REMS MODRDR (mslrem_1001), column AMBIENT_TEMP',
        'requested': [args.first, args.last], 'sols_ok': len(ok),
        'missing': {r['sol']: r['status'] for r in results if r['status'] != 'ok'},
        'rows': sum(r.get('rows', 0) for r in ok), 'reliable': sum(r.get('reliable', 0) for r in ok),
        'strict': sum(r.get('strict', 0) for r in ok),
        'filter': 'AMBIENT_TEMP_CONFIDENCE_LEVEL byte 8 (reliability) = 1; strict also byte 7 (error < 5 K) != 0',
        'generated_utc': dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds'),
    }
    (OUT / 'rems_manifest.json').write_text(json.dumps(man, indent=1))
    print(json.dumps({k: v for k, v in man.items() if k != 'missing'}, indent=1))
    print(f'missing sols: {len(man["missing"])}')


if __name__ == '__main__':
    main()
