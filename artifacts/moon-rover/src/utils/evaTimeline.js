/**
 * EVA zaman çizelgesi — planlanan rotada "hangi anda nerede, ne yapıyor".
 *
 * Planlayıcının walk-back profili (walkback.js → walkbackProfile.elapsed) her
 * rota noktasından AYRILIŞ anını verir (bilim durağında bekleme dahil). Buradan:
 *   dep[i] = elapsed[i]                 noktadan ayrılış [s]
 *   arr[i] = dep[i] − bekleme(i)        noktaya varış   [s]
 * İki nokta arasında hız sabittir (yürüme modeli segment başına süre verir),
 * bu yüzden konum segment içinde zamanla doğrusal ilerler. Böylece oynatma,
 * GO/NO-GO kararının dayandığı zamanlamanın ta kendisidir.
 *
 * Saf modül (Three/React yok): Node'da test edilir.
 */

import { walkTimeS } from './walkModel.js';

/**
 * @param {Array<[number,number,number]>} path  dünya koordinatları [x,y,z]
 * @param {ArrayLike<number>} elapsedS  her noktadan ayrılış anı (bekleme dahil), elapsedS[0] ≥ 0
 * @param {Array<{idx:number, dwellS:number, label?:string}>} [stops]  bekleme noktaları
 * @param {number} [t0=0]  çizelgenin başlangıç anı (abort çizelgesi için ofset)
 */
export function buildTimeline(path, elapsedS, stops = [], t0 = 0) {
  const n = path.length;
  if (n < 1) throw new Error('timeline: empty path');
  if (!elapsedS || elapsedS.length !== n) throw new Error('timeline: path/elapsed length mismatch');
  const dwell = new Float64Array(n);
  for (const s of stops) {
    if (!(s.idx >= 0 && s.idx < n)) throw new Error(`timeline: stop index ${s.idx} out of range`);
    dwell[s.idx] += s.dwellS || 0;
  }
  const xs = new Float64Array(n), zs = new Float64Array(n);
  const arr = new Float64Array(n), dep = new Float64Array(n), cum = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    xs[i] = path[i][0]; zs[i] = path[i][2];
    dep[i] = t0 + elapsedS[i];
    arr[i] = dep[i] - dwell[i];
    if (i > 0) {
      cum[i] = cum[i - 1] + Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]);
      if (arr[i] < dep[i - 1] - 1e-6) throw new Error(`timeline: time goes backwards at point ${i}`);
    }
  }
  const sorted = [...stops].filter(s => (s.dwellS || 0) > 0).sort((a, b) => a.idx - b.idx);
  return {
    n, xs, zs, arr, dep, cum, dwell,
    startS: t0,
    totalS: dep[n - 1],
    lengthM: cum[n - 1],
    stops: sorted.map((s, k) => ({
      n: k + 1, idx: s.idx, label: s.label || null,
      arriveS: arr[s.idx], departS: dep[s.idx], dwellS: dwell[s.idx],
      x: xs[s.idx], z: zs[s.idx],
    })),
  };
}

/** Rota polyline'ından yürüme modeline göre çizelge (abort / dönüş yolu için, bekleme yok). */
export function timelineFromPath(path, heightAt, t0 = 0) {
  const n = path.length;
  const el = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    const [x0, , z0] = path[i - 1], [x1, , z1] = path[i];
    el[i] = el[i - 1] + walkTimeS(Math.hypot(x1 - x0, z1 - z0), heightAt(x1, z1) - heightAt(x0, z0));
  }
  return buildTimeline(path, el, [], t0);
}

/** Segment yönü (rotation.y = atan2(dx, dz)); sıfır uzunluklu segmentlerde komşuya bakılır. */
function segHeading(tl, i) {
  const { n, xs, zs } = tl;
  for (let k = Math.min(i, n - 2); k >= 0 && k < n - 1; k++) {
    const dx = xs[k + 1] - xs[k], dz = zs[k + 1] - zs[k];
    if (dx * dx + dz * dz > 1e-12) return Math.atan2(dx, dz);
  }
  for (let k = Math.min(i, n - 1) - 1; k >= 0; k--) {
    const dx = xs[k + 1] - xs[k], dz = zs[k + 1] - zs[k];
    if (dx * dx + dz * dz > 1e-12) return Math.atan2(dx, dz);
  }
  return 0;
}

/**
 * Çizelgede t anındaki durum.
 * @returns {{x,z, seg, u, state:'pre'|'walk'|'dwell'|'done', atIdx, heading, speedMs, distM}}
 *   seg/u: yürünen segment (seg→seg+1) ve içindeki oran; atIdx: beklenen/ulaşılan nokta
 */
export function sampleTimeline(tl, t) {
  const { n, xs, zs, arr, dep, cum } = tl;
  if (!(t >= arr[0])) {                      // başlangıçtan önce (veya NaN)
    return { x: xs[0], z: zs[0], seg: 0, u: 0, state: 'pre', atIdx: 0,
      heading: segHeading(tl, 0), speedMs: 0, distM: 0 };
  }
  let lo = 0, hi = n - 1;                    // arr[i] ≤ t olan en büyük i
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (arr[mid] <= t) lo = mid; else hi = mid - 1;
  }
  const i = lo;
  if (t < dep[i]) {
    return { x: xs[i], z: zs[i], seg: Math.max(0, Math.min(i, n - 2)), u: i >= n - 1 ? 1 : 0, state: 'dwell', atIdx: i,
      heading: segHeading(tl, Math.max(0, i - 1)), speedMs: 0, distM: cum[i] };
  }
  if (i >= n - 1) {
    return { x: xs[n - 1], z: zs[n - 1], seg: Math.max(0, n - 2), u: 1, state: 'done', atIdx: n - 1,
      heading: segHeading(tl, Math.max(0, n - 2)), speedMs: 0, distM: cum[n - 1] };
  }
  const segT = arr[i + 1] - dep[i];
  const u = segT > 0 ? Math.min(1, Math.max(0, (t - dep[i]) / segT)) : 1;
  const segLen = cum[i + 1] - cum[i];
  return {
    x: xs[i] + (xs[i + 1] - xs[i]) * u,
    z: zs[i] + (zs[i + 1] - zs[i]) * u,
    seg: i, u, state: 'walk', atIdx: i,
    heading: segHeading(tl, i),
    speedMs: segT > 0 ? segLen / segT : 0,
    distM: cum[i] + segLen * u,
  };
}

/** Örneğin bulunduğu andan sonraki ilk bilim durağı (yoksa null). */
export function nextStop(tl, s) {
  const from = s.state === 'dwell' ? s.atIdx + 1 : s.state === 'walk' ? s.seg + 1 : s.state === 'pre' ? 0 : tl.n;
  return tl.stops.find(st => st.idx >= from) || null;
}

/** Bekleme durumundaysa o durak (yoksa null). */
export function currentStop(tl, s) {
  return s.state === 'dwell' ? (tl.stops.find(st => st.idx === s.atIdx) || null) : null;
}

/** t anına kadar AYRILINMIŞ (örnek alınmış) durak sayısı. */
export function stopsCompleted(tl, t) {
  let k = 0;
  for (const st of tl.stops) if (st.departS <= t) k++;
  return k;
}

function pointSegDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
  let u = L2 > 1e-12 ? ((px - ax) * dx + (pz - az) * dz) / L2 : 0;
  u = Math.max(0, Math.min(1, u));
  return Math.hypot(ax + u * dx - px, az + u * dz - pz);
}

/**
 * [t, t + windowS] aralığında yürünecek yolun P noktasına en yakın mesafesi [m].
 * (Önümüzdeki toz şeytanı rotayı kesiyor mu?)
 */
export function minDistanceAhead(tl, t, windowS, px, pz) {
  const a = sampleTimeline(tl, t);
  const tEnd = Math.min(tl.totalS, t + windowS);
  const b = sampleTimeline(tl, tEnd);
  let best = Math.hypot(a.x - px, a.z - pz);
  let prevX = a.x, prevZ = a.z;
  const first = a.state === 'walk' ? a.seg + 1 : a.atIdx + (a.state === 'pre' ? 0 : 1);
  const last = b.state === 'walk' ? b.seg : b.atIdx;
  for (let i = first; i <= last && i < tl.n; i++) {
    best = Math.min(best, pointSegDist(px, pz, prevX, prevZ, tl.xs[i], tl.zs[i]));
    prevX = tl.xs[i]; prevZ = tl.zs[i];
  }
  best = Math.min(best, pointSegDist(px, pz, prevX, prevZ, b.x, b.z));
  return best;
}

/** Çizelge noktası i'nin zaman oranı [0,1] (HUD zaman çubuğu işaretleri için). */
export function timeFraction(tl, tS) {
  const span = tl.totalS - tl.startS;
  return span > 0 ? Math.max(0, Math.min(1, (tS - tl.startS) / span)) : 0;
}
