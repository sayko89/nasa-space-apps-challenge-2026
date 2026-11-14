# Mars AI terrain segmentation

*Interplanetary Survival Guide: Martian Map* · NASA Space Apps Challenge 2026 · Team PERIAPSIS

Every number in this file is copied from files that the pipeline wrote:

- `pipeline/sources/ai4mars/inventory.json`, `manifest.json`, `evaluation.json`
- `pipeline/sources/ai4mars/training/*-meta.json`
- `web/public/models/mars-terrain-v1.json`

Every number below is read from those files (full run 43603275202, evaluation/export by run 43636893719). Nothing is estimated.

## 1. Lunar model audit (Phase 1)

| Searched | Result |
|---|---|
| `sayko89/nasa-space-apps-challenge-2026`, all history | no segmentation model, weights, training or inference code, masks or labels. `utils/learningModel.js` is a per-cell traversal-experience average, not a neural network |
| `sayko89/tua-astro-hackathon` (the project this grew from), 93 commits | no segmentation model. `scripts/rover_local_nav.py` is a NumPy cost-map navigator |
| Hugging Face account `saiyko` | two tabular classifiers (heart disease, dispatch risk); no segmentation model |

**Unknown.** Lunar model framework, architecture, input size, classes, loss, optimiser, training duration, hardware, metrics, and the lunar dataset (name, size, labels, split).

**Consequence.** Transfer from a lunar model (approach A) was not run, and no lunar-vs-Mars comparison is reported. The Moon simulator (`?site=moon`) is unchanged.

## 2. Mars dataset (Phase 2)

**AI4Mars merged v0.6.** Swan, Ono and Atha, NASA JPL. Zenodo, doi:10.5281/zenodo.15995036, 22 Oct 2022, CC BY 4.0. The archive is 16.46 GB, 146,140 files.

The inventory read it remotely, and the label key was verified against two things:

- the dataset's own `label_keys.json`
- the pixel values found in sample masks of every label folder

| Key | Values |
|---|---|
| **NAV** (used) | 0 soil · 1 bedrock · 2 sand · 3 big rock (≥ 30 cm high, ≥ 50 cm wide) · 255 no label |
| M2020_GEO (not used) | 21 geology classes (bedrock / float-rock textures, sand dune / ripples, pebbles, vein, hill) — a different taxonomy |

| Set | Labels | Used | Why |
|---|---:|---|---|
| MSL (Curiosity) Navcam train | 16,064 | yes — training / validation | crowdsourced, merged (≥ 3 labellers, ⅔ agreement); range > 30 m and rover masked |
| MSL Navcam expert test (min1 / min2 / min3, 100 % agreement) | 322 each | yes — **test only** | the only expert-labelled set for a rover in our sites |
| M2020 (Perseverance) NAV | 3,827 | yes — training / validation / **Jezero test** | crowdsourced; there is no expert test set for M2020 (dataset changelog) |
| M2020_GEO Navcam / Mastcam | 2,153 / 6,355 | no | geology taxonomy (Phase 10: kept separate) |
| MSL Mastcam | 9,099 | no | contains an undocumented label value 4; no range / rover masks |
| MER (Spirit, Opportunity) | 8,507 train + test | no | train labels have no range mask (dataset notes) |

**Data preparation** (`pipeline/segmentation/prepare.py`). The archive is downloaded in one request and checked against the MD5 that Zenodo publishes. Range requests are not used for preparation, because Zenodo limits anonymous clients to about 2,000 requests per hour.

The checks, each logged with its reason in `manifest.json` (nothing is dropped silently):

- image / label matching
- unreadable files
- size mismatch
- label values outside the key
- empty labels
- exact duplicate images (SHA-1)
- the dataset's known duplicates: M2020 `.jpg` / `.jpeg` pairs, and the `-1 … -4` labels of one Vgnc image

Images are converted to grey, with the shorter side resized to 256 px (aspect kept). Labels are resized with nearest-neighbour, so class values are never blended.

The split is by **Mars day**, so near-identical frames never straddle the splits:

- **Grouping:** MSL by spacecraft clock ÷ one sol; M2020 by the sol in the file name, or the clock for Vgnc frames.
- **MSL:** sols that contain an expert-test image are kept out of training.
- **M2020:** 15 % of sols are held out as the Jezero test set.
- **Validation:** 12 % of the remaining sols.
- **Seed:** 1234.
- **Leakage check:** the run fails if any group appears in two splits.

Split sizes (measured, `pipeline/sources/ai4mars/manifest.json`; pixel counts at 256 px):

| Split | Images | Mars-day groups | soil px | bedrock px | sand px | big rock px |
|---|---|---|---|---|---|---|
| train-msl | 14,068 | 1272 | 195,658,559 | 255,387,743 | 60,353,941 | 4,677,805 |
| val-msl | 1,832 | 169 | 22,106,546 | 35,925,742 | 10,037,783 | 710,860 |
| test-min1 | 322 | 48 | 5,567,214 | 3,750,498 | 2,798,470 | 23,839 |
| test-min2 | 321 | 48 | 5,015,269 | 2,795,758 | 2,395,327 | 8,116 |
| test-min3 | 287 | 48 | 3,754,206 | 1,636,933 | 1,914,376 | 4,852 |
| train-m2020 | 2,643 | 126 | 84,853,977 | 71,180,025 | 32,195,226 | 7,192,463 |
| test-m2020 | 369 | 24 | 12,823,749 | 9,710,202 | 4,607,093 | 812,477 |
| val-m2020 | 183 | 9 | 8,821,475 | 1,331,677 | 1,172,764 | 212,488 |

Leakage check: no group in two splits. Rejected or excluded during preparation (counts from `manifest.json`): duplicate image (.jpg kept .jpeg) — 287; excluded set: geology taxonomy (M2020_GEO) — 2; excluded set: MSL Mastcam: undocumented label value 4 — 1; excluded set: MER: range mask not applied — 1; M2020 duplicate label (-1 … -4 of one image) — 131; label without image — 498; empty label (no labelled pixel) — 202; exact duplicate image (second copy dropped) — 1.

## 3. Model and training (Phases 3–4)

**Architecture.** LR-ASPP with a MobileNetV3-Large encoder (torchvision); 4 output classes; label 255 is ignored in the loss and the metrics.

**Input.** The grey Navcam image repeated on 3 channels, with ImageNet normalisation. Navcams are the camera that took the Jezero and Gale ground views in this project.

| Run | Approach | Initialisation | Loss |
|---|---|---|---|
| `pretrained-cedice` | B — general-purpose pretrained backbone | ImageNet encoder; frozen in epoch 0, then fine-tuned at the head learning rate ÷ 10 | cross-entropy (class-weighted) + Dice |
| `scratch-cedice` | C — from scratch | random | same |
| `pretrained-ce` | B, loss check | ImageNet | cross-entropy only |
| — | A — lunar transfer | **not run: no lunar model** | — |

**Training settings:**

| Setting | Value |
|---|---|
| Optimiser | AdamW (weight decay 1e-4); learning rate 1e-4 (pretrained) / 1e-3 (scratch) |
| Scheduler | ReduceLROnPlateau on validation mIoU |
| Batch | 8 |
| Crops | random 256 × 256 |
| Augmentation | horizontal flip, contrast ×0.85–1.15, brightness ±12. No rotation or perspective warps, which would distort the Navcam horizon and depth geometry |
| Class weights | inverse √ frequency, because big rocks are rare |
| Stopping | early stopping after 3 epochs without improvement, and a 210-min time budget per run |
| Resume | from the last checkpoint |
| Seeds | fixed |
| History | exported |
| Hardware | GitHub-hosted runner, CPU only. Each run's hardware string and its measured training time are in its `*-meta.json` |

Measured (`pipeline/sources/ai4mars/training/*-meta.json`):

| Run | Epochs run | Training time | Best validation epoch | Best mean val mIoU | Training images (MSL + M2020) |
|---|---|---|---|---|---|
| `pretrained-cedice` | 12 | 3.51 h | 11 (of 0…11) | 0.6523 | 14,068 + 2,643 |
| `pretrained-ce` | 12 | 3.51 h | 11 (of 0…11) | 0.6453 | 14,068 + 2,643 |
| `scratch-cedice` | 18 | 3.51 h | 17 (of 0…17) | 0.6367 | 14,068 + 2,643 |

Hardware (from the meta files): x86_64, 4 CPU threads, no GPU, torch 2.8.0+cpu. **All three runs stopped on the 210-min time budget, not on early stopping, and the best epoch is the last one** — validation mIoU was still rising, so longer training (or a GPU) would likely improve the model; that is not measured here.

## 4. Evaluation (Phase 5)

**Model selection** is by mean validation mIoU (MSL + M2020). The test sets are never used for training or selection.

**Measures:**

- pixel accuracy
- mIoU over the classes present
- per-class IoU, Dice, precision and recall
- confusion matrix

| Test set | What it measures |
|---|---|
| MSL Navcam expert, min1 / min2 / min3 | Curiosity Navcam images, expert labels — closest to **Gale** |
| M2020 NAV hold-out | Perseverance Navcam, crowdsourced labels — closest to **Jezero**; *not expert-verified* |

Results (measured, `pipeline/sources/ai4mars/evaluation.json`):

**Selected model: `pretrained-cedice`** (highest mean validation mIoU), exported as `web/public/models/mars-terrain-v1.onnx`.

| Run | val mIoU MSL | val mIoU M2020 | test min1 | test min2 | test min3 | test M2020 |
|---|---|---|---|---|---|---|
| `pretrained-cedice` (selected) | 0.788 | 0.516 | 0.638 | 0.683 | 0.762 | 0.578 |
| `pretrained-ce` | 0.784 | 0.506 | 0.645 | 0.694 | 0.773 | 0.565 |
| `scratch-cedice` | 0.778 | 0.495 | 0.644 | 0.688 | 0.765 | 0.543 |

Selected model, per class on the test sets (IoU; pixel accuracy in the last column):

| Test set | soil | bedrock | sand | big rock | pixel accuracy |
|---|---|---|---|---|---|
| test-min1 | 0.888 | 0.777 | 0.809 | 0.077 | 0.904 |
| test-min2 | 0.934 | 0.851 | 0.874 | 0.075 | 0.941 |
| test-min3 | 0.954 | 0.915 | 0.911 | 0.267 | 0.965 |
| test-m2020 | 0.772 | 0.664 | 0.560 | 0.315 | 0.803 |

**What this means.** Soil, bedrock and sand are segmented well on Curiosity Navcam images (expert test, IoU 0.78–0.95). **Big rocks are not**: IoU 0.07–0.32 — they are rare in the training labels (0.9 % of labelled MSL pixels) and the model mostly misses them. On Perseverance Navcam (Jezero, crowdsourced labels) the scores are lower than on Curiosity (mIoU 0.58).

**Low-confidence threshold (measured on validation):** 0.3 — validation pixels above it are right 93.6 % of the time (target 90 %), the few below it 24.1 %. Confidence is reasonably calibrated: in the 0.9–1.0 bin, MSL validation pixels are right 98.5 % and M2020 94.4 % of the time.

**Low-confidence pixels.** A pixel is shown as *unknown* when its top softmax probability is below a threshold. The threshold is the lowest value at which validation pixels above it are right at least 90 % of the time. The 90 % target is a design choice; the threshold itself and the accuracy above and below it are measured on validation and recorded in `evaluation.json`.

## 5. Jezero and Gale predictions (Phase 6)

`pipeline/segmentation/infer_sites.py` runs the exported ONNX model on the ground-view frames already listed in `pov.json`:

- **Jezero:** Perseverance NAVCAM frames only. Mastcam-Z is another camera, outside the training domain, so it is skipped and counted.
- **Gale:** Curiosity Navcam frames.
- **Frame selection:** up to 3 full frames per rover position, looking at the ground (elevation ≤ 0°). Subframe strips (e.g. 800×150) are skipped and counted.

Every prediction stores:

- the source image ID and URL, NASA page, mission, camera, sol, UTC
- the rover position, as station, site x / z and latitude / longitude
- the approximate viewing azimuth and elevation
- the original and mask sizes
- the model version and prediction time
- class shares, unknown share, and a confidence summary

Counts (measured, `web/public/sites/<site>/segmentation/index.json`):

- **Jezero:** 37 frames predicted, 0 errors; skipped — other cameras (out of training domain): 774, download errors: 0, subframe strips (too thin to segment): 100 (2026-11-14T20:24:39+00:00).
- **Gale:** 408 frames predicted, 0 errors; skipped — other cameras (out of training domain): 0, download errors: 0, subframe strips (too thin to segment): 0 (2026-11-14T20:25:10+00:00).

## 6. Geographic alignment (Phase 7)

| Available | Not available |
|---|---|
| rover position of each frame (MMGIS / raw-image feed, tested to agree with lat/lon within 2 m) | camera models (CAHVOR), stereo range / XYZ products for these frames |
| approximate frame azimuth (mast azimuth + rover yaw) and elevation | per-pixel ground coordinates |

**Decision.** There is no defensible image-to-ground transformation, so the predictions stay **image-level**:

- They are shown in an inspection panel with the rover position they were taken from.
- They are never drawn on the orbital map.
- A rover-trained model is **not** applied to HiRISE: orbital imagery has another viewing geometry and resolution, and there is no validated domain adaptation. The HiRISE layer is unchanged.

## 7. User interface (Phase 8)

**Mars AI Terrain Segmentation** panel (Jezero and Gale; hidden on the Moon):

- Browse the rover images by sol and rover position.
- Switch the view: **original / overlay (opacity slider) / mask / confidence**.
- A consistent legend: soil, bedrock, sand, big rock, unknown.
- Class shares and pixel counts, number of processed pixels, a confidence summary.
- Source-image metadata, model version and dataset provenance.
- During an EVA, **NEAREST TO EV1** jumps to the image taken closest to the astronaut.
- If the predictions or the model are missing, the panel says so.

The panel labels predictions as a model prediction: *not a NASA measurement, not georeferenced*.

**Helmet camera** (the "image processing" screen): an **ELEVATION** view drawn from the HiRISE DTM (measured orbital elevation, 4 m grid). It shows:

- terrain coloured by height relative to the astronaut, with contour lines
- relief at ×3 vertical exaggeration
- the astronaut's MOLA elevation
- height difference and grade at 10 / 25 / 50 / 100 m along the walking direction

**SLOPE** keeps the previous hazard view. Both are deterministic: no model prediction is involved.

## 8. Hazards and route planning (Phase 9)

**Not connected, by design.** A map-level AI terrain layer would need georeferenced predictions (§6), and without them any cost layer would invent spatial precision. So:

- A* and the walk-back, slope, rock, radius, rover, oxygen and time rules are unchanged.
- There is no with / without-AI route comparison to report.

The predictions inform the crew image by image: what the ground near a rover position looked like to the model.

## 9. Geology (Phase 10)

Boxwork, contacts, mineral units and ChemCam anomalies stay in their own layers. The four generic terrain classes are never mapped onto them. M2020_GEO, the only labelled geology taxonomy in AI4Mars, is not used; it would need its own model and evaluation.

## 10. Inference architecture (Phase 11)

The demo is a static site (GitHub Pages) with no backend, so inference runs in the pipeline:

- ONNX export
- onnxruntime on the runner
- predictions cached as PNG + JSON next to the site files, loaded on demand

Lunar and Mars inference are separate; there is no lunar model in the app. In-browser inference was not added: the rover photos are served cross-origin by mars.nasa.gov, so a browser cannot read their pixels.

## 11. Reproduction

```
# all stages run on GitHub Actions (data reachable there): write the stage to pipeline/segmentation/RUN on an ml/** branch
echo inventory > pipeline/segmentation/RUN   # list AI4Mars remotely, read its documentation, check label pixel values
echo smoke     > pipeline/segmentation/RUN   # whole pipeline on ≤ 200 labels per source, 4-min training
echo full      > pipeline/segmentation/RUN   # prepare → 3 trainings → evaluate / export → site inference
python -m unittest discover -s pipeline/segmentation/tests   # dataset helpers, split leakage, metrics
```

| Output | Location |
|---|---|
| Model | `web/public/models/mars-terrain-v1.onnx` + model card `mars-terrain-v1.json` |
| Predictions | `web/public/sites/<site>/segmentation/` |
| Reports | `pipeline/sources/ai4mars/` |

PyTorch checkpoints are kept as workflow artifacts (7 days); the ONNX export is the kept model.

## 12. Limitations

- Training labels are crowdsourced; only the MSL test set is expert-labelled. The Jezero (M2020) numbers come from crowdsourced labels.
- The labels cover ground within ~30 m and exclude the rover, so predictions on far terrain, sky and rover hardware are not meaningful.
- The Jezero frames are 800-px browse JPEGs; training used full-resolution archive images.
- The predictions are not georeferenced, so they do not enter the hazard map or the route planner.
- CPU-only training within a time budget; a GPU and longer training would likely do better.
- "Big rock" is rare in the labels, so it is the least reliable class.
