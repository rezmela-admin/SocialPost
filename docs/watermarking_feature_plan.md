# Feature Plan: Image Watermarking

This document outlines the plan to add a feature that automatically applies a text watermark (e.g., a signature or URL) to all generated images.

## 1. Configuration

A new section will be added to `config.json` to allow for easy control of the watermarking feature without modifying the source code. This provides flexibility to enable/disable the feature, change the text, and adjust its appearance.

**Example `config.json` addition:**
```json
"imageWatermarking": {
  "enabled": true,
  "text": "https://ramesh2050.com",
  "font": "Arial",
  "fontColor": "#FFFFFF",
  "fontSize": 36,
  "position": "bottom-right"
}
```

## 2. Core Logic: `applyWatermark()` Function

A new, reusable function named `applyWatermark` will be created in `app.js`. This function will be responsible for the entire image manipulation process.

*   **Technology:** It will use the `sharp` library, which is already a project dependency.
*   **Process:**
    1.  The function will accept the path to an image file as an argument.
    2.  It will read the `imageWatermarking` settings from the configuration.
    3.  It will dynamically create an SVG (Scalable Vector Graphics) object representing the text to be overlaid. This is a robust method for rendering text onto an image with `sharp`.
    4.  The SVG layer will be composited (merged) onto the original image at the specified position (e.g., bottom-right, top-left).
    5.  The original image file will be overwritten with the newly watermarked version.
    6.  Error handling will be included to prevent a failed watermark from crashing the entire content generation workflow.

## 3. Integration into Existing Workflows

The `applyWatermark` function will be called immediately after an image is saved to disk in the two primary content generation workflows:

1.  **`generateAndQueuePost()`:** The call will be added after the `fs.writeFileSync` that saves the single `post-image-*.png`.
2.  **`generateAndQueueComicStrip()`:** The call will be added after the `sharp(...).toFile()` method that saves the final `comic-strip-*.png`.

This ensures that any image queued for posting will have the watermark applied, if the feature is enabled in the configuration.
