/**
 * Dust devil on the route ahead during an EVA: go around it, or go home.
 *
 * The dust devil is treated as a no-go disc (trigger radius + a safety margin) and the planner
 * runs again from where the crew stands: the remaining stops (those inside the disc are skipped)
 * and home, A* in strict mode, so the answer is either a route that never enters the disc or a
 * definite "no path". The new route is accepted only if
 *   1. no point of it comes within the trigger radius (else the alarm would fire again),
 *   2. at every point the crew can still walk home — around the dust devil — within the EVA
 *      budget, counting the time already spent (walk-back margin ≥ 0),
 *   3. the oxygen left covers the rest of the plan plus the reserve,
 *   4. the crew is home before sunset (when the sun position is known).
 * Otherwise the EVA is aborted and the walk home also avoids the dust devil when it can.
 *
 * Illustrative, not an operational procedure: the dust devil does not move and the safety
 * margin is a design choice (no NASA source was found for an EVA dust-devil avoidance rule).
 */
import { planAllRoutes, homeMapsAvoiding, discMask } from './pathfinder.js';
import { buildTimeline } from './evaTimeline.js';

export const DUST_REROUTE = {
  safetyMarginM: { value: 25, note: 'design choice (illustrative): clearance kept beyond the trigger radius' },
};

const minDist = (path, x, z) => path.reduce((m, p) => Math.min(m, Math.hypot(p[0] - x, p[2] - z)), Infinity);

/**
 * @param {object} c
 * @param {{x,z}} c.pos          crew position now
 * @param {number} c.t           mission time now [s]
 * @param {Array} c.stops        remaining stops [{ n, x, z, dwellS, label }]
 * @param {{x,z}} c.home
 * @param {{x,z,radius,interferenceRadius}} c.hazard
 * @param {number} c.budgetS     EVA budget [s]
 * @param {number} c.nominalEndS end of the current plan [s] (for the extra time)
 * @param {object} c.maps        { hm, sm, cm } site grids
 * @param {string} [c.mode]      planner mode (SAFE)
 * @param {number} [c.startMs]   EVA start (sun, light stats)
 * @param {object} [c.mission]
 * @param {(planLeftS, backS) => {ok, detail}} [c.oxygenCheck]
 * @param {(ms) => {elevationDeg}} [c.sunAt]
 * @returns {{ ok, reason?, path?, elapsedS?, stops?, skipped, endS?, extraS?, checks, toHomeAt, returnPath(x, z) }}
 */
export function planDustReroute(c) {
  const trig = c.hazard.interferenceRadius ?? c.hazard.radius;
  const blockR = trig + DUST_REROUTE.safetyMarginM.value;
  const block = discMask(c.hazard.x, c.hazard.z, blockR);
  const avoid = homeMapsAvoiding(c.home.x, c.home.z, c.maps.hm, block);
  const skipped = c.stops.filter(s => Math.hypot(s.x - c.hazard.x, s.z - c.hazard.z) <= blockR);
  const kept = c.stops.filter(s => !skipped.includes(s));
  const checks = [];
  const fail = (reason) => ({ ok: false, reason, skipped, checks, toHomeAt: avoid.toHomeAt, returnPath: avoid.returnPath });

  if (Math.hypot(c.pos.x - c.hazard.x, c.pos.z - c.hazard.z) <= blockR) return fail('the crew is already inside the safety distance of the dust devil');
  const wps = [{ x: c.pos.x, z: c.pos.z }, ...kept.map(s => ({ x: s.x, z: s.z, dwellS: s.dwellS || 0, label: s.label })), { x: c.home.x, z: c.home.z }];
  const mode = c.mode || 'SAFE';
  let r;
  try {
    r = planAllRoutes(wps, c.maps.sm, c.maps.cm, c.maps.hm, 45, null,
      { modes: [mode], home: c.home, block, strict: true, mission: c.mission || null,
        startMs: Number.isFinite(c.startMs) ? c.startMs + c.t * 1000 : undefined })[mode];
  } catch (err) {
    return fail(`re-planning failed: ${err.message}`);
  }
  if (!r) return fail('no walkable path around the dust devil to the remaining stops and home');
  const { path, stats } = r;
  const el = stats.elapsedS, endS = c.t + el[el.length - 1];

  const clear = minDist(path, c.hazard.x, c.hazard.z);
  checks.push({ key: 'clearance', ok: clear > trig, detail: `closest approach ${clear.toFixed(0)} m (trigger radius ${trig.toFixed(0)} m)` });
  let minMargin = Infinity;
  for (let i = 0; i < path.length; i++) {
    const back = avoid.toHomeAt(path[i][0], path[i][2]);
    minMargin = Math.min(minMargin, Number.isFinite(back) ? c.budgetS - (c.t + el[i]) - back : -Infinity);
  }
  checks.push({ key: 'margin', ok: minMargin >= 0, detail: Number.isFinite(minMargin) ? `smallest walk-back margin ${Math.round(minMargin / 60)} min (time already spent included)` : 'home not reachable from part of the route' });
  if (c.oxygenCheck) {
    const o = c.oxygenCheck(el[el.length - 1], avoid.toHomeAt(c.pos.x, c.pos.z));
    checks.push({ key: 'oxygen', ok: !!o.ok, detail: o.detail });
  }
  if (c.sunAt && Number.isFinite(c.startMs)) {
    const elv = c.sunAt(c.startMs + endS * 1000)?.elevationDeg;
    if (Number.isFinite(elv)) checks.push({ key: 'daylight', ok: elv > 0, detail: elv > 0 ? 'home before sunset' : 'home after sunset' });
  }
  const bad = checks.filter(k => !k.ok);
  if (bad.length) return fail(`the route around it fails: ${bad.map(k => `${k.key} (${k.detail})`).join('; ')}`);

  const stops = (stats.stops || []).map(s => {
    const src = kept[s.wp - 1];
    return { idx: s.idx, dwellS: s.dwellS, label: src?.label ?? s.label, n: src?.n };
  });
  return { ok: true, mode, path, elapsedS: el, stops, skipped, endS, extraS: endS - c.nominalEndS, checks,
    toHomeAt: avoid.toHomeAt, returnPath: avoid.returnPath };
}

/**
 * The walked part of the old timeline up to t0, then the new route from the crew's position.
 * Stops already done keep their times; the new stops keep their original numbers.
 */
export function spliceTimeline(old, t0, pos, path, elapsedS, newStops, hold = null) {
  const pts = [], el = [], stops = [];
  for (let i = 0; i < old.n && old.dep[i] <= t0; i++) { pts.push([old.xs[i], 0, old.zs[i]]); el.push(old.dep[i]); }
  for (const s of old.stops) if (s.departS <= t0) stops.push({ idx: s.idx, dwellS: s.dwellS, label: s.label, n: s.n });
  const base = pts.length;
  const wait = hold?.dwellS > 0 ? hold.dwellS : 0;        // the stop the crew is at is finished first
  pts.push([pos.x, 0, pos.z]); el.push(t0 + wait);
  if (wait) stops.push({ idx: base, dwellS: wait, label: hold.label, n: hold.n });
  for (let j = 1; j < path.length; j++) { pts.push(path[j]); el.push(t0 + wait + elapsedS[j]); }
  for (const s of newStops) stops.push({ ...s, idx: base + Math.max(0, s.idx) });
  return buildTimeline(pts, el, stops);
}
