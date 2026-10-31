/**
 * Dust hazard state + configuration model.
 */

import { IS_DEM } from '../three/terrainGenerator.js';

export const DUST_STATES = {
  NORMAL: 'normal',
  PLACEMENT: 'dust_placement_mode',
  PRESENT: 'dust_present',
  INTERFERENCE: 'dust_interference_detected',
  SIGNAL_LOST: 'signal_lost',
  STOPPED: 'stopped',
  RETURN_HOME: 'return_to_home',
};

// DEM (2 km Mars site): the hazard is a dust devil, drawn at a map-readable
// size (illustrative radius, not a measured value); Moon: 8 m dust cloud.
export const DUST_HAZARD_CONFIG = {
  visibleRadius: IS_DEM ? 35 : 8,
  interferenceRadiusScale: 1.35,
  criticalRadiusScale: 1.0,
  pathInfluenceScale: 1.05,
  pathArmedDistanceScale: 1.45,
  sensorConeDeg: 60,
  sensorRangeScale: 1.35,
  triggerPersistenceTicks: 6,
};

// DEM: site center = landing site (pipeline centers the grid on it).
export const DEFAULT_HOME = IS_DEM ? { x: 0, z: 0 } : { x: -25, z: -20 };

export function createDustHazard(x, z, config = DUST_HAZARD_CONFIG) {
  return {
    x,
    z,
    radius: config.visibleRadius,
    interferenceRadius: config.visibleRadius * config.interferenceRadiusScale,
    criticalRadius: config.visibleRadius * config.criticalRadiusScale,
    opacity: 0.5,
    intensity: 1,
    active: true,
    createdAt: Date.now(),
  };
}
