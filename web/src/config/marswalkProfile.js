/**
 * Marswalk (astronaut EVA) parameters — single source of truth.
 *
 * Every value: { value, unit, status, label, source, quote?, note? }
 *   status: 'sourced'     → from a NASA document; `source` + `quote` filled in
 *           'assumption'  → a sourced model adapted to this problem;
 *                           `note` states exactly what is assumed
 *           'design'      → a planning preference (not a physical claim)
 *           'placeholder' → TEMPORARY, must not be used in a presentation
 *
 * IMPORTANT LIMITATION: the NASA EVA operations values we could find were
 * written for the MOON (xEVA ConOps). No official Mars-specific slope / speed /
 * distance limit was found. NASA's suited walking test found a walk-back at
 * Mars gravity (3/8 g) not acceptable (TP-2009-214796), so treat these values
 * as OPTIMISTIC for Mars. See MARS_CAVEAT.
 */

const XEVA = 'NASA EVA-EXP-0042 Rev B, Exploration EVA System Concept of Operations (2020)';
const XEVA_URL = 'https://www.nasa.gov/wp-content/uploads/2017/02/eva-exp-0042_xeva_system_con_ops_rev_b_final_dtd_10192020_ref_doc.pdf';

export const MARSWALK_PROFILE = {
  maxWalkableSlopeDeg: {
    value: 20,
    unit: 'deg',
    status: 'sourced',
    label: 'max walkable slope',
    source: `${XEVA} §4.2.1.3`,
    url: XEVA_URL,
    quote: 'Walking up/down/across a slope of up to 20°',
    note: 'Lunar ConOps value. DEM cells steeper than this are impassable walls.',
  },
  levelWalkSpeedKmh: {
    value: 2.0,
    unit: 'km/h',
    status: 'sourced',
    label: 'level walking speed',
    source: `${XEVA} §4.2.1.3.1.1`,
    url: XEVA_URL,
    quote: 'Traverses assume an ~2 km/hr walking pace over relatively level regolith',
    note: 'Marked TBR (to be resolved) in the document.',
  },
  evaDurationH: {
    value: 8,
    unit: 'h',
    status: 'sourced',
    label: 'EVA duration budget',
    source: `${XEVA} §4.1.4`,
    url: XEVA_URL,
    quote: 'The xEVA suit will support EVAs of up to 8 hours in duration (6±2 hours).',
    note: 'Planning budget. The extra hour of secondary O₂ (§4.2.1.1) is for emergencies only and is not planned against.',
  },
  maxRadialDistanceKm: {
    value: 2,
    unit: 'km',
    status: 'sourced',
    label: 'max walking distance from the habitat',
    source: `${XEVA} §4.2.1.3.1`,
    url: XEVA_URL,
    quote: 'a walking traverse of up to 2 km away from the lander on the lunar surface (radial distance)',
  },
  maxRockReliefM: {
    value: 0.5,
    unit: 'm',
    status: 'design',
    source: 'Rock relief from the 1 m HiRISE DTM (pipeline/build_layers.py)',
    note: 'Cells whose relief (after removing the local slope) exceeds this are treated as boulders / outcrops the crew walks around. '
        + 'No sourced suited-EVA obstacle height was found; 0.5 m is a planning choice. The 1 m DTM resolves rocks of a few metres only.',
  },
  slopeSpeedModel: {
    value: 'tobler',
    unit: null,
    status: 'assumption',
    label: 'walking speed vs. slope (Tobler shape)',
    source: 'Tobler, W. (1993). Three presentations on geographical analysis and modeling. NCGIA Technical Report 93-1.',
    note: 'No NASA data on how slope changes suited walking speed was found. Tobler\'s hiking function '
        + '(Earth, unsuited) is used for its SHAPE only: '
        + 'v(g) = v0 · exp(-3.5·|g + 0.05|) / exp(-3.5·0.05), with v0 = levelWalkSpeedKmh on level ground.',
  },
};

/**
 * Crew size: EVAs are planned as a two-person crew (EV1 + EV2). Lunar concept,
 * used here for Mars. Only the visual crew and the HUD use this.
 */
export const EVA_CREW = {
  value: 2,
  status: 'sourced',
  label: 'EVA crew (EV1 + EV2)',
  source: 'NASA, EVA Lunar Surface Concept of Operations (2020) — notional Design Reference EVA with EV1/EV2',
  url: 'https://www.nasa.gov/wp-content/uploads/2020/01/topic_1-_eva_lunar_surface_concept_of_operations.pdf',
};

/**
 * Route-mode preference weights — NOT physical claims, planning preferences.
 * Reported times use the same physical model (Tobler shape + NASA speed) in
 * every mode; these weights only change which path is chosen.
 *   slopeAversion: cell time × (1 + k·(slope/limit)²)  — stay away from steep ground
 *   climbPenaltyS: extra penalty per metre climbed [s]   — climb less
 */
export const MODE_WEIGHTS = {
  FAST: { slopeAversion: 0,   climbPenaltyS: 0,  status: 'design', desc: 'Shortest walking time' },
  SAFE: { slopeAversion: 4,   climbPenaltyS: 0,  status: 'design', desc: 'Stays farthest from the slope limit' },
  ECO:  { slopeAversion: 0.5, climbPenaltyS: 60, status: 'design', desc: 'Least climbing (energy / heat load)' },
  AUTO: { slopeAversion: 1.5, climbPenaltyS: 20, status: 'design', desc: 'Balanced' },
};

/**
 * Science EVA (Stage 6). No sourced stop duration or science-value scale was
 * found — all design choices / assumptions, labelled as such in the UI.
 *   dwellMin     : sampling / observation time per stop [min] (user adjustable)
 *   weights      : points per distinct tag (diversity); contact = boundary of two bedrock units
 *   interiorR    : cells in every direction that must be the same unit to count as "inside" it
 *   minHomeDistM : cells closer than this to the habitat are not stop candidates
 *   maxCandidates: nearest candidates that enter the exact (Held–Karp) optimisation
 *   maxChemCandidates: extra "re-sample" candidates at rocks whose ChemCam chemistry stands out
 *                  (> 2 × RMSEP from their layer's mean); chemistry weight per distinct anomaly
 */
export const SCIENCE_PARAMS = {
  dwellMin: 20,
  weights: { bedrock: 2, surface: 1, contact: 3, mineral: 2, chemistry: 2 },
  interiorR: 2,
  minHomeDistM: 20,
  maxCandidates: 12,
  maxChemCandidates: 2,
  status: 'design',
};

export const MARS_CAVEAT = {
  source: 'Norcross et al., NASA/TP-2009-214796, Feasibility of Performing a Suited 10-km Ambulation on the Moon',
  url: 'https://www.lpi.usra.edu/lunar/artemis/NorcrossEtAl_NASA-TP-2009-214796_EVA%20Walkback%20Test.pdf',
  note: 'A 10 km suited walk-back was found feasible at lunar gravity but not acceptable at Mars gravity (3/8 g): '
      + 'subjects worked near maximum effort to keep the pace. The lunar ConOps limits are optimistic for Mars.',
};

/** Numeric value of a parameter (UI and models use this). */
export function param(key) {
  return MARSWALK_PROFILE[key].value;
}

/** Parameters with no source yet (placeholder) — for the HUD warning. */
export function placeholderParams() {
  return Object.entries(MARSWALK_PROFILE)
    .filter(([, p]) => p.status === 'placeholder')
    .map(([k]) => k);
}

/** Parameters marked as assumptions — shown separately in the HUD. */
export function assumptionParams() {
  return Object.entries(MARSWALK_PROFILE)
    .filter(([, p]) => p.status === 'assumption')
    .map(([k]) => k);
}
