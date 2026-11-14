/** Martian Map (Mars sites) design tokens — see docs/WORKSPACES.md §4. */
export const T = {
  ground: '#101215', panel: '#15181c', raised: '#1c2026', sunken: '#0d0f12', rule: '#2a3038', ruleStrong: '#3a424d',
  text: '#d9dde3', muted: '#8b949e', faint: '#5d6670', accent: '#d9894a', accentSoft: 'rgba(217,137,74,0.14)',
  info: '#7fb2e6', go: '#4fb477', cond: '#e0b040', nogo: '#e5534b', insuf: '#8b949e',
  sans: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  mono: "ui-monospace, 'SFMono-Regular', Menlo, Consolas, 'Liberation Mono', monospace",
};
export const STATUS_COLOR = { GO: T.go, CONDITIONAL: T.cond, 'NO-GO': T.nogo, 'INSUFFICIENT DATA': T.insuf };
export const TOPBAR_H = 48;
export const CATALOG_W = 318;
export const WORKSPACES = [
  { id: 'explore', n: '01', label: 'EXPLORE', short: 'EXPLORE', hint: 'Map and data catalog: look at the site, inspect any layer or point' },
  { id: 'analyze', n: '02', label: 'ANALYZE', short: 'ANALYZE', hint: 'Terrain, science data and provenance: compare layers and check the evidence' },
  { id: 'plan', n: '03', label: 'PLAN MISSION', short: 'PLAN', hint: 'Crew, suit, oxygen, payload, objective, stops and route' },
  { id: 'ops', n: '04', label: 'OPERATIONS', short: 'OPS', hint: 'Decision, cuff card and EVA execution' },
];
/** Which workspace holds each mission-workflow target (utils/workflow.js WF). */
export const WORKSPACE_OF_TARGET = { top: 'explore', 'wf-layers': 'analyze', 'wf-objective': 'plan', 'wf-crew': 'plan',
  'wf-payload': 'plan', 'wf-dust': 'plan', 'wf-decision': 'ops', 'wf-export': 'ops' };
