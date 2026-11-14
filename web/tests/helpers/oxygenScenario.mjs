/**
 * Real-site oxygen scenario (Jezero / Gale): plan an objective, check oxygen in planning for each
 * BVAD scenario, then play the real route with the app's own playback environment.
 */
import assert from 'node:assert/strict';
import { planObjective } from './realSite.mjs';

export async function oxygenScenario(ctx, objectiveId, lonEast) {
  const { P, T, MS, hm } = ctx;
  const { msAtLtst } = await import('../../src/utils/marsTime.js');
  const OX = await import('../../src/utils/oxygen.js');
  const { O2_SCENARIOS } = await import('../../src/config/oxygen.js');
  const { EvaPlayback } = await import('../../src/utils/evaPlayback.js');
  const start = msAtLtst(Date.UTC(2026, 10, 14), 9, lonEast);
  const { safe } = planObjective(ctx, objectiveId, start);
  const s = safe.stats;
  const mission = (o2) => ({ suit: 'mars', equipmentKg: 10, o2: { reserveMin: 30, initialKg: null, ...o2 } });
  const decide = (o2) => MS.missionDecision(s, { limits: { maxSlopeDeg: 20, maxRadialM: 2000 },
    wx: { advisory: 'clear', near: [], sep: [] }, radiationLocal: true, hazards: [], oxygen: OX.planOxygenCheck(OX.oxygenConfig(mission(o2)), s) });

  // sized tanks (8 h at the scenario rate): same answer as the walk-back budget and the 30-min reserve
  for (const k of Object.keys(O2_SCENARIOS)) {
    const c = OX.planOxygenCheck(OX.oxygenConfig(mission({ scenario: k })), s);
    assert.equal(c.returnOk, s.minMarginS >= 0, k);
    assert.equal(c.reserveOk, s.minMarginS >= 30 * 60, k);
  }
  // a small tank: the same route becomes NO-GO under the high-rate architecture only
  const small = 1.0;
  const cryo = decide({ scenario: 'cryogenic', initialKg: small });
  assert.equal(cryo.status, 'NO-GO');
  assert.ok(cryo.hard.find(h => h.key === 'oxygen').ok === false);
  const closed = decide({ scenario: 'closed-loop', initialKg: small });
  assert.ok(closed.hard.find(h => h.key === 'oxygen').ok, 'closed loop: 13 h of oxygen');

  // playback on the real route
  const env = { toHomeAt: P.toHomeTimeAt, returnPath: (x, z) => P.fastestReturnPath(x, z, hm), heightAt: T.getTerrainHeight };
  const pb = new EvaPlayback();
  pb.setOxygen(OX.oxygenConfig(mission({ scenario: 'swing-bed' })));
  pb.load(safe.path, s, { mode: 'SAFE', budgetS: s.budgetS, startMs: start, ponrIdx: s.ponrIdx }, env);
  pb.play(); pb.setSpeed(600);
  pb.tick(Math.min(3600, s.roundTripS / 2) / 600);
  const mid = pb.oxygenAt();
  assert.ok(Math.abs(mid.consumedKg - 0.15 * pb.t / 3600) < 1e-9);
  assert.ok(mid.returnFeasible && mid.mass.totalKg < 114 && mid.mass.totalKg > 113);
  assert.ok(pb.abort('test abort'));
  while (pb.status === 'playing') pb.tick(1);
  const end = pb.oxygenAt();
  assert.ok(Math.abs(end.consumedKg - 0.15 * pb.t / 3600) < 1e-9);
  assert.ok(end.remainingKg > 0);
  return { s, cryo, mid, end };
}
