# Automated Daily Cartoon Bot — Application Map

## Overview

This CLI application generates illustrated social posts and multi‑panel comic strips using LLMs and image models, queues them for posting, and optionally posts to X, LinkedIn, and Bluesky via a background worker.

Key domains:
- Interactive menu UI flows for topic, style, platforms, and approvals
- Text generation (LLM) + Image generation providers with retry/approval loops
- Image composition (comic strips), watermarking, and PDF export
- JSON file–backed job queue + posting worker

---

## Entry Point

- `app.js`
  - Loads env vars via `dotenv/config`.
  - `loadInitialState()` reads `config.json` and `character_library.json` into `sessionState`.
  - Chooses image provider: `getImageGenerator(sessionState)` from `src/lib/image-generators/index.js`.
  - Starts interactive UI: `menuManager(sessionState, mainMenu(sessionState, imageGenerator))`.

Control flow:
1) `start()` → `loadInitialState()`
2) `getImageGenerator(sessionState)`
3) `menuManager(sessionState, mainMenu(...))` → user actions drive workflow functions

---

## Runtime State (`sessionState`)

- `prompt`: Active creative profile object (from `prompt_profiles/*.json`), includes:
  - `workflow`, `task`, `expectedPanelCount?`, `profilePath`
- `narrativeFrameworkPath`: Optional framework (`narrative_frameworks/*.json`)
- `characterLibrary`: From `character_library.json`
- `search.defaultTopic`: Default topic seed (`config.json`)
- `textGeneration`, `imageGeneration`, `debug`, `displaySettings`, `framingOptions`, `imageWatermarking`, etc. (from `config.json`)
- UI scratch:
  - `draftPost`: `{ topic, platforms[], skipSummarization, comicLayout? }`
  - `finalImagePrompt`: Last approved prompt sent to image generator

---

## UI Layer (`src/lib/ui`)

- `menu.js`
  - Shows startup banner (optional), session status (active profile, framework, logged‑in platforms, pending jobs).
  - Main actions:
    - Select Narrative Framework → `framework-selector.js`
    - Generate and Queue a New Post → opens topic editor then a guided submenu
    - Manage Creative Profiles → `profile-manager.js`
    - Conditionally: Process Job Queue (if pending), Clear Job Queue & Cleanup Files
  - Post submenu (stateless, reads/writes `sessionState.draftPost`):
    - Set Topic, Select Platforms
    - If comic strip profile: Select Layout (from `getAvailableLayouts(expectedPanelCount)`) 
    - Else: Toggle “Use Topic as Summary”
    - Confirm and Generate Post → dispatches to appropriate workflow
  - Cleanup: “Clear Job Queue & Cleanup Files” removes `post-image-*`, `comic-strip-*`, and `final-comic-*` files.
  - Logged-in detection: X/LinkedIn via session files; Bluesky via `BLUESKY_HANDLE` + `BLUESKY_APP_PASSWORD` (or `bluesky_credentials.json` fallback).
- `menu-manager.js`: Menu engine (stack, back/quit, `action`, `submenu`, `popAfterAction`).
- `framework-selector.js`: Lists `narrative_frameworks/*.json`, sets `sessionState.narrativeFrameworkPath`.
- `topic-editor.js`: Approve/Edit/Cancel loop for the topic.
- `banner.js`: ASCII banner, reads version from `package.json`.

---

## Workflows (`src/lib/workflows.js`)

Shared utilities from `src/lib/utils.js`:
- `buildTaskPrompt(...)`: Injects active framework template and character consistency instruction. Panel guidance is added only when the active profile declares `expectedPanelCount` (or the profile task explicitly states an N‑panel strip); otherwise uses single‑panel phrasing.
- `generateAndParseJsonWithRetry(...)`: LLM call with JSON repair and retry.
- `getApprovedInput(...)`: User approval/edit loop for text.
- `generateImageWithRetry(...)`: Regenerates prompt via LLM on safety failures.
- `getPanelApproval(...)`, `getPostApproval(...)`: Open image, approve/retry/edit prompts.
- `selectGraphicStyle()`: Choose style from `graphic_styles.json`.

Primary flows:
- `generateAndQueuePost(sessionState, postDetails, imageGenerator, skipSummarization?)`
  - Picks text generator, builds task prompt; parses `{ summary, imagePrompt?, dialogue? }`.
  - Approvals: summary, optional dialogue/speech bubble.
  - Appends selected graphic style to prompt; final image prompt approval.
  - Approval‑driven generation loop: generates image and opens review; on “Retry”/“Edit Prompt”, deletes unapproved image and regenerates using the (possibly edited) prompt; on “Approve”, proceeds. Saves as `post-image-<ts>.png`.
  - Adds a universal text legibility directive for speech bubbles: large, bold, high‑contrast lettering sized for easy mobile reading; ensure text is fully visible and not cut off.
  - Applies watermark; optional PDF export via `pdf-exporter.js`.
  - Enqueues job via `queue-manager.js`.

- `generateAndQueueComicStrip(sessionState, postDetails, imageGenerator)`
  - Expects `expectedPanelCount` from active profile (e.g., 4 panels).
  - Generates structured JSON with `summary` and `panels[]`.
  - Per‑panel approval workflow: preview, edit prompt, retry until approved; collects `temp_panel_<idx>.png`.
  - Composes final strip using `composeComicStrip(panelPaths, layout, panelWidth, panelHeight, borderSize)` and saves `final-comic-<ts>.png`.
  - Optional PDF export, enqueue job.

- `generateVirtualInfluencerPost(sessionState, postDetails, imageGenerator, skipSummarization?)`
  - Two‑phase: character image (with neutral BG + dialogue), then Python inpainting (`edit_image.py`) to place into background.
  - Approvals on summary, dialogue, background prompt; enqueue job.

---

## Providers

Text Generation (`src/lib/text-generators`):
- `index.js` selects provider based on `config.textGeneration.provider`:
  - `GeminiProvider` (`@google/generative-ai`)
  - `OpenAIProvider` (`openai` Chat Completions)
  - `DeepSeekProvider` (HTTP API)
  - `KimiProvider` (HTTP API)

Image Generation (`src/lib/image-generators`):
- `index.js` selects provider based on `config.imageGeneration.provider` (relies on `sessionState`; no module‑level config reads):
  - `openai-provider.js`: `openai.images.generate` (DALL·E/gpt-image-1); builds model‑aware requests.
  - `gemini-provider.js`: `@google/genai` Imagen API.
  - `gemini-flash-provider.js`: `@google/generative-ai` image parts on Flash.

Logging: Providers emit debug via shared `utils.debugLog(sessionState, ...)` instead of reading `config.json` themselves.

Post‑processing:
- `image-processor.js`: Watermark overlay via SVG + `sharp` (controlled by `imageWatermarking` in `config.json`, honoring `position` for placement).
- `comic-composer.js`: Grid composition for panel images (`getAvailableLayouts`, `composeComicStrip`).
- `pdf-exporter.js`: Scales image into a PDF page with margins using `pdf-lib`.

---

## Queue + Worker

Queue (`src/lib/queue-manager.js`):
- JSON file queue at `post_queue.json` with jobs `{ id, status, createdAt, topic, summary, imagePath, platforms[], profile }`.
- `addJob`, `getPendingJobCount`, `getAnyJobCount`, `clearQueue`.

Worker (`worker.js`):
- Loads `config.json` and iterates pending jobs.
- For each platform in `job.platforms`:
  - `Bluesky`: `@atproto/api` login (`BLUESKY_HANDLE`, `BLUESKY_APP_PASSWORD`), optional resize/compress via `sharp`, `agent.uploadBlob` then `agent.post`.
  - `X`, `LinkedIn`: Playwright (`chromium`) with stored sessions (`x_session.json`, `linkedin_session.json`), navigates `composeUrl`, uploads image, enters text, clicks post; selectors/timeouts from `config.socialMedia` and `config.timeouts`. Reuses a single `chromium` browser per job, creating a fresh context per platform.
- Updates job status to `completed`/`failed`; on success, deletes or backs up image per `postProcessing` config.
 - Updates job status to `completed`/`failed`.
 - Post‑processing per `postProcessing.actionAfterSuccess`:
   - `delete`: removes the image from the working directory.
   - `backup`: moves the image into `backupFolderPath`.
   - `archive`: organizes content under `archiveFolderPath` as `YYYY/MM/DD/<profile>/<jobId>_<topic-slug>/`, moves `image.*` (and optional PDF), and writes `metadata.json` with topic, summary, platforms, timestamps, and status.

---

## Configuration & Data Files

- `config.json`
  - `socialMedia`: per‑platform URLs and CSS selectors
  - `timeouts`: page load, selector wait, typing pacing
  - `search.defaultTopic`: seed topic on “Generate and Queue a New Post”
  - `prompt`: default prompt profile (used initially; profiles can be switched)
  - `imageGeneration`: provider + models, `comicBorderSize`, `imageFileName`
  - `textGeneration`: provider + model + API key env var names
  - `framingOptions`: common camera framings
  - `debug`, `displaySettings`, `timezone`, `postProcessing`, `worker`, `imageWatermarking`

- `prompt_profiles/*.json`: Creative styles; some define `expectedPanelCount` to enable comic strip flow.
- `narrative_frameworks/*.json`: Templates prepended to the LLM task prompt.
- `graphic_styles.json`: Named visual style prompts for image generation.
- `character_library.json`: Canonical character descriptions for consistency.
- `post_queue.json`: Persistent job queue (JSON array).

---

## Environment & Secrets

Env vars via `.env` (loaded by `dotenv/config`):
- `OPENAI_API_KEY`, `GEMINI_API_KEY`, plus provider‑specific `apiKeyEnv` names from `config.textGeneration.providers`.
- `BLUESKY_HANDLE`, `BLUESKY_APP_PASSWORD` for Bluesky posting.

Session files (presence also shown in main menu status):
- `x_session.json`, `linkedin_session.json`
- Bluesky presence via env (`BLUESKY_HANDLE`/`BLUESKY_APP_PASSWORD`) or `bluesky_credentials.json` fallback

---

## Typical User Journey

1) Start app → banner + status shown.
2) Manage/Load creative profile and optional narrative framework.
3) Generate and queue a new post:
   - Edit/approve topic; pick platforms.
   - If comic: choose layout; else toggle “use topic as summary”.
   - Workflow runs: LLM JSON → text approvals → style → image prompt approval → image generation with retry.
   - Approve image; watermark; optional PDF; enqueue job.
4) Process job queue (immediately or later): worker posts to platforms and cleans up.

---

## Notable Reliability Patterns

- LLM JSON parsing with `jsonrepair` + retry (`generateAndParseJsonWithRetry`).
- Image generation retry with prompt regeneration on safety‑triggered failures (`generateImageWithRetry`).
- Approval‑driven post image loop ensures user edits are applied to regenerated images.
- User approval loops for summary, prompts, panels, and final images.
- Provider selection abstracted via factories for text/images.

---

## Key External Libraries

- `@inquirer/prompts` (CLI UI), `chalk` (color), `open` (preview images)
- `openai`, `@google/generative-ai`, `@google/genai` (AI providers)
- `sharp` (image processing/composition), `pdf-lib` (PDF export)
- `playwright` (browser automation), `@atproto/api` (Bluesky)
- `uuid` (IDs), `jsonrepair` (repair malformed JSON)
