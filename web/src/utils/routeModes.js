/**
 * What each route mode actually optimises (DEM planner, utils/pathfinder.js → planAllRoutes):
 * A* over the 4 m grid, every step costs its suited walking time × (1 + k·(slope / limit)²),
 * plus c seconds per metre climbed. k and c per mode: config/marswalkProfile.js MODE_WEIGHTS.
 * Pure: tested in Node (tests/routeModes.test.mjs).
 */
import { MODE_WEIGHTS } from '../config/marswalkProfile.js';

export const ROUTE_MODES = ['SAFE', 'ECO', 'FAST', 'AUTO'];

/** @returns {{ mode, goal, k, c, formula, effect }} */
export function routeModeExplanation(mode, slopeLimitDeg) {
  const w = MODE_WEIGHTS[mode] || MODE_WEIGHTS.AUTO;
  const k = w.slopeAversion, c = w.climbPenaltyS;
  const lim = Number.isFinite(slopeLimitDeg) ? `${slopeLimitDeg}°` : 'limit';
  const terms = ['walking time'];
  if (k > 0) terms[0] = `walking time × (1 + ${k}·(slope/${lim})²)`;
  if (c > 0) terms.push(`${c} s per metre climbed`);
  const effect = k === 0 && c === 0 ? 'Pure walking time: the quickest route, steep ground allowed up to the limit.'
    : k >= 4 ? `Slopes near the ${lim} limit cost up to ${(1 + k).toFixed(0)}× their walking time, so the route keeps to gentle ground.`
    : c >= 60 ? `Each metre of climb costs ${c} s extra: the route avoids going up and down.`
    : `A middle course: slopes cost up to ${(1 + k).toFixed(1)}× and each metre climbed ${c} s extra.`;
  return { mode, goal: w.desc, k, c, formula: terms.join(' + '), effect };
}
