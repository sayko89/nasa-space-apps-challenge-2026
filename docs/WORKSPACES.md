# Martian Map — workspaces redesign

The interface reorganisation of the Mars sites (Jezero, Gale) into four workspaces. It changes
**layout and presentation only**: every number still comes from the planner, the assessments and the
site files it came from before. The Moon simulator (`?site=moon`) keeps its original interface.

## 1. Reference review — what was taken, and from where

| Reference | Pattern used here | Not taken |
|---|---|---|
| NASA Mars Trek / Moon Trek (JPL Solar System Treks) | layer catalog grouped by kind of data; per-layer visibility, opacity and an info (metadata) view; stacked layers; measurement tools (distance, elevation profile) grouped apart from the map; click a point → coordinates and values | NASA branding, globe projection controls, bookmarks |
| JPL RSVP / HyperDrive | 3D terrain as the main view; route plotted on the terrain; validation of a plan against terrain constraints before execution | sequence/command editing |
| NASA Playbook (successor of SPIFe) | horizontal mission timeline with activities and fixed resource bands; constraint violations flagged on the timeline itself; plan and execution on the same timeline | crew self-scheduling, multi-crew editing |
| NASA Eyes | mission context kept visible (current site and mission are always shown) | free-flight camera |

Sources: Trek feature summary (OpenPlanetary, *Key features of Treks*); Playbook (NASA NTRS
20190032485, Marquez et al.). These are design references only; this app is not a NASA product.

## 2. Audit of the previous interface

One right-hand panel held everything (≈ 20 sections in one scroll): mini-map, terrain mode, waypoints,
mission setup, science EVA, Mars time, route & EVA controls, contingency, GO/NO-GO, camera, map
layers, helmet camera, telemetry, export, log. A 13-step workflow strip at the top scrolled to the
right section. The 3D view showed one draped layer at a time; provenance lived in a separate modal.
All state already lived in `App.jsx`, so workspaces can switch without losing anything.

## 3. Information architecture

```
TOP BAR   MARTIAN MAP · site switcher | 01 EXPLORE · 02 ANALYZE · 03 PLAN MISSION · 04 OPERATIONS | mission status (objective · route · decision · EVA)
EXPLORE   left: data catalog (categories → layers)   centre: 3D terrain   right: inspector + map tools (mini-map, measure, profile)
ANALYZE   left: data catalog                          centre: 3D terrain   right: terrain analysis (layers, compare), science datasets, helmet camera, provenance table
PLAN      centre: 3D terrain + EVA timeline band      right: mission configuration (expandable, values shown closed) · objective & stops · waypoints · route modes (with their cost) · route comparison
OPS       centre: 3D terrain + EVA timeline band      right: mission summary · decision & reasons · assessments · cuff card · EVA controls · contingency · telemetry · export
```

* **Inspector** — one component for a map location, a data layer, a science stop, a route and a hazard.
  Sections (Overview · Scientific evidence · Data source · Technical · Mission relevance) appear only
  when they have content. Explore and Analyze dock it in the right panel; Plan and Operations show it
  as a card over the map.
* **Data catalog** — built from what the site actually loaded (`src/config/catalog.js`). Categories
  without a dataset are not shown (e.g. AI segmentation until its model outputs exist on this branch).
  Several layers can be draped at once, each with its own opacity, in catalog order.
* **Mission workflow** — the 13 steps stay; each step opens the workspace that holds it.
* **Timeline** — walking legs, stops, return, point of no return, budget and sunset from the planned
  route (`stats` of the active route); the EVA cursor moves on it during playback.

## 4. Design system (Mars sites)

* Type: system UI sans for text, `ui-monospace` for numbers and coordinates; 11–13 px base.
* Colour roles (`src/ui/theme.js`): ground `#101215`, panel `#15181c`, raised `#1c2026`, rule `#2a3038`,
  text `#d9dde3`, muted `#8b949e`, accent (Mars ochre) `#d9894a`, link/info `#7fb2e6`.
  Status: GO `#4fb477`, CONDITIONAL `#e0b040`, NO-GO `#e5534b`, INSUFFICIENT DATA `#8b949e`.
  Data kinds reuse the provenance colours (measured, orbital, derived, transferred, modelled, simulated).
* Panels: square corners (2 px), 1 px rules, no glass blur, no glow; section headers 10 px caps.
* Status indicator: filled chip with the word (never colour alone).
* Map controls: grouped in one tool strip; no buttons floating over the terrain except the EVA HUD.

## 5. What was built (components)

| File | Role |
|---|---|
| `src/workspace/TopBar.jsx` | identity, site switcher, workspace tabs, mission status (objective · route · decision · EVA) |
| `src/workspace/LayerCatalog.jsx` | data catalog: search, categories, visibility, opacity, order, legends, ⓘ → inspector |
| `src/workspace/Inspector.jsx` | global inspector for point / layer / stop / route |
| `src/workspace/MissionTimeline.jsx` | EVA timeline band (Plan Mission, Operations) |
| `src/config/catalog.js` | catalog from the loaded site (pure) |
| `src/utils/inspect.js` | point inspection + mission relevance (pure) |
| `src/utils/missionTimeline.js` | timeline from the cuff-card table and the route limits (pure) |
| `src/utils/routeModes.js` | what each route mode optimises, from `MODE_WEIGHTS` (pure) |
| `src/ui/theme.js` | design tokens, workspace list |
| `App.jsx`, `RightPanel.jsx`, `MoonScene.jsx`, `MiniMap.jsx`, `ui.jsx` | workspace state and layout; sections assigned to workspaces; several drapes, terrain click, inspect pin; site-map click → inspector; collapsible sections with summaries |

Mission setup was split into *Astronaut & spacesuit*, *Payload mass*, *Oxygen & life support*,
*Dust exposure & equipment reliability*, *EVA limits & safe haven* and *Environmental constraints*
(same controls, same state). Tests: `tests/workspaces.test.mjs` (catalog, route modes, timeline,
inspector on the real Jezero site); the browser tests open every workspace.

## Limitations

* Inner parts of some existing panels keep their earlier colours (re-theming them line by line was
  out of scope); the frame, controls and new components use the new tokens.
* AI terrain segmentation is not in this branch's data; the catalog category appears once
  `segmentation.json` exists for a site (`ai-predicted` is already a provenance kind).
* The 3D scene shows one route mode's segments only through the inspector; segments are not
  individually clickable in 3D.
* Science stops are inspected from the stop list or the timeline (3D badges are not clickable).
* On phones the EVA HUD and the bottom sheet still share the screen as before.
