/**
 * Radiation and space-weather tests.
 *   node --test web/tests/*.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const R = await import('../src/utils/radiation.js');

test('GCR dose scales with time outside: one sol-length day = 0.64 mSv (Hassler et al. 2014)', () => {
  assert.equal(R.evaDoseMSv(86400), 0.64);
  assert.ok(Math.abs(R.evaDoseMSv(8 * 3600) - 0.64 / 3) < 1e-12);
  assert.equal(R.evaDoseMSv(-5), 0);
});

test('career fraction against the 600 mSv NASA-STD-3001 limit', () => {
  assert.equal(R.careerFraction(6), 0.01);
});

test('space weather: SEP inside the window → postpone; outside → clear; outside coverage → no-data', () => {
  const wx = {
    coverage: ['2021-02-18', '2026-10-30'],
    events: [
      { type: 'SEP', time: '2024-05-20T05:00Z' },
      { type: 'CME', time: '2024-05-19T12:00Z' },
      { type: 'FLR', time: '2023-01-01T00:00Z' },
    ],
  };
  const at = (iso) => R.spaceWeatherAt(wx, Date.parse(iso));
  assert.equal(at('2024-05-21T09:00Z').advisory, 'postpone');
  assert.equal(at('2024-05-21T09:00Z').near.length, 2);
  assert.equal(at('2024-06-10T09:00Z').advisory, 'clear');
  assert.equal(at('2027-06-10T09:00Z').advisory, 'no-data');
  assert.equal(R.spaceWeatherAt(null, 0).advisory, 'no-data');
});
