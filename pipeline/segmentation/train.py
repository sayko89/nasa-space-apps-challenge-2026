"""
Train one Mars terrain segmentation model on the prepared AI4Mars data (prepare.py).

  python train.py --init pretrained|scratch --loss ce+dice|ce --minutes 210

Model: LR-ASPP with a MobileNetV3-Large encoder (torchvision), 4 classes (soil, bedrock, sand, big rock), unlabelled
pixels (255) ignored. Input: grey Navcam image repeated on 3 channels, ImageNet normalisation.
  pretrained  encoder from ImageNet (general-purpose pretrained backbone, approach B); encoder frozen for the first
              epoch, then fine-tuned with a 10× lower learning rate
  scratch     same architecture, random initialisation (approach C)
The lunar model (approach A) was not available: see docs/MARS_SEGMENTATION.md.
Training stops at the time budget or after 3 epochs without validation mIoU improvement; the best epoch on the
validation sets is kept. The test sets are never read here.
"""
import argparse, json, os, sys, time, platform, random
import numpy as np, torch, torch.nn as nn, torch.nn.functional as F
from torchvision.models.segmentation import lraspp_mobilenet_v3_large
from torchvision.models import MobileNet_V3_Large_Weights
sys.path.insert(0, os.path.dirname(__file__))
from common import *
from metrics import confusion, scores

MEAN, STD = 0.449, 0.226          # ImageNet mean / std averaged over RGB (grey input repeated on 3 channels)

def build(init):
    w = MobileNet_V3_Large_Weights.IMAGENET1K_V1 if init == 'pretrained' else None
    return lraspp_mobilenet_v3_large(weights=None, weights_backbone=w, num_classes=len(CLASSES))

def to_tensor(img):
    x = torch.from_numpy(img).float().div(255).sub(MEAN).div(STD)
    return x.unsqueeze(0).repeat(3, 1, 1)

def load_set(name):
    p = os.path.join(WORK, 'data', f'{name}.npz')
    if not os.path.exists(p): return None
    d = np.load(p, allow_pickle=True)
    return list(d['imgs']), list(d['labs'])

def augment(img, lab, rng):
    h, w = img.shape
    y = rng.randint(0, h - SIZE); x = rng.randint(0, w - SIZE)        # random SIZE×SIZE crop (images have short side SIZE)
    img, lab = img[y:y + SIZE, x:x + SIZE], lab[y:y + SIZE, x:x + SIZE]
    if rng.random() < 0.5: img, lab = img[:, ::-1], lab[:, ::-1]      # horizontal flip: terrain has no left/right
    a = 1 + rng.uniform(-0.15, 0.15); b = rng.uniform(-12, 12)       # moderate contrast / brightness
    img = np.clip(img.astype(np.float32) * a + b, 0, 255).astype(np.uint8)
    return np.ascontiguousarray(img), np.ascontiguousarray(lab)
    # no rotation / perspective warps: Navcam views keep their horizon and depth geometry

def dice_loss(logits, target, ignore=IGNORE):
    m = (target != ignore)
    if not m.any(): return logits.sum() * 0
    p = logits.softmax(1)
    t = F.one_hot(target.clamp(max=len(CLASSES) - 1), len(CLASSES)).permute(0, 3, 1, 2).float()
    mm = m.unsqueeze(1).float()
    inter = (p * t * mm).sum((0, 2, 3)); den = (p * mm).sum((0, 2, 3)) + (t * mm).sum((0, 2, 3))
    present = t.mul(mm).sum((0, 2, 3)) > 0
    d = 1 - (2 * inter + 1) / (den + 1)
    return d[present].mean() if present.any() else d.mean() * 0

@torch.no_grad()
def evaluate(model, imgs, labs):
    model.eval(); cm = np.zeros((4, 4), np.int64)
    for img, lab in zip(imgs, labs):
        out = model(to_tensor(img).unsqueeze(0))['out'][0]
        cm += confusion(out.argmax(0).numpy(), lab)
    return scores(cm, CLASSES)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--init', choices=['pretrained', 'scratch'], required=True)
    ap.add_argument('--loss', choices=['ce+dice', 'ce'], default='ce+dice')
    ap.add_argument('--minutes', type=float, default=210)
    ap.add_argument('--batch', type=int, default=8)
    ap.add_argument('--seed', type=int, default=1234)
    ap.add_argument('--patience', type=int, default=3)
    a = ap.parse_args()
    tag = f"{a.init}-{a.loss.replace('+', '')}"
    torch.manual_seed(a.seed); np.random.seed(a.seed); rng = random.Random(a.seed)
    torch.set_num_threads(max(1, os.cpu_count() or 1))
    tr = [load_set('train-msl'), load_set('train-m2020')]
    va = {k: load_set(f'val-{k}') for k in ('msl', 'm2020')}
    imgs = sum((t[0] for t in tr if t), []); labs = sum((t[1] for t in tr if t), [])
    src = sum(([s] * len(t[0]) for s, t in zip(('msl', 'm2020'), tr) if t), [])
    # class weights from the training labels (inverse sqrt frequency, normalised): big rocks are rare
    cnt = np.zeros(4)
    for l in labs: cnt += np.bincount(l.ravel(), minlength=256)[:4]
    cw = 1 / np.sqrt(np.maximum(cnt / cnt.sum(), 1e-6)); cw = cw / cw.mean()
    model = build(a.init)
    enc = list(model.backbone.parameters()); enc_ids = {id(p) for p in enc}
    head = [p for p in model.parameters() if id(p) not in enc_ids]
    lr = 1e-4 if a.init == 'pretrained' else 1e-3
    opt = torch.optim.AdamW([{'params': head, 'lr': lr}, {'params': enc, 'lr': lr if a.init == 'scratch' else 0.0}], weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.ReduceLROnPlateau(opt, mode='max', factor=0.5, patience=1)
    ce = nn.CrossEntropyLoss(weight=torch.tensor(cw, dtype=torch.float32), ignore_index=IGNORE)
    ckdir = os.path.join(WORK, 'ckpt'); os.makedirs(ckdir, exist_ok=True)
    last = os.path.join(ckdir, f'{tag}-last.pt'); best_p = os.path.join(ckdir, f'{tag}-best.pt')
    hist, best, start_ep, bad = [], -1.0, 0, 0
    if os.path.exists(last):                                            # resume
        st = torch.load(last, weights_only=False); model.load_state_dict(st['model']); opt.load_state_dict(st['opt'])
        hist, best, start_ep, bad = st['hist'], st['best'], st['epoch'] + 1, st['bad']
    t0 = time.time(); budget = a.minutes * 60
    order = list(range(len(imgs)))
    for ep in range(start_ep, 1000):
        if a.init == 'pretrained' and ep == 1:
            for g in opt.param_groups[1:]: g['lr'] = opt.param_groups[0]['lr'] / 10          # unfreeze the encoder
        model.train(); rng.shuffle(order); tl, n = 0.0, 0; te = time.time()
        for i in range(0, len(order) - a.batch + 1, a.batch):
            if time.time() - t0 > budget: break
            bx, by = zip(*(augment(imgs[j], labs[j], rng) for j in order[i:i + a.batch]))
            x = torch.stack([to_tensor(b) for b in bx]); y = torch.from_numpy(np.stack(by)).long()
            out = model(x)['out']
            loss = ce(out, y) + (dice_loss(out, y) if a.loss == 'ce+dice' else 0)
            opt.zero_grad(); loss.backward(); opt.step()
            tl += float(loss); n += 1
        complete = time.time() - t0 <= budget
        vs = {k: evaluate(model, *v) for k, v in va.items() if v}
        vm = float(np.mean([v['mIoU'] for v in vs.values()]))
        sched.step(vm)
        hist.append({'epoch': ep, 'complete_epoch': complete, 'train_loss': round(tl / max(1, n), 4), 'batches': n,
                     'val_mIoU': round(vm, 4), 'val': {k: {'mIoU': v['mIoU'], 'pixel_accuracy': v['pixel_accuracy']} for k, v in vs.items()},
                     'lr': [g['lr'] for g in opt.param_groups], 'seconds': round(time.time() - te, 1)})
        print(json.dumps(hist[-1]), flush=True)
        if vm > best: best, bad = vm, 0; torch.save({'model': model.state_dict(), 'epoch': ep, 'val_mIoU': vm, 'val': vs}, best_p)
        else: bad += 1
        torch.save({'model': model.state_dict(), 'opt': opt.state_dict(), 'hist': hist, 'best': best, 'epoch': ep, 'bad': bad}, last)
        if not complete or bad >= a.patience: break
    meta = {'tag': tag, 'init': a.init, 'loss': a.loss, 'architecture': 'LR-ASPP MobileNetV3-Large (torchvision)',
            'params': sum(p.numel() for p in model.parameters()), 'optimizer': 'AdamW (weight decay 1e-4)', 'lr_head': lr,
            'lr_encoder': 'frozen in epoch 0, then head lr / 10' if a.init == 'pretrained' else lr,
            'scheduler': 'ReduceLROnPlateau on validation mIoU (factor 0.5, patience 1)', 'batch': a.batch, 'seed': a.seed,
            'class_weights': dict(zip(CLASSES, np.round(cw, 3).tolist())), 'input': f'grey, short side {SIZE}, random {SIZE}×{SIZE} crops',
            'augmentation': 'horizontal flip; contrast ×(0.85–1.15); brightness ±12 grey levels', 'time_budget_min': a.minutes,
            'training_seconds': round(time.time() - t0, 1), 'epochs_run': len(hist), 'best_val_mIoU': round(best, 4),
            'train_samples': {'msl': src.count('msl'), 'm2020': src.count('m2020')},
            'hardware': f"{platform.processor() or platform.machine()}, {os.cpu_count()} CPU threads, no GPU", 'torch': torch.__version__, 'history': hist}
    json.dump(meta, open(os.path.join(ckdir, f'{tag}-meta.json'), 'w'), indent=1)
    print('done', tag, 'best val mIoU', round(best, 4), 'epochs', len(hist), 'minutes', round((time.time() - t0) / 60, 1))

if __name__ == '__main__':
    main()
