# Changelog

## Unreleased

**Added**
- Archive mode: Organizes posted assets under `./post_archive/YYYY/MM/DD/<profile>/<jobId>_<topic-slug>/` with `image.*` and `metadata.json`.
- Text legibility directive: Ensures large, bold, high-contrast speech text suitable for mobile.
- Watermark position: Respects `imageWatermarking.position`.
- Worker efficiency: Reuses a single Chromium per job (per‑platform contexts).

**Changed**
- Prompt builder: Adds panel guidance only if `expectedPanelCount` or explicit N‑panel task.
- Approval flow: Post image generation is now approval‑driven; “Edit Prompt” regenerates with edits.
- Cleanup: Includes `final-comic-*` artifacts; logged‑in status for Bluesky prefers env vars.
- Config defaults: `postProcessing.actionAfterSuccess = "archive"`, `debug.preserveTemporaryFiles = false`.

**Fixed**
- Edited prompts not applied on retry in image review.

**Docs**
- Updated `docs/app-map.md` to reflect approval loop, provider config flow, watermark position, and archive mode.

