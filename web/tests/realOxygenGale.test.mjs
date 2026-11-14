/** Gale, real data: oxygen in planning and on the played-back route. */
import { test } from 'node:test';
import { loadRealSite } from './helpers/realSite.mjs';
import { oxygenScenario } from './helpers/oxygenScenario.mjs';

const ctx = await loadRealSite('gale');

test('gale: oxygen in planning and on the played-back route (BVAD scenarios)', async () => {
  await oxygenScenario(ctx, 'contacts', 137.384);
});

test('gale: every objective — stops reachable, on the route, timed; margin after each stop; route and decision agree', async () => {
  const { routeConsistency } = await import('./helpers/routeConsistency.mjs');
  await routeConsistency(ctx, 137.384);
});
