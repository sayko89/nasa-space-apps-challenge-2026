"""build_relief.py: normal-map orientation and the committed relief maps.  python -m unittest discover pipeline/tests"""
import json, math, os, sys, unittest

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import build_relief as R  # noqa: E402

SITES = os.path.join(os.path.dirname(__file__), "..", "..", "web", "public", "sites")


class NormalOrientation(unittest.TestCase):
    def plane(self, east, north, n=16, px=1.0):
        rows, cols = np.mgrid[0:n, 0:n]
        return east * cols * px + north * (n - 1 - rows) * px       # row 0 = north edge

    def test_rising_east_tilts_normal_west(self):
        nrm = R.surface_normals(self.plane(0.5, 0.0), 1.0)[8, 8]
        self.assertAlmostEqual(nrm[0], -0.5 / math.sqrt(1.25), places=6)
        self.assertAlmostEqual(nrm[1], 0.0, places=6)
        self.assertLess(R.encode_normals(nrm)[0], 128)                # R < 128: faces west

    def test_rising_north_tilts_normal_south(self):
        nrm = R.surface_normals(self.plane(0.0, 0.25), 1.0)[8, 8]
        self.assertAlmostEqual(nrm[1], -0.25 / math.sqrt(1.0625), places=6)
        self.assertLess(R.encode_normals(nrm)[1], 128)

    def test_flat_is_neutral(self):
        self.assertEqual(tuple(R.encode_normals(R.surface_normals(np.zeros((4, 4)), 1.0))[1, 1]), (128, 128, 255))


class CommittedMaps(unittest.TestCase):
    def test_maps_match_their_site(self):
        for site in ("jezero", "gale"):
            info = json.load(open(os.path.join(SITES, site, "relief.json")))
            meta = json.load(open(os.path.join(SITES, site, "meta.json")))
            self.assertEqual(info["format"], "martian-map-relief/1")
            self.assertAlmostEqual(info["size_px"] * info["pixel_m"], meta["grid"]["span_m"], delta=0.5)
            im = Image.open(os.path.join(SITES, site, info["file"]))
            self.assertEqual(im.size, (info["size_px"], info["size_px"]))
            b = np.asarray(im)[..., 2]
            self.assertGreater(b.min(), 127, "every normal points up")


if __name__ == "__main__":
    unittest.main()
