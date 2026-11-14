/** The 13-step workflow: order, targets, and "done only when the inputs are complete and current". */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WF, workflowSteps } from '../src/utils/workflow.js';
import { DEFAULT_MISSION } from '../src/config/mission.js';

const ALL_DUST = { outerLayer: 'ortho-fabric', jointProtection: 'standard', equipmentProtection: 'exposed', covers: 'fitted' };
const base = { objectiveId: null, mission: DEFAULT_MISSION, visited: {}, science: null, routes: null, activeRoute: 'SAFE', evaStatus: 'idle' };
const done = (o) => workflowSteps({ ...base, ...o }).map(s => s.done);

test('13 steps in the order of the brief, each with a section to jump to', () => {
  assert.deepEqual(WF.map(w => w[0]), ['Mission objective', 'Exploration site', 'Crew & equipment', 'Payload & mass',
    'Dust & equipment reliability', 'Data layers', 'Hazard assessment', 'Science stops', 'EVA route', 'Terrain & mobility',
    'GO / NO-GO', 'EVA simulation', 'Mission export & cuff card']);
  const st = workflowSteps(base);
  assert.equal(st.length, 13);
  assert.ok(st.every((s, i) => s.n === i + 1 && s.target));
  assert.equal(st[6].layer, 'Hazards');
});

test('fresh start: only the site and the (valid default) crew / payload steps are done; dust is not', () => {
  const d = done({});
  assert.deepEqual(d, [false, true, true, true, false, false, false, false, false, false, false, false, false]);
});

test('incomplete or invalid inputs leave a step open', () => {
  assert.equal(done({ mission: { ...DEFAULT_MISSION, dust: { ...ALL_DUST, covers: 'unknown' } } })[4], false);
  assert.equal(done({ mission: { ...DEFAULT_MISSION, dust: ALL_DUST } })[4], true);
  assert.equal(done({ mission: { ...DEFAULT_MISSION, payload: { instruments: -1, comms: 0, sampling: 0, emergency: 0, other: 0 } } })[3], false);
  assert.equal(done({ mission: { ...DEFAULT_MISSION, o2: { scenario: 'magic' } } })[2], false);
});

test('science stops count only for the current objective (stale plan → open)', () => {
  const science = { objectiveId: 'mineral-diversity', stops: [{}] };
  assert.equal(done({ objectiveId: 'mineral-diversity', science })[7], true);
  assert.equal(done({ objectiveId: 'olivine-smectite', science })[7], false);
  assert.equal(done({ objectiveId: 'mineral-diversity', science: { ...science, stops: [] } })[7], false);
});

test('layers, hazards, EVA and export follow what the user did', () => {
  const d = done({ visited: { layers: true, hazards: true, exported: true }, evaStatus: 'paused' });
  assert.equal(d[5], true); assert.equal(d[6], true); assert.equal(d[11], true); assert.equal(d[12], true);
});
