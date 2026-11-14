/** Gale, real data: every mission objective plans a valid EVA and changes the stops. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadRealSite, planObjective } from './helpers/realSite.mjs';

const ctx = await loadRealSite('gale');
const { O, SC, MS, PV, site } = ctx;
const { msAtLtst } = await import('../src/utils/marsTime.js');
const START = msAtLtst(Date.UTC(2026, 10, 14), 9, 137.384);   // 09:00 LTST at the site, as the app defaults
const results = Object.fromEntries(O.objectivesFor('gale').map(o => [o.id, planObjective(ctx, o.id, START)]));

test('gale: each objective → stops within budget, every stop serves the objective', () => {
  for (const o of O.objectivesFor('gale')) {
    const { sci } = results[o.id];
    assert.ok(sci.stops.length >= 1, `${o.id}: stops`);
    assert.ok(sci.totalS <= sci.budgetS, `${o.id}: budget`);
    for (const st of sci.stops) assert.ok(st.tags.some(t => SC.tagWeight(t, o.plan.weights) > 0), `${o.id}: ${st.label}`);
  }
  const kinds = (id) => results[id].sci.stops.map(s => s.kind);
  assert.ok(results.boxwork.sci.stops.every(s => s.tags.includes('B:Boxwork-bearing layer')));
  assert.ok(results.boxwork.sci.stops.some(s => s.tags.includes('S:Ridge or butte crest')));
  assert.ok(results.boxwork.sci.stops.some(s => s.tags.includes('S:Hollow or trough')));
  assert.ok(kinds('contacts').includes('contact'));
  assert.ok(kinds('chem-anomaly').filter(k => k === 'chemistry').length >= 3);
  assert.ok(kinds('chemcam-revisit').every(k => k === 'target'));
  assert.ok(results['water-alteration'].sci.stops.some(s => s.tags.includes('X:CaO high')));
  // one stop per rock
  for (const id of ['chem-anomaly', 'water-alteration', 'chemcam-revisit']) {
    const cells = results[id].sci.stops.map(s => s.idx);
    assert.equal(new Set(cells).size, cells.length, `${id}: duplicate stop cells`);
  }
  const sigs = new Set(O.objectivesFor('gale').map(o => results[o.id].sci.stops.map(s => s.label).join('|')));
  assert.equal(sigs.size, 5);
});

test('gale: SAFE route per objective, decision with local RAD', () => {
  for (const o of O.objectivesFor('gale')) {
    const { safe } = results[o.id];
    assert.ok(safe?.stats?.checks, `${o.id}: route stats`);
    const d = MS.missionDecision(safe.stats, { limits: { maxSlopeDeg: 20, maxRadialM: 2000 },
      wx: { advisory: 'no-data', near: [], sep: [] }, startFuture: true, radiationLocal: true, hazards: [] });
    assert.notEqual(d.status, 'GO', 'unknown space weather is never GO');
    assert.ok(d.notes.some(n => /measured in this crater/.test(n.detail)));
  }
});

test('gale: provenance — derived geology, no CRISM / THEMIS, local ChemCam', () => {
  const p = Object.fromEntries(PV.provenanceFor('gale', site).map(r => [r.key, r]));
  assert.equal(p.geology.category, 'derived');
  assert.equal(p.minerals.available, false);
  assert.equal(p.thermal.available, false);
  assert.equal(p.chemistry.category, 'direct-measurement');
});
