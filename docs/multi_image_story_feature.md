# Feature Plan: 4-Panel Story Posts

This document outlines a high-level plan to implement a new feature allowing the bot to post a 4-panel comic strip style story.

## Core Idea

-   **X (Twitter):** Post a single tweet containing 4 separate images that form a sequential story.
-   **LinkedIn:** Post a single update containing one image that is a 2x2 grid composite of the 4 story images.

## Implementation Steps

1.  **Add New Main Menu Option:**
    -   Modify the `main` function's `inquirer` prompt.
    -   Add a new choice: "Post a 4-Part Story..." to distinguish from the existing single-image post.

2.  **Create a New Core Workflow Function (`runStoryPostCycle`):**
    -   This new function will be responsible for the entire 4-panel story workflow, from generation to posting.
    -   It will be separate from the existing `runSinglePostCycle` to keep the logic clean.

3.  **Engineer a New Gemini API Prompt:**
    -   Design a new, complex prompt for the Gemini API.
    -   The prompt must instruct the model to return a single JSON object containing:
        -   `summary`: A single, overarching summary for the entire story.
        -   `imagePrompts`: An array of exactly 4 strings, where each string is a detailed, sequential prompt for a panel in the comic strip.
    -   Update the JSON parsing logic to handle this new `imagePrompts` array.

4.  **Build the Image Generation and Approval Loop:**
    -   Create a loop that iterates through the 4 `imagePrompts`.
    -   In each iteration, call the OpenAI image generation API.
    -   Save each of the 4 generated images to a temporary file (e.g., `story_panel_1.png`, `story_panel_2.png`, etc.).
    -   Design a new user approval system for this workflow. This will likely involve:
        -   Allowing the user to edit all 4 prompts at once in a text editor.
        -   After generation, pausing and instructing the user to manually inspect the 4 image files before approving the post.

5.  **Implement Image Merging for LinkedIn (`mergeImagesToGrid`):**
    -   Create a new function that uses the `sharp` library.
    -   This function will take the 4 image file paths as input.
    -   It will create a new blank canvas (e.g., 1024x1024).
    -   It will then composite the four images onto the canvas in a 2x2 grid.
    -   It will save the final merged image to a new temporary file.

6.  **Update Social Media Posting Functions:**
    -   **`postToX`:** Modify it to accept an array of file paths and upload all 4 images to the post.
    -   **`postToLinkedIn`:** This function will still accept a single file path, but it will be the path to the newly created merged image.

This plan represents a significant architectural change and will require careful implementation and testing at each step.
