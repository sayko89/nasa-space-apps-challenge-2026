/**
 * Martian dust exposure & equipment reliability — evidence, components and configuration.
 *
 * QUALITATIVE ONLY. No source found gives a validated, quantitative model of how Martian dust
 * degrades spacesuit or EVA equipment over an EVA, so this file holds:
 *   - DUST_SOURCES     every source used, with how it applies to Mars (see APPLICABILITY)
 *   - DUST_COMPONENTS  seven equipment groups, each with its own failure mechanism, a
 *                      vulnerability class (low / moderate / high) and the reason for that class
 *   - DUST_OPTIONS     the crew's protection settings — categories, never percentages
 * There are no failure probabilities, protection percentages or degradation rates here, and
 * none may be added without validated experimental data (tests/dust.test.mjs checks this).
 *
 * xEMU is NASA's exploration suit developed for Artemis LUNAR surface EVAs — it is not a
 * Mars-certified suit. Lunar dust research is used as an engineering analogy only.
 */

/** How a source relates to Mars. Lunar and analog evidence is never presented as Mars validation. */
export const APPLICABILITY = {
  'mars-direct': { label: 'Direct Mars evidence', color: '#ff9966',
    note: 'measured on Mars (rover, orbiter) — still not a test of spacesuit equipment unless stated' },
  'lunar-analogy': { label: 'Lunar research — analogy', color: '#9ab8ff',
    note: 'Apollo experience or lunar-simulant tests; lunar and Martian dust differ (NASA: lunar mitigation "might not be directly applicable to Martian dust")' },
  'mars-analog': { label: 'Mars analog field research', color: '#c8a0ff',
    note: 'Earth site resembling Mars — not a Mars surface measurement' },
  'project-assumption': { label: 'Project assumption', color: '#c8c8a0',
    note: 'a choice made by this project, stated so it can be challenged' },
};

export const DUST_SOURCES = [
  {
    id: 'gaier2005', title: 'The Effects of Lunar Dust on EVA Systems During the Apollo Missions',
    program: 'Apollo (NASA Glenn Research Center review)', author: 'Gaier, J. R.', date: '2005-03',
    ref: 'NASA/TM-2005-213610', url: 'https://ntrs.nasa.gov/citations/20050160460',
    applicability: 'lunar-analogy',
    context: 'Review of mission documents from the six Apollo landings: what dust did to the suits and EVA systems.',
    finding: 'Nine kinds of dust effect: reduced visibility, false instrument readings, dust coating and contamination, loss of traction, '
      + 'clogging of mechanisms, abrasion, thermal-control problems, seal failures, inhalation and irritation. Simple mitigation '
      + 'worked for some (e.g. traction) but not for clogging, abrasion and reduced heat rejection; ground tests under-predicted the severity.',
    relevance: 'The only flight record of dust on suits and EVA hardware — the basis for which mechanisms matter.',
    limitations: 'Lunar regolith, a few-day missions, 1960s–70s suits. Martian dust differs (weathered, wind-blown, in an atmosphere).',
  },
  {
    id: 'jones2025', title: 'Artemis Suit Material Project Overview',
    program: 'Artemis suit materials (NASA JSC)', author: 'Jones, McFarland, Rodgers-Ahnen, Rhodes', date: '2025-07',
    ref: 'ICES-2025-56', url: 'https://ntrs.nasa.gov/api/citations/20250003726/downloads/ICES-2025-56%20Artemis%20Suit%20Material%20Overview%20FINAL.pdf',
    applicability: 'lunar-analogy',
    context: 'Laboratory tests of the outer-layer fabric of the environmental protection garment (EPG) against lunar simulant.',
    finding: 'Baseline Ortho-Fabric (EMU outer layer) showed "significant deficiencies in dust repellency and abrasion resistance": after an '
      + '8-hour tumbler test with simulant NU-LHT-4M it lost 40 % of its warp tensile strength and let ~165 g/m² of simulant pass through.',
    relevance: 'Outer-layer abrasion and dust penetration at moving parts of the suit (joints).',
    limitations: 'Lunar simulant in a tumbler, not Martian dust or a real EVA; the numbers describe that test, not an EVA on Mars, and are not used in any calculation here.',
  },
  {
    id: 'evagap2020', title: 'EVA System Maturation Team Gap List',
    program: 'NASA EVA Systems (xEMU development)', author: 'NASA', date: '2020-01',
    ref: '2020 EVA gap list', url: 'https://www.nasa.gov/sites/default/files/atoms/files/2020_eva_gap_list.pdf',
    applicability: 'lunar-analogy',
    context: 'NASA\'s list of open technology gaps for exploration EVA, with the xEMU status of each.',
    finding: 'Open gaps include dust-tolerant pressure-enclosure bearings (designs being added to the xEMU), dust-tolerant mechanisms '
      + '(relief / purge valves, disconnects, actuators — limited effort for the xEMU), dust-tolerant quick disconnects (not actively worked), '
      + 'a scratch-resistant visor, a lunar EPG shell material, and the unknown Martian dust properties (incl. perchlorates) needed to set requirements.',
    relevance: 'Shows which protections are design goals and which are open problems — none is a Mars-validated capability.',
    limitations: 'A status list (2020), not test results. The xEMU targets the Moon and is not Mars-certified.',
  },
  {
    id: 'litofsky2026', title: 'Dust Mitigation Technology Roadmap (Rev C)',
    program: 'NASA JSC dust mitigation (LSIC Spring 2026)', author: 'Litofsky, J.', date: '2026',
    ref: 'NTRS 20260001844', url: 'https://ntrs.nasa.gov/api/citations/20260001844/downloads/Dust%20Mitigation%20Roadmap%20Rev%20C.pdf',
    applicability: 'lunar-analogy',
    context: 'Roadmap of dust-mitigation technologies: coatings, active cleaning, seals, covers, connectors.',
    finding: 'Lists flexible dust covers for rotary / linear / ball joints of rovers and robots, dust-tolerant bearings and seals, and '
      + 'dust-tolerant quick disconnects, umbilicals and connectors as open gaps; states that "dust mitigation technologies for the moon '
      + 'might not be directly applicable to Martian dust".',
    relevance: 'Available protection types (covers, seals, coatings) and their maturity.',
    limitations: 'Mostly lunar; no quantitative spacesuit results.',
  },
  {
    id: 'sherloc2025', title: 'How NASA\'s Perseverance Is Helping Prepare Astronauts for Mars',
    program: 'Mars 2020 Perseverance — SHERLOC calibration target', author: 'NASA JPL', date: '2025-03-26',
    ref: 'JPL news release', url: 'https://www.jpl.nasa.gov/news/how-nasas-perseverance-is-helping-prepare-astronauts-for-mars/',
    applicability: 'mars-direct',
    context: 'Five 20 mm swatches of spacesuit material (polycarbonate visor, Vectran, two Teflons, Ortho-Fabric) exposed on the rover since 2021.',
    finding: 'About 50 % of the changes SHERLOC has seen in the samples happened within the first 200 days on Mars; Vectran appeared to change first. '
      + 'Mars\' strong ultraviolet is expected to weather materials faster than on Earth.',
    relevance: 'The only spacesuit materials exposed on the Martian surface: confirms the outer layer and visor materials change there.',
    limitations: 'Per-material results not yet published; measures exposure on the rover (mostly UV), not abrasion or dust intrusion in an EVA.',
  },
  {
    id: 'kass2016', title: 'NASA Mars Orbiters Reveal Seasonal Dust Storm Pattern',
    program: 'Mars Reconnaissance Orbiter — Mars Climate Sounder', author: 'NASA JPL (Kass et al., GRL)', date: '2016-06-09',
    ref: 'JPL news release', url: 'https://www.jpl.nasa.gov/news/nasa-mars-orbiters-reveal-seasonal-dust-storm-pattern/',
    applicability: 'mars-direct',
    context: 'Several Mars years of orbital atmospheric temperature and dust observations.',
    finding: 'Large regional dust storms recur each year in southern spring and summer, "the dustiest part of the Martian year" '
      + '(southern spring and summer = solar longitude Ls 180°–360°).',
    relevance: 'Dusty season of the EVA date — an exposure factor, not a forecast of a storm on that day.',
    limitations: 'Seasonal pattern only; it cannot say whether dust will be lifted at the site on the EVA day.',
  },
  {
    id: 'edwards2021', title: 'THEMIS-derived Thermal Inertia of Jezero Crater, Mars',
    program: '2001 Mars Odyssey — THEMIS', author: 'Edwards, C. S. & Buz, J.', date: '2021',
    ref: 'doi:10.5281/zenodo.4931348', url: 'https://doi.org/10.5281/zenodo.4931348',
    applicability: 'mars-direct',
    context: 'Thermal-inertia map used for the Jezero thermal layer (already in the app).',
    finding: 'Thermal inertia below 150 J m⁻² K⁻¹ s⁻½ is classed as dust / fine sand (rough classes after Putzig & Mellon 2007).',
    relevance: 'Whether the route crosses ground mantled with dust — Jezero only.',
    limitations: '100 m pixels; a thin dust coating on rock does not show up.',
  },
  {
    id: 'wang2025', title: 'Potential Health Impacts, Treatments, and Countermeasures of Martian Dust on Future Human Space Exploration',
    program: 'GeoHealth (AGU), peer-reviewed review', author: 'Wang, J. L. et al.', date: '2025-02-21',
    ref: 'NTRS 20250000969', url: 'https://ntrs.nasa.gov/citations/20250000969',
    applicability: 'mars-direct',
    context: 'Review of Martian dust composition (from Mars missions) and the diseases similar substances cause on Earth.',
    finding: 'Very fine grains with perchlorates, silica, nanophase iron oxides and gypsum; exposure mitigation should come first.',
    relevance: 'Why dust carried into the rover or habitat on suits and tools matters — crew health, not equipment.',
    limitations: 'Health review; says nothing about equipment reliability.',
  },
  {
    id: 'marsv', title: 'MARS-V — Mars analog station in the Gobi Desert (press coverage)',
    program: 'MARS-V (Mongolian non-governmental organisation; Mars Society named as partner)', author: 'Universe Magazine; CNN', date: '2025-10',
    ref: 'press articles', url: 'https://localnews8.com/life/cnn-style/2025/10/23/inside-mongolias-mars-camp-the-extreme-adventure-that-wants-to-turn-tourists-into-astronauts/',
    applicability: 'mars-analog',
    context: 'Planned analog station in the Gobi (Dundgovi / Umnugovi) where crews test analog spacesuit prototypes in wind and dust; public opening planned for 2029.',
    finding: 'No results published: the station is described as in early development. NASA involvement is not described.',
    relevance: 'Reviewed and NOT used for any classification here — a possible future source of field data.',
    limitations: 'Earth analog with no published data; not a Mars surface measurement.',
  },
  {
    id: 'project', title: 'This project\'s classification rules', program: 'Martian Map', author: 'Team PERIAPSIS', date: '2026-11',
    ref: 'config/dust.js', url: null, applicability: 'project-assumption',
    context: 'How the evidence above is turned into the categories shown.',
    finding: 'Vulnerability classes are ranked from the failure mechanisms Apollo reported and the open NASA gaps; they are not measured on Mars. '
      + 'Protection settings do not lower a class, because no protection is validated against Martian dust.',
    relevance: 'Makes the reasoning visible.',
    limitations: 'Qualitative; a team judgement on published evidence.',
  },
];

export const sourceById = (id) => DUST_SOURCES.find(s => s.id === id) || null;

/**
 * Crew-selectable protection settings. Every option is a category; 'unknown' is explicit and is
 * reported as missing information, never treated as protected.
 */
export const DUST_OPTIONS = {
  outerLayer: {
    label: 'Suit outer layer', default: 'unknown',
    options: {
      'ortho-fabric': { label: 'Ortho-Fabric (EMU baseline)', protects: false,
        note: 'Tested with lunar simulant: deficient in dust repellency and abrasion resistance (Jones 2025)' },
      'epg-development': { label: 'New EPG material (in development)', protects: true,
        note: 'NASA is developing replacement outer-layer materials; no published Mars or long-duration results' },
      unknown: { label: 'Not specified', protects: null },
    },
  },
  jointProtection: {
    label: 'Joint & bearing protection', default: 'unknown',
    options: {
      'dust-tolerant': { label: 'Dust-tolerant bearings', protects: true,
        note: 'xEMU design goal for the Moon (EVA gap list 2020); no Mars validation' },
      standard: { label: 'Standard bearings', protects: false },
      unknown: { label: 'Not specified', protects: null },
    },
  },
  equipmentProtection: {
    label: 'Equipment dust protection', default: 'unknown',
    options: {
      enclosed: { label: 'Instruments enclosed / sealed', protects: true,
        note: 'sealed housings and windows; no Mars-dust test data cited for EVA tools' },
      exposed: { label: 'Instruments exposed', protects: false },
      unknown: { label: 'Not specified', protects: null },
    },
  },
  covers: {
    label: 'Protective covers', default: 'unknown',
    options: {
      fitted: { label: 'Covers on connectors, optics, mechanisms', protects: true,
        note: 'flexible covers for joints / interfaces are on NASA\'s roadmap (Litofsky 2026); not validated against Martian dust' },
      none: { label: 'No covers', protects: false },
      unknown: { label: 'Not specified', protects: null },
    },
  },
};

export const DEFAULT_DUST = Object.fromEntries(Object.entries(DUST_OPTIONS).map(([k, o]) => [k, o.default]));

/**
 * Seven equipment groups, assessed separately. `protectedBy` names the setting that covers it.
 * `warning` is shown when the group is unprotected (high) or, for optics and tools, exposed.
 * Classes: high = a mechanism Apollo reported as NOT solved by simple mitigation (clogging,
 * abrasion, seal failure) and still an open NASA gap; moderate = a mechanism Apollo reported but
 * where the part is meant to touch dust or can be cleaned / inspected in the field; low = (none
 * of these seven qualifies on the evidence found).
 */
export const DUST_COMPONENTS = [
  {
    key: 'joints', name: 'Spacesuit joints (soft goods)', protectedBy: 'outerLayer', vulnerability: 'high',
    warning: 'Unprotected joints may require inspection or maintenance.',
    mechanism: 'Abrasion of the outer fabric where it flexes; dust penetrating the layers.',
    rationale: 'Abrasion was one of the effects simple mitigation did not solve on Apollo; the baseline outer fabric lost strength and let simulant through in lunar tests.',
    precautions: ['Inspect the outer layer at knees, elbows and shoulders after the EVA', 'Brush / clean the suit before entering the rover or habitat'],
    evidence: ['gaier2005', 'jones2025', 'sherloc2025'], confidence: 'low',
    uncertainty: 'Lunar simulant tests; on Mars only material exposure (mostly UV) is measured — abrasion by Martian dust is not.',
  },
  {
    key: 'bearings', name: 'Bearings & mechanical interfaces (suit)', protectedBy: 'jointProtection', vulnerability: 'high',
    warning: 'Exposed mechanical interfaces may be vulnerable to regolith intrusion.',
    mechanism: 'Regolith entering bearing races of the pressure enclosure: stiff joints, wear, seal damage.',
    rationale: 'Clogged mechanisms and seal failures were reported on Apollo; dust-tolerant pressure bearings are an enabling NASA gap.',
    precautions: ['Check joint torque / range of motion after the EVA', 'Plan bearing inspection and maintenance between EVAs'],
    evidence: ['gaier2005', 'evagap2020', 'litofsky2026'], confidence: 'low',
    uncertainty: 'No Mars data; dust-tolerant designs are a lunar development goal.',
  },
  {
    key: 'connectors', name: 'External connectors & quick disconnects', protectedBy: 'covers', vulnerability: 'high',
    warning: 'External connectors may not mate or seal if dust reaches them — keep them capped until use.',
    mechanism: 'Dust on mating faces and seals: hard mating, leaks, poor electrical contact.',
    rationale: 'Seal failures were reported on Apollo; dust-tolerant quick disconnects and connectors remain open NASA gaps.',
    precautions: ['Keep caps / covers on until mating', 'Inspect and clean seals before every mating'],
    evidence: ['gaier2005', 'evagap2020', 'litofsky2026'], confidence: 'low',
    uncertainty: 'No Martian-dust test of EVA connectors was found.',
  },
  {
    key: 'sampling', name: 'Sampling instruments & tools', protectedBy: 'equipmentProtection', vulnerability: 'moderate',
    warning: 'Exposed sampling tools may clog at hinges and container seals.',
    mechanism: 'Dust coating; clogging of hinges and sample-container seals.',
    rationale: 'Tools are meant to touch regolith, so coating alone is expected; the risk is in their moving parts and container seals (Apollo reported both clogging and seal failures).',
    precautions: ['Stow sample containers closed between stops', 'Check tool hinges and container seals at each stop'],
    evidence: ['gaier2005'], confidence: 'low',
    uncertainty: 'Depends on the tool design; no Mars tool data.',
  },
  {
    key: 'optics', name: 'Cameras & optical surfaces (incl. helmet visor)', protectedBy: 'covers', vulnerability: 'moderate',
    warning: 'Optical surfaces may require additional protection.',
    mechanism: 'Dust settling on lenses and the visor: reduced visibility; scratching when wiped.',
    rationale: 'Reduced visibility and dust coating were reported on Apollo; a scratch-resistant visor is an open gap; on Mars the polycarbonate visor material is among the samples changing on Perseverance. Moderate because the effect can be seen and cleaned in the field.',
    precautions: ['Keep lens covers on when not imaging', 'Check visor and camera windows at each stop'],
    evidence: ['gaier2005', 'evagap2020', 'sherloc2025'], confidence: 'low',
    uncertainty: 'No rate of dust settling on optics during an EVA is used — none was found for EVA conditions.',
  },
  {
    key: 'rover', name: 'Rover interfaces (hatch, seals, umbilicals)', protectedBy: 'covers', vulnerability: 'high',
    warning: 'Rover hatch seals and umbilicals may be contaminated by dust carried on suits — clean before ingress.',
    mechanism: 'Dust carried on suits into hatches and seals; contaminated umbilical connectors; dust brought inside.',
    rationale: 'Seal failures on Apollo; dust-tolerant umbilicals are an open gap; dust carried inside is a crew-health concern on Mars.',
    precautions: ['Clean suits and tools before ingress', 'Inspect hatch seals after the EVA'],
    evidence: ['gaier2005', 'litofsky2026', 'wang2025'], confidence: 'low',
    uncertainty: 'Rover and hatch design not specified in this project.',
  },
  {
    key: 'mechanisms', name: 'Exposed moving mechanisms (valves, latches, actuators)', protectedBy: 'covers', vulnerability: 'high',
    warning: 'Exposed valves, latches and actuators may jam with dust — function-check them after the EVA.',
    mechanism: 'Dust jamming moving parts: relief / purge valves, latches, actuators.',
    rationale: 'Clogged mechanisms were among the effects Apollo could not solve with simple mitigation; dust-tolerant mechanisms had only limited effort for the xEMU.',
    precautions: ['Operate exposed mechanisms as little as possible in dust', 'Function-check valves and latches after the EVA'],
    evidence: ['gaier2005', 'evagap2020'], confidence: 'low',
    uncertainty: 'No Mars data.',
  },
];

/** Dusty season: southern spring and summer (Kass et al. 2016, JPL). */
export const DUSTY_SEASON_LS = { from: 180, to: 360, source: 'kass2016' };
/** Thermal-inertia class that marks dust-mantled ground (Edwards & Buz 2021 interpretation table). */
export const DUST_TI_MAX = { value: 150, source: 'edwards2021' };
