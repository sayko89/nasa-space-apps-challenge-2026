/**
 * İklim (MEDA ATS) + gün batımı doğrulama testleri (Aşama 5b)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as C from '../src/utils/climate.js';
import * as MT from '../src/utils/marsTime.js';

// Sentetik iklim: 36 dilim × 288; medyan = 200 + bin + slot/100, p10 = medyan−2, p90 = medyan+3
const SL = 288;
const synth = {
  format: 'martian-map-climate/1', lsBinDeg: 10, ltstStepH: 24 / SL,
  bins: Array.from({ length: 36 }, (_, b) => {
    const median = Array.from({ length: SL }, (_, s) => 200 + b + s / 100);
    if (b === 3) median[100] = null;                       // eksik dilim
    return { ls0: b * 10, ls1: b * 10 + 10, nSols: 20, median,
      p10: median.map(v => v == null ? null : v - 2), p90: median.map(v => v == null ? null : v + 3) };
  }),
};

test('airTemp: dilim seçimi, saat aradeğerlemesi ve 360° sarması', () => {
  const a = C.airTemp(synth, 15, 12);                    // bin 1, slot 144
  assert.ok(Math.abs(a.median - (201 + 1.44)) < 1e-9);
  const b = C.airTemp(synth, 15, 12 + (24 / SL) / 2);    // slot 144.5
  assert.ok(Math.abs(b.median - (201 + 1.445)) < 1e-9);
  assert.equal(C.airTemp(synth, 359.9, 0).ls0, 350);
  assert.equal(C.airTemp(synth, 360, 0).ls0, 0);
  assert.ok(Math.abs(C.airTemp(synth, 15, 23.99).median - (201 + (2.87 + (0 - 2.87) * ((23.99 / (24 / SL)) % 1)))) < 1e-6, 'gece yarısı sarması');
  // Eksik dilim: komşusu kullanılır
  const m = C.airTemp(synth, 35, 100 * 24 / SL);
  assert.ok(Math.abs(m.median - (203 + 1.01)) < 1e-9);
  assert.equal(C.airTemp(null, 15, 12), null);
});

test('evaWindowTemps: pencere boyunca min/max ve uç değerler', () => {
  const lon = 77.45, start = MT.msAtLtst(Date.UTC(2026, 9, 26, 12), 9, lon);
  const end = start + 3 * 3600e3;
  const w = C.evaWindowTemps(synth, start, end, lon);
  assert.ok(w && w.coverage === 1);
  assert.ok(w.minMedian <= w.startMedian && w.startMedian <= w.maxMedian);
  assert.ok(Math.abs(w.minP10 - (w.minMedian - 2)) < 1e-9 && Math.abs(w.maxP90 - (w.maxMedian + 3)) < 1e-9);
  assert.equal(C.evaWindowTemps(synth, end, start, lon), null);
});

test('Mars24 gün batımı = MEDA ekibinin tablosu (Hueso et al. 2024, Fig 10) ±0.5 dk', () => {
  // Zenodo 10.5281/zenodo.11198655 › "Fig 10/time_of_sunset_vs_sol.xlsx" (SOL, sunset LTST)
  const ref = { 0: 18.0506, 50: 18.2779, 100: 18.4645, 150: 18.5838, 183: 18.6085, 200: 18.6014,
    250: 18.5042, 300: 18.3132, 350: 18.0630, 400: 17.7819, 450: 17.5218, 504: 17.3915,
    550: 17.4819, 600: 17.7070, 650: 17.9599, 699: 18.1922 };
  const landing = Date.UTC(2021, 1, 18, 20, 55);           // Perseverance iniş (sol 0)
  for (const [sol, lt] of Object.entries(ref)) {
    const ss = MT.sunriseSunset(landing + Number(sol) * MT.SOL_SECONDS * 1000, 18.44, 77.45);
    const dMin = Math.abs(ss.setLtst - lt) * 60;
    assert.ok(dMin < 0.5, `sol ${sol}: Mars24 ${ss.setLtst.toFixed(4)} vs MEDA ${lt} (${dMin.toFixed(2)} dk)`);
  }
});

// Gerçek veri bütünlüğü: tarayıcıda Zenodo verisinden aynı algoritmayla bağımsız hesaplanan değerler
// [medyan, p10, p90] (K). pipeline/build_climate.py çalıştırılınca climate.json ile karşılaştırılır.
const REAL_SPOT = {
  1: { 5: [191.4, 189.8, 192.7], 9: [218.1, 216.2, 223.1], 14: [245.1, 242.9, 247.1], 20: [213.7, 212.1, 214.9] },
  9: { 5: [195.1, 193.6, 196.5], 9: [224.6, 222.9, 226.5], 14: [243.1, 240.9, 245.5], 20: [215.2, 212.7, 216.9] },
  18: { 5: [197.0, 195.8, 200.3], 9: [225.8, 224.0, 227.3], 14: [258.6, 257.8, 261.0], 20: [220.3, 219.3, 221.5] },
  27: { 5: [189.4, 188.4, 192.1], 9: [211.1, 209.7, 212.1], 14: [238.4, 236.5, 241.3], 20: [209.0, 206.8, 210.0] },
};
const REAL_NSOLS = '19,30,23,22,21,21,23,22,22,18,19,18,17,19,19,19,18,18,17,13,17,14,13,15,11,15,16,15,16,16,17,16,18,18,18,20';
const realPath = new URL('../public/sites/jezero/climate.json', import.meta.url);

test('climate.json (gerçek veri) bağımsız referansla aynı', { skip: !fs.existsSync(realPath) && 'climate.json yok — python pipeline/build_climate.py' }, () => {
  const c = JSON.parse(fs.readFileSync(realPath));
  assert.equal(c.source.license, 'CC-BY-4.0');
  assert.equal(c.bins.map(b => b.nSols).join(','), REAL_NSOLS);
  for (const [b, hours] of Object.entries(REAL_SPOT)) for (const [h, [m, p10, p90]] of Object.entries(hours)) {
    const s = Number(h) * 12, bin = c.bins[b];
    assert.ok(Math.abs(bin.median[s] - m) <= 0.05 && Math.abs(bin.p10[s] - p10) <= 0.05 && Math.abs(bin.p90[s] - p90) <= 0.05,
      `bin ${b} ${h}:00 → ${bin.median[s]}/${bin.p10[s]}/${bin.p90[s]} vs ${m}/${p10}/${p90}`);
  }
});
