"""
AI4Mars v0.6 inventory, read remotely (HTTP range requests) — nothing is assumed about the layout.

  python pipeline/segmentation/ai4mars_inventory.py

Writes pipeline/sources/ai4mars/inventory.json (every directory with file counts and sizes, the
documentation files verbatim, and the pixel values found in a sample of label masks per folder).
Source: Swan, Ono, Atha (2022), AI4Mars v0.6, Zenodo, doi:10.5281/zenodo.15995036, CC BY 4.0.
"""
import io, json, os, random, sys, collections, time
from remotezip import RemoteZip
import numpy as np
from PIL import Image

URL = 'https://zenodo.org/records/15995036/files/ai4mars-dataset-merged-0.6.zip?download=1'
OUT = os.path.join(os.path.dirname(__file__), '..', 'sources', 'ai4mars')
os.makedirs(OUT, exist_ok=True)

t0 = time.time()
with RemoteZip(URL) as z:
    infos = z.infolist()
    dirs = collections.defaultdict(lambda: {'files': 0, 'bytes': 0, 'ext': collections.Counter(), 'examples': []})
    for i in infos:
        if i.is_dir(): continue
        d = os.path.dirname(i.filename)
        e = dirs[d]; e['files'] += 1; e['bytes'] += i.file_size; e['ext'][os.path.splitext(i.filename)[1].lower()] += 1
        if len(e['examples']) < 3: e['examples'].append(os.path.basename(i.filename))
    docs = {}
    for i in infos:
        n = i.filename.lower()
        if not i.is_dir() and (n.endswith(('.txt', '.md', '.json', '.csv', '.pdf', 'readme')) or 'readme' in n) and i.file_size < 2_000_000:
            raw = z.read(i.filename)
            docs[i.filename] = raw.decode('utf-8', 'replace')[:20000] if not n.endswith('.pdf') else f'<pdf {len(raw)} bytes>'
    # label encoding: pixel values in a random sample of label PNGs per label folder
    rng = random.Random(0)
    values = {}
    for d, e in dirs.items():
        if not ('label' in d.lower() or 'mask' in d.lower()): continue
        pngs = [i.filename for i in infos if os.path.dirname(i.filename) == d and i.filename.lower().endswith('.png')]
        hist = collections.Counter(); modes = collections.Counter(); shapes = collections.Counter()
        for f in rng.sample(pngs, min(12, len(pngs))):
            im = Image.open(io.BytesIO(z.read(f))); modes[im.mode] += 1
            a = np.array(im); shapes[str(a.shape)] += 1
            u, c = np.unique(a, return_counts=True)
            for k, v in zip(u.tolist(), c.tolist()): hist[str(k)] += v
        values[d] = {'sampled': min(12, len(pngs)), 'modes': dict(modes), 'shapes': dict(shapes), 'pixel_values': dict(sorted(hist.items(), key=lambda x: int(x[0]) if x[0].lstrip('-').isdigit() else 0))}

inv = {'source': URL, 'doi': '10.5281/zenodo.15995036', 'license': 'CC BY 4.0', 'files': len([i for i in infos if not i.is_dir()]),
       'bytes': sum(i.file_size for i in infos), 'seconds': round(time.time() - t0, 1),
       'dirs': {d: {**e, 'ext': dict(e['ext'])} for d, e in sorted(dirs.items())}, 'label_pixel_values': values, 'docs': docs}
json.dump(inv, open(os.path.join(OUT, 'inventory.json'), 'w'), indent=1)
print(f"{inv['files']} files, {inv['bytes']/1e9:.2f} GB, {len(dirs)} folders, {len(docs)} doc files, {inv['seconds']} s")
for d, e in sorted(dirs.items()): print(f"  {e['files']:7d}  {e['bytes']/1e6:9.1f} MB  {d}")
