# Final integration, regression testing & validation

*Interplanetary Survival Guide: Martian Map* · NASA Space Apps Challenge 2026 · Team PERIAPSIS · 14 Nov 2026

This report covers the final integration pass over all modules: mission objectives, data provenance, hazard map, science stops, payload, dust, terrain & mobility, oxygen and EVA safety. Every test result below was produced by running the suite in this pass. Browser checks were made on the production build in headless Chromium.

## 1. Architecture

```
Site files (public/sites/<site>/)  ──► terrain/siteData.js (one loader, one grid, one projection)
         │
         ▼
config/  objectives · provenance · marswalkProfile (EVA limits, hazard thresholds, the one 30-min reserve)
         mission (suit, carry limit, sciencePlanKey) · dust · oxygen
         │
         ▼
planner  science.js (candidates + Held–Karp)  →  pathfinder.js (A*, Dijkstra home maps, walk-back margin,
         point of no return, route stats)  — runs in a Web Worker (planner.worker.js)
         │
         ▼
assess   missionStatus.js  ← the ONE decision: GO / CONDITIONAL / NO-GO / INSUFFICIENT DATA
         payload.js · dust.js · mobility.js · oxygen.js   (three separate assessments + oxygen, no combined score)
         │
         ▼  evaAssessments(route, spaceWeather, {mission, startMs})  — the same objects feed:
UI       panel (decision, EVA assessment, mission summary) · EVA HUD status line · cuff card · JSON export
sim      evaPlayback.js (mission clock: walking, stops, abort, oxygen) → EvaHud / OxygenPanel
```

Every output (panel, HUD, cuff card, export) calls `evaAssessments()` with the current mission configuration. Nothing is cached between them, so a configuration change is visible everywhere on the next render.

## 2. Integration issues found and resolved

| # | Issue found | Kind | Resolution |
|---|---|---|---|
| 1 | The 30-min reserve was written in three places (Mars-conservative budget, decision reserve, default O₂ reserve) | repeated configuration | One constant, `APOLLO17_RESERVE` (marswalkProfile), used by all three |
| 2 | "Steep" (15°) and "rough" (0.25 m) thresholds were repeated in the planner, stop cards and hazard map | repeated configuration | All read `HAZARD_PARAMS.steepFraction` / `roughFraction`; the unused `STEEP_DEG` was removed |
| 3 | After re-planning, a loaded EVA playback could still show the old route | stale result | Re-planning closes the playback and logs it |
| 4 | Changing the objective left the previous objective's stops on screen | stale result | The stops are re-planned for the new objective; a science plan made under other EVA limits / buffer / rover / stop time is flagged (`sciencePlanKey`) |
| 5 | When no stop fitted, the previous stops stayed | stale result | They are cleared, with a message |
| 6 | Waypoints outside the 2 km site or with non-finite coordinates were silently clamped to the edge, and a 5 km-away point planned GO | wrong coordinates | `assertInSite()` rejects them in the planner and the science start (share links included), with a clear message |
| 7 | Path smoothing moved and thinned the stop vertices: a science stop could lie 8 m off the route and its stay was placed on a neighbouring vertex | verified defect | Stop / waypoint vertices are pinned through smoothing and thinning; the stay is placed on the stop's own vertex. A*, Dijkstra and Held–Karp are unchanged; Moon mode keeps the old call |
| 8 | The workflow strip had 10 steps and marked steps done regardless of their inputs | inconsistent workflow | 13 steps, as in the brief; a step is done only when its inputs are complete and current (e.g. dust settings all specified, stops planned for the current objective) |
| 9 | The cuff card had no coordinates, objective, hazards, equipment or dust warnings, return direction or data limits | incomplete output | Added (one A4 page kept); the card uses the same assessment objects as the panel |
| 10 | The EVA HUD did not show the decision, payload, dust or mobility status | incomplete simulation view | A status line with the live decision, objective, payload, dust warnings, mobility and route hazards |
| 11 | The provenance table had no entry for suit mass / carry limit, oxygen or dust | provenance gap | Three entries added: modelled (sourced study), modelled (BVAD reference × simulated time), derived (qualitative, lunar evidence labelled) |
| 12 | Phone: the taller HUD covered the site switcher during an EVA | layout | The O₂ detail line is dropped on phones; HUD top 97 px, switcher bottom 80 px |
| 13 | README route figures changed slightly after fix 7 | documentation | All objective, limit-set and buffer figures recomputed from the planner and updated |
| 14 | Cuff card "data limits" repeated the dust warnings | output | Only data notes (transferred RAD, ground known only from orbit) and fixed data limits are shown |

## 3. Files modified in this pass

- **Code:**
  - `web/src/App.jsx`
  - `components/RightPanel.jsx`, `components/CuffCard.jsx`, `components/EvaHud.jsx`, `components/EvaAssessment.jsx`, `components/OxygenPanel.jsx`
  - `config/marswalkProfile.js`, `config/mission.js`, `config/oxygen.js`, `config/provenance.js`
  - `utils/pathfinder.js`, `utils/missionStatus.js`, `utils/mobility.js`, `utils/stopCards.js`, `utils/cuffCard.js`
- **Tests (new):**
  - `tests/siteConsistency.test.mjs`
  - `tests/edgeCases.test.mjs`
  - `tests/helpers/routeConsistency.mjs`
- **Tests (extended):** new tests added to `realMobility.test.mjs`, `realOxygenGale.test.mjs` and `cuffCard.test.mjs`, and a fixture field added in `mobility.test.mjs`. No existing assertion was removed or weakened.
- **Docs:**
  - `README.md`
  - `docs/CHALLENGE_COMPLIANCE.md`
  - this file
- **Package:** `MartianMap/app` (offline build) rebuilt.

## 4. The safety model (unchanged rules, one place)

| Group | Rules | Effect |
|---|---|---|
| Hard constraints | walk-back margin ≥ 0 everywhere · slope ≤ limit · distance ≤ limit · carried weight ≤ 45 kg Earth-eq. · O₂ for the walk home from every point · rover walk-back (rover mode) · daylight | any fails → **NO-GO**; one cannot be evaluated (no start time, invalid O₂ or payload entry) → **INSUFFICIENT DATA** |
| Environment | space weather (SEP ±2 d, or unknown) · margin < 30-min reserve · O₂ reserve not kept · route crosses a depression / obstacle edge | any open → **CONDITIONAL** |
| Notes | transferred RAD reference · ground known only from orbit · dust & equipment warnings | shown; never change the status |

Order: NO-GO before INSUFFICIENT DATA before CONDITIONAL before GO. A favourable payload, dust or oxygen result cannot override a failed hard constraint; this is tested on a real route. Dust never rejects a route: no documented operational rule was found that would justify it. Missing information is never GO.

## 5. Regression test results (executed)

| Suite | Result |
|---|---|
| `node --test web/tests/*.test.mjs` (30 files) | **138 / 138 pass** (before this pass: 123) |
| `python -m unittest discover pipeline/tests` | **7 / 7 pass** |
| Production build (`vite build`) | succeeds |
| Offline package (`pipeline/build_offline.py`) | builds; served from `MartianMap/app`: Gale and `?site=moon` load with no page errors |

## 6. Jezero validation

| Check | Result |
|---|---|
| Five objectives give different stops; every stop serves its objective | pass (`realJezero.test.mjs`) |
| CRISM minerals and THEMIS thermal inertia on the DTM grid; centre 18.44°N 77.45°E; 97 rover positions match their lat/lon (< 2 m) | pass (`siteConsistency.test.mjs`) |
| RAD shown as a transferred Gale reference ("not a local measurement") | pass (`realJezero`, `provenance`) |
| For all 5 objectives: stops reachable and on the route, stop time counted, margin at each stop, PONR, decision agrees with the route | pass (`realMobility.test.mjs`) |
| Payload / dust settings do not change routes or walking times; Mars speed factor applies outbound and on the return | pass |
| Oxygen: sized tanks agree with the budget / reserve; a 1 kg tank is NO-GO only for the cryogenic architecture; real-route playback with abort | pass |
| Edge cases (§7) | pass (`edgeCases.test.mjs`) |
| Browser (desktop 1500×950, tablet 820×1180, phone 390×844): plan *Olivine-Smectite*, start the EVA | 13-step workflow; no horizontal scroll; HUD does not overlap the panel or sheet; HUD status `CONDITIONAL · payload within limit · dust 3 warnings · mobility caution · hazards: 20 m closed depression`; no page errors |
| Cuff card | shows coordinates, objective, stations with BACK and direction home, hazards, payload / O₂ / mobility, dust warnings, data limits; **prints on 1 A4 page** (PDF checked) |

## 7. Gale validation

| Check | Result |
|---|---|
| Boxwork objectives (ridge & hollow, water-related alteration with per-unit weights) | pass (`realGale.test.mjs`, `objectives.test.mjs`) |
| ChemCam targets: inside the site, next to the rover position of their sol; one stop per rock | pass |
| RAD local; REMS climatology loaded | pass (`realGale`, `climate`) |
| Derived geology labelled "NOT an official published GIS geologic map" | pass (`provenance.test.mjs`) |
| 137 rover positions match their lat/lon (< 2 m); all layers on the grid; centre 4.8115°S 137.384°E | pass |
| For all 5 objectives: route and science consistency | pass (`realOxygenGale.test.mjs`) |
| Oxygen in planning and on the played-back route | pass |
| Offline package: objective UI and workflow present, no errors | pass |

## 8. Moon compatibility

| Check | Result |
|---|---|
| `?site=moon`: procedural terrain, no Mars objectives, all four route modes plan around craters | pass (`moonMode.test.mjs`) |
| Oxygen check not applied (no walk-back profile) | pass |
| Browser (production build and offline package): no workflow strip, no objective UI, no page errors | pass |
| Path smoothing in Moon mode unchanged (no pinned vertices) | by construction (`smoothPath(rawPath)` call unchanged) |

## 9. Edge cases (all on real Jezero data)

| Case | Behaviour | Test |
|---|---|---|
| Missing data (no route / no start time / no layer) | INSUFFICIENT DATA, or listed as missing | `edgeCases`, `missionStatus`, `dust` |
| Invalid coordinates (outside the site, NaN) | rejected with a message, never clamped | `edgeCases` |
| Empty science stop list | empty result, previous stops cleared in the app | `edgeCases` |
| Impossible target (inside a wall) | route ends on the nearest walkable cell | `edgeCases` |
| Payload over the limit | NO-GO through the carry rule; mobility unaffected | `edgeCases`, `mobility` |
| Missing dust protection settings | dust INSUFFICIENT DATA; decision unchanged | `edgeCases`, `dust` |
| Excessive slope | NO-GO; not overridden by any other assessment | `edgeCases` |
| Negative walk-back margin | point of no return; NO-GO; oxygen NO-GO; mobility FAIL | `edgeCases` |
| Future space-weather date | "does not forecast", never GO | `edgeCases`, `missionStatus` |

## 10. Feature status

| Feature | Status |
|---|---|
| Mission objective selector (5 + 5) that changes stop selection | Implemented and tested |
| Lake-and-delta objective at Jezero | Partially implemented (delta outside the 2 km site) |
| Data provenance (direct / orbital / derived / transferred / modelled / simulated), incl. payload, oxygen, dust | Implemented and tested |
| Hazard map and obstacle buffer | Implemented and tested |
| Science stops with explanations | Implemented and tested |
| Payload & mass | Implemented and tested |
| Dust exposure & equipment reliability (qualitative) | Implemented and tested |
| Terrain & mobility | Implemented and tested |
| Oxygen & carried mass | Implemented and tested |
| GO / CONDITIONAL / NO-GO / INSUFFICIENT DATA | Implemented and tested |
| 13-step workflow with completeness | Implemented, browser-checked; the step logic has no unit test of its own (implemented but not fully validated) |
| EVA simulation with status line and O₂ panel | Implemented and tested (controller); HUD browser-checked |
| Cuff card with the full mission content, one page | Implemented and tested (rows); content and page count browser-checked |
| JSON export with objective, stop cards, decisions, assessments, provenance | Implemented, browser-checked (implemented but not fully validated) |
| Bundled DONKI archive | Partially implemented: needs the repository secret `NASA_API_KEY`; live lookup otherwise |
| Gale CRISM mineral map | Blocked by unavailable data |
| Gale THEMIS thermal inertia (quantitative) | Blocked by unavailable data |
| Jezero SuperCam / PIXL chemistry layer | Blocked by unavailable data |
| Quantitative dust degradation, O₂ tied to activity, load–speed effect | Not implemented: no validated source; documented as limitations |

## 11. Scientific limitations

- **EVA limits.** The lunar ConOps values are optimistic for Mars. The Mars-conservative set is derived; its speed assumes cost ∝ speed.
- **Radiation at Jezero** is a Gale RAD reference. Solar particle events are not modelled.
- **Hazard thresholds** other than the 20° slope are assumptions or design choices. The 1 m DTM misses rocks under ~2 m.
- **Gale geology** is derived (elevation band + DEM relief) and assumes near-horizontal layers.
- **Dust** is qualitative. Most evidence is lunar, used as an analogy. The Perseverance suit-material results are not yet published per material.
- **Oxygen rates** are BVAD architecture references, constant per scenario. The initial O₂ is sized when not entered, and the suit mass is assumed to include it.
- **Payload** does not change walking speed.
- **Air temperatures** are a climatology, and **DONKI** does not forecast.

## 12. Remaining technical debt

- `RightPanel.jsx` is ~2,000 lines. `evaAssessments()` and `useSpaceWeather()` live there and are imported by `App.jsx`; they belong in a utility module or a hook file.
- Browser checks (three viewports, cuff-card PDF, offline package) were run with Playwright scripts outside the repository. They are not part of CI.
- The README route figures are written by hand from the planner. A script that regenerates them would prevent drift.
- The workflow completion rules have no unit test. Neither does the JSON export shape.
- The HUD status line recomputes the assessments on every App render. This is cheap, but could be memoised.
- The bundled DONKI archive still waits for the repository secret.

## 13. Challenge requirement coverage

| Challenge requirement | Where |
|---|---|
| Identify a science objective and a location | objectives (5 per site) + two sites; the objective drives stop selection |
| Use NASA data, traceable | provenance table and README data matrix; every layer with mission, instrument, source, processing, kind |
| Distinguish measured, orbital, derived, transferred, modelled, simulated | provenance categories, shown in the app and the export |
| Plan a safe EVA route | A* on walking time, walls, buffer, Dijkstra walk-back, point of no return, daylight, rover walk-back, oxygen |
| Explain the go / no-go decision | the four-state decision with its reasons; panel, HUD, cuff card, export |
| Consider the suit, equipment and environment | payload & mass, dust & equipment, terrain & mobility, oxygen & mass, radiation, space weather |
| Communicate the plan to the crew | printable one-page cuff card, EVA playback, share link, JSON |

**Acceptance criteria:** each criterion in the brief was checked against code and tests in this pass:

- objectives drive the planning
- sources are traceable
- measured and derived information are distinguishable
- stops carry their reasons
- routes respect the constraints, and stops now lie on the route
- payload, dust and mobility are separate
- decisions are explained
- the cuff card is the current plan
- Jezero, Gale and Moon work
- all tests pass
- the README matches the implementation

The open items are the blocked datasets and the limitations above. They are stated in the app and the README.
