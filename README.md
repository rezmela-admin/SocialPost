# Automated Social Media Bot v2.0

This project contains an automated bot for generating and posting content to social media. It has evolved into a robust, job-based system that separates content creation from the posting process.

## Core Architecture

The application uses a worker-based architecture for improved reliability and asynchronous operation.

*   **`app.js` (The Frontend):** This is the main, interactive script you run from your terminal. Its purpose is to handle user input, generate content (text and images), and add "jobs" to a queue file. It does **not** do the posting itself.
*   **`worker.js` (The Backend):** This script is launched by `app.js` when you choose to process the queue. Its only job is to find pending jobs in the queue, log in to the specified social media platforms, upload the content, and update the job's status.
*   **`post_queue.json`:** This file is the central nervous system of the bot. It acts as the communication channel between the app and the worker, storing all pending, processing, and completed jobs.

## Core Features

-   **Asynchronous Job Queue:** Create multiple posts without waiting for each one to upload. The worker processes them sequentially.
-   **Multi-Platform Support:** Post to X (Twitter) and LinkedIn.
-   **AI-Powered Content Generation:**
    -   Uses the Google Gemini API to generate post summaries and image prompts from a topic.
    -   Uses the OpenAI DALL-E API (`gpt-image-1`) to generate high-quality images.
-   **Flexible Content Creation:**
    -   **AI Summarization:** Let the AI generate a summary from a news topic.
    -   **Skip Summarization:** Provide your own post text and use the AI just for generating the image.
    -   **Post from Local Media:** Bypass AI image generation entirely and provide a path to a local image or video file.
-   **Advanced Creative Control:**
    -   **Creative Profiles:** Switch between different artistic styles, character personas, or prompt structures using a simple menu.
    -   **Multi-Character Scenes:** A dedicated profile (`multi_character_scene.json`) allows the AI to generate a single image with multiple characters and their dialogues, perfect for richer storytelling.
-   **Batch Processing:**
    -   **AI Batch Generation:** Provide a high-level theme (e.g., "US political news") and let the AI generate and queue multiple, distinct posts automatically.
-   **Secure Session Management:** Securely saves your social media login sessions, so you only have to log in once per platform.

## How to Use

The application is designed to be run from a single terminal window.

### Step 1: Initial Login (One-Time Setup)

Before you can post, you need to create login sessions for the platforms you intend to use.

1.  Run the application: `node app.js`
2.  From the main menu, select **Initial Login Setup**.
3.  A browser window will open. Log in to your social media account(s) as prompted.
4.  Once you successfully log in, the application will save an encrypted session file. You will not need to do this again unless the session expires.

### Step 2: Create and Queue a Post

You have several options for creating content, all available from the main menu:

*   **Generate and Queue a New Post:** The standard workflow. The app will guide you through providing a topic, getting an AI-generated summary and image, and approving the content before adding it to the queue.
*   **Create Post from Local Media:** This option lets you bypass the AI image generator. You provide the path to a local image/video file, write the post text, and add it to the queue.
*   **Generate Batch of Posts with AI:** A powerful feature for creating multiple posts at once. You provide a theme, and the AI handles the rest.

### Step 3: Process the Job Queue

Once you have one or more pending jobs in the queue, a new option will appear on the main menu.

1.  Select **Process Job Queue (# pending)** from the main menu.
2.  The application will launch the background worker, which will start posting the queued jobs. You will see the progress directly in your terminal.
3.  Once all jobs are processed, you will be prompted to press Enter to return to the main menu.

## Core Files

*   **`app.js`**: The user-facing main application.
*   **`worker.js`**: The background processor for posting jobs.
*   **`config.json`**: Contains all key configuration, including API models, social media URLs, and selectors.
*   **`post_queue.json`**: The job queue file.
*   **`/prompt_profiles/`**: A directory containing different JSON files that define the creative style and structure of the AI-generated content.
*   **`*.session.json`**: Encrypted session files for social media platforms (e.g., `x_session.json`). **Do not share these.**
