/**
 * Data provenance — one record per data layer and per model the app uses, for the site
 * that is loaded. Every record says what kind of knowledge it is:
 *
 *   direct-measurement    measured on the ground at this site (rover instruments)
 *   orbital-observation   observed from orbit over this site
 *   derived               computed by this project from other data (method given)
 *   transferred-reference measured elsewhere and applied here as a reference value
 *   modelled              computed from a published model or algorithm
 *   simulated             made up by the app for training / playback (not data)
 *
 * and, when a layer does not exist for the site, why (`available: false`). Values that the
 * pipeline wrote into the site files (sol ranges, counts, resolutions) are read from them, so
 * this table cannot drift from the data. Pure: tested in Node (tests/provenance.test.mjs).
 */

export const CATEGORIES = {
  'direct-measurement': { label: 'Direct measurement', color: '#7fe08a' },
  'orbital-observation': { label: 'Orbital observation', color: '#8fc8ff' },
  derived: { label: 'Derived (this project)', color: '#ffd166' },
  'transferred-reference': { label: 'Transferred reference', color: '#ffa94d' },
  modelled: { label: 'Modelled', color: '#c8a8ff' },
  simulated: { label: 'Simulated', color: '#ff8fa3' },
  'ai-predicted': { label: 'AI-predicted', color: '#e58fe0' },
};

const doi = (d) => (d && /^https?:/.test(d) ? d : d ? `https://doi.org/${d}` : null);

/**
 * @param {string} siteName  'jezero' | 'gale' | …
 * @param {object} site      SITE (terrain/siteData.js) — meta, ortho, layers, geology, climate, pov, chemistry, track
 * @returns {Array<object>}  records: { key, name, category, available, mission, instrument, source:{title,url},
 *                           observed, resolution, coverage, dataType, processing, status, uncertainty, limitations, reason? }
 */
export function provenanceFor(siteName, site) {
  const meta = site?.meta || {};
  const span = meta.grid ? `${Math.round(meta.grid.span_m)} m × ${Math.round(meta.grid.span_m)} m site` : 'site';
  const isGale = siteName === 'gale';
  const rover = isGale ? 'Curiosity' : 'Perseverance';
  const out = [];
  const add = (r) => out.push({ available: true, ...r });
  const missing = (key, name, category, reason, extra = {}) => out.push({ key, name, category, available: false, reason, ...extra });

  // ---- Topography
  add({
    key: 'terrain', name: 'Terrain (elevation, slope)', category: 'orbital-observation',
    mission: 'Mars Reconnaissance Orbiter', instrument: 'HiRISE (stereo DTMs)',
    source: { title: meta.source?.title || 'HiRISE DTM', url: doi(meta.source?.doi) || meta.source?.page || null },
    observed: 'HiRISE stereo pairs taken before the mosaic was published',
    resolution: `1 m DTM, resampled to a ${meta.grid?.cell_m ?? 4} m grid`, coverage: span,
    dataType: 'topographic', processing: 'cut to the site, reprojected to a local equirectangular frame, block-averaged to 4 m; slope by central differences',
    status: 'sourced', uncertainty: 'DTM vertical precision is a fraction of a metre; slope over 4 m smooths steps shorter than a cell',
    limitations: 'Features smaller than a few metres are not resolved',
  });
  add({
    key: 'rocks', name: 'Rock relief (boulders / outcrops)', category: 'derived',
    mission: 'Mars Reconnaissance Orbiter', instrument: 'HiRISE DTM (1 m)',
    source: { title: site?.layers?.rock?.source?.title || meta.source?.title || 'HiRISE DTM', url: doi(site?.layers?.rock?.source?.doi) || meta.source?.page || null },
    observed: 'as the DTM', resolution: '1 m inside each 4 m cell', coverage: span, dataType: 'topographic',
    processing: 'max − min of the 1 m DTM in each 4 m cell after removing its best-fit plane (pipeline/build_layers.py)',
    status: 'derived', uncertainty: 'a proxy: relief can come from a boulder, an outcrop step or DTM noise',
    limitations: 'A 1 m DTM shows rocks of a few metres; rocks under ~2 m are not seen. At Gale, DEM noise raises the values',
  });
  if (site?.segmentation) {
    const sg = site.segmentation;
    add({
      key: 'segmentation', name: 'Terrain classes on rover images (AI)', category: 'ai-predicted',
      mission: site.track?.rover ? `${site.track.rover} (images)` : 'rover images', instrument: `${sg.model} (LR-ASPP MobileNetV3, trained on AI4Mars v0.6)`,
      source: { title: 'AI4Mars v0.6 training set (Swan et al., Zenodo 10.5281/zenodo.15995036)', url: 'https://doi.org/10.5281/zenodo.15995036' },
      observed: `predicted ${sg.predictedUtc?.slice(0, 10) || ''}`, resolution: 'per image pixel (256 px short side)', coverage: `${sg.count} Navcam frames`,
      dataType: 'image classes (soil, bedrock, sand, big rock)', processing: 'pipeline/segmentation (train → evaluate → ONNX → infer_sites); docs/MARS_SEGMENTATION.md',
      status: 'model prediction', uncertainty: `pixels below confidence ${sg.lowConfidence} shown as unknown; big rocks poorly detected (test IoU 0.08–0.32)`,
      limitations: 'Image level, not georeferenced: never drawn on the map and never changes routes or safety rules',
    });
  }
  if (site?.relief) {
    add({
      key: 'reliefShading', name: '3D relief shading', category: 'derived',
      mission: 'Mars Reconnaissance Orbiter', instrument: 'HiRISE DTM (1 m)',
      source: { title: meta.source?.title || 'HiRISE DTM', url: doi(meta.source?.doi) || meta.source?.page || null },
      observed: 'as the DTM', resolution: `${site.relief.pixel_m?.toFixed(2)} m/px normal map`, coverage: span, dataType: 'topographic',
      processing: 'surface normals of the 1 m DTM on the site grid, used to light the 4 m terrain mesh (pipeline/build_relief.py)',
      status: 'derived', uncertainty: 'DTM noise shows as fine texture; the ×2 / ×4 view steepens the shading only',
      limitations: 'Lighting only: heights, slopes, routes and every number still come from the 4 m grid',
    });
  }

  // ---- Images
  if (site?.ortho) {
    add({
      key: 'orthoImage', name: 'Orbital image', category: 'orbital-observation',
      mission: 'Mars Reconnaissance Orbiter', instrument: 'HiRISE',
      source: { title: site.ortho.source?.title, url: doi(site.ortho.source?.doi) || site.ortho.source?.page || null },
      observed: `HiRISE images in a mosaic published ${site.ortho.source?.year ?? ''}`.trim(),
      resolution: `${site.ortho.pixel_m?.toFixed(2)} m/px shown (mosaic 25 cm)`, coverage: `${Math.round((site.ortho.coverage ?? 1) * 100)}% of the site`,
      dataType: 'optical', processing: 'warped onto the site grid; aligned to the DTM to ≤ 1 m (phase correlation)',
      status: 'sourced', uncertainty: 'single moment in time, lighting of that pass',
      limitations: 'Shown at 0.5 m/px to keep the download small; soft up close',
    });
  } else missing('orthoImage', 'Orbital image', 'orbital-observation', 'no orthomosaic for this site');
  if (site?.pov) {
    const st = site.pov.stations || [];
    const sols = st.length ? [Math.min(...st.map(s => s.sol)), Math.max(...st.map(s => s.sol))] : null;
    add({
      key: 'pov', name: 'Ground-level images', category: 'direct-measurement',
      mission: isGale ? 'Mars Science Laboratory' : 'Mars 2020', instrument: isGale ? 'Navcam / Mastcam' : 'Navcam / Mastcam-Z',
      source: { title: `${rover} raw images (${site.pov.credit || 'NASA/JPL-Caltech'})`, url: isGale ? 'https://mars.nasa.gov/msl/multimedia/raw-images/' : 'https://mars.nasa.gov/mars2020/multimedia/raw-images/' },
      observed: sols ? `sols ${sols[0]}–${sols[1]}` : '—',
      resolution: 'rover camera frames', coverage: `${st.length} rover positions, ${st.reduce((a, s) => a + (s.frames?.length || 0), 0)} frames`,
      dataType: 'optical', processing: 'near-horizontal frames kept; facing = mast azimuth + rover heading',
      status: 'sourced', uncertainty: 'view direction accurate to a few degrees',
      limitations: 'Only the metadata is stored; images load from mars.nasa.gov (internet needed)',
    });
  }
  if (site?.track) {
    add({
      key: 'roverTrack', name: `${rover}'s route`, category: 'direct-measurement',
      mission: isGale ? 'Mars Science Laboratory' : 'Mars 2020', instrument: 'rover localization (waypoints)',
      source: { title: site.track.credit, url: 'https://mars.nasa.gov/' },
      observed: `sols ${site.track.sols[0]}–${site.track.sols[1]}`, resolution: 'one point per drive end',
      coverage: `${site.track.points} positions, ${(site.track.length_m / 1000).toFixed(1)} km in the site`,
      dataType: 'positional', processing: 'waypoints inside the site, in drive order (pipeline/build_track.py)',
      status: 'sourced', uncertainty: 'localization error of a few metres', limitations: 'path between drive ends is drawn straight',
    });
  }

  // ---- Geology
  const g = site?.geology?.source;
  if (site?.geology && g?.kind === 'derived') {
    add({
      key: 'geology', name: 'Geological units (derived interpretation)', category: 'derived',
      mission: 'Mars Science Laboratory + Mars Reconnaissance Orbiter', instrument: 'rover track + HiRISE DEM',
      source: { title: g.short || g.title, url: null },
      observed: g.method?.boxwork_sols ? `boxwork campaign, sols ${g.method.boxwork_sols.join('–')}` : '—',
      resolution: '4 m grid', coverage: span, dataType: 'geologic',
      processing: 'stratigraphic level = elevation band Curiosity crossed in the boxwork campaign; terrain class = relief against a 15 m background (pipeline/build_gale_geology.py)',
      status: 'derived', uncertainty: 'assumes near-horizontal layers; lateral edges of the boxwork not modelled',
      limitations: 'NOT an official published GIS geologic map — none is published for this part of Mount Sharp yet',
    });
  } else if (site?.geology) {
    add({
      key: 'geology', name: 'Geological units (published map)', category: 'orbital-observation',
      mission: 'Mars 2020 science team (mapped on MRO HiRISE images)', instrument: 'photogeologic mapping',
      source: { title: g?.title, url: doi(g?.doi) },
      observed: `published ${g?.year ?? ''}`.trim(), resolution: 'mapped at HiRISE scale, rasterized to 4 m', coverage: span, dataType: 'geologic',
      processing: 'polygons rasterized onto the site grid (pipeline/build_geology.py)',
      status: 'sourced', uncertainty: 'boundaries drawn from orbit; may be buried on the ground',
      limitations: 'Map units, not rock compositions',
    });
  } else missing('geology', 'Geological units', 'orbital-observation', 'no geology for this site');

  // ---- Spectral / thermal / chemistry
  const L = site?.layers || {};
  if (L.minerals) {
    add({
      key: 'minerals', name: 'Dominant minerals', category: 'orbital-observation',
      mission: 'Mars Reconnaissance Orbiter', instrument: 'CRISM',
      source: { title: L.minerals.source?.title, url: doi(L.minerals.source?.doi) },
      observed: `CRISM scenes ${(L.minerals.source?.scenes || []).join(', ')}`, resolution: `${L.minerals.source?.resolution_m ?? 36} m`,
      coverage: span, dataType: 'spectral', processing: 'class map resampled to 4 m; high / medium confidence kept',
      status: 'sourced', uncertainty: 'class name = closest spectral match; medium-confidence pixels flagged',
      limitations: 'Dominant mineral of each pixel only',
    });
  } else {
    missing('minerals', 'Dominant minerals', 'orbital-observation', isGale
      ? 'Not integrated: CRISM observes lower Mount Sharp, but no processed, published mineral map of this site was found; turning raw CRISM cubes into one needs spectral processing this project has not validated'
      : 'no CRISM mineral map for this site', { mission: 'Mars Reconnaissance Orbiter', instrument: 'CRISM' });
  }
  if (L.thermal) {
    add({
      key: 'thermal', name: 'Thermal inertia', category: 'orbital-observation',
      mission: '2001 Mars Odyssey', instrument: 'THEMIS',
      source: { title: L.thermal.source?.title, url: doi(L.thermal.source?.doi) },
      observed: `published ${L.thermal.source?.year ?? ''}`.trim(), resolution: `${L.thermal.source?.resolution_m ?? 100} m`,
      coverage: span, dataType: 'thermal', processing: 'resampled to 4 m; classed by published thresholds',
      status: 'sourced', uncertainty: 'classes (dust / sand / rock) are guidance',
      limitations: '100 m pixels: mixed ground averages out',
    });
  } else {
    missing('thermal', 'Thermal inertia', 'orbital-observation', isGale
      ? 'Not integrated: for Gale, THEMIS offers a qualitative thermal-inertia image (100 m/px, 2006) without physical units, so it cannot classify the ground as the quantitative Jezero layer does'
      : 'no thermal-inertia layer for this site', { mission: '2001 Mars Odyssey', instrument: 'THEMIS' });
  }
  if (site?.chemistry) {
    const c = site.chemistry;
    const sols = c.targets?.length ? [Math.min(...c.targets.map(t => t.sol)), Math.max(...c.targets.map(t => t.sol))] : null;
    add({
      key: 'chemistry', name: 'Rock chemistry (major oxides)', category: 'direct-measurement',
      mission: 'Mars Science Laboratory', instrument: 'ChemCam (LIBS)',
      source: { title: c.source?.title, url: c.source?.url },
      observed: sols ? `sols ${sols[0]}–${sols[1]}` : '—', resolution: 'spot a few mm wide per laser point',
      coverage: `${c.targets?.length ?? 0} targets in the site`, dataType: 'chemical',
      processing: `target placed from ${c.location_method || 'rover position + pointing'}`,
      status: 'sourced', uncertainty: 'accuracy (RMSEP) a few wt% per oxide; positions ±1 m (mast offset ignored)',
      limitations: 'Major oxides only — no sulfur or chlorine in this product',
    });
  } else {
    missing('chemistry', 'Rock chemistry', 'direct-measurement', isGale ? 'no ChemCam table for this site'
      : 'Not integrated: SuperCam major-oxide results exist only as supplementary CSV in the PDS Analyst\'s Notebook ("not archived products") and carry no target coordinates; PIXL maps abrasion patches millimetres wide — neither can be placed on a 4 m grid with verified positions',
      { mission: 'Mars 2020', instrument: 'SuperCam / PIXL' });
  }

  // ---- Atmosphere
  if (site?.climate) {
    const c = site.climate;
    add({
      key: 'air', name: `Air temperature at ${c.heightM} m`, category: 'direct-measurement',
      mission: isGale ? 'Mars Science Laboratory' : 'Mars 2020', instrument: c.instrument,
      source: { title: c.source?.title || c.instrument, url: doi(c.source?.doi) || c.source?.url || null },
      observed: c.solRange ? `sols ${c.solRange.join('–')} (one Mars year)` : '—', resolution: '5-min means, 10° Ls bins',
      coverage: isGale ? 'Curiosity\'s positions that year (lower Mount Sharp), applied to the site' : 'Perseverance\'s positions, applied to the site',
      dataType: 'atmospheric', processing: 'climatology: median / p10 / p90 per season and time of day',
      status: 'sourced', uncertainty: 'climatology, not a forecast; sensor biases near sunset screened (Gale)',
      limitations: 'One Mars year; one height above ground',
    });
  }

  // ---- Radiation
  add({
    key: 'radiation', name: 'Surface radiation dose rate', category: isGale ? 'direct-measurement' : 'transferred-reference',
    mission: 'Mars Science Laboratory', instrument: 'RAD',
    source: { title: 'Hassler et al. 2014, Science 343, 1244797', url: 'https://doi.org/10.1126/science.1244797' },
    observed: 'Aug 2012 – Jun 2013 (near solar maximum)', resolution: 'mean dose-equivalent rate, 0.64 mSv/day',
    coverage: isGale ? 'measured in Gale crater (this crater)' : 'measured in Gale crater — about 3,700 km away — applied to Jezero',
    dataType: 'radiation', processing: 'rate × time on the surface',
    status: isGale ? 'sourced' : 'transferred',
    uncertainty: isGale ? 'varies with the solar cycle and season' : 'Jezero is ~1.8 km higher than Gale (less air above), so its dose is likely a little higher',
    limitations: isGale ? 'Galactic cosmic rays only; solar particle events not included' : 'NOT a Jezero measurement; galactic cosmic rays only',
  });
  add({
    key: 'spaceWeather', name: 'Space-weather events', category: 'direct-measurement',
    mission: 'NASA space-weather operations', instrument: 'DONKI (event database)',
    source: { title: 'NASA CCMC DONKI', url: 'https://kauai.ccmc.gsfc.nasa.gov/DONKI/' },
    observed: site?.spaceWeather?.coverage ? `archive ${site.spaceWeather.coverage.join(' – ')}; newer dates looked up live` : 'looked up live for the EVA date',
    resolution: 'events (time, type)', coverage: 'heliosphere; Mars arrivals from WSA-ENLIL model runs', dataType: 'radiation',
    processing: 'events within ±2 days of the EVA → postpone advisory',
    status: 'sourced', uncertainty: 'CME arrival times at Mars are model estimates',
    limitations: 'A record of past events, not a forecast: future dates have no data',
  });
  add({
    key: 'doseComparison', name: 'Dose rates elsewhere (Earth, ISS, Moon)', category: 'transferred-reference',
    mission: 'various', instrument: 'UNSCEAR; Chang\'e 4 LND; ISS dosimetry',
    source: { title: 'UNSCEAR 2000; Zhang et al. 2020, Sci. Adv. 6, eaaz1334', url: 'https://doi.org/10.1126/sciadv.aaz1334' },
    observed: 'different years / solar-cycle phases', resolution: 'mean daily rates', coverage: 'not this site', dataType: 'radiation',
    processing: 'shown side by side for context', status: 'sourced', uncertainty: 'solar-cycle timing differs between values',
    limitations: 'Context only, not used in GO decisions',
  });

  // ---- Models and simulation
  add({
    key: 'sun', name: 'Sun position, local solar time', category: 'modelled',
    mission: '—', instrument: 'Mars24 algorithm (NASA GISS)', source: { title: 'Allison & McEwen 2000', url: 'https://www.giss.nasa.gov/tools/mars24/' },
    observed: 'computed for the EVA date', resolution: 'per route point', coverage: 'site', dataType: 'ephemeris',
    processing: 'sun elevation / azimuth; terrain shadows ray-marched on the DTM', status: 'sourced',
    uncertainty: '< 0.25 min against the MEDA team\'s sunset table (tests)', limitations: 'No atmospheric dust extinction',
  });
  add({
    key: 'walkModel', name: 'Suited walking speed vs slope', category: 'modelled',
    mission: '—', instrument: 'Tobler hiking function (shape) + EVA limit set (pace)',
    source: { title: 'Tobler 1993; NASA xEVA ConOps; Norcross et al. 2009', url: 'https://www.lpi.usra.edu/lunar/artemis/NorcrossEtAl_NASA-TP-2009-214796_EVA%20Walkback%20Test.pdf' },
    observed: '—', resolution: '4 m grid', coverage: 'site', dataType: 'model',
    processing: 'walking time per cell for A* and Dijkstra', status: 'assumption',
    uncertainty: 'the slope shape for a suited walker is an assumption', limitations: 'Not validated for Mars suits',
  });
  add({
    key: 'suitMass', name: 'Suit mass and carry limit', category: 'modelled',
    mission: 'NASA Mars suit sizing study', instrument: 'Ogilvie et al., ICES 2026',
    source: { title: 'Mars Spacesuit Mass Requirements (NTRS 20260005410)', url: 'https://ntrs.nasa.gov/citations/20260005410' },
    observed: '—', resolution: '—', coverage: 'crew', dataType: 'engineering',
    processing: 'suit + payload weight on Mars as Earth-equivalent kg vs 23 kg lift limit + 22 kg pressure offset (utils/payload.js)', status: 'sourced',
    uncertainty: 'a design study, not a flown suit', limitations: 'Payload does not change walking speed (no validated load–speed model at Mars gravity)',
  });
  add({
    key: 'oxygen', name: 'Oxygen consumption', category: 'modelled',
    mission: 'NASA life-support baselines', instrument: 'BVAD, NASA/TP-2015-218570 Rev 2, §4.6.2',
    source: { title: 'Life Support Baseline Values and Assumptions Document (2022)', url: 'https://ntrs.nasa.gov/citations/20210024855' },
    observed: '—', resolution: 'per EVA second', coverage: 'crew', dataType: 'model',
    processing: 'architecture reference rate (0.076 / 0.15 / 1.0 kg/h) × simulated mission time (utils/oxygen.js)', status: 'sourced',
    uncertainty: 'architecture references, not a Mars-suit specification; constant per scenario',
    limitations: 'Not measured; no activity dependence; initial oxygen sized for 8 h when not entered (assumption)',
  });
  add({
    key: 'dust', name: 'Dust exposure & equipment reliability', category: 'derived',
    mission: 'Apollo, Artemis suit materials, Mars 2020, MRO, Mars Odyssey', instrument: 'literature (config/dust.js)',
    source: { title: 'Gaier 2005; Jones et al. 2025; NASA EVA gap list 2020; JPL 2025 (SHERLOC); Kass et al. 2016', url: 'https://ntrs.nasa.gov/citations/20050160460' },
    observed: '—', resolution: '—', coverage: 'equipment', dataType: 'qualitative',
    processing: 'vulnerability classes and warnings from documented failure mechanisms; each source labelled Mars / lunar analogy / analog', status: 'derived',
    uncertainty: 'qualitative; mostly lunar evidence used as an analogy',
    limitations: 'No failure probabilities or degradation rates (none validated for Martian dust); never changes the decision',
  });
  add({
    key: 'evaSimulation', name: 'EVA playback, astronauts, dust devil', category: 'simulated',
    mission: '—', instrument: 'this app', source: { title: 'utils/evaPlayback.js, components/MarsCrew.jsx', url: null },
    observed: '—', resolution: '—', coverage: '—', dataType: 'simulation',
    processing: 'the planner\'s own timeline played back; dust devil placed by the user', status: 'simulated',
    uncertainty: '—', limitations: 'Training / illustration only — no data',
  });
  return out;
}
