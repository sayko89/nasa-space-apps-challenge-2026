/**
 * Mars24 güneş modeli testleri — `node --test web/tests/*.test.mjs`
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as MT from '../src/utils/marsTime.js';

const ref = JSON.parse(fs.readFileSync(new URL('./fixtures/marstime_ref.json', import.meta.url)));
const angDiff = (a, b) => { const d = ((a - b) % 360 + 540) % 360 - 180; return Math.abs(d); };
const hDiff = (a, b) => { const d = ((a - b) % 24 + 36) % 24 - 12; return Math.abs(d); };

test('GISS örneği (USGS plio test değerleri): 2000-01-06 00:00 UTC', () => {
  const ms = Date.UTC(2000, 0, 6, 0, 0, 0);
  const j = MT.j2000tt(ms);
  assert.ok(Math.abs(MT.solarLongitude(j) - 277.18677) < 1e-5, `Ls ${MT.solarLongitude(j)}`);
  assert.ok(hDiff(MT.ltst(j, 0), 23.648468934) < 1e-8, `LTST ${MT.ltst(j, 0)}`);
  assert.ok(Math.abs(MT.sunPosition(ms, 0, 0).zenithDeg - 154.261908004) < 1e-7);
});

test('TT−UTC artık saniyeleri (2015 ve 2017 dahil)', () => {
  assert.equal(MT.ttMinusUtc(MT.julianUT(Date.UTC(2000, 0, 6))), 64.184);
  assert.equal(MT.ttMinusUtc(MT.julianUT(Date.UTC(2016, 5, 1))), 68.184);
  assert.equal(MT.ttMinusUtc(MT.julianUT(Date.UTC(2026, 9, 26))), 69.184);
});

test('marstime referansıyla 60 rastgele anda birebir uyum', () => {
  const { lonE } = ref.site;
  for (const r of ref.rows) {
    const j = r.j;
    assert.ok(angDiff(MT.solarLongitude(j), r.ls) < 1e-9, `Ls j=${j}`);
    assert.ok(Math.abs(MT.equationOfTime(j) - r.eot) < 1e-9, `EOT j=${j}`);
    assert.ok(Math.abs(MT.marsSolDate(j) - r.msd) < 1e-7, `MSD j=${j}`);
    assert.ok(hDiff(MT.mtc(j), r.mtc) < 1e-7, `MTC j=${j}`);
    assert.ok(hDiff(MT.ltst(j, lonE), r.ltst) < 1e-7, `LTST j=${j}`);
    assert.ok(angDiff(MT.subsolarLonWest(j), r.subsolW) < 1e-7, `subsolar j=${j}`);
    assert.ok(Math.abs(MT.solarDeclination(MT.solarLongitude(j)) - r.decl) < 1e-9, `decl j=${j}`);
    assert.ok(Math.abs(MT.heliocentricDistance(j) - r.r) < 1e-12, `r j=${j}`);
  }
});

test('azimut/yükseklik: güneş-altı noktasından bağımsız vektör geometrisiyle aynı', () => {
  // Güneş yönü ≈ Mars merkezinden güneş-altı noktasına (gezegen ölçeği ≪ AU).
  // Yerel doğu-kuzey-yukarı tabanında yazıp az/el hesapla, formülle karşılaştır.
  const D = Math.PI / 180;
  const unit = (latD, lonE) => [Math.cos(latD * D) * Math.cos(lonE * D), Math.cos(latD * D) * Math.sin(lonE * D), Math.sin(latD * D)];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  let n = 0;
  for (let k = 0; k < 400; k++) {
    const ms = Date.UTC(2026, 0, 1) + k * 37.3 * 3600e3;
    for (const [lat, lonE] of [[18.44, 77.45], [-14.6, 175.5], [60, -30]]) {
      const j = MT.j2000tt(ms);
      const dec = MT.solarDeclination(MT.solarLongitude(j));
      const sLonE = (360 - MT.subsolarLonWest(j)) % 360;
      const s = unit(dec, sLonE);
      const up = unit(lat, lonE);
      const east = [-Math.sin(lonE * D), Math.cos(lonE * D), 0];
      const north = [-Math.sin(lat * D) * Math.cos(lonE * D), -Math.sin(lat * D) * Math.sin(lonE * D), Math.cos(lat * D)];
      const elG = Math.asin(dot(s, up)) / D;
      const azG = (Math.atan2(dot(s, east), dot(s, north)) / D + 360) % 360;
      const p = MT.sunPosition(ms, lat, lonE);
      assert.ok(Math.abs(p.elevationDeg - elG) < 1e-6, `el ${p.elevationDeg} vs ${elG}`);
      if (Math.abs(elG) < 89.9) assert.ok(angDiff(p.azimuthDeg, azG) < 1e-6, `az ${p.azimuthDeg} vs ${azG} (lat ${lat})`);
      n++;
    }
  }
  assert.equal(n, 1200);
});

test('LTST hedefleme ve gün doğumu/batımı tutarlı', () => {
  const { lat, lonE } = ref.site;
  const base = Date.UTC(2026, 9, 26, 12);
  for (const target of [6, 9.5, 12, 17.25]) {
    const t = MT.msAtLtst(base, target, lonE);
    assert.ok(hDiff(MT.ltst(MT.j2000tt(t), lonE), target) < 1e-6);
    assert.ok(Math.abs(t - base) <= MT.SOL_SECONDS * 1000 * 0.51, 'en yakın sol seçilmeli');
  }
  const ss = MT.sunriseSunset(base, lat, lonE);
  assert.ok(ss, 'Jezero kutup gecesinde değil');
  const el = (t) => MT.sunPosition(t, lat, lonE).elevationDeg;
  assert.ok(Math.abs(el(ss.riseMs)) < 1e-4 && el(ss.riseMs + 60e3) > el(ss.riseMs), 'doğuşta yükseliyor');
  assert.ok(Math.abs(el(ss.setMs)) < 1e-4 && el(ss.setMs + 60e3) < el(ss.setMs), 'batışta alçalıyor');
  assert.ok(ss.riseLtst > 4 && ss.riseLtst < 8 && ss.setLtst > 16 && ss.setLtst < 20, `${ss.riseLtst} ${ss.setLtst}`);
  // Öğlen güneş en yüksekte ve güneyde/kuzeyde (azimut ≈ 0 veya 180)
  const noon = MT.msAtLtst(base, 12, lonE);
  const pn = MT.sunPosition(noon, lat, lonE);
  assert.ok(pn.elevationDeg > el(noon - 1800e3) && pn.elevationDeg > el(noon + 1800e3));
  assert.ok(angDiff(pn.azimuthDeg, 180) < 1 || angDiff(pn.azimuthDeg, 0) < 1, `öğlen azimut ${pn.azimuthDeg}`);
});
