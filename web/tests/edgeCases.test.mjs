/**
 * Edge cases on the real Jezero site, through the same functions the app uses:
 * invalid coordinates, unknown objective, empty stop list, unreachable target, payload over the limit,
 * missing dust settings, excessive slope, negative walk-back margin, future space weather, missing data.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadRealSite, planObjective } from './helpers/realSite.mjs';

const ctx = await loadRealSite('jezero');
const { P, T, MS, hm, sm, cm } = ctx;
const { msAtLtst } = await import('../src/utils/marsTime.js');
const { spaceWeatherAt } = await import('../src/utils/radiation.js');
const { payloadAssessment } = await import('../src/utils/payload.js');
const { dustAssessment } = await import('../src/utils/dust.js');
const { mobilityAssessment } = await import('../src/utils/mobility.js');
const { oxygenConfig, planOxygenCheck } = await import('../src/utils/oxygen.js');
const START = msAtLtst(Date.UTC(2026, 10, 14), 9, 77.45);
const plan = (wps, mission = { suit: 'mars', equipmentKg: 10 }) => P.planAllRoutes(wps, sm, cm, hm, 45, null, { modes: ['SAFE'], startMs: START, mission }).SAFE;
const limits = { maxSlopeDeg: 20, maxRadialM: 2000 };
const clear = { advisory: 'clear', near: [], sep: [] };
const decide = (s, extra = {}) => MS.missionDecision(s, { limits, wx: clear, radiationLocal: false, hazards: [], ...extra });

test('invalid coordinates are rejected, never moved onto the site edge', () => {
  assert.throws(() => plan([{ x: 0, z: 0 }, { x: 5000, z: 0 }]), /outside the .* site/);
  assert.throws(() => plan([{ x: 0, z: 0 }, { x: NaN, z: 0 }]), /no valid coordinates/);
  assert.throws(() => plan([{ x: 0, z: 0 }, { x: 0, z: -1023 }]), /outside/);
  assert.throws(() => P.planScience({ x: 3000, z: 0 }, hm, { objectiveId: 'mineral-diversity', slopeMap: sm }), /science EVA start .* outside/);
  assert.throws(() => P.planScience({ x: 0, z: 0 }, hm, { objectiveId: 'boxwork', slopeMap: sm }), /unknown mission objective/);   // a Gale objective at Jezero
  assert.equal(plan([{ x: 0, z: 0 }, { x: 1022, z: 1022 }]).path.length > 1, true);                                   // the corner itself is inside
});

test('empty science stop list: nothing fits → no stops, no crash', () => {
  const r = P.planScience({ x: 0, z: 0 }, hm, { objectiveId: 'olivine-smectite', slopeMap: sm, maxReturnS: 1 });   // 1-s rover walk-back
  assert.deepEqual(r.stops, []);
  assert.equal(r.totalS, 0);
});

test('unreachable target: the route ends on the nearest walkable cell, never inside a wall', () => {
  const wall = P.getWallMap(), n = T.GRID_RES, cell = T.TERRAIN_SIZE / (n - 1), half = T.TERRAIN_SIZE / 2;
  let wi = -1;
  for (let i = 0; i < wall.length; i++) if (wall[i] && Math.abs(i % n - n / 2) < n / 3 && Math.abs(Math.floor(i / n) - n / 2) < n / 3) { wi = i; break; }
  if (wi < 0) return;                                                    // no interior wall cell at this site
  const tx = -half + (wi % n) * cell, tz = -half + Math.floor(wi / n) * cell;
  const r = plan([{ x: 0, z: 0 }, { x: tx, z: tz }]);
  const end = r.path[r.path.length - 1];
  assert.equal(P.isWallAt(end[0], end[2]), false);
  assert.ok(Math.hypot(end[0] - tx, end[2] - tz) < 30, 'ends next to the wall');
});

test('payload over the limit on a real route → NO-GO through the carry rule; mobility unaffected', () => {
  const wps = [{ x: 0, z: 0 }, { x: 300, z: -200, dwellS: 1200 }, { x: 0, z: 0 }];
  const heavy = plan(wps, { suit: 'mars', equipmentKg: 40 });
  const d = decide(heavy.stats, { payload: payloadAssessment({ suit: 'mars', equipmentKg: 40 }) });
  assert.equal(d.status, 'NO-GO');
  assert.match(d.summary, /carried weight/);
  assert.equal(mobilityAssessment(heavy.stats, d, { hazards: [] }).status, 'PASS');
});

test('missing dust settings → dust INSUFFICIENT DATA, decision unchanged; future space weather → never GO', () => {
  const r = planObjective(ctx, 'mineral-diversity', START).safe;
  const dust = dustAssessment({ startMs: START, stopCount: r.stats.stopCount, dustGroundShare: r.stats.layers.thermal.dustShare });
  assert.equal(dust.status, 'INSUFFICIENT DATA');
  const base = decide(r.stats);
  assert.equal(decide(r.stats, { dust }).status, base.status);
  const future = Date.UTC(2031, 0, 1);
  const wx = spaceWeatherAt(null, future);
  assert.equal(wx.advisory, 'no-data');
  const f = MS.missionDecision(r.stats, { limits, wx, startFuture: true, radiationLocal: false, hazards: [] });
  assert.notEqual(f.status, 'GO');
  assert.ok(f.environment.find(e => e.key === 'spaceWeather').detail.includes('does not forecast'));
});

test('negative walk-back margin (7.5-h stay far out): point of no return, NO-GO, oxygen NO-GO too', () => {
  const r = plan([{ x: 0, z: 0 }, { x: 900, z: 600, dwellS: 7.5 * 3600 }, { x: 0, z: 0 }]);
  assert.ok(r.stats.minMarginS < 0 && r.stats.ponrIdx >= 0);
  assert.equal(r.stats.checks.budget, false);
  const d = decide(r.stats, { oxygen: planOxygenCheck(oxygenConfig({ suit: 'mars', equipmentKg: 10 }), r.stats) });
  assert.equal(d.status, 'NO-GO');
  assert.equal(d.hard.find(h => h.key === 'oxygen').ok, false);
  assert.equal(mobilityAssessment(r.stats, d, { hazards: [] }).status, 'FAIL');
});

test('excessive slope on a real route → NO-GO; a favourable payload / dust / oxygen result cannot override it', () => {
  const r = plan([{ x: 0, z: 0 }, { x: 300, z: -200 }]);
  const steep = { ...r.stats, maxSlopeDeg: 25, checks: { ...r.stats.checks, slope: false } };
  const mission = { suit: 'mars', equipmentKg: 5, o2: { scenario: 'closed-loop', initialKg: 5, reserveMin: 30 },
    dust: { outerLayer: 'epg-development', jointProtection: 'dust-tolerant', equipmentProtection: 'enclosed', covers: 'fitted' } };
  const d = decide(steep, { payload: payloadAssessment(mission), dust: dustAssessment({ dust: mission.dust, startMs: START }),
    oxygen: planOxygenCheck(oxygenConfig(mission), steep) });
  assert.equal(d.status, 'NO-GO');
  assert.deepEqual(d.hard.filter(h => !h.ok).map(h => h.key), ['slope']);
});

test('missing data: no route, no start time, missing layer → INSUFFICIENT DATA or explicit gaps', () => {
  assert.equal(MS.missionDecision(null, {}).status, 'INSUFFICIENT DATA');
  const noStart = P.planAllRoutes([{ x: 0, z: 0 }, { x: 200, z: 0 }], sm, cm, hm, 45, null, { modes: ['SAFE'], mission: { suit: 'mars', equipmentKg: 10 } }).SAFE;
  assert.equal('daylight' in noStart.stats.checks, false);
  assert.equal(decide(noStart.stats).status, 'INSUFFICIENT DATA');
  assert.equal(dustAssessment({ dust: {}, startMs: START, dustGroundShare: null }).missing.some(m => m.key === 'ground'), true);
});
