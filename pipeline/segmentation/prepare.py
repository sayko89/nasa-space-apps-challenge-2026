"""
Prepare the Mars training data from AI4Mars v0.6 (read remotely, file by file; nothing else is downloaded).

Sources (verified label key "NAV": 0 soil, 1 bedrock, 2 sand, 3 big rock, 255 no label):
  MSL Navcam  train      msl/ncam/labels/train            + images msl/ncam/images/edr
  MSL Navcam  test       msl/ncam/labels/test/masked-gold-min{1,2,3}-100agree (expert, 100 % agreement)
  M2020 NAV   train      m2020/labels/NAV                 + images m2020/images/{ncam,HAFIQ}
Excluded and logged: M2020_GEO (geology taxonomy), MSL Mastcam (undocumented value 4), MER (range mask not applied).

Checks: image/label matching, unreadable files, size mismatch, label values outside the key, empty labels,
exact duplicate images (SHA-1), M2020 duplicate labels (-1 … -4) and .jpg/.jpeg duplicates.
Split: by Mars day (sol) groups so near-identical images never straddle train / validation / test.
Outputs: $SEG_WORK/data/<set>.npz (uint8 images resized to short side 256, labels nearest-neighbour) and
pipeline/sources/ai4mars/manifest.json (every sample, its group, split and SHA-1; every rejection and why).
"""
import io, json, os, random, sys, collections, concurrent.futures as cf, threading, time
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(__file__))
from common import *

VAL_FRAC, M2020_TEST_FRAC, SEED = 0.12, 0.15, 1234
LIMIT = int(os.environ.get('SEG_LIMIT', '0'))          # optional cap per source (smoke runs); 0 = all
os.makedirs(OUT, exist_ok=True); os.makedirs(os.path.join(WORK, 'data'), exist_ok=True)
log = collections.defaultdict(list)                     # reason -> [names]

_local = threading.local()
def open_zip():
    """The downloaded archive (SEG_ZIP, one request — Zenodo limits anonymous clients to ~2,000 requests per hour,
    so per-file range requests cannot fetch 20k samples), else remote range requests (inventory-sized jobs only)."""
    local = os.environ.get('SEG_ZIP')
    if local and os.path.exists(local):
        import zipfile
        return zipfile.ZipFile(local)
    from remotezip import RemoteZip
    return RemoteZip(ZIP_URL)

def rz():
    if not hasattr(_local, 'z'): _local.z = open_zip()   # one handle per thread (zip handles are not thread-safe)
    return _local.z

def resize_pair(img, lab):
    w, h = img.size; s = SIZE / min(w, h)
    nw, nh = max(SIZE, round(w * s)), max(SIZE, round(h * s))
    img = img.resize((nw, nh), Image.BILINEAR)
    lab = lab.resize((nw, nh), Image.NEAREST) if lab is not None else None
    return img, lab

def read_retry(name, tries=6):
    """Range request with back-off (Zenodo throttles bursts); the last error is raised after `tries`."""
    for k in range(tries):
        try: return rz().read(name)
        except Exception as e:
            if k == tries - 1: raise
            print(f'retry {k + 1} {name}: {type(e).__name__}: {str(e)[:120]}', flush=True)
            if hasattr(_local, 'z') and not hasattr(_local.z, 'read_fake'):
                try: del _local.z
                except AttributeError: pass
            time.sleep(min(60, 2 ** k))

def load(sample):
    """Read, validate and resize one sample; returns (arrays, None) or (None, reason)."""
    try:
        raw = read_retry(sample['image'])
        img = Image.open(io.BytesIO(raw)); img.load()
    except Exception as e:
        return None, f'unreadable image ({type(e).__name__}: {str(e)[:60]})'
    try:
        lab = Image.open(io.BytesIO(read_retry(sample['label']))); lab.load()
    except Exception as e:
        return None, f'unreadable label ({type(e).__name__})'
    if lab.mode not in ('L', 'P'): return None, f'label mode {lab.mode}'
    if img.size != lab.size: return None, f'size mismatch image {img.size} label {lab.size}'
    a = np.array(lab)
    bad = set(np.unique(a).tolist()) - NAV_VALUES
    if bad: return None, f'label values outside the NAV key: {sorted(bad)}'
    if (a != IGNORE).sum() == 0: return None, 'empty label (no labelled pixel)'
    g = img.convert('L')                                  # Navcam: grey (M2020 colour Navcam → luminance)
    g, l = resize_pair(g, Image.fromarray(a))
    return {'img': np.array(g, np.uint8), 'lab': np.array(l, np.uint8), 'sha1': sha1(raw), 'orig': list(img.size)}, None

def assign_splits(samples, test_groups, rng, log):
    """Sol-grouped split. Samples whose split is already set (expert test) are left alone. MSL groups that hold an
    expert-test image are excluded from training (leakage guard). M2020: the first ~15 % of shuffled groups → test."""
    groups = collections.defaultdict(list)
    for s in samples:
        if s['split'] is None: groups[(s['source'], s['group'])].append(s)
    keys = sorted(groups); rng.shuffle(keys)
    n_m = sum(1 for k in keys if k[0] == 'm2020'); m_seen = 0
    for k in keys:
        src, g = k
        if src == 'msl' and g in test_groups:
            for s in groups[k]: s['split'] = 'excluded-test-sol'
            log['MSL train label on a sol of an expert-test image (leakage guard)'] += [s['label'] for s in groups[k]]
            continue
        if src == 'm2020' and m_seen < M2020_TEST_FRAC * n_m: sp = 'test-m2020'
        else: sp = 'val' if rng.random() < VAL_FRAC else 'train'
        if src == 'm2020': m_seen += 1
        for s in groups[k]: s['split'] = sp

def main():
    t0 = time.time()
    z = open_zip()
    print('archive:', os.environ.get('SEG_ZIP') or ZIP_URL, flush=True)
    names = [i.filename for i in z.infolist() if not i.is_dir()]
    by_dir = collections.defaultdict(list)
    for n in names: by_dir[os.path.dirname(n)[len(PREFIX):]].append(n)
    img_index = {}
    for d in ['msl/ncam/images/edr', 'm2020/images/ncam', 'm2020/images/HAFIQ']:
        for n in by_dir[d]:
            k = base_key(n)
            # M2020: keep the higher-quality .jpeg when both .jpg and .jpeg exist (dataset DATA_NOTES)
            if k in img_index and img_index[k].lower().endswith('.jpeg'): log['duplicate image (.jpg kept .jpeg)'].append(n); continue
            if k in img_index: log['duplicate image (.jpg kept .jpeg)'].append(img_index[k])
            img_index[k] = n
    for d, why in [('m2020/labels/M2020_GEO/ncam', 'geology taxonomy (M2020_GEO)'), ('m2020/labels/M2020_GEO/mcam', 'geology taxonomy (M2020_GEO)'),
                   ('msl/mcam/labels/train', 'MSL Mastcam: undocumented label value 4'), ('mer/labels/train/merged-unmasked', 'MER: range mask not applied')]:
        log[f'excluded set: {why}'].append(f'{len(by_dir[d])} labels in {d}')

    samples, seen_m2020 = [], set()
    def add(label, source, split_hint):
        k = base_key(label)
        if source == 'm2020':
            if k in seen_m2020: log['M2020 duplicate label (-1 … -4 of one image)'].append(label); return
            seen_m2020.add(k)
        img = img_index.get(k)
        if not img: log['label without image'].append(label); return
        grp = msl_sol_group(img) if source == 'msl' else m2020_sol_group(img)
        if not grp: log['no sol group'].append(label); return
        samples.append({'label': label, 'image': img, 'source': source, 'group': grp, 'split': split_hint})
    msl_test = {}
    for v in ('min1', 'min2', 'min3'):
        for n in by_dir[f'msl/ncam/labels/test/masked-gold-{v}-100agree']:
            if n.lower().endswith('.png'): msl_test.setdefault(base_key(n), {})[v] = n
    msl_train = [n for n in by_dir['msl/ncam/labels/train'] if n.lower().endswith('.png')]
    m2020_nav = sorted(n for n in by_dir['m2020/labels/NAV'] if n.lower().endswith('.png'))
    if LIMIT: msl_train, m2020_nav = msl_train[:LIMIT], m2020_nav[:LIMIT]
    test_groups = {msl_sol_group(img_index.get(k, '')) for k in msl_test} - {None}
    for n in msl_train:
        if base_key(n) in msl_test: log['MSL train label of an expert-test image (kept out)'].append(n); continue
        add(n, 'msl', None)
    for k, vs in msl_test.items():
        for v, n in vs.items(): add(n, 'msl', f'test-{v}')
    for n in m2020_nav: add(n, 'm2020', None)

    assign_splits(samples, test_groups, random.Random(SEED), log)
    work = [s for s in samples if s['split'] != 'excluded-test-sol']

    # ---- read, validate, resize (parallel range requests)
    arrays = {}
    with cf.ThreadPoolExecutor(int(os.environ.get('SEG_THREADS', '8'))) as ex:
        for s, (res, why) in zip(work, ex.map(load, work)):
            if why: log[why].append(s['label']); s['rejected'] = why; continue
            arrays[s['label']] = res; s['sha1'] = res['sha1']; s['orig_size'] = res['orig']
    # exact duplicate images (same bytes) across different names: keep the first, log the rest
    first = {}
    for s in work:
        if 'sha1' not in s: continue
        if s['sha1'] in first and first[s['sha1']]['split'] != s['split']:
            log['exact duplicate image across splits (dropped)'].append(s['label']); s['rejected'] = 'duplicate'; arrays.pop(s['label'], None)
        else: first.setdefault(s['sha1'], s)
    sets = collections.defaultdict(list)
    for s in work:
        if s['label'] in arrays: sets[s['split'] + ('' if s['split'].startswith('test') else f"-{s['source']}")].append(s)
    summary = {}
    for name, ss in sets.items():
        imgs = np.empty(len(ss), dtype=object); labs = np.empty(len(ss), dtype=object)
        cls = np.zeros(256, np.int64)
        for i, s in enumerate(ss):
            imgs[i] = arrays[s['label']]['img']; labs[i] = arrays[s['label']]['lab']
            cls += np.bincount(labs[i].ravel(), minlength=256)
        np.savez(os.path.join(WORK, 'data', f'{name}.npz'), imgs=imgs, labs=labs, names=np.array([s['label'] for s in ss]),
                 groups=np.array([s['group'] for s in ss]))
        summary[name] = {'samples': len(ss), 'groups': len({s['group'] for s in ss}),
                         'pixels': {CLASSES[c] if c < 4 else 'unlabelled': int(cls[c]) for c in (0, 1, 2, 3, 255)}}
    # leakage check: no group in two splits of the same source
    seen = collections.defaultdict(set)
    for s in work:
        if s['label'] in arrays and not s['split'].startswith('test-min'): seen[(s['source'], s['group'])].add(s['split'])
    leaks = {f'{k[0]}:{k[1]}': sorted(v) for k, v in seen.items() if len(v) > 1}
    manifest = {'dataset': 'AI4Mars merged v0.6', 'doi': '10.5281/zenodo.15995036', 'license': 'CC BY 4.0', 'seed': SEED,
                'size': f'short side {SIZE} px', 'splits': summary, 'leaking_groups': leaks,
                'rejections': {k: {'count': len(v), 'examples': v[:5]} for k, v in log.items()},
                'samples': [{k: s.get(k) for k in ('label', 'image', 'source', 'group', 'split', 'sha1', 'orig_size', 'rejected')} for s in samples],
                'seconds': round(time.time() - t0, 1)}
    json.dump(manifest, open(os.path.join(OUT, 'manifest.json'), 'w'), separators=(',', ':'))
    print(json.dumps({k: manifest[k] for k in ('splits', 'leaking_groups', 'seconds')}, indent=1))
    print('rejections:', {k: len(v) for k, v in log.items()})
    if leaks: sys.exit('split leakage detected')

if __name__ == '__main__':
    main()
