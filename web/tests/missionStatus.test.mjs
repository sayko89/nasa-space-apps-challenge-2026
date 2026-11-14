import { test } from 'node:test';
import assert from 'node:assert/strict';
import { missionDecision, RESERVE_S } from '../src/utils/missionStatus.js';

const limits = { maxSlopeDeg: 20, maxRadialM: 2000 };
const clearWx = { advisory: 'clear', near: [], sep: [] };
function stats(over = {}) {
  return {
    minMarginS: 3 * 3600, ponrIdx: -1, maxSlopeDeg: 12, maxRadialM: 900,
    carry: { earthEqKg: 43.1, limitKg: 45 }, light: { homeBySunset: true }, radiation: { doseMSv: 0.1 },
    ...over, checks: { budget: true, carry: true, radial: true, slope: true, daylight: true, ...(over.checks || {}) },
  };
}

test('GO only when every hard constraint passes and every environmental condition is known and clear', () => {
  const d = missionDecision(stats(), { limits, wx: clearWx, radiationLocal: true, hazards: [] });
  assert.equal(d.status, 'GO');
  assert.ok(d.hard.every(h => h.ok));
});

test('any failed hard constraint → NO-GO, whatever the environment', () => {
  for (const k of ['budget', 'slope', 'radial', 'carry', 'daylight']) {
    const d = missionDecision(stats({ checks: { [k]: false } }), { limits, wx: clearWx, radiationLocal: true, hazards: [] });
    assert.equal(d.status, 'NO-GO', k);
    assert.match(d.summary, /^Fails:/);
  }
  const r = missionDecision(stats({ checks: { rover: false }, rover: { maxReturnS: 2400, limitS: 1800 } }), { limits, wx: clearWx });
  assert.equal(r.status, 'NO-GO');
});

test('missing information is never a safe result', () => {
  // no space-weather data → CONDITIONAL, not GO
  const a = missionDecision(stats(), { limits, wx: { advisory: 'no-data', near: [], sep: [] }, hazards: [] });
  assert.equal(a.status, 'CONDITIONAL');
  assert.match(a.summary, /space weather unknown/);
  assert.equal(a.environment.find(e => e.key === 'spaceWeather').ok, null);
  const f = missionDecision(stats(), { limits, wx: null, startFuture: true, hazards: [] });
  assert.match(f.environment.find(e => e.key === 'spaceWeather').detail, /does not forecast/);
  assert.notEqual(f.status, 'GO');
  // daylight cannot be checked → INSUFFICIENT DATA
  const s = stats(); delete s.checks.daylight; s.light = null;
  const b = missionDecision(s, { limits, wx: clearWx, hazards: [] });
  assert.equal(b.status, 'INSUFFICIENT DATA');
  // no route at all
  assert.equal(missionDecision(null, {}).status, 'INSUFFICIENT DATA');
});

test('environmental conditions → CONDITIONAL; notes never change the status', () => {
  const sep = missionDecision(stats(), { limits, wx: { advisory: 'postpone', near: [{}], sep: [{}] }, hazards: [] });
  assert.equal(sep.status, 'CONDITIONAL');
  assert.match(sep.summary, /solar particle event near the date/);
  const tight = missionDecision(stats({ minMarginS: RESERVE_S - 60 }), { limits, wx: clearWx, hazards: [] });
  assert.equal(tight.status, 'CONDITIONAL');
  const pit = missionDecision(stats(), { limits, wx: clearWx, hazards: [{ key: 'depression', name: 'closed depression / crater', lengthM: 12 }] });
  assert.equal(pit.status, 'CONDITIONAL');
  assert.match(pit.summary, /route crosses depressions/);
  const unseen = missionDecision(stats(), { limits, wx: clearWx, radiationLocal: false,
    hazards: [{ key: 'unseen', name: 'known only from orbit', lengthM: 300 }] });
  assert.equal(unseen.status, 'GO');
  assert.match(unseen.notes.find(n => n.key === 'radiation').detail, /not a local measurement/);
  assert.ok(unseen.notes.some(n => n.key === 'unseen'));
});
