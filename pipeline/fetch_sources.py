"""Download the raw source data for the extra map layers into pipeline/sources/.

    python pipeline/fetch_sources.py

Runs in GitHub Actions (.github/workflows/fetch-sources.yml), which commits the result,
so the build scripts work offline afterwards. Every file keeps its original name and the
manifest records where it came from.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / 'sources'
UA = {'User-Agent': 'Mozilla/5.0 (martian-map data pipeline; +https://github.com/sayko89/nasa-space-apps-challenge-2026)'}

SOURCES = {
    'themis_ti/Jezero_Thermal_Inertia_v1.tiff': {
        'url': 'https://zenodo.org/records/4931348/files/Jezero_Thermal_Inertia_v1.tiff?download=1',
        'citation': 'Edwards, C. S. & Buz, J. (2021). THEMIS-derived Thermal Inertia of Jezero Crater, Mars. Zenodo. doi:10.5281/zenodo.4931348 (CC BY 4.0)',
    },
    'crism/jezeroFinal.tif': {
        'url': 'https://zenodo.org/records/5575824/files/jezeroFinal.tif?download=1',
        'citation': 'Parente, M., Saranathan, A. M., Itoh, Y., Tarnas, J. D., Seelos, F. P., Mustard, J. F. (2021). Map of the dominant mineralogy over and around the Mars2020 landing ellipse. Zenodo. doi:10.5281/zenodo.5575824 (CC BY 4.0)',
    },
    'crism/Jezero_readme.pdf': {'url': 'https://zenodo.org/records/5575824/files/Jezero_readme.pdf?download=1'},
    'crism/jezeroEM.png': {'url': 'https://zenodo.org/records/5575824/files/jezeroEM.png?download=1'},
    'crism/mineralSpectra_mapped_v2.sli.hdr': {'url': 'https://zenodo.org/records/5575824/files/mineralSpectra_mapped_v2.sli.hdr?download=1'},
    'm20/M20_waypoints.json': {
        'url': 'https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_waypoints.json',
        'citation': 'NASA/JPL-Caltech, Mars 2020 Perseverance rover waypoints (MMGIS)',
    },
}

# CCMC's own DONKI web service: same database as api.nasa.gov/DONKI, no API key or rate limit.
DONKI = 'https://kauai.ccmc.gsfc.nasa.gov/DONKI/WS/get/{kind}?startDate={start}&endDate={end}'


def get(url: str) -> bytes:
    for attempt in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001
            if attempt == 3:
                raise
            print(f'  retry {attempt + 1}: {e}')
            time.sleep(5 * (attempt + 1))
    raise RuntimeError(url)


def main() -> None:
    manifest = {'fetched_utc': dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds'), 'files': {}}
    errors = {}
    old = json.loads((OUT / 'manifest.json').read_text()).get('files', {}) if (OUT / 'manifest.json').exists() else {}
    for rel, meta in SOURCES.items():
        path = OUT / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        if path.exists() and rel in old:  # already fetched and recorded
            manifest['files'][rel] = old[rel]
            continue
        try:
            data = get(meta['url'])
        except Exception as e:  # noqa: BLE001 — keep going, report at the end
            errors[rel] = repr(e)
            print(f'{rel}: FAILED {e}')
            continue
        path.write_bytes(data)
        manifest['files'][rel] = {**meta, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
        print(f'{rel}: {len(data) / 1e6:.2f} MB')

    # Space weather since landing (2021-02-18), in yearly chunks to keep requests small.
    events = {}
    for kind in ['SEP', 'CME', 'FLR', 'GST', 'IPS']:
        events[kind] = []
        for year in range(2021, dt.date.today().year + 1):
            start = f'{year}-01-01' if year > 2021 else '2021-02-18'
            end = min(dt.date(year, 12, 31), dt.date.today()).isoformat()
            try:
                raw = get(DONKI.format(kind=kind, start=start, end=end))
                items = json.loads(raw or b'[]') or []
            except Exception as e:  # noqa: BLE001
                errors[f'donki/{kind}/{year}'] = repr(e)
                items = []
            events[kind].extend(items)
            time.sleep(1)
        print(f'DONKI {kind}: {len(events[kind])} events')
    (OUT / 'donki').mkdir(parents=True, exist_ok=True)
    (OUT / 'donki' / 'events.json').write_text(json.dumps(events))
    manifest['files']['donki/events.json'] = {
        'url': DONKI.format(kind='<SEP|CME|FLR|GST|IPS>', start='2021-02-18', end='today'),
        'citation': 'NASA CCMC Space Weather Database Of Notifications, Knowledge, Information (DONKI)',
    }
    manifest['errors'] = errors
    (OUT / 'manifest.json').write_text(json.dumps(manifest, indent=2))


if __name__ == '__main__':
    main()
