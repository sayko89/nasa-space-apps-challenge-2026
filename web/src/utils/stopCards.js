/**
 * Science stop cards — for every stop the planner chose: why it was chosen, what to look at,
 * which data supports it, what that data shows and what it cannot tell.
 *
 * Built only from what the planner already computed (tags, kind, ChemCam match, terrain at the
 * stop) and the objective's own text — no new numbers. Terrain-risk classes use the planner's own
 * thresholds: the slope limit, the "steep ground" mark (15°) and half the rock-relief limit, the
 * same marks the route card reports.
 *
 * Pure (no React / Three): tested in Node (tests/stopCards.test.mjs).
 */
import { tagWeight } from './science.js';
import { HAZARD_PARAMS } from '../config/marswalkProfile.js';

// 'steep' / 'rough' below use the same marks as the hazard map and the route card (HAZARD_PARAMS)

const LAYER_OF = {
  B: 'geology', S: 'geology', C: 'geology', M: 'minerals', X: 'chemistry', T: 'chemistry',
};

/** Terrain risk at a stop: 'low' | 'moderate' | 'high' | 'unknown', with the reason. */
export function terrainRisk(terrain, limits) {
  const slope = terrain?.slopeDeg, rock = terrain?.rockReliefM;
  if (slope == null && rock == null) return { level: 'unknown', reason: 'no terrain data at this cell' };
  const notes = [];
  const steep = HAZARD_PARAMS.steepFraction.value * limits.maxSlopeDeg, rough = HAZARD_PARAMS.roughFraction.value * limits.maxRockReliefM;
  let level = 'low';
  if (slope != null) {
    if (slope > limits.maxSlopeDeg) { level = 'high'; notes.push(`slope ${slope.toFixed(1)}° over the ${limits.maxSlopeDeg}° limit`); }
    else if (slope > steep) { level = 'moderate'; notes.push(`slope ${slope.toFixed(1)}° (steep: > ${steep}°)`); }
    else notes.push(`slope ${slope.toFixed(1)}°`);
  }
  if (rock != null) {
    if (rock > limits.maxRockReliefM) { level = 'high'; notes.push(`rock relief ${rock.toFixed(2)} m over the ${limits.maxRockReliefM} m limit`); }
    else if (rock > rough) { if (level === 'low') level = 'moderate'; notes.push(`rock relief ${rock.toFixed(2)} m (rough: > ${rough} m)`); }
    else notes.push(`rock relief ${rock.toFixed(2)} m`);
  }
  return { level, reason: notes.join(' · ') };
}

/** How well the data behind the stop is known: measured > mapped > derived. */
export function dataConfidence(stop, site) {
  if (stop.kind === 'chemistry' || stop.kind === 'target') {
    return { level: 'measured', reason: 'ChemCam measured this rock from the rover (spot a few mm wide; accuracy a few wt%)' };
  }
  if (stop.kind === 'mineral') {
    const c = stop.terrain?.mineralConfidence;
    return { level: c === 'high' ? 'mapped (high)' : 'mapped (medium)',
      reason: `CRISM ${c || 'medium'}-confidence class, 36 m pixel, orbital` };
  }
  if (site.geologyDerived) return { level: 'derived', reason: 'this project\'s derived units (elevation band + DEM relief), not a published map' };
  return { level: 'mapped', reason: 'photogeologic map from HiRISE images (Stack et al. 2020), orbital' };
}

function investigate(stop) {
  switch (stop.kind) {
    case 'contact': return 'Find the contact on the ground; photograph both sides and the boundary; sample each unit within a few metres of it; note which lies on top.';
    case 'mineral': return `Look for rock that matches the CRISM class (${stop.tags.find(t => t[0] === 'M')?.slice(2)}); sample the freshest exposure; note colour, grain size and any alteration rind.`;
    case 'chemistry': return `Find ${stop.chem?.name}; sample the same spot ChemCam hit and the host rock next to it, so the standout (${(stop.chemAll || [stop.chem]).map(c => c?.tag).join(', ')}) can be checked in the lab.`;
    case 'target': return `Find ${stop.target?.name} (ChemCam, sol ${stop.target?.sol}); photograph the laser pits if visible and sample the rock by hand for comparison.`;
    default: return 'Sample the unit away from loose cover; photograph the outcrop with scale; note texture and layering.';
  }
}

function evidence(stop) {
  const units = stop.tags.filter(t => t[0] === 'B' || t[0] === 'S').map(t => t.slice(2));
  const out = [];
  if (units.length) out.push(`Units here: ${units.join(' / ')}`);
  const m = stop.tags.find(t => t[0] === 'M');
  if (m) out.push(`CRISM dominant mineral: ${m.slice(2)}`);
  if (stop.kind === 'contact') out.push(`Mapped contact: ${stop.tags.find(t => t[0] === 'C')?.slice(2)}`);
  for (const c of stop.chemAll || (stop.chem ? [stop.chem] : [])) {
    out.push(`ChemCam ${c.name}, sol ${c.sol}: ${c.tag} by ${c.diff > 0 ? '+' : ''}${c.diff.toFixed(1)} wt% against its level`);
  }
  for (const t of stop.targetAll || (stop.target ? [stop.target] : [])) out.push(`ChemCam target ${t.name}, sol ${t.sol}${t.points ? `, ${t.points} laser points` : ''}`);
  return out;
}

/**
 * @param {object} stop       planner stop (kind, tags, label, x, z, terrain, chem?, target?)
 * @param {number} n          stop number (1-based)
 * @param {object} ctx        { objective, weights, dwellS, site: { geologyDerived }, limits: { maxSlopeDeg, maxRockReliefM }, latLon? }
 */
export function buildStopCard(stop, n, ctx) {
  const { objective, weights } = ctx;
  const counted = stop.tags.filter(t => tagWeight(t, weights) > 0);
  const why = counted.length
    ? `Adds ${counted.map(t => `${t.slice(2)} (${t[0] === 'C' ? 'contact' : t[0] === 'M' ? 'mineral' : t[0] === 'X' ? 'chemistry' : t[0] === 'T' ? 'measured target' : t[0] === 'B' ? 'bedrock' : 'surface'}, weight ${tagWeight(t, weights)})`).join(', ')}`
      + ' to the plan — the nearest place (walking time) that does, within the EVA budget.'
    : 'Context stop.';
  const layers = [...new Set(stop.tags.map(t => LAYER_OF[t[0]]).filter(Boolean)), 'terrain', 'rocks'];
  const ll = ctx.latLon ? ctx.latLon(stop.x, stop.z) : null;
  return {
    n,
    name: stop.label,
    kind: stop.kind,
    x: stop.x, z: stop.z,
    lat: ll?.lat ?? null, lon: ll?.lon ?? null,
    objective: objective?.name || 'No objective (balanced survey)',
    importance: objective?.relevance || 'Samples a distinct geological unit, contact or mineral.',
    why,
    investigate: investigate(stop),
    layers,
    evidence: evidence(stop),
    uncertainty: objective?.uncertainty || '',
    visitMin: Math.round((ctx.dwellS || 0) / 60),
    risk: terrainRisk(stop.terrain, ctx.limits),
    confidence: dataConfidence(stop, ctx.site),
  };
}
