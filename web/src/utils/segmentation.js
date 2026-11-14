/**
 * Mars AI terrain segmentation — image-level predictions made by the pipeline (pipeline/segmentation/).
 *
 * The predictions are MODEL OUTPUT for individual rover images, linked to the rover position the image was taken
 * from. They are not georeferenced (no camera model or range data are used), so they are never drawn on the
 * orbital map and never change routes or safety rules. Pure: tested in Node (tests/segmentation.test.mjs).
 */

export const SEG_CLASSES = [
  { value: 0, key: 'soil', label: 'Soil' },
  { value: 1, key: 'bedrock', label: 'Bedrock' },
  { value: 2, key: 'sand', label: 'Sand' },
  { value: 3, key: 'big_rock', label: 'Big rock (≥ 30 cm high, ≥ 50 cm wide)' },
];
export const UNKNOWN = 255;
/** Fallback palette (the model card's palette is used when present): earth, brown, yellow-orange, red, grey. */
export const DEFAULT_PALETTE = { 0: [166, 124, 82], 1: [122, 74, 40], 2: [240, 178, 50], 3: [214, 48, 39], 255: [128, 128, 128] };

/**
 * Colour a class mask into RGBA pixels.
 * @param {Uint8ClampedArray|number[]} gray  one value per pixel (0–3, 255)
 * @param {object} palette  value → [r,g,b]
 * @param {number} alpha    0–255 for classified pixels
 * @param {number} unknownAlpha  0–255 for unknown / low-confidence pixels (0 = transparent)
 */
export function colorizeMask(gray, palette = DEFAULT_PALETTE, alpha = 255, unknownAlpha = 110) {
  const out = new Uint8ClampedArray(gray.length * 4);
  for (let i = 0; i < gray.length; i++) {
    const v = gray[i];
    const c = palette[v] || palette[UNKNOWN];
    out[i * 4] = c[0]; out[i * 4 + 1] = c[1]; out[i * 4 + 2] = c[2];
    out[i * 4 + 3] = v === UNKNOWN || !palette[v] ? unknownAlpha : alpha;
  }
  return out;
}

/** Confidence (0–255 grey) → RGBA: low = red, high = green. */
export function colorizeConfidence(gray, threshold) {
  const out = new Uint8ClampedArray(gray.length * 4);
  const t = Math.round(threshold * 255);
  for (let i = 0; i < gray.length; i++) {
    const v = gray[i];
    out[i * 4] = v < t ? 230 : 40; out[i * 4 + 1] = v < t ? 60 : Math.round(80 + 0.6 * v); out[i * 4 + 2] = 50; out[i * 4 + 3] = 255;
  }
  return out;
}

/** Pixel statistics of a class mask (counts, shares; unknown counted separately). */
export function maskStats(gray) {
  const counts = { soil: 0, bedrock: 0, sand: 0, big_rock: 0, unknown: 0 };
  for (let i = 0; i < gray.length; i++) {
    const c = SEG_CLASSES[gray[i]];
    if (c && gray[i] <= 3) counts[c.key]++; else counts.unknown++;
  }
  const n = gray.length;
  return { pixels: n, counts, shares: Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, n ? v / n : 0])) };
}

/** Nearest prediction to a site position (by the rover position the image was taken from). */
export function nearestPrediction(items, x, z) {
  let best = null, d = Infinity;
  for (const it of items || []) {
    const dd = Math.hypot(it.rover_x - x, it.rover_z - z);
    if (dd < d) { d = dd; best = it; }
  }
  return best ? { item: best, distanceM: d } : null;
}

const REQUIRED = ['id', 'image_url', 'mission', 'camera', 'sol', 'station', 'rover_x', 'rover_z', 'rover_lat', 'rover_lon', 'image_size', 'mask_size', 'fractions', 'confidence'];
/** Integrity check of a site's segmentation index; returns a list of problems (empty = fine). */
export function validateIndex(index, halfM = Infinity) {
  const errs = [];
  if (!index || !Array.isArray(index.items)) return ['no items'];
  if (!index.model) errs.push('no model version');
  if (!/not georeferenced/.test(index.kind || '')) errs.push('kind must state that predictions are not georeferenced');
  for (const it of index.items) {
    for (const k of REQUIRED) if (it[k] === undefined || it[k] === null) errs.push(`${it.id || '?'}: missing ${k}`);
    if (Math.abs(it.rover_x) > halfM || Math.abs(it.rover_z) > halfM) errs.push(`${it.id}: rover position outside the site`);
    const f = it.fractions || {};
    const sum = ['soil', 'bedrock', 'sand', 'big_rock', 'unknown'].reduce((a, k) => a + (f[k] || 0), 0);
    if (Math.abs(sum - 1) > 0.01) errs.push(`${it.id}: class shares sum to ${sum.toFixed(3)}`);
    const c = it.confidence || {};
    for (const k of ['mean', 'median', 'p10']) if (!(c[k] >= 0 && c[k] <= 1)) errs.push(`${it.id}: confidence ${k} outside 0–1`);
    if (it.mask_size && it.image_size) {
      const ar = (a) => a[0] / a[1];
      if (Math.abs(ar(it.mask_size) - ar(it.image_size)) > 0.02) errs.push(`${it.id}: mask aspect differs from the image`);
    }
  }
  return errs;
}
