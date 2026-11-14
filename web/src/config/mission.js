/**
 * Mission options the crew picks before planning: which suit, how much equipment,
 * and whether a pressurized rover parks at the start point as a safe haven.
 *
 * Sourced numbers come from NASA's Mars suit mass study (Ogilvie et al., ICES 2026,
 * NTRS 20260005410). Their sizing logic: on Mars a suited astronaut carries the suit's
 * weight; what a crew member can carry is the NIOSH lifting limit (~23 kg) plus ~22 kg
 * that suit pressure offsets, i.e. ~45 kg Earth-equivalent.
 */

import { DEFAULT_O2 } from './oxygen.js';

export const MARS_G = 3.711;      // m/s²
export const EARTH_G = 9.80665;   // m/s²

const ICES = 'Ogilvie et al. (2026), Mars Spacesuit Mass Requirements, ICES-2026, NASA NTRS 20260005410';
const ICES_URL = 'https://ntrs.nasa.gov/citations/20260005410';

export const SUITS = {
  mars: { label: 'Mars suit (target)', massKg: 104, source: ICES, url: ICES_URL,
    note: 'Mass NASA derives for a Mars-capable suit: ~42 kg pressure garment + ~62 kg life-support backpack.' },
  xemu: { label: 'Lunar xEMU', massKg: 170, source: ICES, url: ICES_URL,
    note: 'Current lunar suit mass used as the baseline in the same study. The xEMU is developed for Artemis lunar EVAs — not a Mars-certified suit.' },
};

export const CARRY = {
  liftLimitKg: { value: 23, source: `${ICES} (NIOSH lifting limit)`, url: ICES_URL },
  pressureOffsetKg: { value: 22, source: `${ICES} (load offset by suit pressure)`, url: ICES_URL },
};

export const ROVER = {
  walkbackMin: { value: 30, status: 'sourced', source: `${ICES}: 30-minute walkback limit for rover excursions`, url: ICES_URL },
  driveSpeedKmh: { value: 10, status: 'design', note: 'Average pressurized-rover driving speed for the drive-time estimate. Planning choice.' },
};

/** Default mission settings (UI state). */
// payload: null = one equipment figure; { instruments, comms, sampling, emergency, other } = itemised (utils/payload.js)
// dust: protection settings, all 'unknown' until the crew states them (config/dust.js)
// o2: oxygen scenario, initial oxygen (null = sized), reserve (config/oxygen.js)
export const DEFAULT_MISSION = { suit: 'mars', equipmentKg: 10, rover: false, limits: 'lunar', obstacleBuffer: false,
  payload: null, dust: { outerLayer: 'unknown', jointProtection: 'unknown', equipmentProtection: 'unknown', covers: 'unknown' },
  o2: { ...DEFAULT_O2 } };

/**
 * Carried-weight check: suit + equipment weight on Mars, as Earth-equivalent kg,
 * against lift limit + pressure offset.
 */
export function carryCheck(m) {
  const suit = SUITS[m?.suit] || SUITS.mars;
  const massKg = suit.massKg + Math.max(0, m?.equipmentKg || 0);
  const earthEqKg = massKg * MARS_G / EARTH_G;
  const limitKg = CARRY.liftLimitKg.value + CARRY.pressureOffsetKg.value;
  return { suit, massKg, earthEqKg, limitKg, ok: earthEqKg <= limitKg,
    maxEquipmentKg: Math.max(0, limitKg * EARTH_G / MARS_G - suit.massKg) };
}

/**
 * What the science stop optimiser depends on besides the objective: EVA limit set (budget, radius,
 * speed), obstacle buffer (walls), rover walk-back and time per stop. A science plan made under a
 * different key is flagged as made for other settings (the route and decision are re-planned anyway).
 */
export function sciencePlanKey(m, dwellMin) {
  return `${m?.limits || 'lunar'}|${!!m?.obstacleBuffer}|${!!m?.rover}|${dwellMin}`;
}

/** Straight-line drive estimate from the habitat (site centre) to the rover parking point. */
export function roverDrive(x, z) {
  const km = Math.hypot(x, z) / 1000;
  return { km, minutes: km / ROVER.driveSpeedKmh.value * 60 };
}
