# Automated Social Media Bot v2.0

This project contains an automated bot for generating and posting content to social media. It uses a worker-based architecture to separate content creation from the posting process, allowing for asynchronous and reliable operation.

## Features

### Core Architecture
- **Asynchronous Job Queue:** Generate multiple posts in an interactive session without waiting for each one to upload. The app adds jobs to a queue, and a separate worker process handles the posting in the background.
- **Hybrid Platform Support:** Uses stable, official APIs where available (e.g., Bluesky) and robust browser automation for platforms with restrictive APIs (e.g., X, LinkedIn).
- **Cost-Effective Automation:** Bypasses expensive API fees on certain platforms by using intelligent browser automation, making frequent posting more accessible.
- **Secure Session Management:** Saves your social media login sessions so you only have to log in once per platform.

### AI-Powered Content Workflows
- **Interactive Comic Strip Generation:** A guided workflow for creating multi-panel comic strips. Each panel is generated and presented for user approval (`Approve`/`Retry`/`Edit`/`Cancel`), and the image is opened automatically to prevent errors and save time.
- **Virtual Influencer Posts:** A sophisticated two-phase workflow that first generates a character with a speech bubble against a neutral background, then uses inpainting to place that character into a completely different, AI-generated scene.
- **Standard Post Generation:** The classic workflow to generate a post with a summary and a single image based on a topic.
- **Batch Processing:** Generate and queue multiple posts from a single high-level theme, allowing for efficient content creation.

### Creative Control & Customization
- **Creative Profiles:** Define the AI's personality, the specific task it should perform, and the expected output format (e.g., a JSON structure for a comic). This allows for highly specialized and consistent content. Managed via the `prompt_profiles` directory.
- **Narrative Frameworks:** Inject proven storytelling structures (e.g., "Problem/Solution," "Myth Buster," "Before/After/Bridge") into the AI's prompt to guide the narrative and make content more engaging. Managed via the `narrative_frameworks` directory.
- **Graphic Styles:** Maintain a consistent visual aesthetic across all generated images by defining reusable style prompts. Managed in `graphic_styles.json`.
- **Character Library:** Ensure character consistency in comics and series by defining character appearances in a central library. The AI is instructed to adhere to these descriptions, preventing visual drift between panels. Managed in `character_library.json`.

 ## Installation

Follow these steps to set up and run the application.

### 1. Prerequisites: Node.js

This application requires Node.js. If you don't have it, download and install the latest LTS version.

- **[Download Node.js](https://nodejs.org/en/download)**

Verify the installation by opening a terminal and running `node -v`.

### 2. Project Setup

#### A. Clone the Repository
Clone this repository to your local machine.

#### B. Install Dependencies
Navigate to the project directory in your terminal and run:
```bash
npm install
```
This will install the necessary libraries from `package.json`.

#### C. Install Browsers for Automation
The application uses Playwright for browser automation. Install the required browsers by running:
```bash
npx playwright install
```

### 3. Configuration

The application requires API keys for the AI services you intend to use.

1.  Find the `.env.example` file.
2.  Create a copy of it and rename the copy to `.env`.
3.  Open the `.env` file and add your API keys for the services you want to use (e.g., OpenAI, Gemini).
    ```
    OPENAI_API_KEY="your_openai_api_key_here"
    GEMINI_API_KEY="your_gemini_api_key_here"
    ```
4.  Save the file.

#### Selecting AI Providers

You can choose between different AI providers for text and image generation by editing the `config.json` file.

-   Open `config.json`.
-   Locate the `textGeneration` and `imageGeneration` sections.
-   Set the `provider` key to your desired service (e.g., `"openai"`, `"gemini"`).
-   Set the `model` key to a model supported by your chosen provider.

**Example `config.json`:**
```json
"imageGeneration": {
  "provider": "openai",
  "providers": {
    "openai": { "model": "dall-e-3" },
    "gemini": { "model": "imagen-2" }
  }
}
```

## Usage

The application is split into two main parts: the interactive app (`app.js`) and the background worker (`worker.js`).

### Step 1: Initial Login (One-Time Setup)

Before you can queue posts, you must log in to your social media accounts to create a valid session.

1.  Run the main application:
    ```bash
    node app.js
    ```
2.  From the menu, select **Initial Login Setup**.
3.  A browser window will open. Log in to your accounts as prompted. The application will save your session for future use.

### Step 2: Generate and Queue Content

1.  Run `node app.js`.
2.  Choose one of the content creation options from the menu.
3.  Follow the prompts to generate and approve your content. A new job will be added to the `post_queue.json` file.

### Getting Started with Story Patterns

- From the main menu, choose `Story Pattern (narrative structure)`.
- Browse categories (How To, Storytelling, Biography, etc.) and pick a pattern.
- Then select Create New: the topic editor opens with that pattern’s example prefilled—overwrite it with your idea.
- To remove a pattern, open the Story Pattern browser and pick `No Template (Default)` at the root.
- The selected pattern guides structure for this session and can be changed anytime.

### Step 3: Process the Queue

When you are ready to publish your queued posts, run the worker:

```bash
node worker.js
```

The worker will find pending jobs in the queue and post them one by one. You can run this script at any time. For full automation, consider setting up a scheduled task (like a cron job or Windows Task Scheduler) to run it periodically.

## Video Export (Panels → MP4)

You can export a mobile-friendly MP4 from a generated comic output directory. This automates the ffmpeg steps and supports configurable durations, transitions, and a subtle Ken Burns zoom.

Basic example:

```bash
node scripts/export-video.js --input outputs/<your-comic-folder> \
  --size 1080x1920 --fps 30 --duration 2.0 \
  --transition slideleft --trans-duration 0.5 \
  --kenburns in --zoom-to 1.08
```

Key options:
- `--input` (required): path to an `outputs/<...>` folder containing `metadata.json` and a `panels/` directory.
- `--out`: file path for the resulting MP4 (default: `<input>/video-<timestamp>.mp4`).
- `--size <WxH>`: output resolution (default: `1080x1920` or `metadata.size`).
- `--fps`: frames per second (default: `30`).
- `--duration`: default seconds per panel.
- `--durations <csv>`: per-panel durations (e.g., `2.4,1.8,1.8,1.8,1.8,2.2`).
- `--transition`: global transition (e.g., `fade`, `fadeblack`, `slideleft`, `wipleft`, `none`).
- `--transitions <csv>`: per-gap transitions list.
- `--trans-duration`: crossfade/transition length in seconds (default: `0.5`).
- `--kenburns`: `none` | `in` | `out` (or CSV per panel).
- `--zoom-to`: end zoom factor for Ken Burns (default: `1.06`).

Behavior notes:
- If `panels/list.txt` exists (ffmpeg-concat format), its `duration` lines are used automatically.
- Images are scaled with letterboxing to the target size and encoded as `yuv420p` for wide compatibility.
- Transitions use ffmpeg `xfade`; `none` yields a hard cut.
- Slow zoom uses `zoompan` with a small linear change to avoid artifacting.
- If `metadata.json.panelDetails` contains lines like "Visual transition into next panel: push-in", the exporter auto-maps hints to transitions and per-panel Ken Burns when you don’t explicitly pass `--transitions`/`--kenburns`.
 - Strict mode (default) validates inputs and forces even output dimensions; if you supply an odd width/height, it adjusts to the nearest even for encoder compatibility.

### One‑Shot: TTS Narration + Export

To generate narration audio (Gemini TTS) and export the MP4 in one go:

```bash
node scripts/make-video-with-audio.js -i outputs/<your-comic-folder> \
  --voices Zephyr,Puck --transition slideleft --trans-duration 0.5 \
  --kenburns in --zoom-to 1.08
```

Notes:
- If `<input>/narration.wav` exists, it’s reused. Add `--force-tts` to regenerate, or `--skip-tts` to never run TTS.
- Provide a custom audio with `--narration <file>`.
- All regular exporter flags apply (e.g., `--durations`, `--size`, `--fps`).
- Requires `GEMINI_API_KEY` for TTS and `ffmpeg` on PATH.

## Story Patterns & Examples

The app supports reusable storytelling structures (“Story Patterns”) stored under `narrative_frameworks/` as JSON files. Each file typically has these keys:

- `name`: Display name in the menu (e.g., "Playbook: Title -> Steps -> CTA").
- `description`: One-line purpose of the pattern.
- `template`: Text appended to the AI task to guide structure.
- `example`: A short, concrete starter text shown to the user.

### Editor Preload Behavior

- When you select a Story Pattern that includes an `example`, the topic editor opens with that example prefilled. You can overwrite it directly.
- If no pattern is selected or the file lacks an `example`, the editor falls back to `config.search.defaultTopic`.
- Menu labels and prompts show only the first line of long examples for readability.

### Validate Framework Files (Optional)

You can validate all narrative templates at any time:

```bash
node scripts/validate_frameworks.js
```

This checks that each JSON under `narrative_frameworks/` is valid and contains `name`, `description`, `template`, and `example`. It prints `[OK]` if all pass, or lists any files with issues and exits non‑zero.
