/**
 * Helmet-camera elevation readouts, from the site DTM (measured orbital elevation, HiRISE stereo).
 * Nothing here is a model prediction: heights are bilinear samples of the 4 m DTM grid.
 * Pure: tested in Node (tests/helmetView.test.mjs).
 */

/** Distances ahead [m] shown on the helmet camera. */
export const AHEAD_M = [10, 25, 50, 100];

/**
 * Terrain ahead along the walking direction.
 * @param {(x:number,z:number)=>number} heightAt  DTM height [m, relative to originM]
 * @param {number} x, z      astronaut position [m] (site frame: x east, z south)
 * @param {number} heading   walking direction [rad]; forward = (sin h, cos h) — the helmet camera convention
 * @param {number} half      half the site width [m]: points outside the DTM are reported as null
 * @param {number} originM   add to get absolute (MOLA-referenced) elevation
 * @returns {{ hereM:number, absM:number, ahead: Array<{ d, absM, dhM, gradePct } | null> }}
 */
export function aheadProfile(heightAt, x, z, heading, half, originM = 0, distances = AHEAD_M) {
  const h0 = heightAt(x, z);
  const fx = Math.sin(heading), fz = Math.cos(heading);
  const ahead = distances.map((d) => {
    const px = x + fx * d, pz = z + fz * d;
    if (Math.abs(px) > half || Math.abs(pz) > half) return null;
    const h = heightAt(px, pz);
    if (!Number.isFinite(h)) return null;
    const dh = h - h0;
    return { d, absM: h + originM, dhM: dh, gradePct: (dh / d) * 100 };
  });
  return { hereM: h0, absM: h0 + originM, ahead };
}

/** Contour interval [m] for a visible height range: about 6–12 lines on screen. */
export function contourInterval(rangeM) {
  for (const c of [0.5, 1, 2, 5, 10, 20, 50]) if (rangeM / c <= 12) return c;
  return 100;
}

/**
 * Colour for a height relative to the astronaut (diverging: below = blue, level = sand, above = red).
 * @param {number} dh     height above the astronaut's ground [m]
 * @param {number} range  |dh| that saturates the colour [m]
 * @returns {[number,number,number]}
 */
export function elevationColor(dh, range) {
  const t = Math.max(-1, Math.min(1, dh / Math.max(1e-6, range)));
  const mid = [178, 150, 112];                      // level ground: Martian sand tone
  const lo = [58, 118, 196], hi = [214, 74, 46];    // below / above
  const end = t < 0 ? lo : hi, k = Math.abs(t);
  return mid.map((m, i) => Math.round(m + (end[i] - m) * k));
}
