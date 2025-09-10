feat(core): config path override, dependency checks, and video posting; robustness tweaks

Summary
- Add CONFIG_PATH/--config support, dependency checks, and a video posting path.
- Improve startup/DX with validation, preflight warnings, and safer app entry.

Details
- app.js
  - Load config/characters asynchronously via fs/promises.
  - Add config validation for providers, timeouts, and default topic.
  - Preflight provider env vars (OPENAI_API_KEY, GEMINI_API_KEY, etc.) with clear warnings.
  - Support config path override via env (CONFIG_PATH) and CLI (--config | -c).
  - Run a quick non-fatal dependency check (Playwright/FFmpeg) at startup.
  - Add global handlers for unhandled rejections and uncaught exceptions.
  - Gate the CLI so the app only starts when executed directly (not on import for tests/scripts).

- src/lib/utils.js
  - Add checkDependencies(): verifies Playwright can launch Chromium and FFmpeg exists.
  - Expose as a utility used by startup and a new menu action.

- src/lib/ui/menu.js
  - New menu action: "Check Dependencies (Playwright, FFmpeg)".
  - New action: "Queue Video Post (upload mp4 like image)" to enqueue an existing .mp4 with caption + platforms.

- worker.js
  - Support generic media posting using job.mediaPath (fallback to imagePath for backwards compat).
  - Upload videos to X and LinkedIn using existing Playwright flow.
  - Use selectors.mediaPreview (or image/video previews) and wait accordingly.
  - Respect CONFIG_PATH when loading config.
  - Generalize archiving/cleanup for both images and videos; write appropriate metadata.
  - Explicitly block Bluesky video posting for now with a clear error (API support TBD).

- config.json
  - Add selectors.mediaPreview for X and LinkedIn to detect either image or video previews.

Fixes/Chores
- Fix direct-run detection so importing app.js in tests no longer triggers the interactive menu.
- Quick smoke tests executed locally (import app, load state, get image generator, run quick deps check).

Notes / Follow-ups
- Optional: add CHAR_LIB_PATH/--characters override if needed.
- Optional: auto-transcode oversized/unsupported videos via FFmpeg before upload.
- Optional: add Bluesky video support when stable API/flow is available.

MP4 Functionality Implemented
- Queue video posts from UI
  - New "Queue Video Post (upload mp4 like image)" action lets users pick an exported .mp4 (or provide a path), write a caption, select platforms, and enqueue a job using `mediaPath`.
  - Uses existing scheduling/worker pipeline; preserves prior image flow behavior (backward-compatible via `imagePath`).

- Worker media handling for video
  - Detects videos by extension (.mp4/.mov/.webm) and treats them as media uploads for X and LinkedIn using Playwright.
  - Waits on `selectors.mediaPreview` so either an image or video preview satisfies readiness.
  - Posts caption with human-like typing delays; clicks post and waits for confirmation (toast, modal disappearance, or URL change).
  - Archives uploaded media (image or video) uniformly; metadata records `asset` and tags video vs image.
  - Cleans up, backs up, or archives based on `postProcessing.actionAfterSuccess` (delete | backup | archive).
  - For Bluesky, video is explicitly not posted yet (clear error message); images remain supported.

- Config and selectors
  - Added `mediaPreview` selectors for X and LinkedIn to detect both `<img>` and `<video>` thumbs post-upload.
  - Maintains existing `imagePreview` for backwards compatibility; worker chooses the appropriate selector.

- Export and ffmpeg pipeline (supporting .mp4 generation)
  - Video exporter builds robust ffmpeg filter graphs with scale/pad, fps, trim, setpts, setsar, yuv420p output.
  - Supports cross-fade transitions with `xfade` (per-gap transitions), and hard cuts via `concat` when requested.
  - Ken Burns effect per panel (`none|in|out`) with configurable zoom factor; per-panel or global settings.
  - Reads per-panel durations from `panels/list.txt` if present; can override via CLI `--durations`.
  - Derives transitions/Ken Burns hints from `metadata.panelDetails` when not explicitly provided.
  - Enforces even output dimensions for encoder compatibility; validates fps/durations in strict mode.
  - CLI utility supports dry-run (`--dry-run`) and various tuning flags (fps, size, crf, preset, transitions).

---

feat(story-patterns): preload examples in topic editor; add teaching template; standardize examples; validator + docs

Summary
- Preload the selected Story Pattern’s `example` text into the topic editor to guide users with a concrete starter.
- Add a beginner-friendly “Teaching Story” how-to template and standardize `example` fields across patterns.
- Improve menu/Editor UX: show a short, single-line preview for long topics.
- Add a simple validator script and update README with Story Pattern usage and validation instructions.

Details
- src/lib/ui/menu.js
  - When creating a new post, if a Story Pattern is selected and has an `example`, preload it into the editor instead of the global default topic.
  - Trim the “Set Topic (Current: …)” label to the first line (60 chars) for readability.

- src/lib/ui/topic-editor.js
  - Show only the first line of the current topic (80-char preview) in the selection prompt to avoid multi-line clutter.

- narrative_frameworks (JSON templates)
  - how_to: add new `teaching_story_principle_steps_check.json` (renamed from “protocol” to “steps” for clarity) with example.
  - Add concise `example` fields to: how_to/problem_solution.json, how_to/title_steps_cta.json,
    storytelling/story_lesson_takeaway.json, storytelling/points_payoff_question.json,
    analytics/datapoint_interpretation_recommendation.json,
    debunkers/myth_buster.json, opinions/contrarian_evidence_cta.json, mistakes/mistake_consequence_fix.json,
    case_studies/before_after_bridge.json, case_studies/casestudy_whatwedid_result_replicate.json,
    and all biography templates under `narrative_frameworks/biography/`.

- scripts/validate_frameworks.js
  - New standalone validator to check that each framework JSON parses and includes required keys: `name`, `description`, `template`, `example`.
  - Run with: `node scripts/validate_frameworks.js`.

- README.md
  - New “Story Patterns & Examples” section documenting keys and editor preload behavior.
  - “Validate Framework Files (Optional)” with usage of the new validator.
  - “Getting Started with Story Patterns” quick-start under Usage.

Notes
- `example` is now used to seed the topic editor; users can overwrite it directly.
- Fallback remains `config.search.defaultTopic` when no pattern/example is active.
