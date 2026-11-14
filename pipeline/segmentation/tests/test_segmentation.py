"""Dataset helpers, split leakage and metrics of the Mars segmentation pipeline (numpy / Pillow only)."""
import io, os, random, sys, collections, unittest
import numpy as np
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from common import msl_sol_group, m2020_sol_group, base_key, CLASSES, IGNORE, NAV_VALUES, SOL_SECONDS
from metrics import confusion, scores, calibration
import prepare


class Names(unittest.TestCase):
    def test_label_key_is_the_verified_nav_key(self):
        self.assertEqual(CLASSES, ['soil', 'bedrock', 'sand', 'big_rock'])
        self.assertEqual(IGNORE, 255)
        self.assertEqual(NAV_VALUES, {0, 1, 2, 3, 255})

    def test_groups_by_mars_day(self):
        a = msl_sol_group('NLB_486137455EDR_F0481570NCAM00354M1.JPG')
        b = msl_sol_group('NLB_486140000EDR_F0481570NCAM00354M1.JPG')      # 43 min later: same sol
        c = msl_sol_group(f'NLB_{486137455 + int(SOL_SECONDS)}EDR_F0481570NCAM00354M1.JPG')
        self.assertEqual(a, b); self.assertNotEqual(a, c)
        self.assertEqual(m2020_sol_group('NLF_0147_0680095330_885ECM_N0060000NCAM00500_01_195J.png'), 'm2020-147')
        self.assertIsNone(msl_sol_group('README.txt'))

    def test_base_key_matches_images_and_labels(self):
        self.assertEqual(base_key('a/NLB_1_EDR.JPG'), base_key('b/NLB_1_EDR_merged.png'))
        # real AI4Mars v0.6 names (inventory.json)
        self.assertEqual(base_key('m2020/labels/NAV/NLF_0009_0667755636_926ECM_N0030000NCAM05000_01_295J_merged60.png'),
                         base_key('m2020/images/ncam/NLF_0009_0667755636_926ECM_N0030000NCAM05000_01_295J.jpeg'))
        self.assertEqual(base_key('VgncRawLeft_0684693433-41490-2_rectified_merged.png'), base_key('VgncRawLeft_0684693433-41490_rectified.jpeg'))
        self.assertEqual(base_key('VgncRawLeft_0684693433-41490-3.png'), base_key('VgncRawLeft_0684693433-41490.jpeg'))
        self.assertNotEqual(base_key('NLA_397586928EDR_F0010008AUT_04096M1.JPG'), base_key('NLA_397586934EDR_F0010008AUT_04096M1.png'))

    def test_vgnc_frames_group_by_mars_day(self):
        a = m2020_sol_group('VgncRawLeft_0684693433-41490_rectified.jpeg')
        b = m2020_sol_group('VgncRawLeft_0684693508-32241_rectified.jpeg')   # 75 s later
        self.assertEqual(a, b)
        self.assertNotEqual(a, m2020_sol_group(f'VgncRawLeft_{684693433 + 90000:010d}-1_rectified.jpeg'))


class Split(unittest.TestCase):
    def make(self):
        s = []
        for g in range(40):
            for k in range(5): s.append({'label': f'msl{g}-{k}', 'source': 'msl', 'group': f'msl-{g}', 'split': None})
        for g in range(30):
            for k in range(3): s.append({'label': f'm{g}-{k}', 'source': 'm2020', 'group': f'm2020-{g}', 'split': None})
        s.append({'label': 'gold', 'source': 'msl', 'group': 'msl-7', 'split': 'test-min1'})
        return s

    def test_no_group_in_two_splits_and_test_sols_kept_out(self):
        s = self.make(); log = collections.defaultdict(list)
        prepare.assign_splits(s, {'msl-7'}, random.Random(1), log)
        seen = collections.defaultdict(set)
        for x in s: seen[(x['source'], x['group'])].add(x['split'])
        leaks = [k for k, v in seen.items() if len({sp for sp in v if not sp.startswith('test-min')}) > 1]
        self.assertEqual(leaks, [])
        self.assertTrue(all(x['split'] in ('excluded-test-sol', 'test-min1') for x in s if x['group'] == 'msl-7'))
        self.assertTrue(any(x['split'] == 'test-m2020' for x in s))
        self.assertFalse(any(x['split'] == 'test-m2020' for x in s if x['source'] == 'msl'))
        self.assertTrue(log)

    def test_reproducible(self):
        a, b = self.make(), self.make()
        prepare.assign_splits(a, set(), random.Random(5), collections.defaultdict(list))
        prepare.assign_splits(b, set(), random.Random(5), collections.defaultdict(list))
        self.assertEqual([x['split'] for x in a], [x['split'] for x in b])


class Validation(unittest.TestCase):
    """prepare.load() rejects bad samples with a reason instead of dropping them silently."""
    def run_load(self, img_bytes, lab_bytes):
        class Z:
            read_fake = True
            def read(self, name): return {'i': img_bytes, 'l': lab_bytes}[name]
        prepare._local.z = Z()
        return prepare.load({'image': 'i', 'label': 'l'})

    def png(self, a, mode='L'):
        from PIL import Image
        b = io.BytesIO(); Image.fromarray(a.astype(np.uint8), mode).save(b, 'PNG'); return b.getvalue()

    def test_good_sample_resized_with_nearest_labels(self):
        img = self.png(np.random.RandomState(0).randint(0, 255, (512, 640)))
        lab = np.full((512, 640), 255); lab[:200] = 0; lab[200:400] = 3
        res, why = self.run_load(img, self.png(lab))
        self.assertIsNone(why)
        self.assertEqual(res['img'].shape, (256, 320)); self.assertEqual(res['lab'].shape, (256, 320))
        self.assertEqual(set(np.unique(res['lab']).tolist()), {0, 3, 255})      # nearest: no blended class values

    def test_rejections(self):
        img = self.png(np.zeros((100, 100)))
        self.assertIn('unreadable image', self.run_load(b'not an image', img)[1])
        self.assertIn('size mismatch', self.run_load(img, self.png(np.zeros((90, 100))))[1])
        self.assertIn('outside the NAV key', self.run_load(img, self.png(np.full((100, 100), 4)))[1])
        self.assertIn('empty label', self.run_load(img, self.png(np.full((100, 100), 255)))[1])


class Metrics(unittest.TestCase):
    def test_confusion_ignores_unlabelled_pixels(self):
        gt = np.array([[0, 1, 255], [2, 3, 255]]); pr = np.array([[0, 1, 3], [2, 2, 0]])
        cm = confusion(pr, gt)
        self.assertEqual(cm.sum(), 4)
        s = scores(cm, CLASSES)
        self.assertEqual(s['per_class']['soil']['iou'], 1.0)
        self.assertEqual(s['per_class']['big_rock']['recall'], 0.0)
        self.assertAlmostEqual(s['per_class']['sand']['iou'], 0.5)
        self.assertEqual(s['pixel_accuracy'], 0.75)

    def test_absent_classes_do_not_enter_the_mean(self):
        cm = np.zeros((4, 4), int); cm[0, 0] = 10; cm[1, 1] = 5
        s = scores(cm, CLASSES)
        self.assertEqual(s['mIoU'], 1.0)
        self.assertEqual(s['classes_absent_from_ground_truth'], ['sand', 'big_rock'])

    def test_calibration_bins(self):
        c = np.array([0.35, 0.55, 0.95, 0.97]); ok = np.array([False, True, True, True])
        b = calibration(c, ok)
        self.assertEqual(sum(x['pixels'] for x in b), 4)
        self.assertEqual([x for x in b if x['from'] == 0.9][0]['accuracy'], 1.0)


if __name__ == '__main__':
    unittest.main()
