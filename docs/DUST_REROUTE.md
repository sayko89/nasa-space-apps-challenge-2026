# Dust devil during an EVA — go around it, or go home

`web/src/utils/dustReroute.js`, called by `EvaPlayback._dustAhead()` (`web/src/utils/evaPlayback.js`).

## Trigger (unchanged)
Every frame the playback looks 10 minutes of walking ahead (`HAZARD_LOOKAHEAD_S = 600`). When the
route comes within the dust devil's trigger radius (`interferenceRadius` = 1.35 × 35 m), the
decision below runs instead of an immediate abort.

## Decision
1. **No-go disc**: trigger radius + safety distance (`DUST_REROUTE.safetyMarginM`, 25 m, design choice).
   Stops inside the disc are skipped. If the crew is already inside it, there is nothing to plan → abort.
2. **Re-plan from where the crew stands** to the remaining stops and home (SAFE mode, same A*, same
   walking model), with the disc closed (`planAllRoutes(…, { block, strict: true })`). Strict mode
   returns a definite "no path" instead of the old BFS fallback that walked to the nearest cell.
   If the crew is sampling a stop, that stop is finished first.
3. **Accept** the new route only if:
   * no point comes within the trigger radius (else the alarm would fire again);
   * at every point the crew can walk home **around the dust devil** within the EVA budget,
     counting the time already spent (walk-back margin ≥ 0, Dijkstra over walls ∪ disc);
   * the oxygen left covers the rest of the plan plus the reserve (same `oxygenState` as the HUD);
   * the crew is home before sunset (when the sun position is known).
4. Accepted → the timeline is spliced at the current time (walked part kept, stop numbers kept),
   the live margin and the oxygen check use the walk-home times around the dust devil, the new route
   is drawn in yellow, and the log says the extra time and the skipped stops.
   Rejected → abort; the walk home avoids the dust devil when a path exists (orange dashed),
   otherwise the old fastest path home.
5. A second alarm for the same dust devil → abort (no second re-plan). A new dust devil may be
   avoided again. *Restart* returns to the plan as loaded.

## Limits (say this to the jury)
* The dust devil does not move; real ones drift with the wind.
* The 35 m radius, ×1.35 trigger and 25 m safety distance are illustrative design choices.
* No NASA source was used for an EVA dust-devil avoidance procedure — this is a planning
  demonstration, not an operational rule.
* The re-plan runs on the main thread: ~0.1–0.25 s on the Jezero grid (measured in Node).

## Tests
`web/tests/eva.test.mjs`: around a dust devil on the leg (both stops kept, never within the
trigger radius, home, margin ≥ 0, restart), dust devil on a stop (skipped), budget too tight
(abort, walk home clear of it), strict "no path" when it closes home, second alarm → abort.
