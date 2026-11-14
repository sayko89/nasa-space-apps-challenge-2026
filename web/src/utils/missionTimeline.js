/**
 * EVA timeline for one planned route — the bands of a Playbook-style timeline, built only from
 * values the planner and the assessments already computed (no new estimates):
 *   items   walk legs, stops (with planned stay) and the walk home, from the cuff-card table
 *   marks   EVA budget, point of no return, sunset, oxygen endurance and reserve floor (when known)
 * Times are seconds after EVA start. Pure: tested in Node (tests/missionTimeline.test.mjs).
 */
import { buildCuffCard } from './cuffCard.js';

/**
 * @param {object} route   { path, stats } of a DEM route
 * @param {object} [o]     { startMs, oxygen: planOxygenCheck result }
 * @returns {null | { items, marks, endS, budgetS, reserveS, rows }}
 */
export function missionTimeline(route, { startMs = null, oxygen = null } = {}) {
  const s = route?.stats;
  if (!route?.path?.length || !s?.elapsedS || !s?.marginS || !Number.isFinite(s.budgetS)) return null;
  const cc = buildCuffCard(route.path, s);
  const items = [];
  let t = 0;
  for (const r of cc.rows) {
    if (r.arriveS > t + 1) items.push({ kind: 'walk', t0: t, t1: r.arriveS, label: `Walk to ${r.label}`, distM: r.legM });
    items.push({ kind: 'stop', t0: r.arriveS, t1: r.departS, label: r.label, n: r.n, marginS: r.marginS });
    t = r.departS;
  }
  items.push({ kind: 'return', t0: t, t1: cc.home.arriveS, label: cc.rows.length ? 'Walk home' : 'Walk', distM: cc.home.legM });

  const marks = [{ kind: 'budget', t: s.budgetS, label: 'EVA budget' }];
  if (s.ponrIdx >= 0 && Number.isFinite(s.elapsedS[s.ponrIdx])) marks.push({ kind: 'ponr', t: s.elapsedS[s.ponrIdx], label: 'Point of no return', critical: true });
  if (Number.isFinite(startMs) && Number.isFinite(s.light?.sunsetMs)) {
    marks.push({ kind: 'sunset', t: (s.light.sunsetMs - startMs) / 1000, label: 'Sunset', critical: s.light.homeBySunset === false });
  }
  if (oxygen?.valid) {
    marks.push({ kind: 'o2', t: oxygen.enduranceS, label: 'O₂ endurance', critical: !oxygen.returnOk });
    marks.push({ kind: 'o2reserve', t: oxygen.enduranceS - oxygen.reserveS, label: 'O₂ reserve floor', critical: !oxygen.reserveOk });
  }
  const endS = Math.max(s.budgetS, cc.home.arriveS, ...marks.filter(m => Number.isFinite(m.t) && m.t > 0 && m.t < 3 * s.budgetS).map(m => m.t));
  return { items, marks: marks.filter(m => Number.isFinite(m.t)), endS, budgetS: s.budgetS, reserveS: cc.home.reserveS, rows: cc.rows };
}
