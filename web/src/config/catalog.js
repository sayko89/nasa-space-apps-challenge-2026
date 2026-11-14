/**
 * Data catalog — the layers and datasets the loaded site actually has, grouped the way planetary
 * map portals group them (imagery, topography, geology, …). Nothing is listed that the site files
 * do not contain: a category with no dataset is left out.
 *
 * Item kinds:
 *   base     the terrain itself or its surface (DTM mesh, HiRISE image, relief shading) — a mode, not a drape
 *   drape    a map layer that can be draped on the 3D terrain (heatmaps.js layer name in `layer`)
 *   overlay  a vector overlay drawn in 3D (rover track)
 *   dataset  data used by the app that is not a map (climate, radiation, rover images, chemistry)
 * `prov` is the key of the provenance record (config/provenance.js) that documents the item.
 *
 * Pure: tested in Node (tests/catalog.test.mjs).
 */

export const CATALOG_CATEGORIES = [
  ['imagery', 'Imagery'], ['topography', 'Topography'], ['geology', 'Geology'], ['mineralogy', 'Mineralogy'],
  ['chemistry', 'Chemistry'], ['thermal', 'Thermal'], ['atmospheric', 'Atmospheric'], ['radiation', 'Radiation'],
  ['rover', 'Rover Observations'], ['ai', 'AI Terrain Segmentation'], ['hazards', 'Hazards'], ['mission', 'Mission Planning'],
];

/**
 * @param {object} site   SITE (terrain/siteData.js)
 * @param {object} opts   { drapeLayers: string[] — heatmap names this build can draw (panelConstants.HEATMAP_OPTIONS) }
 * @returns {Array<{ id, label, items: Array<object> }>}
 */
export function buildCatalog(site, { drapeLayers = [] } = {}) {
  const can = new Set(drapeLayers);
  const items = [];
  const add = (cat, it) => items.push({ cat, ...it });
  const drape = (cat, layer, it) => { if (can.has(layer)) add(cat, { id: `drape:${layer}`, kind: 'drape', layer, ...it }); };
  const L = site?.layers || {};
  const isGale = site?.name === 'gale';

  if (site?.ortho) add('imagery', { id: 'base:ortho', kind: 'base', name: 'HiRISE orthoimage', prov: 'orthoImage',
    desc: 'Orbital image draped on the terrain (MRO HiRISE, shown at ~0.5 m/px).' });

  if (site?.meta) add('topography', { id: 'base:dtm', kind: 'base', name: 'Digital terrain model (DTM)', prov: 'terrain', always: true,
    desc: `HiRISE stereo DTM resampled to the ${site.meta.grid?.cell_m ?? 4} m site grid — the 3D surface and every slope the planner uses.` });
  if (site?.relief) add('topography', { id: 'base:relief', kind: 'base', name: 'Relief shading (1 m DTM)', prov: 'reliefShading',
    desc: 'Lighting from the 1 m DTM surface normals; ×2 / ×4 steepen the shading only.' });
  drape('topography', 'Elevation', { name: 'Elevation', prov: 'terrain', desc: 'Height above the Mars datum (MOLA areoid), from the DTM.' });
  drape('topography', 'Slope Angle', { name: 'Slope angle', prov: 'terrain', desc: 'Slope of each 4 m cell, from the DTM.' });
  drape('topography', 'Roughness', { name: 'Roughness', prov: 'terrain', desc: 'Local height variation between neighbouring cells (derived from the DTM).' });
  drape('topography', 'Illumination', { name: 'Illumination (modelled)', prov: 'sun', desc: 'Sun on the terrain at the selected mission time (Mars24 sun position, DTM shading).' });

  drape('geology', 'Geology: Surface', { name: isGale ? 'Surface units (derived)' : 'Surface units', prov: 'geology',
    desc: isGale ? 'Units derived by this project — not a published geological map.' : 'Photogeologic surface units of the Mars 2020 landing site map.' });
  drape('geology', 'Geology: Bedrock', { name: isGale ? 'Bedrock units (derived)' : 'Bedrock units', prov: 'geology',
    desc: isGale ? 'Units derived by this project — not a published geological map.' : 'Photogeologic bedrock units of the Mars 2020 landing site map.' });

  if (L.minerals) drape('mineralogy', 'Minerals (CRISM)', { name: 'Dominant minerals (CRISM)', prov: 'minerals', desc: L.minerals.label || 'MRO CRISM dominant mineralogy classes.' });
  if (site?.chemistry) add('chemistry', { id: 'data:chemistry', kind: 'dataset', name: 'ChemCam major oxides', prov: 'chemistry',
    desc: `${site.chemistry.targets?.length ?? ''} rover targets with laser-spectroscopy chemistry; shown at the science stops.`.trim() });
  if (L.thermal) drape('thermal', 'Thermal Inertia (THEMIS)', { name: 'Thermal inertia (THEMIS)', prov: 'thermal', desc: L.thermal.label || 'Mars Odyssey THEMIS thermal inertia.' });
  if (site?.climate) add('atmospheric', { id: 'data:air', kind: 'dataset', name: `Air temperature (${site.climate.instrument || 'rover'})`, prov: 'air',
    desc: 'Measured near-surface air temperature through the sol; used for the mission time and cuff card.' });
  add('radiation', { id: 'data:radiation', kind: 'dataset', name: 'Surface dose rate (RAD)', prov: 'radiation',
    desc: 'Curiosity RAD surface dose rate, used for the EVA dose.' });
  add('radiation', { id: 'data:spaceWeather', kind: 'dataset', name: 'Space-weather events (DONKI)', prov: 'spaceWeather',
    desc: 'Solar particle events and CMEs near the EVA date (site archive, newer dates looked up live).' });

  if (site?.track) add('rover', { id: 'overlay:track', kind: 'overlay', name: `${site.track.rover}'s route & places`, prov: 'roverTrack',
    desc: `The rover's own traverse through this site (sols ${site.track.sols?.join('–')}) and named places.` });
  if (site?.pov?.stations?.length) add('rover', { id: 'data:pov', kind: 'dataset', name: 'Rover ground images', prov: 'pov',
    desc: `${site.pov.stations.length} rover positions with Navcam / Mastcam frames; opened from a stop or a map point nearby.` });

  if (site?.segmentation) add('ai', { id: 'data:segmentation', kind: 'dataset', name: 'Terrain classes (AI)', prov: 'segmentation',
    desc: 'Model predictions on rover images — image-level, not map-aligned.' });

  drape('hazards', 'Hazards', { name: 'Hazard classes', prov: 'terrain', desc: 'Slope limit, rock obstacles, depressions, steep and rough ground, areas seen only from orbit.' });
  drape('hazards', 'No-Go', { name: 'No-go cells', prov: 'terrain', desc: 'Cells the route planner never enters (over the slope limit or a rock obstacle).' });
  if (L.rock) drape('hazards', 'Rock Relief (HiRISE)', { name: 'Rock relief (1 m DTM)', prov: 'rocks', desc: L.rock.label || 'Relief inside each 4 m cell — proxy for boulders and outcrops.' });

  drape('mission', 'EVA Range', { name: 'EVA range (walk-back)', prov: 'walkModel', desc: 'Fastest suited walk home from every cell; needs a planned route.' });

  return CATALOG_CATEGORIES
    .map(([id, label]) => ({ id, label, items: items.filter(i => i.cat === id) }))
    .filter(c => c.items.length > 0);
}

/** Case-insensitive search over name, description and category label. */
export function filterCatalog(cats, q) {
  const s = (q || '').trim().toLowerCase();
  if (!s) return cats;
  return cats.map(c => ({ ...c, items: c.items.filter(i => `${i.name} ${i.desc} ${c.label}`.toLowerCase().includes(s)) }))
    .filter(c => c.items.length > 0);
}
