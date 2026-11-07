import test from 'node:test';
import assert from 'node:assert/strict';
import { param, paramEntry, setEvaProfile, getEvaProfile, MARS_CONSERVATIVE, MARS_SUIT_COST_RATIO, assumptionParams }
  from '../src/config/marswalkProfile.js';
import { walkTimeS } from '../src/utils/walkModel.js';

test('lunar is the default; mars changes only speed, budget and radius', () => {
  setEvaProfile('lunar');
  assert.equal(getEvaProfile(), 'lunar');
  assert.equal(param('levelWalkSpeedKmh'), 2.0);
  assert.equal(param('evaDurationH'), 8);
  assert.equal(param('maxRadialDistanceKm'), 2);
  setEvaProfile('mars');
  assert.equal(param('levelWalkSpeedKmh'), 1.21);                  // 2.0 / (27.6 / 16.7)
  assert.equal(param('evaDurationH'), 7.5);
  assert.equal(param('maxRadialDistanceKm'), 1.2);
  assert.equal(param('maxWalkableSlopeDeg'), 20);                  // unchanged: no Mars source
  assert.equal(param('maxRockReliefM'), 0.5);
  assert.deepEqual(Object.keys(MARS_CONSERVATIVE).sort(), ['evaDurationH', 'levelWalkSpeedKmh', 'maxRadialDistanceKm']);
  setEvaProfile('lunar');
});

test('every Mars value is sourced or a labelled assumption with a note', () => {
  for (const [k, e] of Object.entries(MARS_CONSERVATIVE)) {
    assert.ok(['sourced', 'assumption'].includes(e.status), k);
    assert.match(e.url, /^https:\/\//, k);
    assert.ok(e.note && e.note.length > 20, k);
  }
  assert.ok(Math.abs(MARS_SUIT_COST_RATIO.value - 1.6527) < 1e-3);
  setEvaProfile('mars');
  assert.ok(assumptionParams().includes('levelWalkSpeedKmh'));
  assert.equal(paramEntry('evaDurationH').status, 'sourced');
  setEvaProfile('lunar');
});

test('walking time scales with the profile; radial walk-back time is preserved', () => {
  setEvaProfile('lunar');
  const lunar = walkTimeS(1000, 0);
  setEvaProfile('mars');
  const mars = walkTimeS(1000, 0);
  assert.ok(Math.abs(mars / lunar - 2.0 / 1.21) < 1e-9);
  // the lunar radius walked at the lunar pace ≈ the Mars radius walked at the Mars pace (1 h)
  setEvaProfile('lunar'); const tL = walkTimeS(2000, 0);
  setEvaProfile('mars');  const tM = walkTimeS(1200, 0);
  assert.ok(Math.abs(tL - tM) / tL < 0.01);
  setEvaProfile('nonsense');
  assert.equal(getEvaProfile(), 'lunar');
});
