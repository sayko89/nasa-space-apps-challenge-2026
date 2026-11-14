/** Jezero, real data: every mission objective plans a valid EVA and changes the stops. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadRealSite, planObjective } from './helpers/realSite.mjs';

const ctx = await loadRealSite('jezero');
const { O, SC, MS, PV, site } = ctx;
const { msAtLtst } = await import('../src/utils/marsTime.js');
const START = msAtLtst(Date.UTC(2026, 10, 14), 9, 77.45);   // 09:00 LTST at the site, as the app defaults
const results = Object.fromEntries(O.objectivesFor('jezero').map(o => [o.id, planObjective(ctx, o.id, START)]));

test('jezero: each objective → stops within budget, every stop serves the objective', () => {
  for (const o of O.objectivesFor('jezero')) {
    const { sci } = results[o.id];
    assert.ok(sci.stops.length >= 1, `${o.id}: stops`);
    assert.ok(sci.totalS <= sci.budgetS, `${o.id}: budget`);
    assert.equal(sci.objectiveId, o.id);
    for (const st of sci.stops) assert.ok(st.tags.some(t => SC.tagWeight(t, o.plan.weights) > 0), `${o.id}: ${st.label}`);
    if (o.plan.filter.minerals?.length === 0) assert.ok(!sci.stops.some(s => s.kind === 'mineral'), `${o.id}: no mineral stops`);
    if (o.plan.filter.contacts === false) assert.ok(!sci.stops.some(s => s.kind === 'contact'), `${o.id}: no contact stops`);
  }
  // mineral objectives only visit their classes
  for (const st of results['olivine-pyroxene'].sci.stops.filter(s => s.kind === 'mineral')) {
    assert.match(st.label, /^(Olivine|High-Ca pyroxene|Low-Ca pyroxene) \(CRISM\)/);
  }
  assert.ok(results['olivine-smectite'].sci.stops.some(s => /^Olivine \+ smectite/.test(s.label)));
  // the objective changes the plan
  const sig = (id) => results[id].sci.stops.map(s => s.label).join('|');
  const sigs = new Set(O.objectivesFor('jezero').map(o => sig(o.id)));
  assert.ok(sigs.size >= 4, `distinct plans: ${sigs.size}`);
});

test('jezero: SAFE route for each objective is evaluated with a reasoned decision', () => {
  for (const o of O.objectivesFor('jezero')) {
    const { safe } = results[o.id];
    assert.ok(safe?.stats?.checks, `${o.id}: route stats`);
    const d = MS.missionDecision(safe.stats, { limits: { maxSlopeDeg: 20, maxRadialM: 2000 },
      wx: { advisory: 'clear', near: [], sep: [] }, radiationLocal: false, hazards: [] });
    assert.ok(['GO', 'CONDITIONAL'].includes(d.status), `${o.id}: ${d.status} — ${d.summary}`);
    assert.ok(d.notes.some(n => /not a local measurement/.test(n.detail)), 'RAD transferred note');
    assert.ok('daylight' in safe.stats.checks, 'daylight evaluated');
  }
});

test('jezero: provenance from the loaded site', () => {
  const p = Object.fromEntries(PV.provenanceFor('jezero', site).map(r => [r.key, r]));
  assert.equal(p.radiation.category, 'transferred-reference');
  assert.equal(p.chemistry.available, false);
  assert.equal(p.minerals.available, true);
  assert.equal(p.thermal.available, true);
});
