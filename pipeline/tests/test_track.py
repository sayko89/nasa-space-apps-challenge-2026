"""build_track: drive order, splitting where the rover leaves the site, region labels inside their unit."""
import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import build_track as bt  # noqa: E402

R = 3396190.0


def wp(site, drive, sol, x, z, lat0=0.0, lon0=100.0):
    import math
    return {'properties': {'site': site, 'drive': drive, 'sol': sol,
                           'lat': lat0 - math.degrees(z / R), 'lon': lon0 + math.degrees(x / R)}}


class Track(unittest.TestCase):
    def test_segments_in_drive_order_and_split_outside(self):
        feats = [wp(2, 0, 12, 300, 0), wp(1, 10, 10, 0, 0), wp(1, 20, 11, 100, -50),      # inside
                 wp(2, 5, 13, 5000, 0),                                                    # left the site
                 wp(3, 0, 20, -200, 200), wp(3, 9, 21, -100, 250), wp(3, 99, 30, 9000, 9000), wp(4, 0, 31, 10, 10)]
        segs = bt.build_segments(feats, 0.0, 100.0, R, 1000)
        self.assertEqual([[p[2] for p in s] for s in segs], [[10, 11, 12], [20, 21]])      # single point dropped
        self.assertAlmostEqual(segs[0][1][0], 100, places=0)
        self.assertAlmostEqual(segs[0][1][1], -50, places=0)

    def test_region_label_sits_inside_its_unit(self):
        n = 40
        codes = np.ones((n, n), dtype=np.uint8)
        codes[:, 20:] = 2
        codes[5:35, 5:15] = 3          # unit 1 becomes a ring-like shape: its centre of mass is not in it
        rle, flat = [], codes.ravel()
        start = 0
        for i in range(1, flat.size + 1):
            if i == flat.size or flat[i] != flat[start]:
                rle.append([int(flat[start]), i - start]); start = i
        geo = {'grid': {'n': n, 'cell_m': 4.0}, 'bedrock': {'units': ['', 'A', 'B', 'C'], 'rle': rle}}
        half = (n - 1) * 4.0 / 2
        labels = bt.region_labels(geo, half)
        self.assertEqual([l['text'] for l in labels], ['A', 'B', 'C'])
        for l in labels:
            col, row = round((l['x'] + half) / 4.0), round((l['z'] + half) / 4.0)
            self.assertEqual(codes[row, col], l['code'])
            self.assertTrue(l['derived'])


if __name__ == '__main__':
    unittest.main()
