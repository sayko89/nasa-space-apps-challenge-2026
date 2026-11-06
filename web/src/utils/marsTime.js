/**
 * Mars solar time & sun position — Mars24 algorithm (NASA GISS).
 *
 * Kaynak: Allison & McEwen (2000), Planet. Space Sci. 48, 215–235; Allison (1997).
 * Denklemler ve sabitler, GISS çözümlü örneğine göre düzenlenmiş `marstime`
 * (C. Lee) referans implementasyonuyla birebir aynıdır ve USGS `plio`
 * testlerindeki değerlerle doğrulanmıştır (tests/marsTime.test.mjs):
 *   2000-01-06 00:00 UTC → Ls 277.18677°, LTST(0°) 23.648468934 h, SZA(0,0) 154.261908004°
 *
 * Referanstan iki bilinçli fark:
 *   1. Artık saniye tablosu güncel (2015-07-01 ve 2017-01-01 eklendi; TT−UTC = 69.184 s).
 *   2. Azimut formülünde enlem radyana çevrilir (referansta eksik); sonuç
 *      güneş-altı noktasından vektör geometrisiyle bağımsız olarak doğrulanır.
 *
 * Kurallar: boylam girişleri DOĞU boylamı (°E); Mars24 içte batı boylamı
 * kullanır. Enlem gezegen-grafik varsayılır (Jezero 18.4° için gezegen-merkezli
 * ile farkı ~0.1°, ihmal edilir). Güneş doğuşu/batışı = disk merkezi ufukta,
 * kırılma yok (Mars atmosferinde ihmal edilebilir), arazi ufku hesaba katılmaz.
 */

const D2R = Math.PI / 180;
const J2000 = 2451545.0;
export const SOL_SECONDS = 88775.244;   // 24 h 39 m 35.244 s

// TAI−UTC adımları (JD, saniye). TT−UTC = TAI−UTC + 32.184 s.
const LEAP = [
  [2441317.5, 10], [2441499.5, 11], [2441683.5, 12], [2442048.5, 13], [2442413.5, 14],
  [2442778.5, 15], [2443144.5, 16], [2443509.5, 17], [2443874.5, 18], [2444239.5, 19],
  [2444786.5, 20], [2445151.5, 21], [2445516.5, 22], [2446247.5, 23], [2447161.5, 24],
  [2447892.5, 25], [2448257.5, 26], [2448804.5, 27], [2449169.5, 28], [2449534.5, 29],
  [2450083.5, 30], [2450630.5, 31], [2451179.5, 32], [2453736.5, 33], [2454832.5, 34],
  [2456109.5, 35], [2457204.5, 36], [2457754.5, 37],
];

export function julianUT(ms) { return 2440587.5 + ms / 86400000; }

export function ttMinusUtc(jdut) {
  let tai = 0;
  for (const [jd, s] of LEAP) { if (jdut >= jd) tai = s; else break; }
  return (tai || 0) + 32.184;          // 1972 öncesi için yaklaşık (yalnızca 32.184 s)
}

/** UTC ms → J2000'den itibaren TT gün farkı (ΔtJ2000). */
export function j2000tt(ms) {
  const jd = julianUT(ms);
  return jd + ttMinusUtc(jd) / 86400 - J2000;
}

const mod = (x, m) => ((x % m) + m) % m;

export function meanAnomaly(j) { return mod(19.3870 + 0.52402075 * j, 360); }
export function fmsAngle(j) { return mod(270.3863 + 0.52403840 * j, 360); }

const PBS_A   = [0.0071, 0.0057, 0.0039, 0.0037, 0.0021, 0.0020, 0.0018];
const PBS_TAU = [2.2353, 2.7543, 1.1177, 15.7866, 2.1354, 2.4694, 32.8493];
const PBS_PHI = [49.409, 168.173, 191.837, 21.736, 15.704, 95.528, 49.095];
export function perturbers(j) {
  let s = 0;
  for (let i = 0; i < 7; i++) s += PBS_A[i] * Math.cos(((0.985626 * j / PBS_TAU[i]) + PBS_PHI[i]) * D2R);
  return s;
}

/** Merkez denklemi (v − M), derece. */
export function equationOfCenter(j) {
  const M = meanAnomaly(j) * D2R;
  return (10.691 + 3.0e-7 * j) * Math.sin(M) + 0.6230 * Math.sin(2 * M) + 0.0500 * Math.sin(3 * M)
       + 0.0050 * Math.sin(4 * M) + 0.0005 * Math.sin(5 * M) + perturbers(j);
}

/** Güneş boylamı Ls (mevsim), derece. */
export function solarLongitude(j) { return mod(fmsAngle(j) + equationOfCenter(j), 360); }

/** Zaman denklemi, derece (×24/360 → saat). */
export function equationOfTime(j) {
  const ls = solarLongitude(j) * D2R;
  return 2.861 * Math.sin(2 * ls) - 0.071 * Math.sin(4 * ls) + 0.002 * Math.sin(6 * ls) - equationOfCenter(j);
}

export function marsSolDate(j) { return ((j - 4.5) / 1.027491252) + 44796.0 - 0.00096; }
/** Mars Coordinated Time (başlangıç meridyeninde ortalama güneş saati), saat. */
export function mtc(j) { return mod(24 * marsSolDate(j), 24); }

const westOf = (lonEast) => mod(360 - lonEast, 360);

export function lmst(j, lonEast) { return mod(mtc(j) - westOf(lonEast) / 15, 24); }
/** Yerel gerçek güneş saati (LTST), saat. */
export function ltst(j, lonEast) { return mod(lmst(j, lonEast) + equationOfTime(j) / 15, 24); }
/** Güneş-altı noktanın BATI boylamı, derece. */
export function subsolarLonWest(j) { return mod((mtc(j) + equationOfTime(j) / 15) * 15 + 180, 360); }
/** Güneş deklinasyonu (gezegen-grafik), derece. */
export function solarDeclination(lsDeg) {
  const ls = lsDeg * D2R;
  return (Math.asin(0.42565 * Math.sin(ls)) + 0.25 * D2R * Math.sin(ls)) / D2R;
}
/** Güneş–Mars uzaklığı, AU. */
export function heliocentricDistance(j) {
  const M = meanAnomaly(j) * D2R;
  return 1.523679 * (1.00436 - 0.09309 * Math.cos(M) - 0.004336 * Math.cos(2 * M)
                     - 0.00031 * Math.cos(3 * M) - 0.00003 * Math.cos(4 * M));
}

/**
 * Bir noktada güneşin konumu.
 * @returns {{elevationDeg, azimuthDeg, zenithDeg, ls, ltst, msd, decl, rAU}}
 *   azimut: kuzeyden saat yönünde (90 = doğu)
 */
export function sunPosition(ms, latDeg, lonEastDeg) {
  const j = j2000tt(ms);
  const ls = solarLongitude(j);
  const dec = solarDeclination(ls) * D2R;
  const lat = latDeg * D2R;
  const H = (westOf(lonEastDeg) - subsolarLonWest(j)) * D2R;     // saat açısı
  const cosZ = Math.sin(dec) * Math.sin(lat) + Math.cos(dec) * Math.cos(lat) * Math.cos(H);
  const zen = Math.acos(Math.max(-1, Math.min(1, cosZ))) / D2R;
  const az = mod(Math.atan2(Math.sin(H), Math.cos(lat) * Math.tan(dec) - Math.sin(lat) * Math.cos(H)) / D2R, 360);
  return {
    elevationDeg: 90 - zen, azimuthDeg: az, zenithDeg: zen,
    ls, ltst: ltst(j, lonEastDeg), msd: marsSolDate(j), decl: dec / D2R, rAU: heliocentricDistance(j),
  };
}

/**
 * `ms` anına en yakın, verilen LTST'ye denk gelen UTC anı (ms).
 * LTST bir solde 24 saat ilerler; birkaç Newton adımı yeterli.
 */
export function msAtLtst(ms, targetLtstH, lonEastDeg) {
  let t = ms;
  for (let i = 0; i < 6; i++) {
    let d = targetLtstH - ltst(j2000tt(t), lonEastDeg);
    if (d > 12) d -= 24; else if (d < -12) d += 24;
    t += (d / 24) * SOL_SECONDS * 1000;
    if (Math.abs(d) < 1e-7) break;
  }
  return t;
}

/**
 * `ms` anını içeren sol için gün doğumu/batımı (elevation = 0, disk merkezi).
 * @returns {{riseMs, setMs, riseLtst, setLtst}|null} kutup gecesi/günü → null
 */
export function sunriseSunset(ms, latDeg, lonEastDeg) {
  const noon = msAtLtst(ms, 12, lonEastDeg);
  const midnightBefore = noon - SOL_SECONDS * 500;
  const el = (t) => sunPosition(t, latDeg, lonEastDeg).elevationDeg;
  if (el(noon) <= 0 || el(midnightBefore) >= 0) return null;
  const bisect = (a, b) => { // el(a) and el(b) have opposite signs
    let fa = el(a);
    for (let i = 0; i < 40; i++) {
      const m = (a + b) / 2, fm = el(m);
      if ((fm > 0) === (fa > 0)) { a = m; fa = fm; } else b = m;
    }
    return (a + b) / 2;
  };
  const riseMs = bisect(midnightBefore, noon);
  const setMs = bisect(noon, noon + SOL_SECONDS * 500);
  const j0 = (t) => j2000tt(t);
  return { riseMs, setMs, riseLtst: ltst(j0(riseMs), lonEastDeg), setLtst: ltst(j0(setMs), lonEastDeg) };
}

/** Güneş yönü birim vektörü sahne ekseninde (x doğu, y yukarı, z güney). */
export function sunVectorScene(elevationDeg, azimuthDeg) {
  const el = elevationDeg * D2R, az = azimuthDeg * D2R;
  return [Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)];
}
