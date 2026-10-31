/**
 * Panel layout constants. The Martian Map (DEM) panel is drawn 25% larger than
 * the legacy Moon panel so it stays readable on a projector / in the demo video.
 */
import { IS_DEM } from '../three/terrainGenerator';

export const UI_SCALE = IS_DEM ? 1.25 : 1;
export const PANEL_W = Math.round(218 * UI_SCALE);          // right panel width [px]
export const MAP_S = PANEL_W - 16;                           // mini-map / heatmap canvas [px]
/** Scaled font size. */
export const fs = (px) => Math.round(px * UI_SCALE * 10) / 10;
