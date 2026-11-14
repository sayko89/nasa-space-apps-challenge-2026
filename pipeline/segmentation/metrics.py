"""Segmentation metrics from a confusion matrix (numpy only; unlabelled pixels = 255 are never counted)."""
import numpy as np

def confusion(pred, gt, n=4, ignore=255):
    """Rows = ground truth, columns = prediction."""
    m = gt != ignore
    return np.bincount(gt[m].astype(np.int64) * n + pred[m].astype(np.int64), minlength=n * n).reshape(n, n)

def scores(cm, names):
    cm = cm.astype(np.float64)
    tp = np.diag(cm); gt = cm.sum(1); pr = cm.sum(0)
    with np.errstate(divide='ignore', invalid='ignore'):
        iou = tp / (gt + pr - tp); dice = 2 * tp / (gt + pr); prec = tp / pr; rec = tp / gt
    present = gt > 0
    f = lambda a: [None if not np.isfinite(x) else round(float(x), 4) for x in a]
    return {
        'pixels': int(cm.sum()), 'pixel_accuracy': round(float(tp.sum() / max(1, cm.sum())), 4),
        'mIoU': round(float(np.nanmean(iou[present])), 4) if present.any() else None,
        'mean_dice': round(float(np.nanmean(dice[present])), 4) if present.any() else None,
        'per_class': {nm: {'iou': f(iou)[i], 'dice': f(dice)[i], 'precision': f(prec)[i], 'recall': f(rec)[i], 'gt_pixels': int(gt[i])}
                      for i, nm in enumerate(names)},
        'confusion_matrix': cm.astype(int).tolist(), 'classes_absent_from_ground_truth': [names[i] for i in range(len(names)) if not present[i]],
    }

def calibration(conf, correct, bins=(0.0, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0001)):
    """Accuracy of labelled pixels per max-softmax confidence bin."""
    out = []
    for lo, hi in zip(bins[:-1], bins[1:]):
        m = (conf >= lo) & (conf < hi)
        out.append({'from': lo, 'to': min(hi, 1.0), 'pixels': int(m.sum()), 'accuracy': round(float(correct[m].mean()), 4) if m.any() else None})
    return out
