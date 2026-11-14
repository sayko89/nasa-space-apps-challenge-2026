/** Stop cards for a science plan with the app's context (shared by the science panel and the inspector). */
import { findObjective } from '../config/objectives';
import { buildStopCard } from '../utils/stopCards';
import { SCIENCE_PARAMS, param } from '../config/marswalkProfile';
import { localToLatLon } from '../terrain/siteData';
import { SITE } from '../three/terrainGenerator';

export function scienceStopCards(science) {
  if (!science) return [];
  return science.stops.map((st, i) => buildStopCard(st, i + 1, {
    objective: findObjective(SITE.name, science.objectiveId), weights: science.weights || SCIENCE_PARAMS.weights,
    dwellS: science.dwellS, site: { geologyDerived: SITE.geology?.source?.kind === 'derived' },
    limits: { maxSlopeDeg: param('maxWalkableSlopeDeg'), maxRockReliefM: param('maxRockReliefM') },
    latLon: localToLatLon,
  }));
}
