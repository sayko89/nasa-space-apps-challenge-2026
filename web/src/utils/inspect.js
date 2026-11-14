/**
 * Map-point inspection: what the loaded site knows about one point (x east, z south, metres).
 * Every value is read from the site grids or the planner state — fields with no data are left out.
 * Pure (inputs passed in): tested in Node (tests/inspect.test.mjs).
 */
import { thermalClass } from '../terrain/layers.js';

/**
 * @param {number} x
 * @param {number} z
 * @param {object} c  { site, n, cellM, idxAt(x,z)→cell|-1, heights, slope (tan), hazard: {cls}|null, hazardClasses,
 *                      latLon(x,z), home:{x,z}|null, route:{path,stats}|null, stations, toHome: Float32Array|null }
 */
export function inspectPoint(x, z, c) {
  const i = c.idxAt(x, z);
  if (!(i >= 0)) return null;
  const site = c.site || {};
  const out = { x, z, cell: i };
  const ll = c.latLon?.(x, z);
  if (ll) out.latLon = ll;
  if (c.heights) out.elevationM = c.heights[i] + (site.heightOrigin || 0);
  if (c.slope) out.slopeDeg = Math.atan(c.slope[i]) * 180 / Math.PI;

  const g = site.geology;
  if (g) {
    const unit = (grid, units) => (grid && units ? units[grid[i]] || null : null);
    const geo = { bedrock: unit(g.bedrock, g.bedrockUnits), surface: unit(g.surface, g.surfaceUnits) };
    if (geo.bedrock || geo.surface) out.geology = geo;
  }
  const L = site.layers || {};
  if (L.thermal && Number.isFinite(L.thermal.values[i])) out.thermal = { value: L.thermal.values[i], unit: L.thermal.unit, cls: thermalClass(L.thermal, L.thermal.values[i]) };
  if (L.minerals && L.minerals.code[i] > 0) out.mineral = { name: L.minerals.classes[L.minerals.code[i]], confidence: L.minerals.confidence?.[i] ?? null };
  if (L.rock && Number.isFinite(L.rock.values[i])) out.rockReliefM = L.rock.values[i];

  if (c.hazard?.cls) {
    const h = c.hazardClasses?.[c.hazard.cls[i]];
    if (h && h.key !== 'none') out.hazard = { key: h.key, name: h.name, hard: h.hard };
  }
  if (c.home) {
    out.homeDistM = Math.hypot(x - c.home.x, z - c.home.z);
    if (c.toHome && Number.isFinite(c.toHome[i]) && c.toHome[i] < 1e8) out.walkHomeS = c.toHome[i];
  }
  if (c.route?.path?.length) {
    let best = Infinity, bi = -1;
    c.route.path.forEach((p, k) => { const d = Math.hypot(p[0] - x, p[2] - z); if (d < best) { best = d; bi = k; } });
    out.route = { distM: best, idx: bi, elapsedS: c.route.stats?.elapsedS?.[bi] ?? null, marginS: c.route.stats?.marginS?.[bi] ?? null };
  }
  if (c.stations?.length) {
    const near = c.stations.map(st => ({ st, d: Math.hypot(st.x - x, st.z - z) })).sort((a, b) => a.d - b.d).slice(0, 3)
      .filter(e => e.d <= 150).map(e => ({ sol: e.st.sol, distM: e.d, frames: e.st.frames?.length || 0, x: e.st.x, z: e.st.z }));
    if (near.length) out.roverObs = near;
  }
  return out;
}

/** Mission relevance lines for an inspected point (reads only the fields above). */
export function pointRelevance(p, { maxSlopeDeg, maxRockReliefM } = {}) {
  if (!p) return [];
  const lines = [];
  if (p.hazard?.hard) lines.push({ level: 'block', text: `No-go: ${p.hazard.name}. The planner never routes through this cell.` });
  else if (p.hazard) lines.push({ level: 'caution', text: `Flagged: ${p.hazard.name}.` });
  if (Number.isFinite(p.slopeDeg) && Number.isFinite(maxSlopeDeg)) {
    lines.push({ level: p.slopeDeg > maxSlopeDeg ? 'block' : 'info', text: `Slope ${p.slopeDeg.toFixed(1)}° against the ${maxSlopeDeg}° walking limit.` });
  }
  if (Number.isFinite(p.rockReliefM) && Number.isFinite(maxRockReliefM) && p.rockReliefM > maxRockReliefM) {
    lines.push({ level: 'block', text: `Rock relief ${p.rockReliefM.toFixed(2)} m exceeds the ${maxRockReliefM} m obstacle threshold.` });
  }
  if (Number.isFinite(p.walkHomeS)) lines.push({ level: 'info', text: `Fastest suited walk home: ${Math.round(p.walkHomeS / 60)} min.` });
  if (p.route) lines.push({ level: 'info', text: `${p.route.distM.toFixed(0)} m from the active route${Number.isFinite(p.route.elapsedS) ? `, reached at ${Math.round(p.route.elapsedS / 60)} min` : ''}.` });
  if (p.roverObs?.length) lines.push({ level: 'info', text: `Rover images from ${p.roverObs.length} position(s) within 150 m — ground truth for the orbital data.` });
  else lines.push({ level: 'info', text: 'No rover images within 150 m: known from orbit only.' });
  return lines;
}
