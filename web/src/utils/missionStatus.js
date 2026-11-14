/**
 * Mission decision — GO / CONDITIONAL / NO-GO / INSUFFICIENT DATA, with the reason for each.
 *
 * Built only from what the planner already computed for the route (stats.checks, margins, light)
 * plus the space-weather lookup for the EVA date. Nothing is recalculated here.
 *
 *   HARD CONSTRAINTS  (fail → NO-GO; cannot be evaluated → INSUFFICIENT DATA)
 *     walk-back margin ≥ 0 at every point · max slope · distance from start · carried weight
 *     · rover walk-back (rover mode) · daylight (start after sunrise, home before sunset)
 *   ENVIRONMENT       (problem or unknown → CONDITIONAL; never silently GO)
 *     space weather: solar particle event within ±2 days, or no event data for the date
 *     tightest walk-back margin below the 30-min reserve of the Apollo 17 traverse plan
 *     route crosses mapped closed depressions or the obstacle buffer
 *   NOTES             (shown, do not change the status)
 *     radiation dose from a transferred reference (Jezero); ground known only from orbit
 *
 * Pure: tested in Node (tests/missionStatus.test.mjs).
 */

export const RESERVE_S = 30 * 60;   // Apollo 17 Traverse Planning Data: 30-min life-support reserve (see marswalkProfile MARS_CONSERVATIVE)

const hm = (s) => {
  if (!Number.isFinite(s)) return '—';
  const m = Math.round(Math.abs(s) / 60);
  return `${s < 0 ? '−' : ''}${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
};

/**
 * @param {object} s    route stats (pathfinder computeDemStats): checks, minMarginS, maxSlopeDeg, maxRadialM, carry, rover, light, radiation
 * @param {object} ctx  { limits: { maxSlopeDeg, maxRadialM }, wx: spaceWeatherAt() result | null, wxLive?: bool,
 *                        startFuture?: bool, radiationLocal: bool, hazards?: routeHazards() result }
 * @returns {{ status, hard, environment, notes, missing, summary }}
 */
export function missionDecision(s, ctx = {}) {
  const c = s?.checks || {};
  const hard = [], environment = [], notes = [], missing = [];
  const add = (list, key, label, ok, detail) => list.push({ key, label, ok, detail });
  if (!s || !s.checks) {
    return { status: 'INSUFFICIENT DATA', hard, environment, notes, summary: 'No planned route to evaluate.',
      missing: [{ key: 'route', label: 'Planned route', detail: 'plan a route first' }] };
  }
  const lim = ctx.limits || {};

  // ---- hard constraints
  add(hard, 'budget', 'Walk-back margin ≥ 0 everywhere', c.budget,
    Number.isFinite(s.minMarginS) ? `tightest margin ${hm(s.minMarginS)}${s.ponrIdx >= 0 ? ' — point of no return on the route' : ''}` : 'no walkable path home');
  add(hard, 'slope', 'Slope within limit', c.slope, `max ${s.maxSlopeDeg?.toFixed(1)}° / ${lim.maxSlopeDeg}°`);
  add(hard, 'radial', 'Distance from start within limit', c.radial, `farthest ${(s.maxRadialM / 1000).toFixed(2)} km / ${(lim.maxRadialM / 1000).toFixed(1)} km`);
  if ('carry' in c) add(hard, 'carry', 'Carried weight within limit', c.carry,
    s.carry ? `${s.carry.earthEqKg.toFixed(1)} / ${s.carry.limitKg} kg Earth-equivalent` : '');
  if ('rover' in c) add(hard, 'rover', 'Within the rover walk-back', c.rover,
    s.rover ? `farthest ${hm(s.rover.maxReturnS)} walk / ${Math.round(s.rover.limitS / 60)} min` : '');
  if ('daylight' in c) {
    add(hard, 'daylight', 'Start after sunrise, home before sunset', c.daylight,
      c.daylight ? 'whole EVA in daylight' : 'part of the EVA is in darkness');
  } else {
    missing.push({ key: 'daylight', label: 'Daylight', detail: s.light ? 'sun never rises or never sets at this date — rule cannot be applied' : 'no EVA start time — daylight cannot be checked' });
  }

  // ---- environment
  const wx = ctx.wx;
  if (!wx || wx.advisory === 'no-data') {
    environment.push({ key: 'spaceWeather', label: 'Space weather', ok: null,
      detail: ctx.startFuture ? 'future date: DONKI records past events and does not forecast — must be checked before the EVA'
        : 'no DONKI event data for this date (offline or lookup failed) — not assumed clear' });
  } else if (wx.advisory === 'postpone') {
    add(environment, 'spaceWeather', 'Space weather', false,
      `${wx.sep.length} solar particle event${wx.sep.length > 1 ? 's' : ''} within ±2 days (DONKI${ctx.wxLive ? ', live' : ''}) — postpone recommended`);
  } else {
    add(environment, 'spaceWeather', 'Space weather', true, `no solar particle event within ±2 days (DONKI${ctx.wxLive ? ', live' : ''})`);
  }
  if (Number.isFinite(s.minMarginS) && s.minMarginS >= 0) {
    add(environment, 'reserve', 'Tightest margin ≥ 30-min reserve', s.minMarginS >= RESERVE_S,
      `${hm(s.minMarginS)} (Apollo 17 kept 30 min in reserve)`);
  }
  const soft = (ctx.hazards || []).filter(h => h.key === 'depression' || h.key === 'buffer');
  if (ctx.hazards) {
    add(environment, 'terrain', 'Route avoids depressions and obstacle edges', soft.length === 0,
      soft.length ? soft.map(h => `${Math.round(h.lengthM)} m ${h.name}`).join(', ') : 'none crossed');
  }

  // ---- notes
  if (s.radiation) {
    notes.push({ key: 'radiation', label: 'Radiation dose',
      detail: `${s.radiation.doseMSv.toFixed(2)} mSv GCR for the EVA — ${ctx.radiationLocal ? 'Curiosity RAD rate measured in this crater'
        : 'Curiosity RAD rate measured in Gale, used here as a reference (not a local measurement)'}; solar particle events not included` });
  }
  const unseen = (ctx.hazards || []).find(h => h.key === 'unseen');
  if (unseen) notes.push({ key: 'unseen', label: 'Ground known only from orbit', detail: `${Math.round(unseen.lengthM)} m of the route is more than 100 m from any rover ground view` });

  // ---- status
  const failHard = hard.filter(h => !h.ok);
  const envProblems = environment.filter(e => e.ok !== true);
  // how an open environmental condition reads in the one-line summary
  const ISSUE = { spaceWeather: (e) => (e.ok === null ? 'space weather unknown' : 'solar particle event near the date'),
    reserve: () => 'walk-back margin below the 30-min reserve', terrain: () => 'route crosses depressions / obstacle edges' };
  let status;
  if (failHard.length) status = 'NO-GO';
  else if (missing.length) status = 'INSUFFICIENT DATA';
  else if (envProblems.length) status = 'CONDITIONAL';
  else status = 'GO';
  const summary = status === 'NO-GO' ? `Fails: ${failHard.map(h => h.label.toLowerCase()).join('; ')}.`
    : status === 'INSUFFICIENT DATA' ? `Cannot evaluate: ${missing.map(m => m.label.toLowerCase()).join('; ')}.`
    : status === 'CONDITIONAL' ? `All hard constraints met; open: ${envProblems.map(e => (ISSUE[e.key] ? ISSUE[e.key](e) : e.label.toLowerCase())).join('; ')}.`
    : 'All hard constraints met and no environmental condition open.';
  return { status, hard, environment, notes, missing, summary };
}

export const STATUS_STYLE = {
  GO: { fg: '#0a1a0a', bg: '#44dd66' },
  CONDITIONAL: { fg: '#1a1200', bg: '#ffc94d' },
  'NO-GO': { fg: '#fff', bg: '#cc3322' },
  'INSUFFICIENT DATA': { fg: '#fff', bg: '#6a6a80' },
};
