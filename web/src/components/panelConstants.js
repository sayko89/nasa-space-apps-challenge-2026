/** Panel constants shared by RightPanel and its split-out parts. */
import { TERRAIN_SIZE, IS_DEM } from '../three/terrainGenerator';
import { PANEL_W, fs } from '../ui/layout';
import { GEOLOGY_LAYERS, dataLayerOptions } from '../utils/heatmaps';
import { SITE } from '../three/terrainGenerator';

export const HALF = TERRAIN_SIZE / 2;
export const PW   = PANEL_W;   // panel width (src/ui/layout.js)

// DEM: Mars layers only (rover-specific layers stay in the Moon mode)
export const HEATMAP_OPTIONS = IS_DEM
  ? ['Hazards','Elevation','Slope Angle','No-Go','EVA Range', ...(SITE.geology ? GEOLOGY_LAYERS : []), ...dataLayerOptions(), 'Illumination','Roughness']
  : ['Elevation','Slope','Slope Angle','No-Go','EVA Range','Roughness','Slip Risk','Illumination','Hazard Score','Traversability','Experience'];
export const HEATMAP_DEFAULT = IS_DEM ? (GEOLOGY_LAYERS.includes('Geology: Surface') ? 'Geology: Surface' : GEOLOGY_LAYERS[0] || 'Slope Angle') : 'Hazard Score';
export const CANVAS_FONT = (px, bold = false) => `${bold ? 'bold ' : ''}${fs(px)}px monospace`;
export const HM_COLORS = {
  'Thermal Inertia (THEMIS)':'#ff9966','Minerals (CRISM)':'#66ffcc','Rock Relief (HiRISE)':'#ddbb88',
  'Hazards':'#ff7088','Elevation':'#e8a878','No-Go':'#ff4466','EVA Range':'#66ddff',
  'Slope':'#aaddaa','Slope Angle':'#88ccff','Roughness':'#ffcc88',
  'Slip Risk':'#ff8844','Illumination':'#ffffaa','Hazard Score':'#ff6655','Traversability':'#44ffaa',
  'Experience':'#cc66ff', 'Geology: Bedrock':'#d6a060', 'Geology: Surface':'#e8c070',
};
export const ORTHO_LAYER = 'HiRISE image';   // compare-only layer: the orbital photo itself
export const CMP_TAG = { position:'absolute', top:4, maxWidth:'46%', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
  font:'bold 9px monospace', color:'#fff', background:'rgba(0,0,0,0.65)', padding:'1px 4px', borderRadius:2, pointerEvents:'none' };
export const WP_COLORS_2D = ['#22ff55','#ffcc22','#44ddff','#ff88ff','#ffaa33','#aaffaa'];
