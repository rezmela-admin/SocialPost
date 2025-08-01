# User Workflows for the Automated Daily Cartoon Bot

This document outlines the various user workflows available in the `app.js` command-line application.

## 1. Initial Setup

This is a one-time setup process required before using the main features of the application.

1.  **Launch the application:** Run `node app.js` from your terminal.
2.  **Select "Initial Login Setup"** from the main menu.
3.  **Choose Platforms:** Select the social media platforms (X, LinkedIn) you want to log in to.
4.  **Browser Login:** A browser window will open for each selected platform. Manually log in to your account.
5.  **Session Saved:** Once you successfully log in, the application will save a session file (e.g., `x_session.json`) to keep you logged in for future use.

## 2. Content Generation Workflows

These workflows are for creating new social media posts. The application uses a "Job Queue" system. All generated content is first added to a queue, and a separate process is used to post it online.

### 2.1. Standard Post Generation

This is the default workflow for creating a single cartoon post.

1.  **Select "Generate and Queue a New Post"** from the main menu.
2.  **Enter a Topic:** Provide a news topic or a theme for the cartoon.
3.  **AI Generation:** The application uses the Gemini language model to generate:
    *   A text summary of the topic.
    *   A descriptive prompt for generating the cartoon image.
4.  **Approve/Edit Text:** You will be prompted to:
    *   **Approve:** Accept the AI-generated text as is.
    *   **Edit:** Open the text in your default command-line editor to make changes.
    *   **Cancel:** Stop the post-creation process.
5.  **Image Generation:** The application uses the OpenAI API (e.g., DALL-E or GPT models, as configured in `config.json`) to create the cartoon image based on the final approved prompt.
6.  **(Optional) Add Speech Bubble:** You can add a speech bubble with custom text to the image.
7.  **Queue Post:** The final image and summary are saved as a new job in the `post_queue.json` file.

### 2.2. Multi-Character Scene Generation

This workflow creates a single-panel cartoon featuring multiple characters interacting.

1.  **Load a "Multi-Character Scene" Profile:** Go to "Manage Creative Profiles" and load a profile with the `multiCharacterScene` workflow (e.g., `multi_character_scene.json`).
2.  **Enter a Topic:** Provide a topic for the cartoon.
3.  **AI Scene Generation:** The AI is tasked with creating a scene. It receives a library of characters and returns:
    *   A `summary` of the topic.
    *   A `sceneDescription` for the background and setting.
    *   An array of `characters`, each with assigned `dialogue`.
4.  **Approve/Edit Scene:** You will be prompted to approve or edit the generated `summary` and the final, combined image prompt.
5.  **Image Generation:** The application constructs a single, detailed prompt describing the entire scene, including all characters and their dialogue, and sends it to the image generator.
6.  **Queue Post:** The final image and summary are added to the job queue.

### 2.3. Virtual Influencer Post Generation

This workflow creates a post featuring a consistent character against a generated background.

1.  **Load a "Virtual Influencer" Profile:** Go to "Manage Creative Profiles" and load a profile that has the `virtualInfluencer` workflow.
2.  **Follow Standard Steps 1-4:** The process starts similarly to the standard workflow, but the AI will generate a **summary**, **character dialogue**, and a **background description**. You will approve or edit each of these.
3.  **Phase 1: Character Generation:** The app generates the influencer character with a transparent background.
4.  **Phase 2: Inpainting:** A Python script (`edit_image.py`) is automatically called to combine the character and the background (generated based on your approved prompt).
5.  **Queue Post:** The final composite image and summary are added to the job queue.

### 2.4. Comic Strip Generation

The application supports two distinct comic strip generation workflows, controlled by the active Creative Profile.

#### Workflow A: Character-Driven Comic Strip

This workflow generates a 4-panel comic strip featuring specific characters from a predefined library.

1.  **Load a "Character Comic Strip" Profile:** Go to "Manage Creative Profiles" and load a profile configured for this workflow (e.g., `character_comic_strip.json`). This profile's task instructs the AI to use a character library.
2.  **Enter a Topic:** Provide a topic for the comic strip.
3.  **AI Story Generation:** The AI receives the topic and a list of available characters from `character_library.json`. It then generates:
    *   A `summary` for the post.
    *   A `panels` array, where each panel object specifies a `character` from the library, a `panel_description`, and `dialogue`.
4.  **Approve Summary:** You approve or edit the overall summary for the post.
5.  **Panel Generation:** The app generates four separate images, one for each panel. The prompt for each panel is constructed using the style from the profile and the specific `panel_description` from the AI.
6.  **Stitching:** The four panel images are automatically stitched together into a single 2x2 grid image.
7.  **Queue Post:** The final comic strip image and summary are added to the job queue.

#### Workflow B: Generic Comic Strip

This workflow generates a 4-panel comic strip where the AI has creative freedom to invent characters and scenes.

1.  **Load a "Comic Strip" Profile:** Go to "Manage Creative Profiles" and load a generic comic profile (e.g., `comic_strip.json`). This profile's task does *not* require the use of a character library.
2.  **Enter a Topic:** Provide a topic for the comic strip.
3.  **AI Story Generation:** The AI generates a `summary` and a `panels` array. Each panel object contains a `description` of the scene and `dialogue`.
4.  **Approve Summary:** You approve or edit the overall summary for the post.
5.  **Panel Generation & Stitching:** The process continues as in Workflow A, generating and stitching the four panels.
6.  **Queue Post:** The final comic strip image and summary are added to the job queue.

### 2.5. Post from Local Media

This workflow allows you to create a post using an image or video file from your computer.

1.  **Select "Create Post from Local Media"** from the main menu.
2.  **Provide File Path:** Enter the full, absolute path to your image or video file.
3.  **Enter Summary:** Write the text content for your post.
4.  **Select Platforms:** Choose which social media platforms to post to.
5.  **Queue Post:** The local media path and your summary are added to the job queue.

### 2.6. AI-Powered Batch Generation

This workflow lets you create multiple posts at once based on a single theme.

1.  **Select "Generate Batch of Posts with AI"** from the main menu.
2.  **Enter a Theme:** Provide a high-level theme (e.g., "US political news this week").
3.  **Enter Count:** Specify how many posts you want the AI to create.
4.  **AI Topic Generation:** The AI generates a list of distinct post topics based on your theme.
5.  **Automated Generation:** The application then runs the **Standard Post Generation** workflow for each topic automatically, without any interactive prompts for approval or editing.
6.  **Queue Posts:** All generated posts are added to the job queue.

## 3. Queue and Profile Management

### 3.1. Processing the Job Queue

1.  **Select "Process Job Queue"** from the main menu (this option only appears if there are pending jobs).
2.  **Worker Process:** This launches a separate script (`worker.js`) that goes through the `post_queue.json` file.
3.  **Posting:** The worker posts each "pending" job to the social media platforms specified in the job details.
4.  **Status Update:** The status of the job in the queue is updated to "complete" or "failed".

### 3.2. Clearing the Job Queue

1.  **Select "Clear Job Queue & Cleanup Files"** from the main menu.
2.  **Confirm:** You will be asked to confirm the action.
3.  **Action:** This will delete all pending jobs from the queue and remove any associated image files from the project directory.

### 3.3. Managing Creative Profiles

This menu allows you to change the style, character, and behavior of the AI content generation.

*   **Load a Profile:** Switch between different pre-defined creative profiles (e.g., `sarcastic_wit`, `vintage_comic`). This changes the active style and prompts used for generation.
*   **Create a New Profile:** Build a new profile by providing a name, a style description (e.g., "A dark, noir-style comic"), and a task for the AI.
*   **Delete a Profile:** Permanently remove a creative profile.
