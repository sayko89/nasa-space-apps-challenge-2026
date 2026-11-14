/**
 * Site data — arazi kaynağının tek doğruluk noktası.
 *
 * İki mod:
 *   'dem'        public/sites/<name>/{meta.json,grid.bin} başarıyla yüklendi
 *                (pipeline/build_site.py çıktısı, gerçek Mars DTM'i).
 *   'procedural' Veri yok veya ?site=moon — eski prosedürel Ay arazisi.
 *
 * ÖNEMLİ: loadSite(), App ve terrainGenerator import edilmeden ÖNCE
 * tamamlanmalı (bkz. main.jsx). terrainGenerator.js TERRAIN_SIZE/GRID_RES gibi
 * sabitlerini modül değerlendirilirken buradan okur; pathfinder, RightPanel,
 * roverController gibi modüllerin modül seviyesindeki türetilmiş sabitleri de
 * ancak bu sırayla doğru başlar.
 *
 * Tek bağımlılığı bağımlılıksız geology.js çözücüsüdür.
 */

import { decodeGeology } from './geology.js';
import { decodeLayers } from './layers.js';

export const site = {
  mode: 'procedural',
  name: null,
  gridRes: 256,
  sizeM: 100,
  cellM: 100 / 255,
  heights: null,        // Float32Array, heightOrigin çıkarılmış [m]
  heightOrigin: 0,      // mutlak yükseklik = heights[i] + heightOrigin
  meta: null,
  climate: null,        // climate.json (MEDA ATS iklimolojisi) — isteğe bağlı
  geology: null,        // geology.json çözülmüş (Stack et al. 2020) — isteğe bağlı
  layers: null,         // layers.json: THEMIS thermal inertia, CRISM minerals, HiRISE rock relief — optional
  spaceWeather: null,   // space_weather.json: DONKI events (SEP, CME, flares) — optional
  pov: null,            // pov.json: Perseverance Navcam panoramas inside the site — optional
  track: null,          // track.json: the rover's own route through the site + named places — optional
  chemistry: null,      // chemistry.json: ChemCam rock compositions inside the site — optional
  ortho: null,          // ortho.json: HiRISE orthomosaic draped on the terrain (ortho.jpg) — optional
  loadError: null,
};

const DEFAULT_SITE = 'jezero';

/** URL'den site adı: ?site=jezero (varsayılan) | ?site=moon (prosedürel). */
export function siteFromUrl() {
  try {
    const p = new URLSearchParams(window.location.search).get('site');
    return p ? p.trim().toLowerCase() : DEFAULT_SITE;
  } catch {
    return DEFAULT_SITE;
  }
}

function fail(name, reason) {
  site.mode = 'procedural';
  site.name = name;
  site.loadError = reason;
  // eslint-disable-next-line no-console
  console.warn(`[site] '${name}' could not be loaded, falling back to procedural terrain: ${reason}`);
  return site;
}

/**
 * meta.json + grid.bin dosyalarını yükler ve doğrular. Her hata durumunda
 * prosedürel moda düşer (uygulama yine açılır, HUD nedeni gösterir).
 */
export async function loadSite(name = DEFAULT_SITE) {
  if (!name || name === 'moon' || name === 'procedural') {
    site.mode = 'procedural';
    site.name = 'moon';
    return site;
  }
  if (!/^[a-z0-9_-]+$/.test(name)) return fail(name, 'invalid site name');

  const base = `${import.meta.env.BASE_URL}sites/${name}/`;
  let meta;
  try {
    const r = await fetch(base + 'meta.json', { cache: 'no-cache' });
    if (!r.ok) return fail(name, `meta.json HTTP ${r.status}`);
    // SPA fallback index.html döndürebilir — JSON değilse reddet
    meta = JSON.parse(await r.text());
  } catch (e) {
    return fail(name, `meta.json could not be read (${e.message}) — did you run pipeline/build_site.py?`);
  }

  const n = meta?.grid?.n;
  const cell = meta?.grid?.cell_m;
  if (!Number.isInteger(n) || n < 16 || !(cell > 0)) return fail(name, 'meta.json grid field is invalid');
  if (meta?.grid?.dtype !== 'float32-le') return fail(name, `unsupported dtype: ${meta?.grid?.dtype}`);

  let buf;
  try {
    const r = await fetch(base + 'grid.bin', { cache: 'no-cache' });
    if (!r.ok) return fail(name, `grid.bin HTTP ${r.status}`);
    buf = await r.arrayBuffer();
  } catch (e) {
    return fail(name, `grid.bin could not be read (${e.message})`);
  }
  if (buf.byteLength !== n * n * 4) {
    return fail(name, `grid.bin is ${buf.byteLength} B, expected ${n * n * 4} B`);
  }

  // Float32Array platform endianness'ını kullanır; tüm hedef tarayıcılar LE,
  // yine de DataView ile açıkça LE okuyarak garantiye alıyoruz.
  const dv = new DataView(buf);
  const raw = new Float32Array(n * n);
  for (let i = 0; i < raw.length; i++) raw[i] = dv.getFloat32(i * 4, true);
  for (let i = 0; i < raw.length; i++) {
    if (!Number.isFinite(raw[i])) return fail(name, `grid.bin cell ${i} is not finite`);
  }

  // Sahneyi y≈0 civarında tutmak için medyanı çıkar (mutlak değer meta'da)
  const origin = Number.isFinite(meta?.elevation_m?.median)
    ? Math.round(meta.elevation_m.median)
    : 0;
  for (let i = 0; i < raw.length; i++) raw[i] -= origin;

  site.mode = 'dem';
  site.name = name;
  site.gridRes = n;
  site.cellM = cell;
  site.sizeM = (n - 1) * cell;
  site.heights = raw;
  site.heightOrigin = origin;
  site.meta = meta;
  site.loadError = null;
  site.climate = await loadClimate(base);
  site.geology = await loadGeology(base, n);
  site.layers = await loadJson(base, 'layers.json', (j) => decodeLayers(j, n));
  site.pov = await loadJson(base, 'pov.json', (j) => (j?.format === 'martian-map-pov/2' && Array.isArray(j.stations) && j.stations.length ? j : null));
  site.ortho = await loadJson(base, 'ortho.json', (j) => (j?.format === 'martian-map-ortho/1' && j.coverage > 0.5 ? j : null));
  site.chemistry = await loadJson(base, 'chemistry.json', (j) => (j?.format === 'martian-map-chemistry/1' && Array.isArray(j.targets) && j.targets.length ? j : null));
  site.track = await loadJson(base, 'track.json', (j) => (j?.format === 'martian-map-track/1' && Array.isArray(j.segments) && j.segments.length ? j : null));
  site.spaceWeather = await loadJson(base, 'space_weather.json', (j) => (j?.format === 'martian-map-space-weather/1' ? j : null));
  return site;
}

/** İsteğe bağlı climate.json (pipeline/build_climate.py). Yoksa/geçersizse null. */
async function loadClimate(base) {
  try {
    const r = await fetch(base + 'climate.json', { cache: 'no-cache' });
    if (!r.ok) return null;
    const c = JSON.parse(await r.text());
    if (c?.format !== 'martian-map-climate/1' || !Array.isArray(c.bins) || !(c.lsBinDeg > 0) || !(c.ltstStepH > 0)) return null;
    return c;
  } catch {
    return null;      // SPA fallback HTML veya ağ hatası → iklim katmanı yok
  }
}

/** Optional JSON file next to grid.bin; null if missing or invalid. */
async function loadJson(base, file, decode) {
  try {
    const r = await fetch(base + file, { cache: 'no-cache' });
    if (!r.ok) return null;
    return decode(JSON.parse(await r.text()));
  } catch {
    return null;
  }
}

/** İsteğe bağlı geology.json (pipeline/build_geology.py). Yoksa/geçersizse null. */
async function loadGeology(base, n) {
  try {
    const r = await fetch(base + 'geology.json', { cache: 'no-cache' });
    if (!r.ok) return null;
    return decodeGeology(JSON.parse(await r.text()), n);
  } catch {
    return null;
  }
}

/**
 * Yerel (x doğu, z güney) metre → yaklaşık enlem/boylam.
 * Pipeline'daki yerel eqc projeksiyonunun tersi (merkezde gerçek ölçek).
 */
export function localToLatLon(x, z) {
  const m = site.meta;
  if (!m) return null;
  const R = m.projection?.mars_radius_m ?? 3396190;
  const lat0 = m.center.lat_deg;
  const lon0 = m.center.lon_deg_east;
  const lat = lat0 + (-z / R) * (180 / Math.PI);
  const lon = lon0 + (x / (R * Math.cos((lat0 * Math.PI) / 180))) * (180 / Math.PI);
  return { lat, lon };
}
