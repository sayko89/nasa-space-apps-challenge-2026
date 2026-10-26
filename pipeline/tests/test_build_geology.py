"""build_geology.py sentetik shapefile testleri:  python -m unittest discover pipeline/tests"""
import io, json, math, os, sys, tempfile, unittest, zipfile

import numpy as np
import shapefile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import build_geology as G  # noqa: E402

LAT0, LON0, N, CELL = 18.44, 77.45, 64, 4.0
PRJ = ('PROJCS["Mars2000 Equidistant Cylindrical clon0",GEOGCS["GCS_Mars_2000_Sphere",'
       'DATUM["<custom>",SPHEROID["<custom>",3396190.0,0.0]],PRIMEM["Reference_Meridian",0.0],'
       'UNIT["Degree",0.0174532925199433]],PROJECTION["Equidistant_Cylindrical"],'
       'PARAMETER["False_Easting",0.0],PARAMETER["False_Northing",0.0],'
       'PARAMETER["Central_Meridian",0.0],PARAMETER["Standard_Parallel_1",0.0],UNIT["Meter",1.0]]')


def to_src(x, y):
    c = math.cos(math.radians(LAT0))
    return [x / c + G.R_MARS * math.radians(LON0), y + G.R_MARS * math.radians(LAT0)]


def rect(x0, y0, x1, y1, cw=True):
    pts = [(x0, y0), (x0, y1), (x1, y1), (x1, y0), (x0, y0)]   # saat yönü (shapefile dış halka)
    return [to_src(*p) for p in (pts if cw else pts[::-1])]


def make_zip(prj=PRJ):
    shp, shx, dbf = io.BytesIO(), io.BytesIO(), io.BytesIO()
    w = shapefile.Writer(shp=shp, shx=shx, dbf=dbf, shapeType=shapefile.POLYGON)
    w.field("quadname", "C", 20); w.field("SurfUName", "C", 60); w.field("BedrkUName", "C", 60)
    # A: delikli dikdörtgen   B: doğuda ayrı dikdörtgen, yüzey birimi boş
    w.poly([rect(-51, -31, 51, 31), rect(-11, -11, 11, 11, cw=False)]); w.record("Q1", "Aeolian bedforms large", "Crater floor fractured 1")
    w.poly([rect(60, -20, 100, 20)]); w.record("Q1", "", "Crater floor fractured rough")
    w.poly([rect(5000, 5000, 5100, 5100)]); w.record("Q2", "Far away", "Far away")  # pencere dışı
    w.close()
    zb = io.BytesIO()
    with zipfile.ZipFile(zb, "w") as z:
        for ext, b in ((".shp", shp), (".shx", shx), (".dbf", dbf)):
            z.writestr("dir/" + G.SHP_STEM + ext, b.getvalue())
        z.writestr("dir/" + G.SHP_STEM + ".prj", prj)
    return zb.getvalue()


def unrle(r, n):
    return np.concatenate([np.full(c, v, dtype=np.uint8) for v, c in r]).reshape(n, n)


class GeologyTest(unittest.TestCase):
    def run_build(self, prj=PRJ):
        d = tempfile.mkdtemp()
        os.makedirs(os.path.join(d, "out", "t"))
        with open(os.path.join(d, "out", "t", "meta.json"), "w") as f:
            json.dump({"grid": {"n": N, "cell_m": CELL}, "center": {"lat_deg": LAT0, "lon_deg_east": LON0},
                       "projection": {"mars_radius_m": 3396190.0}}, f)
        zp = os.path.join(d, "g.zip")
        with open(zp, "wb") as f:
            f.write(make_zip(prj))
        return G.build(G.parse_args(["--site", "t", "--zip", zp, "--out", os.path.join(d, "out")]))

    def test_grid_matches_direct_point_in_polygon(self):
        out = self.run_build()
        s, b = unrle(out["surface"]["rle"], N), unrle(out["bedrock"]["rle"], N)
        su, bu = out["surface"]["units"], out["bedrock"]["units"]
        h = (N - 1) * CELL / 2
        for r in range(N):
            for c in range(N):
                x, y = -h + c * CELL, h - r * CELL
                in_a = abs(x) < 51 and abs(y) < 31 and not (abs(x) < 11 and abs(y) < 11)
                in_b = 60 < x < 100 and abs(y) < 20
                exp_b = "Crater floor fractured 1" if in_a else "Crater floor fractured rough" if in_b else ""
                exp_s = "Aeolian bedforms large" if in_a else ""
                self.assertEqual((su[s[r, c]], bu[b[r, c]]), (exp_s, exp_b), (r, c, x, y))
        self.assertNotIn("Far away", bu)
        self.assertEqual(out["source"]["license"], "CC-BY-4.0")
        self.assertEqual(sum(u["cells"] for u in out["bedrock"]["summary"]), N * N)

    def test_rejects_wrong_projection(self):
        with self.assertRaises(SystemExit):
            self.run_build(PRJ.replace('"Central_Meridian",0.0', '"Central_Meridian",180.0'))

    def test_rle_roundtrip(self):
        a = np.array([[0, 0, 1], [1, 2, 2], [2, 2, 0]], dtype=np.uint8)
        self.assertTrue((unrle(G.rle(a), 3) == a).all())


if __name__ == "__main__":
    unittest.main()
