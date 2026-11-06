#!/usr/bin/env python3
"""
build_space_weather.py — DONKI space-weather events relevant to a Mars surface EVA.

Input:  pipeline/sources/donki/events.json   (pipeline/fetch_sources.py, NASA CCMC DONKI)
Output: web/public/sites/<site>/space_weather.json

Kept:
  SEP  solar energetic particle events — the main radiation hazard for a crew outside
  CME  coronal mass ejections whose WSA-ENLIL model run predicts an impact at Mars
       (time = modelled arrival at Mars)
  FLR  X-class flares (prompt warning that particles may follow)

    python pipeline/build_space_weather.py
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'pipeline' / 'sources' / 'donki' / 'events.json'


def instruments(e) -> list[str]:
    return [i.get('displayName', '') for i in (e.get('instruments') or []) if isinstance(i, dict)]


def mars_arrivals(cme) -> list[str]:
    out = []
    for a in cme.get('cmeAnalyses') or []:
        for run in a.get('enlilList') or []:
            for imp in run.get('impactList') or []:
                if str(imp.get('location', '')).lower() == 'mars' and imp.get('arrivalTime'):
                    out.append(imp['arrivalTime'])
    return sorted(set(out))


def build(raw: dict) -> list[dict]:
    events = []
    for e in raw.get('SEP') or []:
        events.append({'type': 'SEP', 'time': e.get('eventTime'), 'id': e.get('sepID'),
                       'instruments': instruments(e), 'link': e.get('link')})
    for e in raw.get('CME') or []:
        arr = mars_arrivals(e)
        if arr:
            sp = [a.get('speed') for a in e.get('cmeAnalyses') or [] if a.get('speed')]
            events.append({'type': 'CME', 'time': arr[0], 'id': e.get('activityID'), 'departed': e.get('startTime'),
                           'speedKmS': max(sp) if sp else None, 'note': 'WSA-ENLIL modelled arrival at Mars', 'link': e.get('link')})
    for e in raw.get('FLR') or []:
        cls = str(e.get('classType') or '')
        if cls.startswith('X'):
            events.append({'type': 'FLR', 'time': e.get('peakTime') or e.get('beginTime'), 'id': e.get('flrID'),
                           'class': cls, 'link': e.get('link')})
    events = [e for e in events if e['time']]
    for e in events:  # normalise to ISO with Z
        e['time'] = e['time'].replace('Z', '') + 'Z'
    return sorted(events, key=lambda e: e['time'])


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--site', default='jezero')
    args = ap.parse_args(argv)
    raw = json.loads(SRC.read_text())
    events = build(raw)
    manifest = json.loads((SRC.parent.parent / 'manifest.json').read_text())
    fetched = manifest.get('fetched_utc', '')[:10]
    out = {
        'format': 'martian-map-space-weather/1',
        'coverage': ['2021-02-18', fetched or dt.date.today().isoformat()],
        'counts': {t: sum(e['type'] == t for e in events) for t in ('SEP', 'CME', 'FLR')},
        'events': events,
        'source': {'title': 'Space Weather Database Of Notifications, Knowledge, Information (DONKI)',
                   'publisher': 'NASA Community Coordinated Modeling Center', 'url': 'https://kauai.ccmc.gsfc.nasa.gov/DONKI/'},
        'generator': 'pipeline/build_space_weather.py',
    }
    path = ROOT / 'web/public/sites' / args.site / 'space_weather.json'
    path.write_text(json.dumps(out, separators=(',', ':')))
    print(f"{out['counts']} → {path.relative_to(ROOT)} ({path.stat().st_size / 1e3:.0f} kB)")


if __name__ == '__main__':
    main()
