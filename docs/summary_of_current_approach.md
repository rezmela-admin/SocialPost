# Summary of the Current Virtual Influencer Implementation

This document outlines the intended workflow for the "Virtual Influencer" feature in `runAutomation.js`.

## Goal

The objective is to create a composite image where a consistently described virtual character is seamlessly blended into a dynamically generated background. The process relies on a text-based character description and a two-step AI image generation process (inpainting).

## Core Components

1.  **Creative Profiles (`/prompt_profiles`)**: This system allows for different creative modes. The key profile for this feature is `virtual_influencer.json`.

2.  **`virtual_influencer.json` Profile**: This profile is structured to guide the AI. It must contain:
    *   `"style"`: A description of the overall image aesthetic (e.g., "A hyper-realistic, professional photograph...").
    *   `"characterDescription"`: A detailed **text description** of the virtual influencer's appearance (hair, clothes, expression, etc.). This is the key to achieving character consistency.
    *   `"task"`: A prompt for the Gemini model that asks for a `summary` and a `backgroundPrompt` (a description of a setting for the influencer).

## Intended Workflow (`runSinglePostCycle` function)

When a "Virtual Influencer" profile is active, the script should perform the following steps:

1.  **Get Prompts**: The script calls the Gemini CLI to get the `summary` and the `backgroundPrompt` based on the user's topic.

2.  **Generate Background Image**:
    *   It calls the OpenAI `images.generate` API.
    *   It uses the `backgroundPrompt` to create the scene.
    *   **Crucially**, it should use the `response_format: 'b64_json'` parameter to get the image data directly, avoiding URL downloads.

3.  **Create Mask Locally**:
    *   Using the generated background image data, the script leverages the `sharp` library to create a "mask" file (`mask.png`).
    *   This mask is a black image with a white rectangle in the bottom-right corner. This white "hole" tells the AI where to paint the character.

4.  **Perform Inpainting**:
    *   It calls the OpenAI `images.edit` API.
    *   It provides three inputs: the background image, the newly created mask, and a text prompt that combines the `characterDescription` from the profile with instructions to blend the character naturally into the scene.
    *   This call should also use `response_format: 'b64_json'` to get the final, blended image data directly.

5.  **Post to Social Media**: The final, composite image is then posted to the selected platform.

This entire process is designed to happen without any URL downloads from the OpenAI API, relying exclusively on the `b64_json` response format which has proven to be the most reliable method. The `SyntaxError` in the last attempt was a separate, unrelated mistake in the string processing logic.
