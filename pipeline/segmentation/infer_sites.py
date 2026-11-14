"""
Run the exported Mars terrain model (ONNX) on the rover images of each site and store IMAGE-LEVEL predictions.

  python infer_sites.py            (needs network access to mars.nasa.gov)

Images: the ground-view frames already listed in web/public/sites/<site>/pov.json —
  Jezero: Perseverance NAVCAM frames only (Mastcam-Z is another camera: out of the training domain, skipped)
  Gale:   Curiosity Navcam frames
  up to 3 frames per rover position, those looking at the ground (elevation ≤ 0°), most downward first.
Outputs per site in web/public/sites/<site>/segmentation/: <id>.png (class per pixel: 0 soil, 1 bedrock, 2 sand,
3 big rock, 255 = below the low-confidence threshold), <id>.conf.png (confidence × 255) and index.json with the
source image, rover position, camera, sol, time, sizes, model version, prediction time and class statistics.
The predictions are NOT georeferenced: no camera model or range data are used, so they are never drawn on the map.
"""
import io, json, os, sys, time, datetime, urllib.request, collections
import numpy as np, onnxruntime as ort
from PIL import Image
sys.path.insert(0, os.path.dirname(__file__))
from common import *

MODEL = os.path.join(ROOT, 'web', 'public', 'models')
card = json.load(open(os.path.join(MODEL, 'mars-terrain-v1.json')))
sess = ort.InferenceSession(os.path.join(MODEL, card['file']), providers=['CPUExecutionProvider'])
THR = card['low_confidence_threshold']
PER_STATION = 3

def fetch(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'martian-map-pipeline'})
    with urllib.request.urlopen(req, timeout=60) as r: return r.read()

def predict(img):
    g = img.convert('L'); w, h = g.size; s = SIZE / min(w, h)
    g = g.resize((max(SIZE, round(w * s)), max(SIZE, round(h * s))), Image.BILINEAR)
    a = np.array(g, np.float32) / 255
    x = np.repeat(((a - card['input']['normalise']['mean']) / card['input']['normalise']['std'])[None, None], 3, 1).astype(np.float32)
    p = sess.run(None, {'image': x})[0][0]
    return p.argmax(0).astype(np.uint8), p.max(0)

def frames_for(site, st):
    """Candidate frames, most downward first (the caller keeps the first PER_STATION usable ones)."""
    fr = [f for f in st['frames'] if (f['camera'].startswith('NAVCAM') if site == 'jezero' else f['camera'].startswith('NAV'))]
    fr = [f for f in fr if f.get('el') is not None and f['el'] <= 0]
    return sorted(fr, key=lambda f: f['el'])

def usable(img):
    """Full frames only: subframe strips (e.g. 800×150 browse products) are too thin to segment."""
    w, h = img.size
    return min(w, h) >= SIZE and max(w, h) / min(w, h) <= 2.0

def main():
    t0 = time.time(); log = collections.Counter()
    for site, mission in (('jezero', 'Mars 2020 (Perseverance)'), ('gale', 'Mars Science Laboratory (Curiosity)')):
        pov = json.load(open(os.path.join(ROOT, 'web', 'public', 'sites', site, 'pov.json')))
        out_dir = os.path.join(ROOT, 'web', 'public', 'sites', site, 'segmentation'); os.makedirs(out_dir, exist_ok=True)
        skipped_cam = sum(1 for st in pov['stations'] for f in st['frames'] if site == 'jezero' and not f['camera'].startswith('NAVCAM'))
        items, errors = [], []
        for st in pov['stations']:
            kept = 0
            for f in frames_for(site, st):
                if kept >= PER_STATION: break
                url = f.get('medium') or f.get('small')
                iid = os.path.splitext(os.path.basename(url))[0]
                try:
                    raw = fetch(url); img = Image.open(io.BytesIO(raw)); img.load()
                except Exception as e:
                    errors.append({'url': url, 'error': f'{type(e).__name__}: {e}'[:200]}); log['download error'] += 1; continue
                if not usable(img):
                    log[f'{site} skipped: subframe / strip {img.size[0]}×{img.size[1]}'] += 1; continue
                kept += 1
                cls, conf = predict(img)
                shown = cls.copy(); shown[conf < THR] = IGNORE
                Image.fromarray(shown).save(os.path.join(out_dir, f'{iid}.png'), optimize=True)
                Image.fromarray(np.round(conf * 255).astype(np.uint8)).save(os.path.join(out_dir, f'{iid}.conf.png'), optimize=True)
                n = shown.size
                items.append({'id': iid, 'image_url': url, 'source_page': f.get('link'), 'mission': mission, 'camera': f['camera'],
                              'sol': f.get('sol'), 'utc': f.get('utc'), 'station': st['rmc'], 'rover_x': st['x'], 'rover_z': st['z'],
                              'rover_lat': st['lat'], 'rover_lon': st['lon'], 'azimuth_deg': f.get('az'), 'elevation_deg': f.get('el'),
                              'image_size': list(img.size), 'mask_size': [int(shown.shape[1]), int(shown.shape[0])],
                              'fractions': {c: round(float((shown == i).sum()) / n, 4) for i, c in enumerate(CLASSES)} | {'unknown': round(float((shown == IGNORE).sum()) / n, 4)},
                              'confidence': {'mean': round(float(conf.mean()), 3), 'median': round(float(np.median(conf)), 3), 'p10': round(float(np.percentile(conf, 10)), 3)}})
                log[f'{site} predicted'] += 1
        index = {'site': site, 'model': card['version'], 'model_card': '../../../models/mars-terrain-v1.json', 'low_confidence_threshold': THR,
                 'predicted_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds'),
                 'kind': 'model prediction (image level) — not a NASA measurement, not georeferenced',
                 'selection': f'up to {PER_STATION} full Navcam frames per rover position looking at the ground (elevation ≤ 0°), most downward first',
                 'skipped': {'other cameras (out of training domain)': skipped_cam, 'download errors': len(errors),
                             'subframe strips (too thin to segment)': sum(v for k, v in log.items() if k.startswith(f'{site} skipped'))},
                 'credit': pov.get('credit'), 'items': items, 'errors': errors[:50]}
        json.dump(index, open(os.path.join(out_dir, 'index.json'), 'w'), indent=0)
    print(dict(log), round(time.time() - t0, 1), 's')

if __name__ == '__main__':
    main()
