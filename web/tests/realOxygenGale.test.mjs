/** Gale, real data: oxygen in planning and on the played-back route. */
import { test } from 'node:test';
import { loadRealSite } from './helpers/realSite.mjs';
import { oxygenScenario } from './helpers/oxygenScenario.mjs';

const ctx = await loadRealSite('gale');

test('gale: oxygen in planning and on the played-back route (BVAD scenarios)', async () => {
  await oxygenScenario(ctx, 'contacts', 137.384);
});
