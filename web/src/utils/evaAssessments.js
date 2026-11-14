/**
 * One route → decision + the three separate assessments + oxygen, and the mission export (pure: no React).
 * Every view (panel, EVA HUD, cuff card, JSON export) calls these with the current mission, so none can be stale.
 */
import { localToLatLon } from '../terrain/siteData.js';
import { spaceWeatherAt, radiationIsLocal } from './radiation.js';
import { findObjective } from '../config/objectives.js';
import { buildStopCard } from './stopCards.js';
import { provenanceFor } from '../config/provenance.js';
import { getHazardMap } from './heatmaps.js';
import { missionDecision } from './missionStatus.js';
import { routeHazards } from './hazards.js';
import { payloadAssessment } from './payload.js';
import { dustAssessment } from './dust.js';
import { mobilityAssessment } from './mobility.js';
import { oxygenConfig, planOxygenCheck } from './oxygen.js';
import { worldToGrid } from './pathfinder.js';
import { SCIENCE_PARAMS, param, EVA_PROFILES, getEvaProfile } from '../config/marswalkProfile.js';
import { GRID_RES, SITE } from '../three/terrainGenerator.js';


export const cellIdx = (x, z) => { const { col, row } = worldToGrid(x, z); return row * GRID_RES + col; };

/** Mission export (JSON): objective, stop cards, decision and provenance next to the routes. */
export function missionExport({ science, mission, routes, activeRoute, startMs }) {
  const obj = findObjective(SITE.name, science?.objectiveId);
  const cards = science ? science.stops.map((st, i) => buildStopCard(st, i + 1, {
    objective: obj, weights: science.weights || SCIENCE_PARAMS.weights, dwellS: science.dwellS,
    site: { geologyDerived: SITE.geology?.source?.kind === 'derived' },
    limits: { maxSlopeDeg: param('maxWalkableSlopeDeg'), maxRockReliefM: param('maxRockReliefM') }, latLon: localToLatLon,
  })) : [];
  const wx = Number.isFinite(startMs) ? spaceWeatherAt(SITE.spaceWeather, startMs) : null;
  const decisions = routes ? Object.fromEntries(Object.entries(routes).filter(([, r]) => r?.stats?.checks)
    .map(([m, r]) => [m, routeDecision(r, { wx, live: false, future: startMs > Date.now() }, { mission, startMs })])) : null;
  const active = routes?.[activeRoute] ? evaAssessments(routes[activeRoute], { wx, live: false, future: startMs > Date.now() }, { mission, startMs }) : null;
  return {
    objective: obj ? { id: obj.id, name: obj.name, purpose: obj.purpose, uncertainty: obj.uncertainty, availability: obj.availability } : null,
    mission, evaStartUtc: Number.isFinite(startMs) ? new Date(startMs).toISOString() : null,
    stopCards: cards, decisions, activeDecision: decisions?.[activeRoute] || null,
    assessments: active ? { payload: active.payload, dust: active.dust && { status: active.dust.status, level: active.dust.level, exposure: active.dust.exposure,
      warnings: active.dust.warnings, missing: active.dust.missing,
      components: active.dust.components.map(({ key, name, vulnerability, mechanism, protection, evidence, confidence }) => ({ key, name, vulnerability, mechanism, protection: protection.state, evidence, confidence })) },
      mobility: active.mobility, oxygen: active.oxygen } : null,
    provenance: provenanceFor(SITE.name, SITE).map(({ key, name, category, available, instrument, source, observed, reason }) =>
      ({ key, name, category, available, instrument, source, observed, ...(available ? {} : { reason }) })),
  };
}

/** Decision for one route, from the planner's stats + the shared space-weather lookup. */
export function routeDecision(r, wxState, extra = {}) {
  return evaAssessments(r, wxState, extra)?.decision || null;
}

/** Decision + the three separate assessments (payload, dust, terrain & mobility) for one route. */
export function evaAssessments(r, wxState, { mission = null, startMs = null } = {}) {
  const s = r?.stats;
  if (!s || s.walkTimeS === undefined) return null;
  const hz = getHazardMap();
  const hazards = hz && r.path ? routeHazards(r.path, hz.cls, (x, z) => cellIdx(x, z)) : undefined;
  const payload = mission ? payloadAssessment(mission) : null;
  const dust = mission ? dustAssessment({ dust: mission.dust, startMs, stopCount: s.stopCount,
    dustGroundShare: s.layers?.thermal ? s.layers.thermal.dustShare : null, site: SITE.name }) : null;
  const oxygen = mission ? planOxygenCheck(oxygenConfig(mission), s) : null;
  const decision = missionDecision(s, {
    limits: { maxSlopeDeg: param('maxWalkableSlopeDeg'), maxRadialM: param('maxRadialDistanceKm') * 1000 },
    wx: wxState?.wx || null, wxLive: wxState?.live, startFuture: wxState?.future,
    radiationLocal: radiationIsLocal(), hazards,
    ...(payload ? { payload } : {}), ...(dust ? { dust } : {}), ...(oxygen ? { oxygen } : {}),
  });
  const prof = EVA_PROFILES[getEvaProfile()];
  const mobility = mobilityAssessment(s, decision, { hazards,
    profile: { label: prof.label, levelWalkSpeedKmh: param('levelWalkSpeedKmh'), source: getEvaProfile() === 'mars' ? 'Norcross et al. 2009, NASA/TP-2009-214796' : 'NASA xEVA ConOps' } });
  return { decision, payload, dust, mobility, oxygen };
}
