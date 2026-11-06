/**
 * The site's orbital image (public/sites/<site>/ortho.jpg, pipeline/build_ortho.py): a HiRISE
 * orthomosaic warped onto the site grid, row 0 = north, col 0 = west — the same layout as the
 * terrain mesh UVs and the map canvas. Loaded once and shared by the 3D scene and the map.
 */
import { SITE } from '../three/terrainGenerator';

let _promise = null;

export const hasOrtho = () => !!SITE.ortho;

export function orthoUrl() {
  return `${import.meta.env.BASE_URL}sites/${SITE.name}/${SITE.ortho?.file || 'ortho.jpg'}`;
}

/** Promise<HTMLImageElement | null> — null when the site has no image or it fails to load. */
export function loadOrthoImage() {
  if (!hasOrtho() || typeof Image === 'undefined') return Promise.resolve(null);
  if (!_promise) {
    _promise = new Promise((resolve) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = orthoUrl();
    });
  }
  return _promise;
}
