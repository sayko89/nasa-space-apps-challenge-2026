/**
 * Display scale of the crew figures (true size ~1.9 m with helmet is a few pixels against 2 km of terrain).
 * Drawing only: positions, routes, speeds and every number are unchanged. Decimal point, not comma.
 * The follow camera frames both astronauts from it (components/MoonScene.jsx).
 */
export const CREW_SCALE = 9.4;
/** EV2 walks this far to EV1's right (metres at true size, × CREW_SCALE in the scene). */
export const EV2_SIDE_M = 1.3;
