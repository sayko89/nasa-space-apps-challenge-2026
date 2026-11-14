/**
 * MARTIAN EVA CUFF — the data of the wrist console and the printable backup checklist.
 *
 * Built only from what the app already computes for the selected mission: the planned route and its stats
 * (pathfinder), the cuff-card station table (cuffCard.js), the stop cards (stopCards.js), the decision and the
 * A/B/C + oxygen assessments (evaAssessments.js), the hazards on the route (hazards.js) and — during an EVA
 * playback — the playback snapshot (evaPlayback.js evaSnapshot). Nothing here is telemetry: the position is
 * PLANNED before an EVA and SIMULATED during the playback, and the screens say so.
 *
 * Pure: tested in Node (tests/evaCuff.test.mjs).
 */
import { buildCuffCard } from './cuffCard.js';
import { PAYLOAD_CATEGORIES } from './payload.js';

export const CUFF_SCREENS = [
  { id: 'status', key: 'F1', label: 'STATUS' },
  { id: 'map', key: 'F2', label: 'MAP' },
  { id: 'tasks', key: 'F3', label: 'TASKS' },
  { id: 'hazards', key: 'F4', label: 'HAZARDS' },
  { id: 'return', key: 'F5', label: 'RETURN' },
];

/** Where each item of information comes from — shown next to it on the hazard and emergency screens. */
export const CUFF_SOURCE = {
  measured: 'MEASURED', orbital: 'ORBITAL', derived: 'DERIVED', modelled: 'MODEL', ai: 'AI-PREDICTED',
  nasa: 'NASA REF', project: 'PROJECT RULE', simulated: 'SIMULATED',
};

const bearing = (dx, dz) => ((Math.atan2(dx, -dz) * 180 / Math.PI) + 360) % 360;   // 0 = north (−z)
export const compass8 = (deg) => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8];

/** Mission identifier from the selected mission (site, objective, route mode, start date). */
export function missionId(site, objectiveId, mode, startMs) {
  const d = Number.isFinite(startMs) ? new Date(startMs).toISOString().slice(0, 10).replace(/-/g, '') : 'NODATE';
  const obj = (objectiveId || 'MANUAL').split('-').map(w => w[0]).join('').toUpperCase().slice(0, 4);
  return `${(site || 'SITE').slice(0, 3).toUpperCase()}-${obj}-${(mode || '—').slice(0, 4)}-${d}`;
}

/** Points along the route that lie in a flagged hazard cell (for the map screen), one per ~stepM. */
export function hazardPoints(path, cls, cellIndexAt, classes, stepM = 20) {
  if (!path?.length || !cls) return [];
  const out = [];
  let acc = stepM;
  for (let i = 1; i < path.length; i++) {
    acc += Math.hypot(path[i][0] - path[i - 1][0], path[i][2] - path[i - 1][2]);
    const c = classes[cls[cellIndexAt(path[i][0], path[i][2])]];
    if (c && c.key !== 'none' && c.key !== 'unseen' && acc >= stepM) { out.push({ x: path[i][0], z: path[i][2], key: c.key, hard: c.hard }); acc = 0; }
  }
  return out;
}

/**
 * @param {object} c
 * @param {object} c.route        { path, stats } of the selected route
 * @param {string} c.mode         route mode
 * @param {object} c.site         { name, label }
 * @param {number} c.startMs
 * @param {object} c.mission      mission settings (suit, payload, equipmentKg, o2, limits)
 * @param {object} [c.assess]     evaAssessments() result { decision, payload, dust, mobility, oxygen }
 * @param {Array}  [c.hazards]    routeHazards()
 * @param {Array}  [c.cards]      stop cards (scienceStopCards)
 * @param {object} [c.objective]
 * @param {object} [c.snap]       evaSnapshot() during an EVA playback
 * @param {object} [c.suit]       SUITS[mission.suit]
 * @param {object} [c.limits]     { maxSlopeDeg, maxRockReliefM, maxRadialKm }
 * @param {object} [c.returnPath] { path } walk home from the current position (abort path or fastest return)
 */
export function cuffModel(c) {
  const { route, snap } = c;
  if (!route?.path?.length || !route.stats?.elapsedS) return null;
  const s = route.stats;
  const card = buildCuffCard(route.path, s);
  const live = !!snap && snap.status && snap.status !== 'idle';
  const t = live ? snap.t : 0;
  const home = { x: route.path[0][0], z: route.path[0][2] };
  const pos = live && snap.pose ? { x: snap.pose.x, z: snap.pose.z, label: 'SIMULATED' } : { ...home, label: 'PLANNED START' };
  const d = c.assess?.decision || null;
  // oxygen: the playback's live state during an EVA, the plan check before it (two shapes, same meaning)
  const ox0 = live ? snap.oxygen : c.assess?.oxygen;
  const ox = ox0?.valid ? { ...ox0, rateKgH: ox0.rateKgH ?? c.assess?.oxygen?.rateKgH, scenarioLabel: ox0.scenarioLabel ?? c.assess?.oxygen?.scenarioLabel,
    returnFeasible: ox0.returnFeasible ?? ox0.returnOk, reserveOk: ox0.reserveOk,
    remainingKg: ox0.remainingKg ?? ox0.initialKg } : null;

  // ---- stop states (done / here / next / pending), from the playback when it runs
  const stopsDone = live ? snap.stopsDone : 0;
  const here = live && snap.activity?.kind === 'sample' ? snap.activity.stop?.n : null;
  const nextN = live ? (snap.activity?.next?.n ?? (here ? card.rows.find(r => r.n > here)?.n : null) ?? null) : (card.rows[0]?.n ?? null);
  const stateOf = (n) => (here === n ? 'here' : n <= stopsDone ? 'done' : n === nextN ? 'next' : 'pending');

  // ---- STATUS
  const marginS = live ? snap.margin : s.minMarginS;
  const unsafeReturn = (live && (snap.ponrPassed || !(snap.margin >= 0))) || (ox?.valid && ox.returnFeasible === false) || (!live && s.ponrIdx >= 0);
  const status = {
    id: missionId(c.site?.name, c.objective?.id, c.mode, c.startMs),
    site: c.site?.label || c.site?.name,
    metS: t,
    remainingS: s.budgetS - t,
    budgetS: s.budgetS,
    o2: ox ? { remainingKg: ox.remainingKg, initialKg: ox.initialKg, enduranceS: ox.enduranceS, rateKgH: ox.rateKgH, scenario: ox.scenarioLabel } : null,
    waypoint: live ? activityLine(snap) : `Ready at the start — first stop ${card.rows[0] ? `S${card.rows[0].n} ${card.rows[0].label}` : 'none'}`,
    marginS,
    // the decision is the app's; during the EVA an unsafe return overrides it (never shown as GO)
    decision: unsafeReturn ? 'NO-GO' : (d?.status || (s.go ? 'GO' : 'NO-GO')),
    decisionWhy: unsafeReturn ? 'Return not safe: walk-back margin below zero or not enough oxygen to walk home.' : (d?.summary || ''),
    source: live ? (snap.status === 'done' ? 'SIMULATED · EVA COMPLETE' : snap.aborted ? 'SIMULATED · ABORTED' : 'SIMULATED') : 'PLANNED',
  };

  // ---- MAP
  const next = card.rows.find(r => r.n === nextN) || null;
  const map = {
    path: route.path.map(p => [p[0], p[2]]),
    home,
    pos,
    stops: card.rows.map(r => ({ n: r.n, x: r.x, z: r.z, state: stateOf(r.n) })),
    next: next ? { n: next.n, label: next.label, distM: Math.hypot(next.x - pos.x, next.z - pos.z), bearing: compass8(bearing(next.x - pos.x, next.z - pos.z)) } : null,
    homeDir: { distM: Math.hypot(home.x - pos.x, home.z - pos.z), bearing: compass8(bearing(home.x - pos.x, home.z - pos.z)) },
    hazards: c.hazardPts || [],
    returnPath: c.returnPath?.path ? c.returnPath.path.map(p => [p[0], p[2]]) : null,
    rerouted: live && !!snap.rerouted,
  };

  // ---- TASKS
  const cards = c.cards || [];
  const payloadLine = equipmentLines(c.mission, c.suit);
  const tasks = card.rows.map((r, i) => {
    const k = cards.find(x => Math.hypot(x.x - r.x, x.z - r.z) < 6) || cards[i] || null;
    return {
      n: r.n, name: k?.name || r.label, state: stateOf(r.n),
      objective: k?.objective || c.objective?.name || null,
      context: k ? k.evidence.slice(0, 2).join(' · ') : null,
      activity: k?.investigate || null,
      why: k?.why || null,
      equipment: payloadLine.filter(l => /sampling|instrument/i.test(l.label)).map(l => `${l.label} ${l.kg} kg`),
      durationMin: Math.round(r.stayS / 60),
      arriveS: r.arriveS, leaveByS: r.leaveByS, marginS: r.marginS,
      risk: k?.risk || null, confidence: k?.confidence || null,
    };
  });

  // ---- HAZARDS (kind of evidence shown with each line)
  const hz = [];
  const lim = c.limits || {};
  if (Number.isFinite(s.maxSlopeDeg)) hz.push({ key: 'slope', level: s.checks?.slope === false ? 'block' : s.maxSlopeDeg > 0.75 * (lim.maxSlopeDeg || 20) ? 'caution' : 'ok', src: 'orbital',
    text: `Max slope ${s.maxSlopeDeg.toFixed(1)}° / limit ${lim.maxSlopeDeg ?? '—'}°` });
  if (s.layers?.rock) hz.push({ key: 'rock', level: s.layers.rock.maxReliefM > s.layers.rock.limitM ? 'block' : 'ok', src: 'derived',
    text: `Rock relief max ${s.layers.rock.maxReliefM.toFixed(2)} m / limit ${s.layers.rock.limitM} m (1 m DTM; rocks < ~2 m not seen)` });
  for (const h of c.hazards || []) {
    if (h.key === 'unseen') continue;
    hz.push({ key: h.key, level: h.hard ? 'block' : 'caution', src: 'derived', text: `${h.name}: ${Math.round(h.lengthM)} m of route` });
  }
  const unseen = (c.hazards || []).find(h => h.key === 'unseen');
  if (unseen) hz.push({ key: 'unseen', level: 'caution', src: 'derived', text: `Low-confidence ground: ${Math.round(unseen.lengthM)} m known only from orbit (no rover image nearby)` });
  if (c.assess?.dust) {
    const w = c.assess.dust.warnings.filter(x => x.level !== 'info').slice(0, 2).map(x => x.text.replace(/\.$/, ''));
    hz.push({ key: 'dust', level: w.length ? 'caution' : 'ok', src: 'modelled', text: `Dust exposure ${c.assess.dust.status}${w.length ? ` — ${w.join('; ')}` : ''} (not quantified)` });
  }
  if (s.radiation) hz.push({ key: 'radiation', level: 'ok', src: 'measured', text: `GCR dose ${s.radiation.doseMSv.toFixed(2)} mSv for the EVA (Curiosity RAD rate)` });
  for (const e of d?.environment || []) if (!e.ok) hz.push({ key: `env-${e.key}`, level: 'caution', src: 'project', text: `${e.label || e.key}: ${e.detail}` });
  if (c.segmentation) hz.push({ key: 'ai', level: 'info', src: 'ai', text: `Terrain classes on ${c.segmentation.count} rover images — image level, not on the map; big rocks poorly detected` });
  if (live && snap.rerouted) hz.push({ key: 'reroute', level: 'caution', src: 'simulated', text: 'Route changed around a dust devil (25 m safety zone)' });

  // ---- RETURN
  const returnS = live ? snap.backS : s.returnTimeS ?? null;
  const o2Back = ox?.valid && Number.isFinite(ox.returnNeedKg) ? ox.returnNeedKg : null;
  const warns = [];
  if (live && snap.ponrPassed) warns.push('POINT OF NO RETURN PASSED');
  if (Number.isFinite(marginS) && marginS < 0) warns.push('WALK-BACK MARGIN BELOW ZERO');
  if (ox?.valid && ox.returnFeasible === false) warns.push('O₂ NOT ENOUGH TO WALK HOME');
  if (ox?.valid && ox.reserveOk === false) warns.push('O₂ RESERVE NOT KEPT');
  if (s.light?.homeBySunset === false) warns.push('NOT HOME BEFORE SUNSET');
  const back = {
    status: warns.length ? 'RETURN NOW' : live && snap.aborted ? 'RETURNING' : 'RETURN AVAILABLE',
    etaS: live && snap.aborted ? snap.activity?.etaS ?? returnS : returnS,
    marginS, remainingS: s.budgetS - t,
    homeDir: map.homeDir,
    o2: ox ? { remainingKg: ox.remainingKg, needKg: o2Back, reserveKg: ox.reserveKg ?? null } : null,
    warnings: warns,
    path: map.returnPath,
  };

  return { status, map, tasks, hazards: hz, ret: back, emergency: emergencyCards(c), equipment: payloadLine, card, live };
}

function activityLine(snap) {
  const a = snap.activity || {};
  if (a.kind === 'sample') return `At S${a.stop.n} ${a.stop.label || ''} — sampling`;
  if (a.kind === 'walk') return `To S${a.next.n} ${a.next.label || ''}`;
  if (a.kind === 'walk-home') return 'Walking home';
  if (a.kind === 'return') return 'ABORT — returning home';
  if (a.kind === 'done') return 'Back at the habitat';
  return 'Ready';
}

/** Equipment list from the mission settings (suit + itemised payload or one equipment figure). */
export function equipmentLines(mission, suit) {
  const out = [];
  if (suit) out.push({ label: `Suit: ${suit.label}`, kg: suit.massKg });
  if (mission?.payload) for (const cat of PAYLOAD_CATEGORIES) { const kg = mission.payload[cat.key]; if (kg > 0) out.push({ label: cat.label, kg }); }
  else if (mission?.equipmentKg > 0) out.push({ label: 'Equipment (not itemised)', kg: mission.equipmentKg });
  return out;
}

/**
 * Emergency reference. Only the rules this app actually applies (project-level, labelled) and the
 * NASA sources it is built on; spacesuit failure procedures are NOT modelled and are not invented.
 */
export function emergencyCards(c) {
  const s = c.route?.stats || {};
  const lim = c.limits || {};
  return [
    { key: 'abort', title: 'ABORT — WALK HOME', src: 'project',
      lines: ['Press ABORT. Walk the fastest way home (BACK time on the backup card).', 'The return path avoids a dust devil’s safety zone when it can.'] },
    { key: 'margin', title: 'MARGIN < 0 / NO RETURN', src: 'project',
      lines: ['Turn back now: home is no longer reachable inside the EVA budget.', `Rule: walk-back margin ≥ 0 at every point (budget ${Math.round((s.budgetS || 0) / 3600)} h).`] },
    { key: 'o2', title: 'O₂ BELOW RETURN NEED', src: 'project',
      lines: ['Return immediately; the rest of the plan is cancelled.', 'O₂ use from the selected scenario (NASA BVAD rates) — a model, not a sensor.'] },
    { key: 'dust', title: 'DUST DEVIL AHEAD', src: 'simulated',
      lines: ['Keep 25 m from it; take the new SAFE route to the destination.', 'No route → back to the start the way you came.'] },
    { key: 'limits', title: 'TERRAIN LIMITS', src: 'project',
      lines: [`Never on ground over ${lim.maxSlopeDeg ?? '—'}°; never over ${lim.maxRadialKm ?? '—'} km from the start; home before sunset.`] },
    { key: 'ref', title: 'SOURCES', src: 'nasa',
      lines: ['EVA limits: NASA xEVA System ConOps; Mars set from Norcross et al. 2009 and Apollo 17 planning (30-min reserve).', 'Walk-back and suit mass: Ogilvie et al., ICES 2026 (NASA). Format: Apollo 15–17 cuff checklists.'] },
    { key: 'suit', title: 'SUIT / COMMS FAILURE', src: 'project',
      lines: ['Not modelled in this prototype — no procedure is given here. Follow the flight crew procedures.'] },
  ];
}
