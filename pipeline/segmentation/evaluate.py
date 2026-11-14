"""
Evaluate every trained model, select one on the VALIDATION sets, report the test sets, export it to ONNX.

Test sets (never used for training or selection):
  test-min1/2/3  MSL Navcam (Curiosity, Gale-type images), expert labels, 100 % agreement of ≥1/2/3 experts
  test-m2020     Perseverance Navcam (Jezero), sol-grouped hold-out of CROWDSOURCED labels (no expert set exists)
Outputs: pipeline/sources/ai4mars/evaluation.json, eval/*.png (image · ground truth · prediction · overlay),
web/public/models/mars-terrain-v1.onnx + mars-terrain-v1.json (model card).
"""
import glob, json, os, sys, time, datetime
import numpy as np, torch
from PIL import Image
sys.path.insert(0, os.path.dirname(__file__))
from common import *
from metrics import confusion, scores, calibration
from train import build, to_tensor, load_set

MODEL_DIR = os.path.join(ROOT, 'web', 'public', 'models'); os.makedirs(MODEL_DIR, exist_ok=True)
EVAL_DIR = os.path.join(OUT, 'eval'); os.makedirs(EVAL_DIR, exist_ok=True)
VERSION = 'mars-terrain-v1'

@torch.no_grad()
def run(model, imgs, labs, keep_conf=False):
    cm = np.zeros((4, 4), np.int64); confs, corr = [], []
    for img, lab in zip(imgs, labs):
        p = model(to_tensor(img).unsqueeze(0))['out'][0].softmax(0)
        c, pred = p.max(0); pred = pred.numpy(); c = c.numpy()
        cm += confusion(pred, lab)
        if keep_conf:
            m = lab != IGNORE; confs.append(c[m]); corr.append(pred[m] == lab[m])
    return cm, (np.concatenate(confs), np.concatenate(corr)) if keep_conf else None

def colour(lab):
    out = np.zeros(lab.shape + (3,), np.uint8)
    for k, rgb in PALETTE.items(): out[lab == k] = rgb
    return out

def main():
    t0 = time.time()
    metas = {os.path.basename(p)[:-10]: json.load(open(p)) for p in glob.glob(os.path.join(WORK, 'ckpt', '*-meta.json'))}
    if not metas: sys.exit('no trained model')
    val = {k: load_set(f'val-{k}') for k in ('msl', 'm2020')}
    tests = {k: load_set(k) for k in ('test-min1', 'test-min2', 'test-min3', 'test-m2020')}
    models, res = {}, {}
    for tag, meta in sorted(metas.items()):
        m = build(meta['init']); m.load_state_dict(torch.load(os.path.join(WORK, 'ckpt', f'{tag}-best.pt'), weights_only=False)['model']); m.eval()
        models[tag] = m
        v = {k: scores(run(m, *d)[0], CLASSES) for k, d in val.items() if d}
        res[tag] = {'val': v, 'val_mIoU_mean': round(float(np.mean([x['mIoU'] for x in v.values()])), 4),
                    'train': {k: meta[k] for k in ('init', 'loss', 'architecture', 'params', 'epochs_run', 'training_seconds', 'best_val_mIoU', 'hardware', 'train_samples')}}
    chosen = max(res, key=lambda t: res[t]['val_mIoU_mean'])
    for tag, m in models.items():
        res[tag]['test'] = {k: scores(run(m, *d)[0], CLASSES) for k, d in tests.items() if d}
    # confidence calibration on validation (chosen model) → low-confidence threshold
    m = models[chosen]
    cal = {}
    for k, d in val.items():
        if not d: continue
        _, (c, ok) = run(m, *d, keep_conf=True)
        cal[k] = {'bins': calibration(c, ok), 'conf': c, 'ok': ok}
    c_all = np.concatenate([v['conf'] for v in cal.values()]); ok_all = np.concatenate([v['ok'] for v in cal.values()])
    TARGET = 0.90                    # design choice: pixels shown as a class should be right ≥ 90 % of the time on validation
    thr = None
    for t in np.arange(0.30, 0.96, 0.05):
        sel = c_all >= t
        if sel.any() and ok_all[sel].mean() >= TARGET: thr = round(float(t), 2); break
    thr = thr if thr is not None else 0.95
    kept = c_all >= thr
    calib = {'per_val_set': {k: v['bins'] for k, v in cal.items()}, 'low_confidence_threshold': thr, 'target_accuracy': TARGET,
             'val_accuracy_above_threshold': round(float(ok_all[kept].mean()), 4), 'val_pixels_above_threshold': round(float(kept.mean()), 4),
             'val_accuracy_below_threshold': round(float(ok_all[~kept].mean()), 4) if (~kept).any() else None}
    # visual artefacts: 4 expert-test images and 4 M2020 hold-out images
    for name, d in (('test-min1', tests['test-min1']), ('test-m2020', tests['test-m2020'])):
        if not d: continue
        for i in np.linspace(0, len(d[0]) - 1, 4).astype(int):
            img, lab = d[0][i], d[1][i]
            with torch.no_grad(): p = m(to_tensor(img).unsqueeze(0))['out'][0].softmax(0)
            conf, pred = p.max(0); pred = pred.numpy().astype(np.uint8); pred[conf.numpy() < thr] = IGNORE
            g = np.repeat(img[..., None], 3, 2)
            over = (0.55 * g + 0.45 * colour(pred)).astype(np.uint8)
            Image.fromarray(np.concatenate([g, colour(lab), colour(pred), over], 1)).save(os.path.join(EVAL_DIR, f'{name}-{i}.png'))
    # ONNX export of the chosen model (dynamic height / width)
    onnx_path = os.path.join(MODEL_DIR, f'{VERSION}.onnx')
    class W(torch.nn.Module):
        def __init__(s, m): super().__init__(); s.m = m
        def forward(s, x): return s.m(x)['out'].softmax(1)
    torch.onnx.export(W(m), torch.zeros(1, 3, SIZE, SIZE), onnx_path, input_names=['image'], output_names=['probabilities'],
                      dynamic_axes={'image': {2: 'h', 3: 'w'}, 'probabilities': {2: 'h', 3: 'w'}}, opset_version=17, dynamo=False)
    card = {'version': VERSION, 'file': f'{VERSION}.onnx', 'selected': chosen, 'selected_on': 'mean validation mIoU (MSL + M2020)',
            'classes': CLASSES, 'class_values': {c: i for i, c in enumerate(CLASSES)}, 'unknown_value': IGNORE, 'palette': {str(k): v for k, v in PALETTE.items()},
            'input': {'channels': 'grey repeated on 3 channels', 'short_side_px': SIZE, 'normalise': {'mean': 0.449, 'std': 0.226}},
            'output': 'softmax probabilities per class', 'low_confidence_threshold': thr,
            'dataset': {'name': 'AI4Mars merged v0.6', 'doi': '10.5281/zenodo.15995036', 'license': 'CC BY 4.0',
                        'used': ['MSL Navcam train (crowdsourced, merged)', 'M2020 NAV (crowdsourced, merged)'],
                        'test': ['MSL Navcam expert labels (min1/2/3, 100 % agreement)', 'M2020 NAV sol-grouped hold-out (crowdsourced)']},
            'lunar_model': 'not available — transfer from a lunar model (approach A) was not run',
            'created_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds')}
    json.dump(card, open(os.path.join(MODEL_DIR, f'{VERSION}.json'), 'w'), indent=1)
    json.dump({'chosen': chosen, 'models': res, 'calibration': calib, 'model_card': card, 'seconds': round(time.time() - t0, 1)},
              open(os.path.join(OUT, 'evaluation.json'), 'w'), indent=1)
    print('chosen', chosen, json.dumps({t: {'val': r['val_mIoU_mean'], 'test': {k: v['mIoU'] for k, v in r['test'].items()}} for t, r in res.items()}, indent=1))
    print('threshold', thr, calib['val_accuracy_above_threshold'], calib['val_pixels_above_threshold'])

if __name__ == '__main__':
    main()
