/**
 * Jezero hava sıcaklığı iklimolojisi — Perseverance MEDA ATS (1.45 m).
 * Veri: public/sites/<site>/climate.json (pipeline/build_climate.py, CC BY 4.0,
 * Hueso et al. 2024, doi:10.5281/zenodo.11198655).
 *
 * climate.bins[b] = { ls0, ls1, nSols, median[288], p10[288], p90[288] } (K)
 * Saat dilimleri 5 dk; aralarda doğrusal aradeğerleme, eksik (null) dilimler atlanır.
 * Bilgi amaçlıdır: GO kararına girmez (kaynaklı bir skafandr ısıl limiti bulunamadı).
 */

import { j2000tt, solarLongitude, ltst } from './marsTime.js';

export const K_TO_C = (k) => k - 273.15;

function slotValue(arr, slotF, n) {
  const s0 = Math.floor(slotF) % n, s1 = (s0 + 1) % n, f = slotF - Math.floor(slotF);
  const a = arr[s0], b = arr[s1];
  if (a == null && b == null) return null;
  if (a == null) return b;
  if (b == null) return a;
  return a + (b - a) * f;
}

/** Ls [°] ve LTST [saat] için {median, p10, p90, nSols} (K) veya null. */
export function airTemp(climate, lsDeg, ltstH) {
  if (!climate?.bins?.length) return null;
  const nb = climate.bins.length;
  const bin = climate.bins[((Math.floor(lsDeg / climate.lsBinDeg) % nb) + nb) % nb];
  if (!bin || !bin.nSols) return null;
  const n = bin.median.length;
  const slotF = (((ltstH % 24) + 24) % 24) / climate.ltstStepH;
  const median = slotValue(bin.median, slotF, n);
  if (median == null) return null;
  return { median, p10: slotValue(bin.p10, slotF, n), p90: slotValue(bin.p90, slotF, n), nSols: bin.nSols, ls0: bin.ls0, ls1: bin.ls1 };
}

/** Belirli bir anda (UTC ms) sahadaki beklenen sıcaklık. */
export function airTempAt(climate, ms, lonEastDeg) {
  const j = j2000tt(ms);
  return airTemp(climate, solarLongitude(j), ltst(j, lonEastDeg));
}

/**
 * EVA penceresi [startMs, endMs] boyunca sıcaklık özeti (10 dk örnekleme).
 * @returns {{minMedian, maxMedian, minP10, maxP90, startMedian, coverage}|null}
 */
export function evaWindowTemps(climate, startMs, endMs, lonEastDeg, stepS = 600) {
  if (!climate || !(endMs >= startMs)) return null;
  let minMedian = Infinity, maxMedian = -Infinity, minP10 = Infinity, maxP90 = -Infinity, hit = 0, tot = 0;
  let startMedian = null;
  for (let t = startMs; t <= endMs + 1; t += stepS * 1000) {
    tot++;
    const a = airTempAt(climate, Math.min(t, endMs), lonEastDeg);
    if (!a) continue;
    hit++;
    if (startMedian == null && t === startMs) startMedian = a.median;
    minMedian = Math.min(minMedian, a.median); maxMedian = Math.max(maxMedian, a.median);
    if (a.p10 != null) minP10 = Math.min(minP10, a.p10);
    if (a.p90 != null) maxP90 = Math.max(maxP90, a.p90);
  }
  if (!hit) return null;
  return {
    startMedian, minMedian, maxMedian,
    minP10: Number.isFinite(minP10) ? minP10 : null,
    maxP90: Number.isFinite(maxP90) ? maxP90 : null,
    coverage: hit / tot,
  };
}

/** Bir Ls dilimi için günlük medyan eğrisi (grafik). */
export function diurnalCurve(climate, lsDeg) {
  if (!climate?.bins?.length) return null;
  const nb = climate.bins.length;
  const bin = climate.bins[((Math.floor(lsDeg / climate.lsBinDeg) % nb) + nb) % nb];
  return bin?.nSols ? bin : null;
}
