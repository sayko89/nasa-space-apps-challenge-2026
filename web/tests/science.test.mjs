/**
 * Bilim durakları + orienteering testleri (Aşama 6)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { site } = await import('../src/terrain/siteData.js');

// 120×120, 4 m düz zemin (A*/Dijkstra süreleri simetrik), batı yarısı ana kaya A, doğu B.
const N = 120, CELL = 4;
Object.assign(site, {
  mode: 'dem', name: 'scitest', gridRes: N, cellM: CELL, sizeM: (N - 1) * CELL,
  heights: new Float32Array(N * N), heightOrigin: 0,
  meta: { center: { lat_deg: 18.44, lon_deg_east: 77.45 }, grid: { n: N, cell_m: CELL, span_m: (N - 1) * CELL },
          projection: { mars_radius_m: 3396190 } },
});
const T = await import('../src/three/terrainGenerator.js');
const P = await import('../src/utils/pathfinder.js');
const S = await import('../src/utils/science.js');
const WB = await import('../src/utils/walkback.js');

const hm = T.buildHeightMap(), sm = T.buildSlopeMap(hm), cm = T.buildCraterMask();
const HALF = (N - 1) * CELL / 2;
const world = (c, r) => ({ x: -HALF + c * CELL, z: -HALF + r * CELL });

// Sentetik jeoloji: ana kaya 1 (c<70) / 2 (c≥70); yüzey 1 = r<30 şeridi, 2 = (80..90)² kare, kalan 0
function synthGeo() {
  const surface = new Uint8Array(N * N), bedrock = new Uint8Array(N * N);
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    const i = r * N + c;
    bedrock[i] = c < 70 ? 1 : 2;
    surface[i] = r < 30 ? 1 : (r >= 80 && r < 90 && c >= 80 && c < 90) ? 2 : 0;
  }
  return { n: N, surface, bedrock, surfaceUnits: ['', 'Dunes', 'Smooth'], bedrockUnits: ['', 'Floor A', 'Floor B'] };
}

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }

const W = { bedrock: 2, surface: 1, contact: 3 };

function bruteForce(Tm, stops, o) {
  const k = stops.length;
  let best = { score: 0, totalS: 0 };
  const score = (set) => {
    const tags = new Set(set.flatMap(j => stops[j].tags));
    let s = 0; for (const t of tags) s += t[0] === 'B' ? o.weights.bedrock : t[0] === 'S' ? o.weights.surface : o.weights.contact;
    return s;
  };
  const perm = (cur, used, t) => {
    if (cur.length) {
      const total = t + Tm[cur[cur.length - 1] + 1][0];
      const sc = score(cur);
      if (total <= o.budgetS && (sc > best.score + 1e-9 || (Math.abs(sc - best.score) <= 1e-9 && total < best.totalS))) best = { score: sc, totalS: total };
    }
    for (let q = 0; q < k; q++) if (!used[q]) {
      const last = cur.length ? cur[cur.length - 1] + 1 : 0;
      used[q] = true; cur.push(q);
      perm(cur, used, t + Tm[last][q + 1] + o.dwellS);
      cur.pop(); used[q] = false;
    }
  };
  perm([], new Array(k).fill(false), 0);
  return best;
}

test('decodeRle: tur dönüşü ve boyut denetimi', () => {
  assert.deepEqual([...S.decodeRle([[0, 2], [3, 1], [1, 3]], 6)], [0, 0, 3, 1, 1, 1]);
  assert.throws(() => S.decodeRle([[0, 5]], 6));
  assert.throws(() => S.decodeRle([[0, 7]], 6));
  const g = { format: 'martian-map-geology/1', grid: { n: 2 }, surface: { rle: [[0, 4]], units: [''] }, bedrock: { rle: [[1, 4]], units: ['', 'X'] } };
  assert.equal(S.decodeGeology(g, 2).bedrock[3], 1);
  assert.equal(S.decodeGeology(g, 3), null);
  assert.equal(S.decodeGeology({ ...g, bedrock: { rle: [[1, 3]], units: [] } }, 2), null);
});

test('optimizeTour = kaba kuvvet (tüm sıralı alt kümeler), rastgele asimetrik örnekler', () => {
  const R = rng(7);
  const pool = ['B:a', 'B:b', 'S:x', 'S:y', 'S:z', 'C:a|b'];
  for (let trial = 0; trial < 40; trial++) {
    const k = 1 + Math.floor(R() * 6);
    const stops = Array.from({ length: k }, () => ({ tags: pool.filter(() => R() < 0.35) }));
    const Tm = Array.from({ length: k + 1 }, (_, i) => Array.from({ length: k + 1 }, (_, j) => i === j ? 0 : 200 + R() * 2000));
    const o = { budgetS: 1500 + R() * 6000, dwellS: R() * 900, weights: W };
    const got = S.optimizeTour(Tm, stops, o);
    const exp = bruteForce(Tm, stops, o);
    assert.ok(Math.abs(got.score - exp.score) < 1e-9, `trial ${trial}: score ${got.score} vs ${exp.score}`);
    if (exp.score > 0) assert.ok(Math.abs(got.totalS - exp.totalS) < 1e-6, `trial ${trial}: time ${got.totalS} vs ${exp.totalS}`);
    // Dönen sıra gerçekten o süreyi veriyor mu?
    let t = 0, last = 0;
    for (const j of got.order) { t += Tm[last][j + 1] + o.dwellS; last = j + 1; }
    if (got.order.length) t += Tm[last][0];
    assert.ok(Math.abs(t - got.totalS) < 1e-6 && t <= o.budgetS + 1e-9);
  }
});

test('candidateStops: iç hücre temsilcileri, kontak, radyal/bütçe elemesi', () => {
  const geo = synthGeo();
  const homeIdx = 60 * N + 60;
  const home = WB.homeTimeMaps(homeIdx, hm, P.getWallMap(), N, CELL);
  const o = { cellM: CELL, wall: P.getWallMap(), budgetS: 8 * 3600, dwellS: 600, maxRadialM: 2000, interiorR: 2, maxCandidates: 14 };
  const c = S.candidateStops(geo, home, o);
  const labels = c.map(s => s.label).sort();
  assert.deepEqual(labels, ['Contact: Floor A / Floor B', 'Dunes on Floor A', 'Dunes on Floor B', 'Floor A', 'Floor B', 'Smooth on Floor B']);
  for (const s of c) {
    if (s.kind === 'contact') {
      assert.ok(s.col === 69, `kontak sütunu ${s.col}`);
      assert.deepEqual(s.tags, ['B:Floor A', 'B:Floor B', 'C:Floor A | Floor B']);
      continue;
    }
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
      const k = s.idx + dr * N + dc;
      assert.equal(geo.bedrock[k], geo.bedrock[s.idx]); assert.equal(geo.surface[k], geo.surface[s.idx]);
    }
  }
  // "Floor A" temsilcisi eve en yakın uygun hücre = evin kendisi
  assert.equal(c.find(s => s.label === 'Floor A').idx, homeIdx);
  // Radyal sınır 100 m: yalnızca yakın adaylar (Smooth karesi ~80 m+ uzakta, iç hücresi daha da uzak)
  const near = S.candidateStops(geo, home, { ...o, maxRadialM: 100 });
  for (const s of near) assert.ok(Math.hypot(s.row - 60, s.col - 60) * CELL <= 100);
  assert.ok(!near.some(s => s.label === 'Dunes on Floor A'));
  // Bütçe: dwell bütçeyi aşıyorsa aday yok
  assert.equal(S.candidateStops(geo, home, { ...o, dwellS: 9 * 3600 }).length, 0);
});

test('planScienceEva: süre matrisi Dijkstra ile tutarlı, tur bütçede, çeşitlilik en yüksek', () => {
  const geo = synthGeo();
  const homeIdx = 60 * N + 60;
  const home = WB.homeTimeMaps(homeIdx, hm, P.getWallMap(), N, CELL);
  const o = { cellM: CELL, budgetS: 3600, dwellS: 300, maxRadialM: 2000, weights: W };
  const r = S.planScienceEva(geo, home, hm, P.getWallMap(), o);
  const k = r.candidates.length;
  for (let i = 0; i < k; i++) {
    const full = WB.dijkstraTimes(r.candidates[i].idx, hm, P.getWallMap(), N, CELL, 'from');
    for (let j = 0; j < k; j++) if (i !== j) assert.ok(Math.abs(r.T[i + 1][j + 1] - full[r.candidates[j].idx]) < 1e-6);
  }
  assert.ok(r.tour.totalS <= o.budgetS);
  // 1 saatte (bu grid ~480 m) tüm etiketler toplanabilir: 2 ana kaya + 2 yüzey + kontak
  assert.equal(r.tour.score, 2 * 2 + 2 * 1 + 3);
  // Gereksiz durak yok: hiçbir durak çıkarılınca puan aynı kalmamalı
  for (const drop of r.tour.order) {
    const rest = r.tour.order.filter(j => j !== drop);
    const tags = new Set(rest.flatMap(j => r.candidates[j].tags));
    assert.ok(tags.size < r.tour.tags.length, `durak ${drop} gereksiz`);
  }
});

test('dwell: walk-back marjı bekleme sonrası ölçülür; planAllRoutes toplam süreye ekler', () => {
  const path = [[0, 0, 0], [40, 0, 0], [80, 0, 0]];
  const toHome = new Float64Array(N * N).fill(100);
  const ci = () => 0;
  const a = WB.walkbackProfile(path, () => 0, ci, toHome, 3600);
  const b = WB.walkbackProfile(path, () => 0, ci, toHome, 3600, new Map([[1, 900]]));
  assert.equal(b.elapsed[0], a.elapsed[0]);
  assert.ok(Math.abs(b.elapsed[1] - a.elapsed[1] - 900) < 1e-9 && Math.abs(b.elapsed[2] - a.elapsed[2] - 900) < 1e-9);
  assert.ok(Math.abs(b.margin[1] - (a.margin[1] - 900)) < 1e-9);

  const h = world(60, 60), s1 = world(90, 60), s2 = world(90, 30);
  const plain = P.planAllRoutes([h, s1, s2, h], sm, cm, hm, 45, null, { modes: ['FAST'] }).FAST.stats;
  const withD = P.planAllRoutes([h, { ...s1, dwellS: 600 }, { ...s2, dwellS: 900 }, h], sm, cm, hm, 45, null, { modes: ['FAST'] }).FAST.stats;
  assert.equal(withD.dwellTotalS, 1500);
  assert.equal(withD.stopCount, 2);
  assert.ok(Math.abs(withD.roundTripS - plain.roundTripS - 1500) < 1e-6, `${withD.roundTripS} vs ${plain.roundTripS}`);
  assert.ok(withD.go);
  const huge = P.planAllRoutes([h, { ...s1, dwellS: 8 * 3600 }, h], sm, cm, hm, 45, null, { modes: ['FAST'] }).FAST.stats;
  assert.ok(!huge.go && huge.ponrIdx >= 0);
});

// Gerçek veri bütünlüğü: tarayıcıda Stack et al. 2020 shapefile'ından FARKLI bir algoritmayla
// (düğüm başına doğrudan çift-tek nokta-poligon testi) bağımsız hesaplanan değerler.
// Poligon kenarları ortak olduğundan 16 hücre iki poligona düşüyor → sayımlarda ±20 hücre tolerans.
const REAL_GEO_COUNTS = {
  bedrock: { 'Crater floor fractured rough': 160290, 'Crater floor fractured 1': 101854 },
  surface: { 'Undifferentiated smooth': 70997, 'Minor Cover Us': 1877, 'Aeolian bedforms, small': 7457,
             'Aeolian bedforms, large': 89922, '': 88430, 'Moderate Cover Us': 3461 },
};
const REAL_GEO_SPOTS = {   // "satır,sütun": [yüzey, ana kaya]
  '0,0': ['Undifferentiated smooth', 'Crater floor fractured rough'],
  '100,400': ['Aeolian bedforms, large', 'Crater floor fractured rough'],
  '256,256': ['Undifferentiated smooth', 'Crater floor fractured rough'],
  '300,50': ['Aeolian bedforms, large', 'Crater floor fractured 1'],
  '400,300': ['', 'Crater floor fractured rough'],
  '200,150': ['Aeolian bedforms, large', 'Crater floor fractured 1'],
  '450,480': ['Undifferentiated smooth', 'Crater floor fractured rough'],
};
const fs = await import('node:fs');
const geoPath = new URL('../public/sites/jezero/geology.json', import.meta.url);
test('geology.json (gerçek veri) bağımsız referansla aynı', { skip: !fs.existsSync(geoPath) && 'geology.json yok — python pipeline/build_geology.py' }, () => {
  const g = JSON.parse(fs.readFileSync(geoPath));
  assert.equal(g.source.license, 'CC-BY-4.0');
  const geo = S.decodeGeology(g, 512);
  assert.ok(geo, 'decodeGeology');
  for (const [layer, units, grid] of [['bedrock', geo.bedrockUnits, geo.bedrock], ['surface', geo.surfaceUnits, geo.surface]]) {
    const cnt = {};
    for (const v of grid) cnt[units[v]] = (cnt[units[v]] || 0) + 1;
    assert.deepEqual(Object.keys(cnt).sort(), Object.keys(REAL_GEO_COUNTS[layer]).sort(), layer);
    for (const [u, c] of Object.entries(REAL_GEO_COUNTS[layer])) assert.ok(Math.abs(cnt[u] - c) <= 20, `${layer} ${u}: ${cnt[u]} vs ${c}`);
  }
  for (const [rc, [s, b]] of Object.entries(REAL_GEO_SPOTS)) {
    const [r, c] = rc.split(',').map(Number), i = r * 512 + c;
    assert.deepEqual([geo.surfaceUnits[geo.surface[i]], geo.bedrockUnits[geo.bedrock[i]]], [s, b], rc);
  }
});

test('CRISM minerals: one candidate per detected mineral, M: tag scored, chosen when it adds diversity', () => {
  const geo = synthGeo();
  // Mg-carbonate patch (rows 50..56, cols 40..46) in otherwise mineral-free ground
  const code = new Uint8Array(N * N);
  for (let r = 50; r < 57; r++) for (let c = 40; c < 47; c++) code[r * N + c] = 1;
  const minerals = { code, classes: ['none', 'Mg-carbonate'] };
  const homeIdx = 60 * N + 60;
  const home = WB.homeTimeMaps(homeIdx, hm, P.getWallMap(), N, CELL);
  const o = { cellM: CELL, budgetS: 3600, dwellS: 120, maxRadialM: 2000, weights: { ...W, mineral: 2 }, interiorR: 2, minerals };
  const r = S.planScienceEva(geo, home, hm, P.getWallMap(), o);
  const mc = r.candidates.filter(c => c.kind === 'mineral');
  assert.equal(mc.length, 1);
  assert.ok(mc[0].tags.includes('M:Mg-carbonate'));
  assert.match(mc[0].label, /Mg-carbonate \(CRISM\)/);
  assert.ok(r.tour.tags.includes('M:Mg-carbonate'), 'the mineral is worth the detour within the budget');
  // without the layer nothing mineral-related appears
  const r0 = S.planScienceEva(geo, home, hm, P.getWallMap(), { ...o, minerals: null });
  assert.ok(!r0.candidates.some(c => c.tags.some(t => t[0] === 'M')));
});

test('ChemCam standouts: one re-sample candidate per distinct anomaly, capped, scored as X:', () => {
  const geo = synthGeo();
  const homeIdx = 60 * N + 60;
  const home = WB.homeTimeMaps(homeIdx, hm, P.getWallMap(), N, CELL);
  const near = 60 * N + 70, far = 60 * N + 90, other = 70 * N + 60;
  const chemCells = new Map([
    [near, [{ tag: 'MgO high', name: 'Gaviota', sol: 4600, diff: 6.3 }]],
    [far, [{ tag: 'MgO high', name: 'Far', sol: 4700, diff: 7 }]],          // same anomaly, farther → not used
    [other, [{ tag: 'CaO low', name: 'Canyon Oak', sol: 4650, diff: -3 }]],
  ]);
  const o = { cellM: CELL, budgetS: 3600, dwellS: 120, maxRadialM: 2000, weights: { ...W, chemistry: 2 }, interiorR: 2, chemCells };
  const r = S.planScienceEva(geo, home, hm, P.getWallMap(), o);
  const xc = r.candidates.filter(c => c.kind === 'chemistry');
  assert.equal(xc.length, 2);
  assert.deepEqual(xc.map(c => c.idx).sort((a, b) => a - b), [near, other].sort((a, b) => a - b));
  const g = xc.find(c => c.idx === near);
  assert.ok(g.tags.includes('X:MgO high'));
  assert.match(g.label, /^Re-sample Gaviota — ChemCam MgO high \(\+6\.3 wt%, sol 4600\)/);
  assert.equal(S.tagScore(['X:MgO high', 'X:MgO high', 'X:CaO low'], o.weights), 4);
  // cap
  const r1 = S.planScienceEva(geo, home, hm, P.getWallMap(), { ...o, maxChemCandidates: 1 });
  assert.equal(r1.candidates.filter(c => c.kind === 'chemistry').length, 1);
  // without chemistry nothing changes
  const r0 = S.planScienceEva(geo, home, hm, P.getWallMap(), { ...o, chemCells: null });
  assert.ok(!r0.candidates.some(c => c.kind === 'chemistry'));
});
