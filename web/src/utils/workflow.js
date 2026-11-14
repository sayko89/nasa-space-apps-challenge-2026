/** The 13-step mission workflow and when each step counts as done (pure; tests/workflow.test.mjs). */
import { payloadAssessment } from './payload.js';
import { oxygenConfig } from './oxygen.js';

import { evaAssessments } from './evaAssessments.js';

export const WF = [
  ['Mission objective', 'wf-objective'], ['Exploration site', 'top'], ['Crew & equipment', 'wf-crew'],
  ['Payload & mass', 'wf-payload'], ['Dust & equipment reliability', 'wf-dust'], ['Data layers', 'wf-layers'],
  ['Hazard assessment', 'wf-layers', 'Hazards'], ['Science stops', 'wf-objective'], ['EVA route', 'wf-decision'],
  ['Terrain & mobility', 'wf-decision'], ['GO / NO-GO', 'wf-decision'], ['EVA simulation', 'wf-decision'],
  ['Mission export & cuff card', 'wf-export'],
];

/** Step done = its inputs are complete and current (a stale or unknown input leaves the step open). */
export function workflowSteps({ objectiveId, mission, visited, science, routes, activeRoute, evaStatus }) {
  const r = routes?.[activeRoute];
  const dustSet = !!mission?.dust && Object.values(mission.dust).every(v => v && v !== 'unknown');
  const A = r?.stats?.walkTimeS !== undefined && mission ? evaAssessments(r, null, { mission }) : null;
  const done = [
    !!objectiveId, true, !!mission && oxygenConfig(mission).valid,
    !!mission && payloadAssessment(mission).status !== 'INSUFFICIENT DATA', dustSet,
    !!visited.layers, !!visited.hazards,
    !!science?.stops?.length && science.objectiveId === objectiveId, !!r?.stats,
    !!A && A.mobility.status !== 'INSUFFICIENT DATA', !!r?.stats?.checks, evaStatus !== 'idle', !!visited.exported,
  ];
  return WF.map(([label, target, layer], i) => ({ n: i + 1, label, target, layer, done: done[i] }));
}
