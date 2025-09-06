# Full Comic Book Generation Plan

## Overview
This plan extends the current Daily Cartoon app to generate a full comic book: front cover, 22 interior pages, and back cover (24 pages total). It leverages existing LLM text generation, image generation, image composition with sharp, and PDF export with pdf-lib, adding orchestration, page layout, multi-page export, and optional batch approvals and resume.

## Deliverables
- New workflow `generateComicBook(...)` that produces a complete print-ready PDF and a project folder with all page assets.
- Page composer for multi-panel pages with margins and gutters.
- Multi-page PDF exporter.
- “Book plan” JSON generation via LLM (covers + per-page panel scripts).
- UI entry and wizard prompts for book generation.
- Config keys for page size, bleed, margins, gutters, concurrency, and batch mode.
- Optional resume/checkpoint mechanism per project.

## Architecture Changes
- Workflow: Add `generateComicBook(sessionState, options, imageGenerator)` to orchestrate: cover generation → interior pages → back cover → PDF compile → archive.
- Page Composition: Add `composeComicPage(panelPaths, layout, pageWidthPx, pageHeightPx, { marginPx, gutterPx, background })` to lay out N panels per page.
- PDF Export: Add `exportPagesToPdf(imagePaths[], outputPdfPath, { pageSizeInches, marginInches, bleedInches })` to generate a single multi-page document.
- Book Script JSON: Add `buildBookTaskPrompt(...)` to request a structured book plan (`title`, `issue`, `frontCover`, `backCover`, `pages[]` with `layout` and `panels[]`).
- Batch Approvals: Add a “book mode” that can approve the first page then auto-apply for the rest, or run fully headless.
- Resume/Checkpoints: Persist progress to `book_projects/<slug>/state.json` so long runs survive interruptions.

## End-to-End Flow
1) Setup: Prompt for title, issue number, page count (default 22), include covers/inside covers, layout template (default `2x3`), chosen style, approval mode, and watermark toggle.
2) Script: Generate a single book plan JSON (covers + pages + panels) via LLM using `buildBookTaskPrompt` with character library keys.
3) Rendering: For each page and each panel, build prompts (style + characters + dialogue + framing) and generate images with retry.
4) Assembly: Compose each page image per layout with margins/gutters/background using sharp.
5) Covers: Generate front and back cover images from specialized prompts (title, tagline, credits) and include them as pages.
6) PDF: Export all page images to a multi-page PDF at the configured trim size; apply bleed/safe area in placement.
7) Output: Store assets under `book_projects/<slug>/pages/` and write `book-<slug>.pdf`. Optionally archive metadata alongside.

## Page Specs
- Trim Size: Default 6.625" × 10.25" (US comic) or 6" × 9" as simpler default. Configurable.
- Bleed: Optional 0.125" on all sides. Ensure interior content respects safe margins.
- Margins: Default 0.5"; configurable safe area for balloons and captions.
- Gutters: Default 0.1" between panels.
- Layouts: Support `1x1` (splash), `2x2`, `2x3` (standard), `3x2`, `1x4`, `4x1`. Compute panel tile sizes from page size − margins, dividing evenly with gutters.
- Panel Fit: Resize with `fit: 'cover'` and center to avoid distortion and fill tiles cleanly.

## Covers
- Front Cover: Title, issue, tagline, series logo/branding, credits. Dedicated prompt builder that emphasizes composition, legibility, and space for masthead.
- Back Cover: Blurb or ad; a simpler prompt. Optionally include a URL watermark here only.
- Inside Covers: Optional; can be added in Phase 2.

## Dialogue Strategy
- Phase 1: Keep model-rendered rectangular dialogue boxes with strict legibility directives (already present in prompts).
- Phase 2: Programmatic lettering (text drawn via sharp over clean art). Requires panel JSON to include balloon text and suggested positions.

## Reliability & Long Runs
- Concurrency: Limit panel generations (e.g., 2–3 concurrent) to respect provider rate limits.
- Retry: Reuse existing prompt-regeneration retry on safety failures.
- Approvals: Batch/book mode to skip all or approve a sample (e.g., page 1) and auto-continue.
- Resume: Save `state.json` after completing each page to resume mid-run.

## File Structure & Naming
- Project Root: `book_projects/<slug>/`
  - `state.json` (progress + settings)
  - `pages/page-001.png` … `page-024.png` (zero-padded)
  - `book-<slug>.pdf` (final)
- Slug from title + issue or timestamp.

## Configuration Additions (config.json)
```json
{
  "bookGeneration": {
    "defaultPageSizeInches": [6.625, 10.25],
    "bleedInches": 0.125,
    "marginInches": 0.5,
    "gutterInches": 0.1,
    "defaultInteriorLayout": "2x3",
    "batchMode": true,
    "concurrency": 2,
    "watermarkForBooks": false
  }
}
```

## UI Changes
- Main Menu: Add “Generate Full Comic Book”.
- Wizard: Title, issue, page count, include covers, inside covers (optional), layout template, style, approval mode, watermark toggle.
- Progress: Show per-page progress, estimated remaining time, and where outputs are saved.

## Book JSON Schema (LLM Output)
Example shape (abbreviated):
```json
{
  "title": "Example Saga",
  "issue": 1,
  "frontCover": {
    "imagePrompt": "Heroic montage ... clear masthead space ...",
    "tagline": "A new dawn"
  },
  "backCover": {
    "imagePrompt": "Subtle textured background ... series info ..."
  },
  "pages": [
    {
      "layout": "2x3",
      "panels": [
        {
          "description": "Establishing shot of city at dawn",
          "characters": [{ "name": "Protagonist" }],
          "dialogue": [{ "character": "Protagonist", "speech": "A new beginning." }]
        }
        // ... panels
      ]
    }
    // ... 21 more interior pages
  ]
}
```

## Function Signatures (Proposed)
- `generateComicBook(sessionState, options, imageGenerator): Promise<{ pdfPath, projectDir }>`
- `composeComicPage(panelPaths, layout, pageWidthPx, pageHeightPx, { marginPx, gutterPx, background }): Promise<string>`
- `exportPagesToPdf(imagePaths, outputPdfPath, { pageSizeInches, marginInches, bleedInches }): Promise<void>`
- `buildBookTaskPrompt({ title, issue, topic, interiorLayout, pageCount, characterKeys }): string`

## Dependencies
- Already used: `sharp`, `pdf-lib`.
- Optional: `uuid` (project IDs).
- No additional core runtime dependencies required.

## Phased Delivery
- Phase 1 (2–4 days):
  - Book prompt + JSON plan; `generateComicBook(...)`; `composeComicPage(...)`; `exportPagesToPdf(...)`;
  - UI entry + wizard; config keys; batch mode; basic progress reporting.
- Phase 2 (3–5 days):
  - Programmatic speech lettering; resume/restart; inside covers; richer layouts; style/seed consistency tuning; automated tests for layout math.

## Notes & Risks
- Provider limits may slow runs; concurrency + resume mitigate this.
- Image aspect differences handled by `fit: 'cover'` and centering.
- For print, disable watermarks on interiors by default; back cover watermark optional.

