/**
 * Relief shading from the 1 m HiRISE DTM (pipeline/build_relief.py → public/sites/<site>/relief.jpg).
 * The 3D mesh is the 4 m grid; the map holds the DTM's surface normals relative to the horizontal
 * (R east, G north, B up = 127.5·(n+1); row 0 = north = UV v 1, col 0 = west = UV u 0).
 */
import { SITE, IS_DEM } from '../three/terrainGenerator.js';

export const RELIEF_SCALES = [1, 2, 4];

export const hasRelief = () => IS_DEM && !!SITE.relief;

export function reliefUrl() {
  return `${import.meta.env?.BASE_URL ?? '/'}sites/${SITE.name}/${SITE.relief?.file || 'relief.jpg'}`;
}

/** A copy of the terrain geometry with every vertex normal pointing up: the relief map supplies the slopes. */
export function flatNormalGeometry(geo) {
  const g = geo.clone();
  const n = g.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  n.needsUpdate = true;
  return g;
}

/** Decode one relief-map pixel (0–255 RGB) to the unit normal {east, north, up}. */
export function decodeReliefPixel(r, g, b) {
  const e = r / 127.5 - 1, nn = g / 127.5 - 1, u = b / 127.5 - 1;
  const l = Math.hypot(e, nn, u) || 1;
  return { east: e / l, north: nn / l, up: u / l };
}

/** Slope in degrees of a decoded normal, with the shading emphasis applied (scale 1 = true slope). */
export function shadedSlopeDeg({ east, north, up }, scale = 1) {
  return Math.atan2(Math.hypot(east, north) * scale, up) * 180 / Math.PI;
}
