/** Phase-5 checks on a real site: every objective's stops are reachable, on the route, timed, and the decision matches the route. */
import assert from 'node:assert/strict';
import { planObjective } from './realSite.mjs';

export async function routeConsistency(ctx, lonEast) {
  const { O, P, MS } = ctx;
  const { msAtLtst } = await import('../../src/utils/marsTime.js');
  const start = msAtLtst(Date.UTC(2026, 10, 14), 9, lonEast);
  for (const o of O.objectivesFor(ctx.site.name)) {
    const { sci, safe } = planObjective(ctx, o.id, start);
    const s = safe.stats, path = safe.path;
    // every stop reachable from home and lying on the planned route
    for (const st of sci.stops) {
      assert.ok(Number.isFinite(P.toHomeTimeAt(st.x, st.z)), `${o.id}: ${st.label} reachable`);
      const d = Math.min(...path.map(p => Math.hypot(p[0] - st.x, p[2] - st.z)));
      assert.ok(d < 6, `${o.id}: ${st.label} on the route (${d.toFixed(1)} m)`);
    }
    // stop time counted: one dwell per stop, and the EVA time = walking + stops
    assert.equal(s.stopCount, sci.stops.length, `${o.id}: stops on the route`);
    assert.ok(Math.abs(s.dwellTotalS - sci.stops.length * sci.dwellS) < 1e-6, `${o.id}: dwell total`);
    assert.ok(Math.abs(s.roundTripS - (s.walkTimeS + s.dwellTotalS)) < 1, `${o.id}: round trip ${s.roundTripS} vs ${s.walkTimeS + s.dwellTotalS}`);
    // margin evaluated after each stop: at each stop departure, margin = budget − elapsed − walk home
    for (const st of s.stops) {
      const i = st.idx, p = path[i];
      const back = P.toHomeTimeAt(p[0], p[2]);
      assert.ok(Math.abs(s.marginS[i] - (s.budgetS - s.elapsedS[i] - back)) < 2, `${o.id}: margin at stop`);
    }
    // the tightest margin and point of no return agree with the per-point margins
    let min = Infinity; for (const m of s.marginS) min = Math.min(min, m);
    assert.ok(Math.abs(min - s.minMarginS) < 1e-6);
    assert.equal(s.ponrIdx >= 0, min < 0);
    // the route is compatible with the decision: a GO / CONDITIONAL route passes every hard rule
    const d = MS.missionDecision(s, { limits: { maxSlopeDeg: 20, maxRadialM: 2000 }, wx: { advisory: 'clear', near: [], sep: [] }, radiationLocal: true, hazards: [] });
    if (d.status === 'GO' || d.status === 'CONDITIONAL') assert.ok(Object.values(s.checks).every(Boolean), o.id);
    assert.equal(d.status === 'NO-GO', Object.values(s.checks).some(v => v === false), o.id);
  }
}
