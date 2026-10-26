/**
 * Gölge + ışık analizi testleri (Aşama 5a)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { site } = await import('../src/terrain/siteData.js');

// 200×200, 2 m: düz zemin + sütun 100'de kuzey-güney doğrultulu 20 m'lik ince duvar
const N = 200, CELL = 2, WALL_COL = 100, WALL_H = 20;
const heights = new Float32Array(N * N);
for (let r = 0; r < N; r++) heights[r * N + WALL_COL] = WALL_H;
Object.assign(site, {
  mode: 'dem', name: 'shtest', gridRes: N, cellM: CELL, sizeM: (N - 1) * CELL, heights, heightOrigin: 0,
  meta: { center: { lat_deg: 18.44, lon_deg_east: 77.45 }, grid: { n: N, cell_m: CELL, span_m: (N - 1) * CELL },
          projection: { mars_radius_m: 3396190 } },
});

const S = await import('../src/utils/shadows.js');
const T = await import('../src/three/terrainGenerator.js');
const P = await import('../src/utils/pathfinder.js');
const MT = await import('../src/utils/marsTime.js');
const hm = T.buildHeightMap(), sm = T.buildSlopeMap(hm), cm = T.buildCraterMask();

test('düz zemin: gündüz gölge yok, gece her yer karanlık', () => {
  const flat = new Float32Array(N * N);
  assert.equal(S.shadowMask(flat, N, CELL, 120, 30).reduce((a, b) => a + b, 0), 0);
  assert.equal(S.shadowMask(flat, N, CELL, 120, -1).reduce((a, b) => a + b, 0), N * N);
});

test('duvar gölgesinin boyu = yükseklik / tan(güneş yüksekliği)', () => {
  for (const el of [15, 30, 45]) {
    const mask = S.shadowMask(hm, N, CELL, 90, el);                 // güneş doğuda → gölge batıya
    const row = 100;
    let len = 0;
    for (let c = WALL_COL - 1; c >= 0 && mask[row * N + c]; c--) len += CELL;
    const expected = WALL_H / Math.tan(el * Math.PI / 180);
    assert.ok(Math.abs(len - expected) <= 2 * CELL, `el=${el}: gölge ${len} m, beklenen ${expected.toFixed(1)} m`);
    // Duvarın doğu (güneşe bakan) tarafı aydınlık
    for (let c = WALL_COL + 1; c < WALL_COL + 10; c++) assert.equal(mask[row * N + c], 0);
  }
});

test('nokta testi gölge maskesiyle tutarlı', () => {
  const az = 90, el = 30, half = (N - 1) * CELL / 2;
  const mask = S.shadowMask(hm, N, CELL, az, el);
  for (const c of [60, 80, 90, 95, 99, 110, 150]) {
    const x = -half + c * CELL, z = 0, r = Math.round(half / CELL);
    assert.equal(S.isShadowedAt(hm, N, CELL, half, x, z, az, el) ? 1 : 0, mask[r * N + c], `sütun ${c}`);
  }
});

test('rota ışık analizi: gece başlangıcı karanlık, gündüz kısa rota gün batımından önce biter', () => {
  const lon = 77.45, base = Date.UTC(2026, 9, 26, 12);
  const a = { x: -120, z: -40 }, b = { x: -60, z: 40 };             // duvarın batısı, kısa rota
  const night = MT.msAtLtst(base, 1, lon);
  const rn = P.planAllRoutes([a, b], sm, cm, hm, 45, null, { startMs: night, modes: ['FAST'] });
  assert.equal(rn.FAST.stats.light.startsInDaylight, false);
  assert.ok(rn.FAST.stats.light.darkFrac > 0.99, `darkFrac ${rn.FAST.stats.light.darkFrac}`);
  assert.equal(rn.FAST.stats.light.homeBySunset, false);
  const morning = MT.msAtLtst(base, 10, lon);
  const rd = P.planAllRoutes([a, b], sm, cm, hm, 45, null, { startMs: morning, modes: ['FAST'] });
  assert.equal(rd.FAST.stats.light.startsInDaylight, true);
  assert.equal(rd.FAST.stats.light.darkFrac, 0);
  assert.equal(rd.FAST.stats.light.homeBySunset, true);
  // startMs verilmezse ışık analizi yok (eski davranış)
  const r0 = P.planAllRoutes([a, b], sm, cm, hm, 45, null, { modes: ['FAST'] });
  assert.equal(r0.FAST.stats.light, null);
});
