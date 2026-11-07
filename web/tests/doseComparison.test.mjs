import test from 'node:test';
import assert from 'node:assert/strict';
import { DOSE_COMPARISON, daysEquivalent, RADIATION } from '../src/utils/radiation.js';

test('four sourced places, Mars uses the RAD value the planner uses', () => {
  assert.deepEqual(DOSE_COMPARISON.map(d => d.key), ['earth', 'iss', 'moon', 'mars']);
  for (const d of DOSE_COMPARISON) { assert.ok(d.mSvPerDay > 0); assert.match(d.url, /^https:\/\//); assert.ok(d.source.length > 10); }
  assert.equal(DOSE_COMPARISON.find(d => d.key === 'mars').mSvPerDay, RADIATION.gcrDoseEquivalentMSvPerDay.value);
  const earth = DOSE_COMPARISON[0].mSvPerDay;
  assert.ok(Math.abs(earth * 365.25 - 2.4) < 1e-9);
});

test('days equivalent: one Mars day ≈ 97 days of Earth background', () => {
  const d = daysEquivalent(0.64);
  assert.equal(Math.round(d.earth), 97);
  assert.equal(d.mars, 1);
  assert.ok(d.moon < 1 && d.iss < 1);
});
