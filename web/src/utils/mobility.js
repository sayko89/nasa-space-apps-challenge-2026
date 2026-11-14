/**
 * Terrain & Mobility assessment — a view of what the planner already computed.
 *
 * Nothing is recalculated and no new physics is added: walking times come from the existing
 * Dijkstra / A* walk with the Tobler slope–speed shape of the active EVA profile; slope, distance,
 * walk-back margin and point of no return come from the same route stats as the decision.
 * Payload and dust do NOT change walking speed: no validated model was found for either, so the
 * same walking times apply outbound and on the way back.
 * Pure: tested in Node (tests/mobility.test.mjs).
 */

const hm = (s) => {
  if (!Number.isFinite(s)) return '—';
  const m = Math.round(Math.abs(s) / 60);
  return `${s < 0 ? '−' : ''}${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
};

/**
 * @param {object} s  route stats (computeDemStats)
 * @param {object} d  missionDecision() result for the same route
 * @param {object} ctx { hazards: routeHazards() result, profile: { label, levelWalkSpeedKmh, source } }
 * @returns {{ status, items, summary, penalties }}  status PASS | CAUTION | FAIL | INSUFFICIENT DATA
 */
export function mobilityAssessment(s, d, ctx = {}) {
  if (!s || !d || !s.checks) return { status: 'INSUFFICIENT DATA', items: [], penalties: [], summary: 'No planned route to evaluate.' };
  const hard = Object.fromEntries(d.hard.map(h => [h.key, h]));
  const env = Object.fromEntries(d.environment.map(e => [e.key, e]));
  const hz = ctx.hazards || [];
  const len = (k) => hz.filter(h => h.key === k).reduce((a, h) => a + h.lengthM, 0);
  const items = [];
  const add = (key, label, ok, detail) => items.push({ key, label, ok, detail });

  add('slope', 'Terrain slope', hard.slope?.ok ?? null,
    `${hard.slope?.detail ?? '—'}; ${Math.round((s.steepFrac || 0) * 100)} % of the route steeper than ${s.steepDeg?.toFixed(0) ?? '—'}°`);
  const rock = s.layers?.rock;
  add('roughness', 'Surface roughness (rock relief)', rock ? true : null,
    rock ? `max ${rock.maxReliefM.toFixed(2)} m relief on the route; ${Math.round(rock.roughShare * 100)} % rough (> ${(rock.limitM / 2).toFixed(2)} m)`
      : 'no rock-relief layer');
  const rockLen = len('rock') + len('slope'), bufLen = len('buffer'), pitLen = len('depression');
  add('obstacles', 'Rock obstacles', ctx.hazards ? rockLen + bufLen === 0 : null,
    !ctx.hazards ? 'hazard map not available'
      : `${rockLen ? `${Math.round(rockLen)} m on an obstacle cell (a start or stop inside one)` : 'routed around every detected obstacle'}`
        + `${bufLen ? `; ${Math.round(bufLen)} m within the obstacle buffer` : ''}`);
  add('craters', 'Craters / closed depressions', ctx.hazards ? pitLen === 0 : null,
    !ctx.hazards ? 'hazard map not available' : pitLen ? `${Math.round(pitLen)} m across closed depressions (≥ 1 m deep)` : 'none crossed');
  add('distance', 'Walking distance', hard.radial?.ok ?? null, `${(s.distance / 1000).toFixed(2)} km walked; ${hard.radial?.detail ?? ''}`);
  add('duration', 'Walking duration', hard.budget ? hard.budget.ok : null,
    `walk ${hm(s.walkTimeS)} + stops ${hm(s.dwellTotalS || 0)} = ${hm(s.roundTripS)} of ${hm(s.budgetS)}`);
  add('return', 'Return safety (walk-back margin, point of no return)', hard.budget?.ok ?? null,
    `${hard.budget?.detail ?? '—'}${env.reserve ? `; ${env.reserve.ok ? 'keeps' : 'below'} the 30-min reserve` : ''}`);
  if (hard.rover) add('rover', 'Rover walk-back', hard.rover.ok, hard.rover.detail);
  const p = ctx.profile;
  add('suit', 'Suit mobility', true,
    p ? `${p.label}: level walking ${p.levelWalkSpeedKmh} km/h with the slope–speed shape of the EVA profile${p.source ? ` (${p.source})` : ''}; slope limit applies to suited walking`
      : 'EVA profile walking speed and slope limit');
  add('equipment', 'Equipment-related mobility', true,
    'no speed penalty for carried payload or dust — no validated model; payload is checked as a weight limit (Payload & Mass)');

  const fail = items.filter(i => i.ok === false && ['slope', 'distance', 'duration', 'return', 'rover'].includes(i.key));
  const caution = items.filter(i => i.ok === false && !fail.includes(i)).concat(env.reserve && env.reserve.ok === false ? [env.reserve] : []);
  const unknown = items.filter(i => i.ok === null && ['slope', 'distance', 'duration', 'return'].includes(i.key));
  const status = fail.length ? 'FAIL' : unknown.length ? 'INSUFFICIENT DATA' : caution.length ? 'CAUTION' : 'PASS';
  const summary = status === 'FAIL' ? `Fails: ${fail.map(i => i.label.toLowerCase()).join('; ')}.`
    : status === 'CAUTION' ? `Within limits; watch: ${caution.map(i => i.label.toLowerCase()).join('; ')}.`
    : status === 'INSUFFICIENT DATA' ? `Cannot evaluate: ${unknown.map(i => i.label.toLowerCase()).join('; ')}.`
    : 'Slope, distance, duration and return margin within limits.';
  return { status, items, summary, penalties: [] };
}
