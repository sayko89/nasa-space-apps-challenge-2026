/**
 * Payload & Mass assessment.
 *
 * Reuses carryCheck() (config/mission.js) — the ~45 kg Earth-equivalent limit of Ogilvie et al.
 * (ICES 2026) is unchanged. Adds the breakdown of what is carried and the remaining capacity.
 *
 * No double counting: the suit mass from the study already contains the pressure garment and
 * the life-support backpack, so those can never be entered as payload. Payload mass is a
 * constraint only — no validated model of walking speed vs carried load at Mars gravity was
 * found, so carried mass does not slow the walk (walking times stay those of the EVA profile).
 * Pure: tested in Node (tests/payload.test.mjs).
 */
import { carryCheck, SUITS, MARS_G, EARTH_G } from '../config/mission.js';

/** Items the crew enters (kg, mass). */
export const PAYLOAD_CATEGORIES = [
  { key: 'instruments', label: 'Scientific instruments' },
  { key: 'comms', label: 'Communication equipment (beyond the suit radio)' },
  { key: 'sampling', label: 'Sampling equipment' },
  { key: 'emergency', label: 'Emergency supplies' },
  { key: 'other', label: 'Additional payload' },
];

/** Already inside the suit mass — shown, never added. */
export function inSuit(suitKey) {
  const s = SUITS[suitKey] || SUITS.mars;
  return suitKey === 'xemu'
    ? [{ label: 'Pressure garment + life-support backpack', note: `in the ${s.massKg} kg suit mass (study gives no split)`, status: 'sourced' },
      { label: 'Suit radio and avionics', note: 'assumed part of the life-support backpack mass', status: 'assumption' }]
    : [{ label: 'Pressure garment', note: '~42 kg of the 104 kg', status: 'sourced' },
      { label: 'Life-support backpack (PLSS)', note: '~62 kg of the 104 kg', status: 'sourced' },
      { label: 'Suit radio and avionics', note: 'assumed part of the life-support backpack mass', status: 'assumption' }];
}

/** Breakdown from the item list, or equal to the single equipment figure if not itemised. */
export function itemsFor(mission) { return mission?.payload && typeof mission.payload === 'object' ? mission.payload : null; }

/** Sum of the items (null if any is missing or invalid). */
export function payloadSum(payload) {
  let t = 0;
  for (const c of PAYLOAD_CATEGORIES) {
    const v = payload?.[c.key];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return null;
    t += v;
  }
  return t;
}

/**
 * @param {object} mission { suit, equipmentKg, payload?: { instruments, comms, sampling, emergency, other } }
 * @returns {{ status, suit, inSuit, items, equipmentKg, massKg, earthEqKg, limitKg, remainingEarthEqKg, remainingKg, invalid, summary }}
 *   status 'WITHIN LIMIT' | 'OVER LIMIT' | 'INSUFFICIENT DATA'
 */
export function payloadAssessment(mission) {
  const payload = itemsFor(mission);
  const invalid = [];
  let items = null, equipmentKg;
  if (payload) {
    items = PAYLOAD_CATEGORIES.map(c => {
      const v = payload[c.key];
      const ok = typeof v === 'number' && Number.isFinite(v) && v >= 0;
      if (!ok) invalid.push({ key: c.key, label: c.label, detail: v == null ? 'missing' : `invalid value: ${String(v)}` });
      return { ...c, kg: ok ? v : null };
    });
    equipmentKg = invalid.length ? null : payloadSum(payload);
  } else {
    const v = mission?.equipmentKg;
    if (!(typeof v === 'number' && Number.isFinite(v) && v >= 0)) invalid.push({ key: 'equipmentKg', label: 'Equipment', detail: v == null ? 'missing' : `invalid value: ${String(v)}` });
    else equipmentKg = v;
  }
  if (!SUITS[mission?.suit]) invalid.push({ key: 'suit', label: 'Suit', detail: 'unknown suit' });
  const suitKey = SUITS[mission?.suit] ? mission.suit : 'mars';
  const base = { suit: SUITS[suitKey], inSuit: inSuit(suitKey), items, invalid };
  if (invalid.length) {
    return { ...base, status: 'INSUFFICIENT DATA', equipmentKg: null, massKg: null, earthEqKg: null, limitKg: carryCheck({ suit: suitKey }).limitKg,
      remainingEarthEqKg: null, remainingKg: null, summary: `Cannot evaluate: ${invalid.map(i => `${i.label.toLowerCase()} ${i.detail}`).join('; ')}.` };
  }
  const c = carryCheck({ suit: suitKey, equipmentKg });
  const remainingEarthEqKg = c.limitKg - c.earthEqKg;
  const remainingKg = remainingEarthEqKg * EARTH_G / MARS_G;      // mass that can still be added
  return { ...base, status: c.ok ? 'WITHIN LIMIT' : 'OVER LIMIT', equipmentKg, massKg: c.massKg, earthEqKg: c.earthEqKg, limitKg: c.limitKg,
    remainingEarthEqKg, remainingKg,
    summary: c.ok ? `${c.earthEqKg.toFixed(1)} of ${c.limitKg} kg Earth-equivalent — ${remainingKg.toFixed(1)} kg of payload mass still possible.`
      : `${c.earthEqKg.toFixed(1)} kg Earth-equivalent is over the ${c.limitKg} kg limit by ${(-remainingEarthEqKg).toFixed(1)} kg (${(-remainingKg).toFixed(1)} kg of mass).` };
}
