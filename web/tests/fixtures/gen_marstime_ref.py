"""
marsTime.js için referans değerleri üretir: `pip install marstime numpy`
    python web/tests/fixtures/gen_marstime_ref.py
Girdi doğrudan ΔtJ2000 (TT gün) olduğu için artık saniye tablosundan bağımsızdır.
marstime, USGS plio testlerindeki GISS değerleriyle birebir uyumludur
(2000-01-06: Ls 277.18677, LTST(0) 23.648468934, SZA(0,0) 154.261908004).
Azimut referansta hatalı olduğu için dahil edilmez (bağımsız geometrik testle doğrulanır).
"""
import json, os, random
import marstime as m

random.seed(2026)
LAT, LON_E = 18.44, 77.45
rows = []
for _ in range(60):
    j = random.uniform(-9000.0, 15000.0)          # ~1975 … ~2041
    rows.append({
        "j": j,
        "ls": m.Mars_Ls(j), "eot": m.equation_of_time(j), "msd": m.Mars_Solar_Date(j),
        "mtc": m.Coordinated_Mars_Time(j),
        "ltst": m.Local_True_Solar_Time(m.east_to_west(LON_E), j),
        "subsolW": m.subsolar_longitude(j), "decl": m.solar_declination(m.Mars_Ls(j)),
        "r": m.heliocentric_distance(j),
        "zen": m.solar_zenith(m.east_to_west(LON_E), LAT, j),
    })
out = os.path.join(os.path.dirname(__file__), "marstime_ref.json")
with open(out, "w") as f:
    json.dump({"site": {"lat": LAT, "lonE": LON_E}, "rows": rows}, f, indent=1)
print("wrote", out, len(rows))
