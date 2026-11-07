#!/usr/bin/env python3
"""
build_climate_rems.py — Gale air-temperature climatology (Curiosity REMS).

Input:  pipeline/sources/rems/rems_5min.csv.gz (pipeline/fetch_rems.py, GitHub Actions)
        one row per (sol, 5-min LTST slot): Ls and the mean reliable AMBIENT_TEMP.
Output: web/public/sites/gale/climate.json — the same format as the Jezero MEDA file
        (martian-map-climate/1): per Ls bin (10°) × 288 LTST slots, median / p10 / p90 of the
        sols' 5-min means, and the number of sols in the bin.

REMS does not record continuously: on most sols it samples the first 5 minutes of every hour,
plus longer blocks that move around the sol. So within one Ls bin some 5-min slots have no sol.
Empty slots are filled by linear interpolation in LTST between the nearest filled slots of the
same bin, only when that gap is at most --max-gap-h (default 1 h, i.e. between two hourly
samples). Wider gaps stay null; the app already skips null slots. The number of filled and
interpolated slots is recorded per bin.

Some sols show sudden drops to −115…−120 °C around sunset that the confidence flags do not
catch; an outlier screen against the other sols of the same season and time drops them.

    python pipeline/build_climate_rems.py
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import gzip
import json
from collections import defaultdict
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'pipeline' / 'sources' / 'rems'
SLOTS = 288
SLOT_H = 24.0 / SLOTS
OUTLIER_WIN = 3          # ±3 slots = ±15 min

SOURCE = {
    'title': 'MSL Rover Environmental Monitoring Station (REMS) — MODRDR, estimated ambient air temperature',
    'short': 'REMS (Curiosity)',
    'creators': 'Gómez-Elvira, J. et al. (Centro de Astrobiología, CSIC-INTA); NASA PDS Atmospheres Node',
    'year': 2026,
    'url': 'https://atmos.nmsu.edu/data_and_services/atmospheres_data/MARS/curiosity/rems.html',
    'doi': None,
    'license': 'public domain (NASA PDS)',
    'paper': 'Gómez-Elvira, J. et al. (2012), REMS: The Environmental Sensor Suite for the Mars Science '
             'Laboratory Rover, Space Sci. Rev. 170, 583-640',
}


def fill_gaps(med: list, max_gap_slots: int) -> tuple[list, int]:
    """Circular linear interpolation across null runs of at most max_gap_slots."""
    n = len(med)
    have = [i for i, v in enumerate(med) if v is not None]
    if len(have) < 2:
        return med, 0
    out, filled = list(med), 0
    for k, a in enumerate(have):
        b = have[(k + 1) % len(have)]
        gap = (b - a) % n - 1
        if gap <= 0 or gap > max_gap_slots:
            continue
        va, vb = med[a], med[b]
        for j in range(1, gap + 1):
            out[(a + j) % n] = round(va + (vb - va) * j / (gap + 1), 1)
            filled += 1
    return out, filled


def build(args) -> dict:
    nbins = int(round(360.0 / args.ls_bin))
    cells = [[[] for _ in range(SLOTS)] for _ in range(nbins)]
    sols_in_bin = [set() for _ in range(nbins)]
    col_n, col_m = ('n_strict', 'mean_strict_k') if args.strict else ('n', 'mean_k')
    used = 0
    sol_lo, sol_hi = 10**9, -1
    recs = []                                   # (bin, slot, sol, value)
    with gzip.open(SRC / 'rems_5min.csv.gz', 'rt') as f:
        for r in csv.DictReader(f):
            if not r[col_m] or int(r[col_n] or 0) < args.min_samples:
                continue
            sol, slot, ls = int(r['sol']), int(r['slot']), float(r['ls'])
            recs.append((int(ls // args.ls_bin) % nbins, slot, sol, float(r[col_m])))

    # Outlier screen. Some sols show sudden drops to −115…−120 °C (and swings back) around
    # sunset that the confidence flags do not catch. Each 5-min mean is compared with the
    # median of all sols in the same Ls bin within ±OUTLIER_WIN slots; it is dropped when it is
    # further than max(5 × robust sigma, 10 K) from it.
    pool = defaultdict(list)
    for b, s, _, v in recs:
        pool[(b, s)].append(v)
    rejected, rej_hour = 0, defaultdict(int)
    for b, s, sol, v in recs:
        ref = [x for d in range(-OUTLIER_WIN, OUTLIER_WIN + 1) for x in pool.get((b, (s + d) % SLOTS), [])]
        med = float(np.median(ref))
        sig = 1.4826 * float(np.median(np.abs(np.array(ref) - med)))
        if abs(v - med) > max(5 * sig, 10.0):
            rejected += 1
            rej_hour[int(s * SLOT_H)] += 1
            continue
        cells[b][s].append(v)
        sols_in_bin[b].add(sol)
        sol_lo, sol_hi = min(sol_lo, sol), max(sol_hi, sol)
        used += 1
    print(f'outlier screen: dropped {rejected} of {len(recs)} sol-slots; by LTST hour {dict(sorted(rej_hour.items()))}')

    def q(vals, p):
        return round(float(np.percentile(vals, p)), 1) if vals else None

    max_gap = int(round(args.max_gap_h / SLOT_H))
    bins, tot_meas, tot_interp = [], 0, 0
    for b in range(nbins):
        med = [q(v, 50) for v in cells[b]]
        p10 = [q(v, 10) for v in cells[b]]
        p90 = [q(v, 90) for v in cells[b]]
        measured = sum(v is not None for v in med)
        med, k = fill_gaps(med, max_gap)
        p10, _ = fill_gaps(p10, max_gap)
        p90, _ = fill_gaps(p90, max_gap)
        tot_meas += measured; tot_interp += k
        bins.append({'ls0': round(b * args.ls_bin, 3), 'ls1': round((b + 1) * args.ls_bin, 3),
                     'nSols': len(sols_in_bin[b]), 'slotsMeasured': measured, 'slotsInterpolated': k,
                     'median': med, 'p10': p10, 'p90': p90})

    man = json.loads((SRC / 'rems_manifest.json').read_text())
    out = {
        'format': 'martian-map-climate/1', 'site': args.site,
        'variable': 'air temperature at ~1.6 m (REMS ATS, estimated ambient), 5-min means',
        'instrument': 'REMS ATS', 'heightM': 1.6, 'units': 'K',
        'lsBinDeg': args.ls_bin, 'ltstStepH': SLOT_H, 'solRange': [sol_lo, sol_hi],
        'stats': 'per (Ls bin, LTST slot): median / p10 / p90 over the sols with data in the slot; '
                 f'gaps up to {args.max_gap_h:g} h linearly interpolated in LTST (slotsInterpolated)',
        'filter': (man['filter'] if not args.strict else man['filter'] + ' (strict used)')
                  + f'; outlier screen: 5-min means further than max(5 robust sigma, 10 K) from the median of '
                    f'the Ls bin within ±{OUTLIER_WIN * 5} min dropped',
        'minSamplesPerSlot': args.min_samples,
        'source': SOURCE | {'product': man['product'], 'sols': man['requested']},
        'generated_utc': dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds'),
        'generator': 'pipeline/build_climate_rems.py',
        'bins': bins,
    }
    path = ROOT / 'web' / 'public' / 'sites' / args.site / 'climate.json'
    path.write_text(json.dumps(out, ensure_ascii=False, separators=(',', ':')))
    print(f'{used} sol-slots used, sols {sol_lo}–{sol_hi}; slots measured {tot_meas}/{nbins * SLOTS}, '
          f'interpolated {tot_interp}, empty {nbins * SLOTS - tot_meas - tot_interp}')
    print(f'→ {path.relative_to(ROOT)} ({path.stat().st_size / 1024:.0f} KB)')
    return out


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('--site', default='gale')
    ap.add_argument('--ls-bin', type=float, default=10.0)
    ap.add_argument('--max-gap-h', type=float, default=1.0)
    ap.add_argument('--min-samples', type=int, default=30, help='1 Hz readings needed in a 5-min slot')
    ap.add_argument('--strict', action='store_true', help='use only readings with error < 5 K')
    build(ap.parse_args(argv))


if __name__ == '__main__':
    main()
