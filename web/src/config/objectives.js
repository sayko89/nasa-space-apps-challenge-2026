/**
 * Mission objectives — what the science EVA is for. Choosing one changes the planner itself:
 * `plan.filter` decides which candidate stops exist (utils/science.js) and `plan.weights` what
 * each sampled tag is worth to the Held–Karp optimiser. No objective adds data: each one only
 * selects among layers that exist for its site, and says so when part of its purpose cannot
 * be served from this 2 km site.
 *
 * Weights are design choices (status 'design'), like SCIENCE_PARAMS.weights; they rank what the
 * objective cares about, they are not scientific scores.
 *
 * Fields per objective
 *   purpose      what the crew is trying to learn
 *   relevance    why it matters, with the source it rests on
 *   layers       data layers the objective uses (keys of config/provenance.js)
 *   candidates   which places become candidate stops
 *   criteria     how the planner chooses among them
 *   uncertainty  what the data cannot tell
 *   availability 'full' | 'partial' — partial: part of the purpose lies outside this site's data
 */

const SRC = {
  stack2020: { label: 'Stack et al. 2020, Space Sci. Rev. 216:127', url: 'https://doi.org/10.1007/s11214-020-00739-x' },
  farley2022: { label: 'Farley et al. 2022, Science 377, eabo2196 — aqueously altered igneous rocks on the Jezero floor', url: 'https://doi.org/10.1126/science.abo2196' },
  goudge2015: { label: 'Goudge et al. 2015, JGR Planets 120 — Jezero paleolake', url: 'https://doi.org/10.1002/2014JE004782' },
  parente2021: { label: 'Parente et al. 2021, CRISM dominant mineralogy (Zenodo)', url: 'https://doi.org/10.5281/zenodo.5575824' },
  jpl2025: { label: 'NASA/JPL, 23 Jun 2025 — "NASA\'s Curiosity Mars rover starts unpacking boxwork formations"', url: 'https://www.jpl.nasa.gov/news/nasas-curiosity-mars-rover-starts-unpacking-boxwork-formations/' },
  nachon2014: { label: 'Nachon et al. 2014, JGR Planets 119 — calcium sulfate veins measured by ChemCam', url: 'https://doi.org/10.1002/2013JE004588' },
  chemcam: { label: 'ChemCam LIBS major-oxide RDR, PDS Geosciences Node', url: 'https://pds-geosciences.wustl.edu/missions/msl/chemcam.htm' },
};

// Gale unit names written by pipeline/build_gale_geology.py
const BOXWORK = 'Boxwork-bearing layer';
const RIDGE = 'Ridge or butte crest', HOLLOW = 'Hollow or trough';

export const OBJECTIVES = {
  jezero: [
    {
      id: 'lake-delta',
      name: 'Ancient Lake and Delta Investigation',
      purpose: 'Sample the crater-floor rocks that lay under Jezero\'s lake and the boundaries between them, looking for the marks water left on them.',
      relevance: 'Jezero held a lake fed by the western delta (Goudge et al. 2015). Perseverance found the floor rocks to be igneous and later altered by water (Farley et al. 2022), so the floor records the lake period through its alteration.',
      sources: [SRC.goudge2015, SRC.farley2022, SRC.stack2020],
      layers: ['geology', 'minerals', 'orthoImage', 'terrain'],
      candidates: 'Interiors of the two crater-floor bedrock units, every contact between them, and CRISM olivine + smectite (an alteration signature).',
      criteria: 'Bedrock units and contacts count most; olivine + smectite adds an alteration stop; wind-blown surface cover does not count.',
      uncertainty: 'The delta front lies about 2 km west of the landing site, outside this 2 km site: no delta stop can be planned here. Unit boundaries are photogeologic (from orbit).',
      availability: 'partial',
      availabilityNote: 'Delta deposits are outside this site — crater-floor (lake-bed) rocks only.',
      plan: {
        filter: { contactOnlyTags: true, units: 'all', contacts: true, minerals: ['Olivine + smectite', 'Olivine/smectite + 2.2 µm', 'Fe/Mg-smectite', 'Mg-smectite 2', 'Mg-carbonate', 'Carbonate + 2.2 µm'], chemTags: [], targets: 0 },
        weights: { bedrock: 3, surface: 0, contact: 3, mineral: 2, chemistry: 0, target: 0 },
      },
    },
    {
      id: 'mineral-diversity',
      name: 'Mineralogical Diversity Exploration',
      purpose: 'Visit as many of the minerals CRISM detects in the site as one EVA allows, each in its geological setting.',
      relevance: 'Mineral variety records the different conditions the rocks went through; CRISM maps the dominant mineral of each 36 m area.',
      sources: [SRC.parente2021, SRC.stack2020],
      layers: ['minerals', 'geology', 'thermal', 'orthoImage'],
      candidates: 'One interior spot per CRISM mineral class present in the site, plus unit interiors and contacts for context.',
      criteria: 'Each distinct mineral counts most; units and contacts add a little so that equal-mineral plans prefer more geological context.',
      uncertainty: 'CRISM gives the dominant mineral of a 36 m pixel, named as the closest spectral match; medium-confidence pixels are included and flagged.',
      availability: 'full',
      plan: {
        filter: { units: 'all', contacts: true, minerals: null, chemTags: [], targets: 0 },
        weights: { bedrock: 1, surface: 1, contact: 1, mineral: 4, chemistry: 0, target: 0 },
      },
    },
    {
      id: 'bedrock-contacts',
      name: 'Bedrock and Geological Contact Analysis',
      purpose: 'Sample each mapped bedrock unit and the contacts between them, where the relative age of units can be read.',
      relevance: 'Contacts show which unit lies over which; the Mars 2020 team mapped the floor units at HiRISE scale (Stack et al. 2020).',
      sources: [SRC.stack2020, SRC.farley2022],
      layers: ['geology', 'orthoImage', 'terrain'],
      candidates: 'Interiors of the bedrock units and the nearest point of every bedrock contact.',
      criteria: 'Contacts count most, then each bedrock unit sampled in its interior (away from the contact); surface cover and minerals do not count.',
      uncertainty: 'Contacts are drawn from orbital images; on the ground a contact may be buried under sand or regolith.',
      availability: 'full',
      plan: {
        filter: { contactOnlyTags: true, units: 'all', contacts: true, minerals: [], chemTags: [], targets: 0 },
        weights: { bedrock: 3, surface: 0, contact: 4, mineral: 0, chemistry: 0, target: 0 },
      },
    },
    {
      id: 'olivine-pyroxene',
      name: 'Olivine and Pyroxene Investigation',
      purpose: 'Sample the olivine- and pyroxene-dominated areas CRISM maps on the crater floor.',
      relevance: 'Olivine and pyroxene are primary igneous minerals; how much of them survives shows how far water altered the floor (Farley et al. 2022).',
      sources: [SRC.parente2021, SRC.farley2022],
      layers: ['minerals', 'geology', 'thermal'],
      candidates: 'Interior spots of the CRISM olivine and high-/low-Ca pyroxene classes, plus bedrock-unit interiors for context.',
      criteria: 'Olivine and pyroxene classes count most; bedrock units add context; contacts and surface cover do not count.',
      uncertainty: 'Class names are closest spectral matches at 36 m; a pixel can hold several minerals. Low-Ca pyroxene is not detected in this site.',
      availability: 'full',
      plan: {
        filter: { units: 'all', contacts: false, minerals: ['Olivine', 'High-Ca pyroxene', 'Low-Ca pyroxene'], chemTags: [], targets: 0 },
        weights: { bedrock: 1, surface: 0, contact: 0, mineral: 4, chemistry: 0, target: 0 },
      },
    },
    {
      id: 'olivine-smectite',
      name: 'Olivine-Smectite Alteration Analysis',
      purpose: 'Sample where CRISM sees olivine together with smectite clay, and the unaltered olivine next to it.',
      relevance: 'Smectite forms when water alters olivine, so the pair marks where the floor rocks met water.',
      sources: [SRC.parente2021, SRC.farley2022],
      layers: ['minerals', 'geology'],
      candidates: 'Interior spots of olivine + smectite (and other smectite classes if present) and of plain olivine for comparison, plus bedrock units.',
      criteria: 'Smectite-bearing classes count most, plain olivine next; bedrock units add context.',
      uncertainty: 'Only "olivine + smectite" is detected in this site (6,817 cells, about 11 ha); the smectite share inside a 36 m pixel is unknown.',
      availability: 'full',
      plan: {
        filter: { units: 'all', contacts: false, minerals: ['Olivine + smectite', 'Olivine/smectite + 2.2 µm', 'Fe/Mg-smectite', 'Mg-smectite 2', 'Olivine'], chemTags: [], targets: 0 },
        weights: { bedrock: 1, surface: 0, contact: 0, mineral: 4, chemistry: 0, target: 0 },
      },
    },
  ],

  gale: [
    {
      id: 'boxwork',
      name: 'Boxwork Ridge and Hollow Investigation',
      purpose: 'Sample a boxwork ridge and a hollow inside the boxwork-bearing layer, to compare the cemented ridges with the rock between them.',
      relevance: 'NASA: the ridges likely formed when groundwater left minerals that hardened into a cement; wind then removed the softer rock around them (JPL, June 2025).',
      sources: [SRC.jpl2025],
      layers: ['geology', 'terrain', 'rocks', 'orthoImage', 'roverTrack'],
      candidates: 'Ridge-crest and hollow interiors that lie in the boxwork-bearing layer.',
      criteria: 'A ridge and a hollow count most; the layer itself adds a little.',
      uncertainty: 'Ridge / hollow are relief classes from the 2016 1 m DEM against a 15 m background; single boxwork ridges a few metres wide are not resolved. The layer boundaries are derived (stratigraphic level), not a published map.',
      availability: 'full',
      plan: {
        filter: { units: { surface: [RIDGE, HOLLOW], bedrock: [BOXWORK] }, contacts: false, minerals: [], chemTags: [], targets: 0 },
        weights: { bedrock: 1, surface: 4, contact: 0, mineral: 0, chemistry: 0, target: 0 },
      },
    },
    {
      id: 'contacts',
      name: 'Geological Contact Exploration',
      purpose: 'Cross the boundaries of the boxwork-bearing layer — with the sulfate unit below and above it.',
      relevance: 'The boxwork appears only in this layer (JPL, June 2025); its upper and lower boundaries bracket the conditions that made it.',
      sources: [SRC.jpl2025],
      layers: ['geology', 'terrain', 'roverTrack'],
      candidates: 'The nearest point of each boundary between levels, and each level\'s interior.',
      criteria: 'Contacts count most, then each level sampled in its interior (away from the contact); terrain classes do not count.',
      uncertainty: 'The levels are an elevation band derived from Curiosity\'s track, assuming near-horizontal layers; real contacts may cross the site at an angle.',
      availability: 'full',
      plan: {
        filter: { contactOnlyTags: true, units: 'all', contacts: true, minerals: [], chemTags: [], targets: 0 },
        weights: { bedrock: 2, surface: 0, contact: 4, mineral: 0, chemistry: 0, target: 0 },
      },
    },
    {
      id: 'chem-anomaly',
      name: 'Chemical Anomaly Investigation',
      purpose: 'Re-sample the rocks whose ChemCam chemistry stands out from their layer.',
      relevance: 'A rock that differs from its layer by more than twice ChemCam\'s accuracy (RMSEP) is a lead: a vein, a nodule, a different source.',
      sources: [SRC.chemcam],
      layers: ['chemistry', 'geology', 'roverTrack'],
      candidates: 'The nearest rock for each kind of standout (e.g. "MgO low", "CaO high"), up to eight kinds.',
      criteria: 'Each kind of standout counts most; the level adds context.',
      uncertainty: 'ChemCam samples a spot a few millimetres wide; its accuracy is a few wt%; target positions ignore the mast offset (about 1 m).',
      availability: 'full',
      plan: {
        filter: { units: 'all', contacts: false, minerals: [], chemTags: null, targets: 0, maxChem: 8 },
        weights: { bedrock: 1, surface: 0, contact: 0, mineral: 0, chemistry: 4, target: 0 },
        maxCandidates: 3,
      },
    },
    {
      id: 'water-alteration',
      name: 'Water-Related Alteration Evidence',
      purpose: 'Look for the marks of groundwater: the cemented boxwork ridges, and rocks rich in calcium, as calcium-sulfate veins are.',
      relevance: 'NASA links the boxwork ridges to groundwater cement and reports white calcium-sulfate veins in this layer (JPL, June 2025); ChemCam identifies such veins by their high CaO (Nachon et al. 2014).',
      sources: [SRC.jpl2025, SRC.nachon2014],
      layers: ['chemistry', 'geology', 'terrain', 'orthoImage'],
      candidates: 'The nearest "CaO high" ChemCam rock, boxwork ridges and hollows.',
      criteria: 'CaO-high rocks and boxwork ridges / hollows count most; the level adds context.',
      uncertainty: 'High CaO is a proxy: ChemCam does not report sulfur in this product, so a vein cannot be confirmed as calcium sulfate here.',
      availability: 'full',
      plan: {
        filter: { units: { surface: [RIDGE, HOLLOW], bedrock: [BOXWORK] }, contacts: false, minerals: [], chemTags: ['CaO high'], targets: 0, maxChem: 2 },
        weights: { bedrock: 1, surface: 3, contact: 0, mineral: 0, chemistry: 3, target: 0 },
      },
    },
    {
      id: 'chemcam-revisit',
      name: 'ChemCam Target Re-investigation',
      purpose: 'Walk to rocks Curiosity already analysed, to see them by eye and sample them by hand.',
      relevance: 'Every ChemCam target has a measured composition; a crew sample of the same rock can be compared with it directly.',
      sources: [SRC.chemcam],
      layers: ['chemistry', 'roverTrack', 'pov'],
      candidates: 'The ten nearest named ChemCam targets.',
      criteria: 'Each distinct target counts the same; the level adds a little.',
      uncertainty: 'Target positions come from the rover position plus laser pointing and range; they ignore the mast offset (about 1 m).',
      availability: 'full',
      plan: {
        filter: { units: 'none', contacts: false, minerals: [], chemTags: [], targets: 10 },
        weights: { bedrock: 1, surface: 0, contact: 0, mineral: 0, chemistry: 0, target: 3 },
      },
    },
  ],
};

/** Objectives for a site name ([] for the Moon). */
export const objectivesFor = (siteName) => OBJECTIVES[siteName] || [];

/** The objective with this id on this site, or null. */
export const findObjective = (siteName, id) => objectivesFor(siteName).find(o => o.id === id) || null;
