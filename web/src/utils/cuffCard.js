/**
 * Cuff card — the planned Marswalk as an Apollo-style wrist card (station list + timeline).
 *
 * Apollo 15–17 crews wore a small spiral-bound checklist on the wrist, and the traverse
 * planning data gave, for every station, the time there and the walk back to the LM. This
 * module turns a planned DEM route into the same kind of table:
 *
 *   ARR      mission elapsed time (MET) at arrival                       h+mm, as Apollo wrote it
 *   STAY     planned time at the stop
 *   LEG      distance walked from the previous stop, and the bearing to it
 *   BACK     fastest walk home from the stop (same Dijkstra map as the GO/NO-GO check)
 *   LEAVE BY latest MET to leave the stop and still be home inside the EVA budget
 *            = budget − BACK. Leaving later is past the turn-back time for that stop.
 *   MARGIN   walk-back margin when leaving on time = LEAVE BY − planned departure
 *
 * Pure (no React / Three): tested in Node (tests/cuffCard.test.mjs).
 */

/** Seconds → Apollo "h+mm" (e.g. 3960 → "1+06"). Negative → "−0+12". */
export function fmtMET(sec) {
  if (!Number.isFinite(sec)) return '—';
  const m = Math.round(Math.abs(sec) / 60);
  return `${sec < 0 ? '−' : ''}${Math.floor(m / 60)}+${String(m % 60).padStart(2, '0')}`;
}

/** Compass bearing [deg] from (x0,z0) to (x1,z1). World: +x east, +z south. */
export function bearingDeg(x0, z0, x1, z1) {
  return ((Math.atan2(x1 - x0, -(z1 - z0)) * 180) / Math.PI + 360) % 360;
}

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export const compass = (deg) => COMPASS[Math.round(deg / 22.5) % 16];

/**
 * @param {Array<[number,number,number]>} path  planned route (closed loop: home → stops → home)
 * @param {object} stats   route stats from pathfinder (elapsedS, marginS, stops, budgetS, …)
 * @param {object} [env]   { startMs, sunAt(ms) → {elevationDeg}, airAt(ms) → {median}, ltstAt(ms) → h }
 * @returns {{ rows, home, totals }}
 */
export function buildCuffCard(path, stats, env = {}) {
  if (!path?.length || !stats?.elapsedS || !stats?.marginS) throw new Error('cuff card: needs a planned DEM route');
  const { elapsedS, marginS, budgetS } = stats;
  const n = path.length;
  const cum = new Float64Array(n);
  for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][2] - path[i - 1][2]);

  const at = (s) => {
    const ms = Number.isFinite(env.startMs) ? env.startMs + s * 1000 : null;
    if (ms == null) return {};
    const sun = env.sunAt?.(ms);
    const air = env.airAt?.(ms);
    return {
      ltstH: env.ltstAt ? env.ltstAt(ms) : null,
      sunElevDeg: sun ? sun.elevationDeg : null,
      airK: air ? air.median : null,
    };
  };

  const stops = [...(stats.stops || [])].sort((a, b) => a.idx - b.idx);
  const rows = [];
  let prevIdx = 0;
  stops.forEach((st, k) => {
    const i = st.idx;
    const departS = elapsedS[i];
    const arriveS = departS - (st.dwellS || 0);
    const backS = budgetS - departS - marginS[i];
    const [px, , pz] = path[prevIdx], [x, , z] = path[i];
    rows.push({
      n: k + 1, label: st.label || `Stop ${k + 1}`, x, z,
      arriveS, stayS: st.dwellS || 0, departS,
      legM: cum[i] - cum[prevIdx], bearingDeg: bearingDeg(px, pz, x, z),
      backS, leaveByS: budgetS - backS, marginS: marginS[i],
      ...at(arriveS),
    });
    prevIdx = i;
  });

  const last = n - 1;
  const homeS = elapsedS[last] + (stats.returnTimeS > 1 ? stats.returnTimeS : 0);
  const home = {
    arriveS: homeS, legM: cum[last] - cum[prevIdx],
    bearingDeg: bearingDeg(path[prevIdx][0], path[prevIdx][2], path[last][0], path[last][2]),
    reserveS: budgetS - homeS,
    ...at(homeS),
  };

  const tightest = rows.length ? rows.reduce((a, b) => (b.marginS < a.marginS ? b : a)) : null;
  return {
    rows, home,
    totals: {
      distanceM: cum[last], roundTripS: homeS, budgetS,
      stayS: rows.reduce((s, r) => s + r.stayS, 0),
      minMarginS: stats.minMarginS, tightestStop: tightest ? tightest.n : null,
      ponr: stats.ponrIdx >= 0, go: !!stats.go,
      maxRadialM: stats.maxRadialM, climbM: stats.climbM, descentM: stats.descentM,
      doseMSv: stats.radiation?.doseMSv ?? null,
      sunsetMs: stats.light?.sunsetMs ?? null, homeBySunset: stats.light?.homeBySunset ?? null,
      air: stats.light?.air ?? null,
    },
  };
}
