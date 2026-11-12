/**
 * Marswalk (DEM modu) testleri — `node --test web/tests/`
 *
 * Arazi modülleri IS_DEM gibi sabitleri import anında sabitlediği için site
 * verisi, modüller DİNAMİK import edilmeden önce doldurulur. node:test her
 * dosyayı ayrı süreçte çalıştırdığı için diğer test dosyalarını etkilemez.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { site } = await import('../src/terrain/siteData.js');

// 256×256, 4 m grid; deterministik engebeli arazi + dik bir sırt
const N = 256, CELL = 4;
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
const rand = rng(42);
const phases = Array.from({ length: 6 }, () => rand() * Math.PI * 2);
const heights = new Float32Array(N * N);
for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
  const x = c * CELL, z = r * CELL;
  let h = 6 * Math.sin(x / 90 + phases[0]) * Math.cos(z / 70 + phases[1])
        + 2 * Math.sin(x / 23 + phases[2]) + 1.5 * Math.cos(z / 17 + phases[3]);
  const d = Math.abs(c - 128) * CELL;                // sırt: c=128 ekseni
  if (!(r >= 180 && r <= 200)) h += Math.max(0, 40 - d * 0.9); // ~42° yamaç, r 180-200 geçit
  heights[r * N + c] = h;
}
Object.assign(site, {
  mode: 'dem', name: 'test', gridRes: N, cellM: CELL, sizeM: (N - 1) * CELL,
  heights, heightOrigin: 0,
  meta: { center: { lat_deg: 18.44, lon_deg_east: 77.45 }, grid: { n: N, cell_m: CELL, span_m: (N - 1) * CELL },
          projection: { mars_radius_m: 3396190 } },
});

const T = await import('../src/three/terrainGenerator.js');
const P = await import('../src/utils/pathfinder.js');
const W = await import('../src/utils/walkModel.js');
const { param, MODE_WEIGHTS } = await import('../src/config/marswalkProfile.js');

const hm = T.buildHeightMap(), sm = T.buildSlopeMap(hm), cm = T.buildCraterMask();
const HALF = (N - 1) * CELL / 2;
const cellCenter = (c, r) => ({ x: -HALF + c * CELL, z: -HALF + r * CELL });

test('walk model: NASA düz zemin hızı ve Tobler şekli', () => {
  assert.ok(Math.abs(W.walkSpeedMs(0) * 3.6 - param('levelWalkSpeedKmh')) < 1e-9);
  assert.ok(W.maxSpeedMs() >= W.walkSpeedMs(-0.05) - 1e-12);
  for (const g of [0.1, 0.2, 0.3]) {
    assert.ok(W.walkSpeedMs(g) < W.walkSpeedMs(-g), `yokuş yukarı daha yavaş olmalı (g=${g})`);
    assert.ok(W.walkSpeedMs(g) <= W.maxSpeedMs());
  }
  // 100 m düz yol, 2 km/h → 180 s
  assert.ok(Math.abs(W.walkTimeS(100, 0) - 180) < 1e-6);
});

test('duvarlar: eğim sınırını aşan hücreler geçilmez', () => {
  const wall = P.getWallMap();
  const lim = Math.tan(param('maxWalkableSlopeDeg') * Math.PI / 180);
  for (let r = 1; r < N - 1; r++) for (let c = 1; c < N - 1; c++) {
    const i = r * N + c;
    assert.equal(wall[i] === 1, sm[i] > lim, `hücre ${c},${r}`);
  }
});

// Heuristic'siz Dijkstra — aynı kenar maliyetiyle kanıtlanmış en iyi süre
function dijkstraTime(sr, sc, er, ec, mult, climbPenaltyS) {
  const wall = P.getWallMap();
  const dist = new Float64Array(N * N).fill(Infinity);
  const done = new Uint8Array(N * N);
  dist[sr * N + sc] = 0;
  const heap = [[0, sr * N + sc]];
  const push = (e) => { heap.push(e); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const t = heap[0], l = heap.pop(); if (heap.length) { heap[0] = l; let i = 0; for (;;) { let m = i; const a = 2 * i + 1, b = a + 1; if (a < heap.length && heap[a][0] < heap[m][0]) m = a; if (b < heap.length && heap[b][0] < heap[m][0]) m = b; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return t; };
  while (heap.length) {
    const [d, k] = pop();
    if (done[k]) continue; done[k] = 1;
    if (k === er * N + ec) return d;
    const r = Math.floor(k / N), c = k % N;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const nr = r + dr, nc = c + dc;
      if (nr < 0 || nr >= N || nc < 0 || nc >= N) continue;
      const nk = nr * N + nc;
      if (wall[nk] || done[nk]) continue;
      const dh = hm[nk] - hm[k];
      let step = W.walkTimeS(dr && dc ? CELL * Math.SQRT2 : CELL, dh) * mult[nk];
      if (dh > 0 && climbPenaltyS) step += climbPenaltyS * dh;
      if (d + step < dist[nk]) { dist[nk] = d + step; push([dist[nk], nk]); }
    }
  }
  return Infinity;
}

function pathCost(worldPath, mult, climbPenaltyS) {
  let t = 0;
  for (let i = 1; i < worldPath.length; i++) {
    const a = P.worldToGrid(worldPath[i - 1][0], worldPath[i - 1][2]);
    const b = P.worldToGrid(worldPath[i][0], worldPath[i][2]);
    const ka = a.row * N + a.col, kb = b.row * N + b.col;
    const diag = a.row !== b.row && a.col !== b.col;
    const dh = hm[kb] - hm[ka];
    let step = W.walkTimeS(diag ? CELL * Math.SQRT2 : CELL, dh) * mult[kb];
    if (dh > 0 && climbPenaltyS) step += climbPenaltyS * dh;
    t += step;
  }
  return t;
}

test('A* her modda Dijkstra ile aynı (optimal) süreyi bulur', () => {
  const pairs = [[[20, 40], [230, 60]], [[30, 220], [220, 30]], [[60, 120], [200, 140]]];
  for (const mode of ['FAST', 'SAFE', 'ECO', 'AUTO']) {
    const mult = P._internals.buildDemMultMap(mode, sm);
    const cp = MODE_WEIGHTS[mode].climbPenaltyS;
    for (const [[sc, sr], [ec, er]] of pairs) {
      const raw = P._internals.aStar(sr, sc, er, ec, mult, { hMap: hm, climbPenaltyS: cp });
      const got = pathCost(raw, mult, cp);
      const best = dijkstraTime(sr, sc, er, ec, mult, cp);
      assert.ok(Number.isFinite(best), `${mode}: hedef ulaşılabilir olmalı`);
      assert.ok(Math.abs(got - best) / best < 1e-6, `${mode} ${sc},${sr}→${ec},${er}: A* ${got.toFixed(2)} s, Dijkstra ${best.toFixed(2)} s`);
    }
  }
});

test('planAllRoutes: sırtı geçitten geçer, duvara girmez, istatistikler tutarlı', () => {
  const a = cellCenter(40, 100), b = cellCenter(216, 100);
  const routes = P.planAllRoutes([a, b], sm, cm, hm, 45, null);
  const gapZ0 = -HALF + 180 * CELL, gapZ1 = -HALF + 200 * CELL;
  for (const [mode, { path, stats }] of Object.entries(routes)) {
    let crossZ = null;
    for (let i = 1; i < path.length; i++) {
      if ((path[i - 1][0] - 0) * (path[i][0] - 0) <= 0) crossZ = path[i][2];
    }
    assert.ok(crossZ >= gapZ0 - CELL && crossZ <= gapZ1 + CELL, `${mode}: sırtı z=${crossZ} noktasında geçti`);
    assert.ok(stats.maxSlopeDeg <= param('maxWalkableSlopeDeg') + 1e-6, `${mode}: maxSlope ${stats.maxSlopeDeg}`);
    assert.ok(stats.walkTimeS > 0 && stats.returnTimeS > 0);
    assert.ok(Math.abs(stats.roundTripS - stats.walkTimeS - stats.returnTimeS) < 1e-6);
    assert.equal(stats.go, stats.checks.budget && stats.checks.radial && stats.checks.slope);
    // Hiçbir yol, düz zemin hızıyla düz çizgiden daha hızlı olamaz
    const straight = Math.hypot(b.x - a.x, b.z - a.z);
    assert.ok(stats.walkTimeS >= straight / W.maxSpeedMs() - 1);
  }
  // FAST tanım gereği en kısa (smoothing öncesi) süre; smoothing sonrası küçük sapmaya izin ver
  const fast = routes.FAST.stats.walkTimeS;
  for (const m of ['SAFE', 'ECO', 'AUTO']) assert.ok(routes[m].stats.walkTimeS >= fast * 0.97, m);
});

test('eğik düzlemde dönüş süresi yön farkını yansıtır', () => {
  // Tamamen yokuş yukarı giden rota: gidiş > dönüş olmalı
  const path = [];
  for (let i = 0; i <= 50; i++) path.push([i * 4, 0, 0]);
  const incline = (x) => 0.12 * x;                    // %12 yokuş
  const out = W.pathWalkStats(path, (x) => incline(x)).timeS;
  const back = W.reverseWalkTimeS(path, (x) => incline(x));
  assert.ok(out > back, `gidiş ${out.toFixed(0)} s > dönüş ${back.toFixed(0)} s`);
});

test('daylight rule: GO needs start after sunrise and home before sunset', async () => {
  const a = cellCenter(40, 100), b = cellCenter(216, 100);
  // Without a start time there is no daylight check (Moon / tests)
  const plain = P.planAllRoutes([a, b], sm, cm, hm, 45, null, { modes: ['SAFE'] }).SAFE.stats;
  assert.equal('daylight' in plain.checks, false);
  assert.equal(plain.go, plain.checks.budget && plain.checks.radial && plain.checks.slope);
  const { msAtLtst } = await import('../src/utils/marsTime.js');
  const at = (h) => P.planAllRoutes([a, b], sm, cm, hm, 45, null,
    { modes: ['SAFE'], startMs: msAtLtst(Date.UTC(2026, 10, 12), h, 77.45) }).SAFE.stats;
  const morning = at(9), evening = at(17.8), night = at(2);
  assert.equal(morning.checks.daylight, true);
  assert.equal(morning.go, plain.go);
  for (const s of [evening, night]) {
    assert.equal(s.light.homeBySunset, false);
    assert.equal(s.checks.daylight, false);
    assert.equal(s.go, false);
  }
});
