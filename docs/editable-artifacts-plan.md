# Editable Artifacts and Post-Generation Editing Plan

## Goal
Persist a structured “ground truth” for each cartoon/comic so the work can be edited, recomposed, and re‑used later — without adding a GUI.

## Rationale
- A composed PNG is not editable; saving inputs/decisions enables later modification.
- Developers and artists benefit from reproducibility: you can recompose, swap panels, or tweak prompts.
- Jobs and posting workflows can reference a canonical artifact instead of ad‑hoc filenames.

## Artifact (Ground Truth) JSON
Stored per post at `artifacts/comics/<timestamp>-<slug>.json` (or `artifacts/posts/...` for single‑image).

- context
  - topic, createdAt, timezone
  - characterStyle: { name, path, snapshot }
  - storyTemplate: { path, templateText }
- workflow
  - type: `single` | `comic` | `virtualInfluencer`
  - expectedPanelCount, layout, platforms
- prompts
  - finalImagePrompt, panelPrompts[], styleChoice
  - saferRewrites[] (history of safety rewordings)
- aiResult
  - summary, dialogue, panels[] (structured)
- images
  - panelImagePaths[], finalImagePath, pdfPath
- generator
  - provider, model, size, maxRetries, watermarking config
- approvals
  - [{ step, decision, editedPrompt? , timestamp }]
- versions
  - app, schema
- history
  - [{ action, details, timestamp }]

Notes
- Snapshot text for profile task and story template to ensure reproducibility even if files change.
- `artifactPath` should be added to queue jobs for traceability.

## File Layout
- artifacts/
  - comics/2025-09-04T12-30-15Z-vaccination-mandate.json
  - posts/2025-09-04T12-31-00Z-energy-prices.json
- images/
  - post-image-*.png, final-comic-*.png (existing pattern)

## Generation Flow Changes
1) After AI parsing (summary/panels), create the artifact with context + prompts.
2) As each panel is approved, append its image path and approval to the artifact.
3) After composition, record `finalImagePath`, optional `pdfPath`, and generator config.
4) When queueing, include `artifactPath` in the job payload.

## Editing Flow (CLI, no GUI)
Add menu: “Edit Existing Comic” (and “Edit Existing Cartoon”)
- Select artifact → show actions:
  - Change layout → recompose from `panelImagePaths`.
  - Regenerate panel N → use `panelPrompts[N]` (or edit first), replace image, recompose.
  - Tweak dialogue → rewrite prompt with LLM and regenerate selected panel(s).
  - Switch style → re-render panels with new `styleChoice`, recompose.
  - Repost / Export → reuse `summary` + `finalImagePath`.
- Persist every change back into the artifact; append to `history[]`.

## Export/Import (Editable Package)
- Export full comic strip as a single, portable package that can be re‑imported and edited later.
  - Default format: `.comic.zip` archive containing the artifact JSON plus all referenced images (`panelImagePaths[]`, `finalImagePath`, optional `pdfPath`).
  - Optional single‑file format: `.comic.json` where images are embedded as base64 (larger, but one file).
- Import validates schema and contents, restores the artifact under `artifacts/comics/` and copies images; the item then appears in “Edit Existing Comic”.
- Add menu actions:
  - “Export as Editable Package (.comic.zip)”
  - “Import Editable Package (.comic.zip or .comic.json)”

## Queue Integration
- Jobs include: { topic, summary, imagePath, platforms, profile, artifactPath }
- Worker can retrieve additional context if needed (e.g., for reposting or auditing).

## Implementation Steps
1) Artifact writer
   - Create helpers: `createArtifact(...)`, `appendArtifact(...)`, `updateArtifact(...)`.
   - Call from `workflows.js` as soon as AI result is parsed.
2) Panel lifecycle capture
   - Record panel approvals + image paths.
   - Save final composition paths and export artifacts (PDF).
3) Job payload enhancement
   - Include `artifactPath` in `addJob(...)` calls.
4) CLI editor (phase 2)
   - Add “Edit Existing Comic/Cartoon” menu.
   - Actions: recompose, regenerate panel, edit prompt/dialogue, switch style, export.
5) Docs + schema versioning
   - Add schema version, document fields in repo (`docs/artifacts-schema.md`).
6) Export/Import utilities (phase 2)
   - Implement `exportComicPackage(artifactPath, options)` to bundle JSON + images to `.comic.zip` (and optionally emit `.comic.json`).
   - Implement `importComicPackage(packagePath)` to validate, restore under `artifacts/comics/`, and relink file paths.
   - Wire to new menu actions (“Export as Editable Package”, “Import Editable Package”).

## Effort & Phasing
- Phase 1 (2–4h): Artifact persistence + job linkage.
- Phase 2 (3–5h): CLI editing actions, recomposition tools, and export/import utilities.
- Phase 3 (1–2h): Polish UX, error handling, docs.

## Risks & Mitigations
- File drift: snapshot narrative template + profile task in artifact.
- Missing panels: gracefully detect and prompt to regenerate before recomposing.
- Large folder sprawl: add a cleanup/menu option to prune temp images; keep artifacts.

## Future Enhancements
- Deterministic reruns: capture seeds if provider supports.
- Bulk edits: re-style all panels with one action.
- Diff-friendly artifacts: order keys consistently; store small images as base64 (optional).
