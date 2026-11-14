/** MARTIAN EVA CUFF (utils/evaCuff.js): the console and the printed backup are built from the selected mission only. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadRealSite, planObjective } from './helpers/realSite.mjs';

const ctx = await loadRealSite('jezero');
const C = await import('../src/utils/evaCuff.js');
const { msAtLtst } = await import('../src/utils/marsTime.js');
const { evaAssessments } = await import('../src/utils/evaAssessments.js');
const { DEFAULT_MISSION } = await import('../src/config/mission.js');
const EP = await import('../src/utils/evaPlayback.js');
const P = ctx.P;

const startMs = msAtLtst(Date.UTC(2026, 10, 14), 9, 77.45);
const { safe } = planObjective(ctx, 'mineral-diversity', startMs);
const mission = { ...DEFAULT_MISSION, payload: { instruments: 3, comms: 1, sampling: 2.5, emergency: 1.5, other: 0 } };
const assess = evaAssessments(safe, { advisory: 'clear', near: [], sep: [] }, { mission, startMs });
const base = { route: safe, mode: 'SAFE', site: { name: 'jezero', label: 'Jezero' }, startMs, mission, assess,
  limits: { maxSlopeDeg: 20, maxRockReliefM: 0.5, maxRadialKm: 2 }, suit: { label: 'Mars suit', massKg: 52 },
  objective: { id: 'mineral-diversity', name: 'Mineralogical Diversity Exploration' } };

test('planned mode: values come from the route and the decision; the position is labelled PLANNED', () => {
  const m = C.cuffModel(base);
  assert.equal(m.live, false);
  assert.equal(m.status.source, 'PLANNED');
  assert.equal(m.map.pos.label, 'PLANNED START');
  assert.equal(m.status.metS, 0);
  assert.equal(m.status.budgetS, safe.stats.budgetS);
  assert.equal(m.status.marginS, safe.stats.minMarginS);
  assert.equal(m.status.decision, assess.decision.status);
  assert.equal(m.tasks.length, safe.stats.stops.length);
  assert.ok(m.tasks.every(t => t.state === 'pending' || t.state === 'next'));
  assert.match(m.status.id, /^JEZ-MD-SAFE-\d{8}$/);
  // equipment from the itemised payload, oxygen only from the model
  assert.deepEqual(m.equipment.map(e => e.kg), [52, 3, 1, 2.5, 1.5]);
  assert.ok(m.status.o2 ? Number.isFinite(m.status.o2.initialKg) : true);
  // every hazard and emergency line names the kind of its source; suit failures are not invented
  assert.ok(m.hazards.every(h => C.CUFF_SOURCE[h.src]));
  assert.ok(m.emergency.every(e => ['project', 'simulated', 'nasa'].includes(e.src)));
  assert.match(m.emergency.find(e => e.key === 'suit').lines[0], /Not modelled/);
  assert.equal(C.cuffModel({ ...base, route: null }), null);
});

test('mission changes reach the cuff: route mode, payload, decision', () => {
  const m2 = C.cuffModel({ ...base, mode: 'ECO', mission: { ...mission, payload: null, equipmentKg: 12 } });
  assert.match(m2.status.id, /-ECO-/);
  assert.deepEqual(m2.equipment.map(e => e.label), ['Suit: Mars suit', 'Equipment (not itemised)']);
  const nogo = C.cuffModel({ ...base, assess: { ...assess, decision: { ...assess.decision, status: 'NO-GO', summary: 'x' } } });
  assert.equal(nogo.status.decision, 'NO-GO');
});

test('during the playback: simulated position, stop states, live margin; never GO with an unsafe return', () => {
  const pb = new EP.EvaPlayback();
  pb.load(safe.path, safe.stats, { mode: 'SAFE', budgetS: safe.stats.budgetS, startMs },
    { toHomeAt: P.toHomeTimeAt, returnPath: (x, z) => P.fastestReturnPath(x, z, ctx.hm), heightAt: ctx.T.getTerrainHeight });
  pb.setSpeed(1); pb.play();
  const st1 = pb.nominal.stops[0];
  pb.tick(st1.departS + 30);
  const snap = EP.evaSnapshot(pb);
  const m = C.cuffModel({ ...base, snap });
  assert.equal(m.live, true);
  assert.equal(m.status.source, 'SIMULATED');
  assert.equal(m.map.pos.label, 'SIMULATED');
  assert.ok(Math.abs(m.status.metS - pb.t) < 1e-9);
  assert.ok(Math.abs(m.status.marginS - snap.margin) < 1e-9);
  assert.equal(m.tasks[0].state, 'done');
  // an unsafe return (margin < 0) is never shown as GO, whatever the plan decision said
  const bad = C.cuffModel({ ...base, assess: { ...assess, decision: { ...assess.decision, status: 'GO' } }, snap: { ...snap, margin: -60 } });
  assert.equal(bad.status.decision, 'NO-GO');
  assert.ok(bad.ret.warnings.includes('WALK-BACK MARGIN BELOW ZERO'));
  assert.equal(bad.ret.status, 'RETURN NOW');
});

test('helpers: compass, hazard points along the route', () => {
  assert.equal(C.compass8(0), 'N'); assert.equal(C.compass8(90), 'E'); assert.equal(C.compass8(225), 'SW');
  const path = [[0, 0, 0], [10, 0, 0], [40, 0, 0], [80, 0, 0]];
  const cls = [0, 1, 2]; const classes = [{ key: 'none' }, { key: 'steep', hard: false }, { key: 'wall', hard: true }];
  const idx = (x) => (x < 20 ? 1 : 2);
  const pts = C.hazardPoints(path, cls, idx, classes, 20);
  assert.ok(pts.length >= 2 && pts.some(p => p.hard));
});
