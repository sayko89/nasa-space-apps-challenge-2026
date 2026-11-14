/**
 * Elevation profile of a planned route — distance walked [m] against elevation [m],
 * the kind of plot JPL's Mars Trek draws for a measured path, here for the EVA route
 * with the science stops marked.
 *
 *   path   [[x, y, z], …]  world polyline; y = terrain height relative to `originM`
 *   stats  route stats (stops: [{ idx, label }]) — optional
 *   originM  absolute elevation of y = 0 (SITE.heightOrigin), so the axis reads in MOLA metres
 *
 * Pure (no React / Three): tested in Node (tests/elevationProfile.test.mjs).
 */
export function elevationProfile(path, stats = null, originM = 0, maxPoints = 240) {
  if (!path || path.length < 2) return null;
  const n = path.length;
  const cum = new Float64Array(n);
  for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][2] - path[i - 1][2]);
  const total = cum[n - 1];
  if (!(total > 0)) return null;

  // Keep every stop and the extremes; thin the rest evenly along the route
  const keep = new Set([0, n - 1]);
  const step = Math.max(1, Math.ceil(n / maxPoints));
  for (let i = 0; i < n; i += step) keep.add(i);
  let iMin = 0, iMax = 0;
  for (let i = 1; i < n; i++) {
    if (path[i][1] < path[iMin][1]) iMin = i;
    if (path[i][1] > path[iMax][1]) iMax = i;
  }
  keep.add(iMin); keep.add(iMax);
  const stops = [...(stats?.stops || [])].filter(s => s.idx > 0 && s.idx < n).sort((a, b) => a.idx - b.idx);
  for (const s of stops) keep.add(s.idx);

  const idx = [...keep].sort((a, b) => a - b);
  const points = idx.map(i => ({ distM: cum[i], elevM: path[i][1] + originM }));
  return {
    points,
    totalM: total,
    minM: path[iMin][1] + originM,
    maxM: path[iMax][1] + originM,
    startM: path[0][1] + originM,
    stops: stops.map((s, k) => ({ n: k + 1, label: s.label || `Stop ${k + 1}`, distM: cum[s.idx], elevM: path[s.idx][1] + originM })),
  };
}

/** SVG geometry for a profile in a w × h box (padding in the same units). */
export function profileGeometry(profile, w, h, pad = { l: 0, r: 0, t: 0, b: 0 }) {
  const span = Math.max(1, profile.maxM - profile.minM);
  const lo = profile.minM - span * 0.08, hi = profile.maxM + span * 0.12;
  const X = (d) => pad.l + (d / profile.totalM) * (w - pad.l - pad.r);
  const Y = (e) => pad.t + (1 - (e - lo) / (hi - lo)) * (h - pad.t - pad.b);
  const line = profile.points.map((p, i) => `${i ? 'L' : 'M'}${X(p.distM).toFixed(2)},${Y(p.elevM).toFixed(2)}`).join('');
  const area = `${line}L${X(profile.totalM).toFixed(2)},${(h - pad.b).toFixed(2)}L${X(0).toFixed(2)},${(h - pad.b).toFixed(2)}Z`;
  return { X, Y, line, area, lo, hi };
}
