/**
 * Rock chemistry near a point — Curiosity ChemCam targets (public/sites/<site>/chemistry.json,
 * pipeline/build_chemistry.py). Pure functions; the data object is passed in.
 */

export const CHEM_RADIUS_M = 60;

/** A target "stands out" when an oxide is this many ChemCam accuracies (RMSEP) from its level's mean. */
export const STANDOUT_SIGMA = 2;   // a stop "has chemistry" if a measured target lies this close

/** Display order and short labels of the oxides (wt%). */
export const OXIDE_ORDER = ['SiO2', 'FeOT', 'MgO', 'CaO', 'Al2O3', 'Na2O', 'K2O', 'TiO2', 'MnO'];

/** Targets within `radius` m of (x, z), nearest first (at most `max`). */
export function nearestTargets(chem, x, z, radius = CHEM_RADIUS_M, max = 3) {
  const list = chem?.targets;
  if (!Array.isArray(list) || !list.length) return [];
  return list
    .map(t => ({ ...t, dist: Math.hypot(t.x - x, t.z - z) }))
    .filter(t => t.dist <= radius)
    .sort((a, b) => a.dist - b.dist)
    .slice(0, max);
}

/** Mean composition of the stratigraphic level with this code, or null. */
export function levelMean(chem, bedrockCode) {
  return chem?.by_bedrock?.find(s => s.code === bedrockCode) || null;
}

/**
 * Oxides where the target differs from its level's mean by more than `sigma` × the ChemCam
 * accuracy (RMSEP) — the readings worth a second look. [{oxide, value, mean, diff}], largest first.
 */
export function standouts(chem, target, level, sigma = STANDOUT_SIGMA) {
  if (!target?.oxides || !level?.mean) return [];
  const out = [];
  for (const o of OXIDE_ORDER) {
    const v = target.oxides[o], m = level.mean[o], e = chem?.rmsep?.[o];
    if (v == null || m == null || !(e > 0)) continue;
    const diff = v - m;
    if (Math.abs(diff) > sigma * e) out.push({ oxide: o, value: v, mean: m, diff });
  }
  return out.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
}

/**
 * Every clear chemical standout in the site, for the science planner:
 * [{ target, tag: 'MgO high', oxide, diff }] — tag is what the diversity score counts.
 */
export function chemAnomalies(chem, sigma = STANDOUT_SIGMA) {
  const out = [];
  for (const t of chem?.targets || []) {
    const lvl = levelMean(chem, t.bedrock);
    if (!lvl?.mean) continue;
    for (const o of OXIDE_ORDER) {
      const v = t.oxides?.[o], m = lvl.mean[o], e = chem.rmsep?.[o];
      if (v == null || m == null || !(e > 0) || Math.abs(v - m) <= sigma * e) continue;
      out.push({ target: t, oxide: o, diff: v - m, tag: `${o} ${v > m ? 'high' : 'low'}` });
    }
  }
  return out;
}
