/**
 * Oxygen consumption scenarios and settings (utils/oxygen.js).
 *
 * The rates are NASA REFERENCE values for different life-support ARCHITECTURES, not the
 * specification of any Mars suit, and not interchangeable: which one applies depends on how the
 * suit removes CO₂ and rejects heat. Source: NASA Life Support Baseline Values and Assumptions
 * Document (BVAD), NASA/TP-2015-218570/REV2, Feb 2022, §4.6.2 — figures given there for a
 * 4-hour Mars surface sortie.
 *
 * Status of the model: SOURCED reference rates × SIMULATED mission time. Nothing is measured.
 *
 * Activity link (investigated, NOT implemented): BVAD Table 4-70 gives 0.086 kg O₂ per
 * crew-member hour at an average EVA metabolic rate of 1.062 MJ/h (RQ 0.90), and Table 4-71
 * gives suited metabolic ranges (Apollo surface EVA 517–2607 kJ/h). This planner has no
 * per-activity metabolic model of its own (walking speed comes from the slope–speed shape,
 * not from metabolic rate), so scaling O₂ with activity would need a metabolic rate for each
 * activity that we cannot source per segment. The rate is therefore constant within a scenario
 * and labelled an approximation; it can be changed during the EVA.
 */

import { APOLLO17_RESERVE } from './marswalkProfile.js';

const BVAD = 'NASA/TP-2015-218570/REV2 (BVAD, Feb 2022) §4.6.2';
export const BVAD_URL = 'https://ntrs.nasa.gov/citations/20210024855';

export const O2_SCENARIOS = {
  'closed-loop': {
    label: 'Closed-loop reference', rateKgH: 0.076, kgPer4h: 0.3,
    architecture: 'completely closed-loop PLSS: only metabolic oxygen and leakage are used',
    source: BVAD, url: BVAD_URL,
  },
  'swing-bed': {
    label: 'Swing-bed CO₂ removal', rateKgH: 0.15, kgPer4h: 0.6,
    architecture: 'swing-bed CO₂ removal venting CO₂ and water to the Martian atmosphere; extra O₂ lost as sweep gas',
    source: BVAD, url: BVAD_URL,
  },
  cryogenic: {
    label: 'Cryogenic O₂ for cooling', rateKgH: 1.0, kgPer4h: 4.0,
    architecture: 'cryogenic oxygen used for thermal control as well as breathing, then vented',
    source: BVAD, url: BVAD_URL,
  },
};
export const DEFAULT_O2_SCENARIO = 'swing-bed';   // BVAD's suitport example uses an xEMU with swing-bed ullage; still only a reference

/** Oxygen reserve kept for the walk back. Configurable; default = Apollo 17 traverse-planning reserve. */
export const O2_RESERVE = {
  defaultMin: APOLLO17_RESERVE.value, min: 0, max: 120,
  source: APOLLO17_RESERVE.source, url: APOLLO17_RESERVE.url,
};

/**
 * Initial oxygen when the crew does not enter one: enough for the suit's design EVA duration at
 * the scenario rate. ASSUMPTION — no source gives a Mars-suit oxygen tank capacity.
 */
export const O2_SIZING = {
  designDurationH: 8,
  source: 'NASA EVA-EXP-0042 Rev B, xEVA Concept of Operations §4.1.4 — "EVAs of up to 8 hours"',
  status: 'assumption',
};
export const O2_INITIAL_LIMITS = { min: 0.05, max: 20 };   // kg, input range of the setup field

/**
 * Fixed vs consumable mass: the suit masses of Ogilvie et al. (ICES 2026) are taken as the
 * charged, ready-to-go suit — i.e. the oxygen load is INSIDE the suit mass. Fixed mass =
 * suit mass − initial oxygen, so the carried mass at the start equals the existing carry check
 * and oxygen is never counted twice. ASSUMPTION (the study does not split out consumables).
 */
export const O2_MASS_CONVENTION = { status: 'assumption',
  note: 'suit mass taken as charged (oxygen included); fixed mass = suit − initial O₂' };

export const DEFAULT_O2 = { scenario: DEFAULT_O2_SCENARIO, initialKg: null, reserveMin: O2_RESERVE.defaultMin };
