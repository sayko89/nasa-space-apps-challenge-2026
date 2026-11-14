/** Jezero, real data: payload and dust settings leave routes and walking times untouched; the EVA profile applies both ways. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadRealSite } from './helpers/realSite.mjs';

const ctx = await loadRealSite('jezero');
const { P, CFG, hm, sm, cm } = ctx;
const { msAtLtst } = await import('../src/utils/marsTime.js');
const START = msAtLtst(Date.UTC(2026, 10, 14), 9, 77.45);
const wps = [{ x: 0, z: 0 }, { x: 300, z: -200, dwellS: 1200 }, { x: -150, z: 250, dwellS: 1200 }, { x: 0, z: 0 }];
const plan = (mission, w = wps) => P.planAllRoutes(w, sm, cm, hm, 45, null, { modes: ['SAFE'], startMs: START, mission }).SAFE;

test('carried mass and dust protection do not change the route or any walking time', () => {
  const light = plan({ suit: 'mars', equipmentKg: 0 });
  const heavy = plan({ suit: 'mars', equipmentKg: 40, payload: { instruments: 10, comms: 5, sampling: 10, emergency: 10, other: 5 },
    dust: { outerLayer: 'ortho-fabric', jointProtection: 'standard', equipmentProtection: 'exposed', covers: 'none' } });
  assert.deepEqual(heavy.path, light.path);
  for (const k of ['walkTimeS', 'returnTimeS', 'roundTripS', 'minMarginS', 'ponrIdx', 'maxSlopeDeg']) assert.equal(heavy.stats[k], light.stats[k], k);
  assert.equal(light.stats.checks.carry, true);
  assert.equal(heavy.stats.checks.carry, false);                   // the payload acts only through the weight limit
  assert.ok(light.stats.layers.thermal && Number.isFinite(light.stats.layers.thermal.dustShare));
});

test('the Mars-conservative walking speed applies the same way outbound and on the way back', () => {
  const oneWay = wps.slice(0, 3);                                   // ends away from home: the walk back is computed separately
  CFG.setEvaProfile('lunar');
  const lunar = plan({ suit: 'mars', equipmentKg: 10 }, oneWay);
  CFG.setEvaProfile('mars');
  const mars = plan({ suit: 'mars', equipmentKg: 10 }, oneWay);
  CFG.setEvaProfile('lunar');
  const ratio = CFG.MARS_SUIT_COST_RATIO.value;
  const r = (k) => mars.stats[k] / lunar.stats[k];
  assert.ok(Math.abs(r('walkTimeS') - ratio) < 0.02, `outbound ${r('walkTimeS')}`);
  assert.ok(Math.abs(r('returnTimeS') - ratio) < 0.02, `return ${r('returnTimeS')}`);
});

test('jezero: oxygen in planning and on the played-back route (BVAD scenarios)', async () => {
  const { oxygenScenario } = await import('./helpers/oxygenScenario.mjs');
  await oxygenScenario(ctx, 'mineral-diversity', 77.45);
});
