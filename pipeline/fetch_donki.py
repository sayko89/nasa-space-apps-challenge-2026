#!/usr/bin/env python3
"""
fetch_donki.py — NASA DONKI space-weather events since Curiosity landed.

The app asks DONKI live for the EVA date. This archive is the fallback when that request
fails (offline package, api.nasa.gov rate limit), so past dates always have an answer.

Output: pipeline/sources/donki/events.json  {SEP: [...], CME: [...], FLR: [...], coverage: [start, end]}
Then:   python pipeline/build_space_weather.py --site jezero  (and --site gale)

SEP and flares come in one request each, CMEs (which carry their full model runs) one
year at a time: 16 requests, inside the public DEMO_KEY limit. NASA_API_KEY overrides it.

    python pipeline/fetch_donki.py [--start 2012-08-06]
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'pipeline' / 'sources' / 'donki' / 'events.json'
KEY = os.environ.get('NASA_API_KEY') or 'DEMO_KEY'     # DEMO_KEY: 30 requests/hour per IP
# api.nasa.gov first: CCMC's own service does not answer from GitHub's runners (probe, 2026-11)
URLS = ['https://api.nasa.gov/DONKI/{kind}?startDate={start}&endDate={end}&api_key=' + KEY,
        'https://kauai.ccmc.gsfc.nasa.gov/DONKI/WS/get/{kind}?startDate={start}&endDate={end}']
# Months per request: SEP and flare lists are small, CMEs carry their model runs → yearly
WINDOW_MONTHS = {'SEP': 240, 'CME': 12, 'FLR': 240}
KINDS = ['SEP', 'CME', 'FLR']
CURIOSITY_LANDING = '2012-08-06'


def get_json(url: str, attempts: int = 2):
    last = None
    for i in range(attempts):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'martian-map-pipeline'})
            with urllib.request.urlopen(req, timeout=90) as r:
                body = r.read()
            return json.loads(body or b'[]') or []
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(3 * (i + 1))
    raise last


def windows(start: dt.date, end: dt.date, months: int = 6):
    a = start
    while a <= end:
        m = a.month - 1 + months
        b = dt.date(a.year + m // 12, m % 12 + 1, 1) - dt.timedelta(days=1)
        yield a, min(b, end)
        a = b + dt.timedelta(days=1)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--start', default=CURIOSITY_LANDING)
    args = ap.parse_args(argv)
    start, end = dt.date.fromisoformat(args.start), dt.date.today()
    events = {k: [] for k in KINDS}
    failed = []
    for kind in KINDS:
        for a, b in windows(start, end, WINDOW_MONTHS[kind]):
            for tmpl in URLS:
                url = tmpl.format(kind=kind, start=a.isoformat(), end=b.isoformat())
                try:
                    got = get_json(url)
                    events[kind] += got
                    print(f'{kind} {a}..{b}: {len(got):4d} from {url.split("/")[2]}')
                    break
                except Exception as e:  # noqa: BLE001
                    print(f'{kind} {a}..{b}: FAILED via {url.split("/")[2]}: {str(e).replace(KEY, "***")}')
            else:
                failed.append(f'{kind} {a}..{b}')
            time.sleep(0.5)
    if failed:
        # A gap would silently say "no events" for those dates — refuse to write a partial archive
        raise SystemExit(f'{len(failed)} windows failed: {failed[:5]}…')
    out = {**events, 'coverage': [start.isoformat(), end.isoformat()],
           'fetched_utc': dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds')}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, separators=(',', ':')))
    print({k: len(v) for k, v in events.items()}, '→', OUT.relative_to(ROOT), f'{OUT.stat().st_size / 1e6:.1f} MB')


if __name__ == '__main__':
    main()
