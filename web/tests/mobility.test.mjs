import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mobilityAssessment } from '../src/utils/mobility.js';
import { missionDecision } from '../src/utils/missionStatus.js';
import { dustAssessment } from '../src/utils/dust.js';
import { payloadAssessment } from '../src/utils/payload.js';

const limits = { maxSlopeDeg: 20, maxRadialM: 2000 };
const clearWx = { advisory: 'clear', near: [], sep: [] };
function stats(over = {}) {
  return {
    walkTimeS: 3600, dwellTotalS: 1200, roundTripS: 3 * 3600, budgetS: 8 * 3600, distance: 2400, steepFrac: 0.05, steepDeg: 15,
    minMarginS: 3 * 3600, ponrIdx: -1, maxSlopeDeg: 12, maxRadialM: 900, stopCount: 3,
    carry: { earthEqKg: 43.1, limitKg: 45 }, light: { homeBySunset: true }, radiation: { doseMSv: 0.1 },
    layers: { rock: { maxReliefM: 0.3, roughShare: 0.1, limitM: 0.5 } },
    ...over, checks: { budget: true, carry: true, radial: true, slope: true, daylight: true, ...(over.checks || {}) },
  };
}
const decide = (s, extra = {}) => missionDecision(s, { limits, wx: clearWx, radiationLocal: true, hazards: [], ...extra });
const ALL_OPEN = { outerLayer: 'ortho-fabric', jointProtection: 'standard', equipmentProtection: 'exposed', covers: 'none' };

test('mobility reads the planner and decision; it adds no penalties', () => {
  const s = stats(), d = decide(s);
  const m = mobilityAssessment(s, d, { hazards: [] });
  assert.equal(m.status, 'PASS');
  assert.deepEqual(m.penalties, []);
  for (const k of ['slope', 'roughness', 'obstacles', 'craters', 'distance', 'duration', 'return', 'suit', 'equipment']) assert.ok(m.items.some(i => i.key === k), k);
  assert.match(m.items.find(i => i.key === 'equipment').detail, /no speed penalty/);
  assert.equal(mobilityAssessment(stats({ checks: { slope: false } }), decide(stats({ checks: { slope: false } }))).status, 'FAIL');
  const pit = mobilityAssessment(s, decide(s, { hazards: [{ key: 'depression', name: 'closed depression', lengthM: 12 }] }), { hazards: [{ key: 'depression', name: 'closed depression', lengthM: 12 }] });
  assert.equal(pit.status, 'CAUTION');
  assert.equal(mobilityAssessment(null, null).status, 'INSUFFICIENT DATA');
});

test('integration: three independent results; dust never overrides the decision', () => {
  const s = stats();
  const base = decide(s);
  const dust = dustAssessment({ dust: ALL_OPEN, startMs: Date.UTC(2026, 10, 14), stopCount: 3, dustGroundShare: 0.5 });
  const withDust = decide(s, { dust });
  assert.equal(base.status, 'GO');
  assert.equal(withDust.status, 'GO', 'dust warnings are notes');
  assert.ok(withDust.notes.some(n => n.key === 'dust' && /does not change the decision/.test(n.detail)));
  // a NO-GO stays NO-GO whatever the dust settings say
  const bad = stats({ checks: { slope: false } });
  assert.equal(decide(bad, { dust: dustAssessment({ dust: { outerLayer: 'epg-development', jointProtection: 'dust-tolerant', equipmentProtection: 'enclosed', covers: 'fitted' } }) }).status, 'NO-GO');
  // independence: changing dust does not change payload or mobility
  const p = payloadAssessment({ suit: 'mars', equipmentKg: 10 });
  const m1 = mobilityAssessment(s, base, { hazards: [] }), m2 = mobilityAssessment(s, withDust, { hazards: [] });
  assert.deepEqual(m1, m2);
  assert.deepEqual(payloadAssessment({ suit: 'mars', equipmentKg: 10, dust: ALL_OPEN }), p);
});

test('integration: payload over the limit → existing carry rule (NO-GO); invalid payload → INSUFFICIENT DATA', () => {
  const over = stats({ checks: { carry: false }, carry: { earthEqKg: 48, limitKg: 45 } });
  const d = decide(over, { payload: payloadAssessment({ suit: 'mars', equipmentKg: 30 }) });
  assert.equal(d.status, 'NO-GO');
  assert.match(d.summary, /carried weight/);
  const inv = decide(stats(), { payload: payloadAssessment({ suit: 'mars', payload: { instruments: -2, comms: 0, sampling: 0, emergency: 0, other: 0 } }) });
  assert.equal(inv.status, 'INSUFFICIENT DATA');
  assert.ok(inv.missing.some(m => m.key === 'payload'));
  // terrain rules unchanged: same decision with or without the new context
  assert.deepEqual(decide(stats()).hard, decide(stats(), { payload: payloadAssessment({ suit: 'mars', equipmentKg: 10 }) }).hard);
});
