/** Workspace redesign — pure parts on the real Jezero site: data catalog, route-mode text, EVA timeline, point inspector. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadRealSite, planObjective } from './helpers/realSite.mjs';

const ctx = await loadRealSite('jezero');
const { site, PV, P, hm, sm, HZ, localToLatLon } = ctx;
const { buildCatalog, filterCatalog, CATALOG_CATEGORIES } = await import('../src/config/catalog.js');
const { routeModeExplanation, ROUTE_MODES } = await import('../src/utils/routeModes.js');
const { missionTimeline } = await import('../src/utils/missionTimeline.js');
const { inspectPoint, pointRelevance } = await import('../src/utils/inspect.js');
const { msAtLtst } = await import('../src/utils/marsTime.js');
const { MODE_WEIGHTS } = await import('../src/config/marswalkProfile.js');
const { oxygenConfig, planOxygenCheck } = await import('../src/utils/oxygen.js');
const { DEFAULT_MISSION } = await import('../src/config/mission.js');

const DRAPES = ['Hazards', 'Elevation', 'Slope Angle', 'No-Go', 'EVA Range', 'Geology: Bedrock', 'Geology: Surface',
  'Thermal Inertia (THEMIS)', 'Minerals (CRISM)', 'Rock Relief (HiRISE)', 'Illumination', 'Roughness'];

test('catalog lists only what the site loaded, each item documented by a provenance record', () => {
  const cats = buildCatalog(site, { drapeLayers: DRAPES });
  const ids = cats.map(c => c.id);
  for (const c of ['imagery', 'topography', 'geology', 'mineralogy', 'thermal', 'atmospheric', 'radiation', 'rover', 'hazards', 'mission']) assert.ok(ids.includes(c), c);
  assert.ok(!ids.includes('chemistry'), 'no ChemCam table at Jezero');
  // AI segmentation appears because the site has real model outputs; it is marked AI-predicted
  assert.ok(ids.includes('ai'));
  assert.equal(PV.provenanceFor('jezero', site).find(r => r.key === 'segmentation').category, 'ai-predicted');
  assert.ok(!buildCatalog({ ...site, segmentation: null }, { drapeLayers: DRAPES }).some(c => c.id === 'ai'), 'no outputs → no AI category');
  assert.ok(ids.every(id => CATALOG_CATEGORIES.some(([k]) => k === id)));
  const prov = new Set(PV.provenanceFor('jezero', site).filter(r => r.available).map(r => r.key));
  for (const it of cats.flatMap(c => c.items)) assert.ok(prov.has(it.prov), `${it.id} → ${it.prov}`);
  // a layer this build cannot draw is not offered
  assert.ok(!buildCatalog(site, { drapeLayers: [] }).flatMap(c => c.items).some(i => i.kind === 'drape'));
  assert.deepEqual(filterCatalog(cats, 'crism').flatMap(c => c.items).map(i => i.layer), ['Minerals (CRISM)']);
  assert.equal(filterCatalog(cats, 'zzz').length, 0);
});

test('route-mode explanations are the planner weights, not new rules', () => {
  for (const m of ROUTE_MODES) {
    const e = routeModeExplanation(m, 20);
    assert.equal(e.k, MODE_WEIGHTS[m].slopeAversion);
    assert.equal(e.c, MODE_WEIGHTS[m].climbPenaltyS);
    assert.equal(e.goal, MODE_WEIGHTS[m].desc);
  }
  assert.equal(routeModeExplanation('FAST', 20).formula, 'walking time');
  assert.match(routeModeExplanation('SAFE', 20).formula, /× \(1 \+ 4·\(slope\/20°\)²\)/);
  assert.match(routeModeExplanation('ECO', 20).formula, /60 s per metre climbed/);
});

test('EVA timeline: legs, stops and walk home tile the planned round trip; limits come from the route', () => {
  const startMs = msAtLtst(Date.UTC(2026, 10, 14), 9, 77.45);
  const { safe } = planObjective(ctx, 'mineral-diversity', startMs);
  const ox = planOxygenCheck(oxygenConfig(DEFAULT_MISSION), safe.stats);
  const tl = missionTimeline(safe, { startMs, oxygen: ox });
  assert.ok(tl.items.length >= 3);
  assert.equal(tl.items[0].t0, 0);
  for (let i = 1; i < tl.items.length; i++) assert.ok(Math.abs(tl.items[i].t0 - tl.items[i - 1].t1) < 1e-6, 'contiguous');
  const last = tl.items[tl.items.length - 1];
  assert.equal(last.kind, 'return');
  assert.ok(Math.abs(last.t1 - safe.stats.roundTripS) < 2, `${last.t1} vs ${safe.stats.roundTripS}`);
  assert.equal(tl.items.filter(i => i.kind === 'stop').length, safe.stats.stops.length);
  assert.equal(tl.marks.find(m => m.kind === 'budget').t, safe.stats.budgetS);
  assert.ok(tl.marks.some(m => m.kind === 'sunset'));
  assert.ok(Math.abs(tl.marks.find(m => m.kind === 'o2').t - ox.enduranceS) < 1e-6);
  assert.equal(missionTimeline(null), null);
});

test('point inspector reads the grids; relevance follows the planner thresholds', () => {
  const T = ctx.T;
  const idxAt = (x, z) => { const { col, row } = P.worldToGrid(x, z); return row * T.GRID_RES + col; };
  const c = { site, n: T.GRID_RES, idxAt, heights: hm, slope: sm, hazard: null, hazardClasses: HZ.HAZARD_CLASSES,
    latLon: localToLatLon, home: { x: 0, z: 0 }, stations: site.pov?.stations };
  const p = inspectPoint(120, -80, c);
  assert.ok(Number.isFinite(p.elevationM) && p.elevationM < -2000, 'MOLA elevation');
  assert.ok(Math.abs(p.latLon.lat - 18.44) < 0.05);
  assert.ok(p.slopeDeg >= 0 && p.slopeDeg < 60);
  assert.ok(p.geology?.bedrock || p.geology?.surface);
  assert.ok(Math.abs(p.homeDistM - Math.hypot(120, 80)) < 1e-9);
  const rel = pointRelevance(p, { maxSlopeDeg: 20, maxRockReliefM: 0.5 });
  assert.ok(rel.some(l => /walking limit/.test(l.text)));
  assert.equal(pointRelevance({ ...p, slopeDeg: 25 }, { maxSlopeDeg: 20 }).find(l => /Slope/.test(l.text)).level, 'block');
  assert.equal(inspectPoint(0, 0, { ...c, idxAt: () => -1 }), null);
});
