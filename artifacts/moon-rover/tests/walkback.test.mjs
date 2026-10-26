/**
 * Walk-back margin testleri (Aşama 4) — `node --test artifacts/moon-rover/tests/*.test.mjs`
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { site } = await import('../src/terrain/siteData.js');

// 200×200, 4 m: doğuya doğru %8 eğimli düzlem + hafif dalga + duvarla çevrili bir "kuyu"
const N = 200, CELL = 4;
const heights = new Float32Array(N * N);
for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
  let h = 0.08 * c * CELL + 1.5 * Math.sin(r / 9) * Math.cos(c / 13);
  // Kapalı halka: merkez (150,150), yarıçap ~10 hücre, 30 m yüksek dik duvar
  const d = Math.hypot(r - 150, c - 150);
  if (d > 9 && d < 12) h += 30;
  heights[r * N + c] = h;
}
Object.assign(site, {
  mode: 'dem', name: 'wbtest', gridRes: N, cellM: CELL, sizeM: (N - 1) * CELL,
  heights, heightOrigin: 0,
  meta: { center: { lat_deg: 18.44, lon_deg_east: 77.45 }, grid: { n: N, cell_m: CELL, span_m: (N - 1) * CELL },
          projection: { mars_radius_m: 3396190 } },
});

const T = await import('../src/three/terrainGenerator.js');
const P = await import('../src/utils/pathfinder.js');
const WB = await import('../src/utils/walkback.js');
const W = await import('../src/utils/walkModel.js');
const { param } = await import('../src/config/marswalkProfile.js');

const hm = T.buildHeightMap(), sm = T.buildSlopeMap(hm), cm = T.buildCraterMask();
const HALF = (N - 1) * CELL / 2;
const world = (c, r) => ({ x: -HALF + c * CELL, z: -HALF + r * CELL });
const HOME = { c: 40, r: 100 };
const homeW = world(HOME.c, HOME.r);
const t0 = performance.now();
const maps = P.getHomeMaps(homeW.x, homeW.z, hm);
const dijkstraMs = performance.now() - t0;
const fastMult = P._internals.buildDemMultMap('FAST', sm);   // slopeAversion 0 → 1 for open cells

function aStarTime(sc, sr, ec, er) {
  const path = P._internals.aStar(sr, sc, er, ec, fastMult, { hMap: hm, climbPenaltyS: 0 });
  let t = 0;
  for (let i = 1; i < path.length; i++) {
    const a = P.worldToGrid(path[i - 1][0], path[i - 1][2]);
    const b = P.worldToGrid(path[i][0], path[i][2]);
    const diag = a.row !== b.row && a.col !== b.col;
    t += W.walkTimeS(diag ? CELL * Math.SQRT2 : CELL, hm[b.row * N + b.col] - hm[a.row * N + a.col]);
  }
  return t;
}

test('ev hücresinde iki harita da 0', () => {
  const k = HOME.r * N + HOME.c;
  assert.equal(maps.fromHome[k], 0);
  assert.equal(maps.toHome[k], 0);
  console.log(`  (iki Dijkstra ${N}×${N}: ${dijkstraMs.toFixed(0)} ms)`);
});

test('ev haritaları A* en kısa süreleriyle aynı (her iki yön)', () => {
  for (const [c, r] of [[180, 20], [120, 180], [60, 30], [190, 100]]) {
    const k = r * N + c;
    const back = aStarTime(c, r, HOME.c, HOME.r);
    const out = aStarTime(HOME.c, HOME.r, c, r);
    assert.ok(Math.abs(maps.toHome[k] - back) / back < 1e-6, `toHome ${c},${r}: ${maps.toHome[k]} vs A* ${back}`);
    assert.ok(Math.abs(maps.fromHome[k] - out) / out < 1e-6, `fromHome ${c},${r}: ${maps.fromHome[k]} vs A* ${out}`);
  }
});

test('yön asimetrisi: yokuş yukarıdaki hücreye gitmek, dönmekten uzun sürer', () => {
  const k = 100 * N + 120;                       // evin doğusu = yokuş yukarı
  assert.ok(maps.fromHome[k] > maps.toHome[k], `${maps.fromHome[k].toFixed(0)} > ${maps.toHome[k].toFixed(0)}`);
});

test('duvarla çevrili bölge ulaşılamaz → Infinity ve NO-GO', () => {
  const k = 150 * N + 150;
  assert.equal(maps.toHome[k], Infinity);
  assert.equal(maps.fromHome[k], Infinity);
  const path = [[world(135, 150).x, 0, world(135, 150).z], [world(150, 150).x, 0, world(150, 150).z]];  // 135: halkanın dışı (d=15)
  const wb = WB.walkbackProfile(path, T.getTerrainHeight, P._internals.cellIndexAt, maps.toHome, 8 * 3600);
  assert.equal(wb.ponrIdx, 1);
  assert.equal(wb.minMarginS, -Infinity);
});

test('dönüşü olmayan nokta: marjın ilk negatif olduğu nokta', () => {
  const routes = P.planAllRoutes([homeW, world(185, 40)], sm, cm, hm, 45, null);
  const { path, stats } = routes.FAST;
  // Normal bütçe: bu mesafe (~600 m) için GO
  assert.equal(stats.ponrIdx, -1);
  assert.ok(stats.go);
  assert.ok(Math.abs(stats.marginS[0] - param('evaDurationH') * 3600) < 1e-6, 'başlangıç = ev → tam bütçe');
  // Yapay küçük bütçe: dönüşü olmayan nokta rota ortasında bir yerde çıkmalı
  const small = stats.roundTripS * 0.6;
  const wb = WB.walkbackProfile(path, T.getTerrainHeight, P._internals.cellIndexAt, maps.toHome, small);
  assert.ok(wb.ponrIdx > 0 && wb.ponrIdx < path.length - 1, `ponr=${wb.ponrIdx}/${path.length}`);
  for (let i = 0; i < wb.ponrIdx; i++) assert.ok(wb.margin[i] >= 0, `nokta ${i} marj ${wb.margin[i]}`);
  assert.ok(wb.margin[wb.ponrIdx] < 0);
  // Gidiş-dönüş = gidiş + varıştan en hızlı dönüş
  assert.ok(Math.abs(stats.roundTripS - stats.walkTimeS - stats.returnTimeS) < 1e-6);
});
