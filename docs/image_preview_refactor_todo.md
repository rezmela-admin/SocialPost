# TODO: Refactor Image Preview and Approval Workflow

**Date:** August 28, 2025

## 1. The Problem

The application currently has an inconsistent user experience for image previews. When generating a single-image post:
- If the `imageGeneration.provider` in `config.json` is set to `"gemini"`, the user is shown a preview of the image and asked for approval before the post is queued.
- If the `imageGeneration.provider` is set to `"openai"`, no preview is shown, and the post is queued immediately after generation.

The root cause is a design flaw: the preview and approval logic was incorrectly implemented *inside* the `gemini-provider.js` file, whereas the `openai-provider.js` file correctly focuses only on image generation. The user interaction logic should be handled at a higher level in the application's workflows to ensure consistency.

## 2. The Solution

The goal is to refactor the code so that a preview and approval step is present for **all** single-image post generations, regardless of the selected provider.

### Step 1: Create a Centralized Approval Function

-   **Action:** Create a new function named `getPostApproval` in `src/lib/utils.js`.
-   **Purpose:** This function will be a generic approval workflow for single-image posts. It should:
    1.  Accept the path to a generated image and the current session state.
    2.  Open the image file for the user to view.
    3.  Present a prompt with options: "Approve", "Retry", "Edit Prompt", and "Cancel".
    4.  Handle the retry/edit loop internally.
    5.  Return a boolean `true` if the image is approved, and `false` if the user cancels.
-   **Reference:** This new function can be modeled closely on the existing `getPanelApproval` function in the same file, which performs a similar task for comic strip panels.

### Step 2: Integrate the Approval Function into the Main Workflow

-   **Action:** Modify the `generateAndQueuePost` function in `src/lib/workflows.js`.
-   **Purpose:** To integrate the new approval step into the single-post generation process.
    1.  After the image is generated and saved to a temporary file, call the new `getPostApproval` function.
    2.  If `getPostApproval` returns `true`: proceed with watermarking, queuing the job, and other post-generation steps.
    3.  If `getPostApproval` returns `false`: delete the temporary image file and gracefully cancel the operation, returning the user to the main menu.

### Step 3: (Optional but Recommended) Clean up the Gemini Provider

-   **Action:** Refactor the `generateImage` function in `src/lib/image-generators/gemini-provider.js`.
-   **Purpose:** To remove the preview and approval logic that is currently inside it.
-   **Details:** The Gemini provider should be simplified to *only* handle the logic of making the API call and returning the Base64 image data, just like the `openai-provider.js` does. This makes the providers interchangeable and keeps the responsibility for user interaction in the correct layer of the application.

By following these steps, the image preview functionality will be consistent, maintainable, and correctly separated from the image generation logic.

---

# TODO: Fix Intermittent `[object Object]` Bug in Image Prompt

**Date:** August 28, 2025

## 1. The Problem

When generating a single-image post, the final image prompt sometimes contains the literal string `[object Object]`. This bug also causes the user's edited and approved `summary` to be ignored when the image prompt is constructed.

The root cause is an intermittent formatting error from the AI. Occasionally, the AI returns a JSON object for the `imagePrompt` field instead of the expected string (e.g., `{ "prompt": "..." }`). The current code does not handle this gracefully. The `||` operator in the prompt construction logic (`imagePrompt || summary`) sees the object, considers it "truthy," and uses it, which results in the `[object Object]` error and causes the `summary` to be ignored.

## 2. The Solution

The fix is to make the prompt construction logic more robust so it can handle the AI's occasional malformed responses.

-   **Action:** Modify the `generateAndQueuePost` function in `src/lib/workflows.js`.
-   **Purpose:** To intelligently check the `imagePrompt` variable before using it.
-   **Implementation:** Replace the current prompt construction line with a more defensive check.

**Current (Buggy) Code:**
```javascript
const { imagePrompt, dialogue } = parsedResult;
let finalImagePrompt = `${selectedStyle.prompt} ${imagePrompt || summary}`;
```

**New (Robust) Code:**
```javascript
const { imagePrompt, dialogue } = parsedResult;

// Determine the base text for the image prompt.
// Use imagePrompt if it's a valid string, otherwise fall back to the approved summary.
const baseImagePromptText = (typeof imagePrompt === 'string' && imagePrompt.trim().length > 0)
    ? imagePrompt
    : summary;

let finalImagePrompt = `${selectedStyle.prompt} ${baseImagePromptText}`;
```

This new code ensures that:
1.  The `imagePrompt` is only used if it is a valid, non-empty string.
2.  If the AI provides a faulty `imagePrompt` (like an object), the code safely falls back to using the user-approved `summary`.
3.  This fixes both the `[object Object]` error and the issue of the edited summary being ignored.