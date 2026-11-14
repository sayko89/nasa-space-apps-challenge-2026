/** Jezero, real data: the shared assessment helper and the JSON export carry the current plan and settings. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadRealSite, planObjective } from './helpers/realSite.mjs';

const ctx = await loadRealSite('jezero');
const { msAtLtst } = await import('../src/utils/marsTime.js');
const { evaAssessments, routeDecision, missionExport } = await import('../src/utils/evaAssessments.js');
const { workflowSteps } = await import('../src/utils/workflow.js');
const { DEFAULT_MISSION } = await import('../src/config/mission.js');
const START = msAtLtst(Date.UTC(2026, 10, 14), 9, 77.45);
const { sci, safe } = planObjective(ctx, 'olivine-smectite', START);
const routes = { SAFE: safe };
const wx = { wx: { advisory: 'clear', near: [], sep: [] }, live: false, future: false };

test('evaAssessments: decision + payload + dust + mobility + oxygen from the current mission', () => {
  const a = evaAssessments(safe, wx, { mission: DEFAULT_MISSION, startMs: START });
  for (const k of ['decision', 'payload', 'dust', 'mobility', 'oxygen']) assert.ok(a[k], k);
  assert.equal(routeDecision(safe, wx, { mission: DEFAULT_MISSION, startMs: START }).status, a.decision.status);
  // a configuration change shows at once: heavier payload → NO-GO; unknown O₂ scenario → INSUFFICIENT DATA or worse
  const heavy = evaAssessments({ ...safe, stats: { ...safe.stats, checks: { ...safe.stats.checks, carry: false } } }, wx,
    { mission: { ...DEFAULT_MISSION, equipmentKg: 40 }, startMs: START });
  assert.equal(heavy.decision.status, 'NO-GO');
  assert.equal(heavy.payload.status, 'OVER LIMIT');
  const badO2 = evaAssessments(safe, wx, { mission: { ...DEFAULT_MISSION, o2: { scenario: 'magic' } }, startMs: START });
  assert.ok(badO2.decision.missing.some(m => m.key === 'oxygen'));
  assert.equal(evaAssessments({ stats: null }, wx, {}), null);
});

test('missionExport: objective, stop cards, decisions and assessments match the plan', () => {
  const science = { ...sci, objectiveId: 'olivine-smectite' };
  const ex = missionExport({ science, mission: DEFAULT_MISSION, routes, activeRoute: 'SAFE', startMs: START });
  assert.equal(ex.objective.id, 'olivine-smectite');
  assert.equal(ex.stopCards.length, sci.stops.length);
  assert.deepEqual(ex.stopCards.map(c => c.name), sci.stops.map(s => s.label));
  assert.ok(ex.decisions.SAFE.status && ex.activeDecision === ex.decisions.SAFE);
  for (const k of ['payload', 'dust', 'mobility', 'oxygen']) assert.ok(ex.assessments[k], k);
  assert.ok(ex.provenance.some(p => p.key === 'radiation' && p.category === 'transferred-reference'));
  assert.equal(ex.evaStartUtc, new Date(START).toISOString());
  assert.doesNotThrow(() => JSON.stringify(ex));
});

test('workflow on a real plan: route, mobility and decision steps are done', () => {
  const st = workflowSteps({ objectiveId: 'olivine-smectite', mission: DEFAULT_MISSION, visited: {}, science: { ...sci, objectiveId: 'olivine-smectite' },
    routes, activeRoute: 'SAFE', evaStatus: 'idle' });
  assert.deepEqual([7, 8, 9, 10].map(i => st[i].done), [true, true, true, true]);
});
