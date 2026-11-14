# Challenge compliance — audit and feature status

*Interplanetary Survival Guide: Martian Map* · NASA Space Apps Challenge 2026 · Team PERIAPSIS

This file records the technical audit made before the compliance work, what was changed, and the status of every feature, so the team and the judges can see what is implemented, what is tested and what is limited by the available data.

Status key: **✅ implemented and tested** · **🟡 partially implemented** · **⛔ blocked by unavailable data** · **— not implemented**

## 1. Audit (before the changes)

Baseline: 64 JavaScript tests and 7 Python tests, all passing.

Each of the 13 core features listed in the brief was found in the code and in at least one test:

| Feature | Where | Test |
|---|---|---|
| A* route planning | `web/src/utils/pathfinder.js` (`aStar`) | `walkback.test.mjs`: A* reaches the Dijkstra optimum in every mode |
| Dijkstra walking times | `utils/walkback.js` (`dijkstraTimes`, `homeTimeMaps`) | `walkback.test.mjs` |
| Held–Karp stop optimisation | `utils/science.js` (`optimizeTour`) | `science.test.mjs`: equals brute force on 40 random cases |
| Terrain slope | `three/terrainGenerator.js`, wall map in `pathfinder.js` | `marswalk.test.mjs` |
| Rock obstacles | rock-relief layer → walls (`getWallMap`) | `marswalk.test.mjs`, pipeline tests |
| Walk-back margin | `walkback.js` (`walkbackProfile`) | `walkback.test.mjs`, `marswalk.test.mjs` |
| Point of no return | `ponrIdx` in `walkbackProfile` | `walkback.test.mjs` |
| GO / NO-GO checks | `computeDemStats` → `checks` | `marswalk.test.mjs`, `mission.test.mjs` |
| Radiation | `utils/radiation.js` | `radiation.test.mjs`, `doseComparison.test.mjs` |
| DONKI | `spaceWeatherAt`, `fetchSpaceWeatherLive` | `radiation.test.mjs` (SEP window) |
| EVA simulation | `utils/evaPlayback.js` | `eva.test.mjs` |
| Cuff card | `utils/cuffCard.js` | `cuffCard.test.mjs` |
| NASA layer display | `utils/heatmaps.js`, `terrain/layers.js` | `climate.test.mjs`, `chemistry.test.mjs`, pipeline tests |

Gaps the brief points at, found in the audit:

- **Science objective.** It was fixed per site and implicit in the scoring weights. There was nothing to choose and no reason given per stop.
- **Provenance.** Sources were in the README and a text box. The kind of each layer was not stated in one place: measured, orbital, derived or transferred.
- **Decision.** Only GO / NO-GO existed. Space weather and other environmental factors were advisories that never changed the result, so unknown space weather still allowed GO.
- **Hazards.** Only planner walls (slope, rock) were shown. Depressions, an obstacle buffer and unseen ground were not.
- **Duplicate stops.** Two ChemCam anomalies of the same rock could become two stops at the same place.

## 2. Feature status after the changes

| Phase | Feature | Status | Notes |
|---|---|---|---|
| 2 | Mission objective selector (5 Jezero + 5 Gale) | ✅ | `config/objectives.js`. Filters the candidates and sets the weights in `science.js`; planning is locked until an objective is chosen; carried in the share link |
| 2 | Purpose / relevance / layers / candidates / criteria / uncertainty per objective | ✅ | Shown in the panel with sources; tests check that every name exists in the site data |
| 2 | Per-stop explanation | ✅ | `utils/stopCards.js`: why chosen, what to investigate, evidence, layers, uncertainty |
| 2 | Ancient Lake **and Delta** | 🟡 | The delta lies outside the 2 km site, so only crater-floor rocks can be sampled. Shown as "partial" |
| 3 | Unified provenance (all fields, six kinds) | ✅ | `config/provenance.js` + provenance table; values read from the site files |
| 3 | Jezero RAD shown as a transferred reference | ✅ | In provenance, the sun panel, decision notes and mission summary |
| 3 | Gale geology shown as a derived interpretation | ✅ | "NOT an official published GIS geologic map" |
| 4 | Gale CRISM | ⛔ | No processed, published mineral map of the site was found; raw cubes would need spectral processing we have not validated |
| 4 | Gale THEMIS thermal inertia | ⛔ | Only a qualitative TI image without physical units (THEMIS MSL landing-site products, 100 m/px, 2006) |
| 4 | Jezero SuperCam / PIXL | ⛔ | SuperCam major oxides exist as supplementary CSV in the PDS Analyst's Notebook ("not archived products"), without target coordinates; PIXL maps mm-scale patches |
| 5 | Hazard map (slope, rocks, buffer, depressions, steep, rough, rover reach, known only from orbit) | ✅ | `utils/hazards.js`, *Hazards* layer; thresholds in `HAZARD_PARAMS` with their status |
| 5 | Obstacle inflation | ✅ | *Mission setup → keep 4 m from obstacles* inflates the planner walls |
| 5 | Craters / depressions | ✅ | Priority-flood sink depth ≥ 1 m (assumption); only what the 1 m DTM resolves |
| 6 | GO / CONDITIONAL / NO-GO / INSUFFICIENT DATA with reasons | ✅ | `utils/missionStatus.js`; hard constraints vs environment vs notes; missing data is never GO |
| 7 | RAD and DONKI separated, with dates, places and limits; no forecast claim | ✅ | Sun panel, provenance, decision; a future date shows "unknown", never "clear" |
| 7 | Bundled DONKI archive | 🟡 | Pipeline and workflow ready; needs the repository secret `NASA_API_KEY`. Without it the app looks DONKI up live and says "unknown" offline |
| 8 | 10-step workflow | ✅ | Strip at the top of the panel; each step jumps to its section; step 5 opens the Hazards layer |
| 8 | Science stop cards | ✅ | Name, coordinates, objective, importance, layers, visit time, terrain risk, data confidence, rationale |
| 8 | Mission summary | ✅ | From the planner's own stats; the same decision as the route cards and the cuff card |
| 8 | Mission export | ✅ | JSON v2 adds objective, stop cards, decisions and provenance; cuff card; share link |
| 9 | NASA tools and inspiration section | ✅ | README: Mars / Moon / Solar System Treks, Worldview, Eyes on the Solar System, Eyes on Exoplanets, Apollo cuff checklists, Curiosity route maps |
| 10 | README to match the implementation | ✅ | |
| 10 | Tests for new functionality; Jezero, Gale and Moon separately | ✅ | `objectives`, `provenance`, `hazards`, `missionStatus`, `moonMode`, `realJezero`, `realGale` |

## 3. Algorithm changes

- **`science.candidateStops`** has a new optional `filter`. It covers units, contacts, CRISM classes, ChemCam anomaly tags and measured targets, plus `contactOnlyTags`. Without a filter the planner behaves exactly as before, and the existing tests run unchanged.
- **`science.tagWeight`** accepts per-unit weights, so only the named terrain classes score.
- **`science.planScienceEva`** drops candidates that are worth nothing to the objective. Held–Karp itself is unchanged.
- **Rock merging.** ChemCam anomalies and targets that fall in one 4 m cell become one stop.
- **`pathfinder.getWallMap`** can dilate the walls by the obstacle buffer. The home walking-time maps are now keyed by limit set + buffer.
- **Daylight** is a hard constraint, unchanged from the previous release.

## 4. Scientific assumptions (all labelled in the app)

- Objective weights rank what an objective cares about. They are not scientific scores.
- Hazard thresholds other than the 20° slope limit are assumptions or design choices: buffer 4 m, depression 1 m, steep 15°, rough 0.25 m, ground-view distance 100 m.
- "CaO high" is a proxy for calcium-sulfate veins, because this ChemCam product has no sulfur.
- The 30-min reserve is taken from the Apollo 17 traverse planning data.
- Earlier assumptions are unchanged: the Tobler slope–speed shape, the Mars-conservative speed factor, the ±2-day SEP window and 20 min per stop.

## 5. Test results

| | Before | After |
|---|---|---|
| JavaScript (`node --test web/tests/*.test.mjs`) | 64 | 94 |
| Python (`python -m unittest discover pipeline/tests`) | 7 | 7 |

All tests pass. The existing assertions were kept; one label format was kept so that `science.test.mjs` runs unchanged. The production build was checked in a headless browser for Jezero, Gale and `?site=moon`, with no page errors:

- objective lock
- stop cards
- mission summary and decision
- Hazards layer and drape
- provenance table
- cuff card

## 6. Remaining limitations

- No CRISM or THEMIS layer at Gale, and no chemistry at Jezero: see phase 4.
- The bundled DONKI archive needs the repository secret `NASA_API_KEY`.
- The 1 m DTM cannot show rocks under ~2 m. No cell is certified rock-free.
- Gale units are derived (an elevation band and DEM relief) and assume near-horizontal layers.
- Ground-view images load from mars.nasa.gov, so they need an internet connection.

## 7. Follow-up: dust, spacesuit and equipment reliability

A separate task added three independent assessments under the decision: **Payload & Mass**, **Dust Exposure & Equipment Reliability** (qualitative, sourced, never a NO-GO by itself) and **Terrain & Mobility**. The audit, sources, rules and tests are in [`EVA_ASSESSMENT.md`](EVA_ASSESSMENT.md). Tests: 94 → 110 JavaScript, 7 Python.

## 8. Follow-up: dynamic oxygen consumption and carried mass

Oxygen is tracked on the EVA mission clock with NASA BVAD (NASA/TP-2015-218570 Rev 2) life-support reference scenarios. It is checked in planning (NO-GO / CONDITIONAL / INSUFFICIENT DATA) and shown live with charts. Carried mass falls as oxygen is used, without changing walking speed. Details: [`OXYGEN_AND_MASS.md`](OXYGEN_AND_MASS.md). Tests: 110 → 123 JavaScript, 7 Python.
