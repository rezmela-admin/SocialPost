# Wish List

This document tracks feature ideas and long-term goals for the Automated Daily Cartoon Bot.

1.  **Page-Long Comics:** Implement a workflow to generate long-form, scrollable comics, potentially with more than the current 4-panel limit.

2.  **New Graphic Styles from Real Art:** Expand the `graphic_styles.json` library with prompts inspired by real art movements and artists (e.g., "in the style of Picasso's cubist period," "a watercolor painting in the style of Monet").

3.  **Interactive Panel Editor:** Create a feature that allows the user to edit the AI-generated story structure (the JSON describing panels, characters, and dialogue) before the images are generated. This would provide more granular control over the final comic.

4.  **Substack Integration:** Add a new module to the `worker.js` to automatically post the generated content (image and summary) to a Substack newsletter.

5.  **Comic Signature/Watermarking:** Implement a feature to automatically add a configurable signature or artist's mark to the corner of each generated comic strip.

6.  **PDF Export:** Add the ability to export a generated comic strip or page as a PDF document.

7.  **Bypass URL:** Add a URL to every post that allows readers to bypass gatekeepers and view the content directly.

8.  **Unified Comic Generation Workflow:** Consolidate the separate single-panel and multi-panel workflows into a single, flexible system. This would allow the user to select a grid layout (e.g., 1x1 for a single image, 2x2 for a standard comic, 2x3 for a longer strip) and eventually format the output for standard sizes like a 6x9 comic book.