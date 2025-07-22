# Automated Daily Cartoon Bot

This project contains an automated bot that performs the following cycle:
1.  Fetches a topic from the user or a schedule file.
2.  Uses the Google Gemini API to generate a news summary and a creative prompt for a political cartoon.
3.  Uses the OpenAI DALL-E API to generate an image based on the cartoon prompt.
4.  Posts the generated image and the news summary to a social media account (currently supports X/Twitter and LinkedIn).

## Features

-   **Multi-Platform:** Post to X (Twitter) and LinkedIn.
-   **Interactive & Scheduled Modes:** Run posts immediately with interactive prompts or schedule them for fully automated posting.
-   **Creative Profiles:** Switch between different artistic styles and character personas (e.g., "Standard Cartoon" vs. "Virtual Influencer").
-   **Hybrid Image Generation:** Includes an advanced workflow that uses a Python script for high-fidelity image editing and inpainting.
-   **Session Management:** Securely saves your social media sessions so you only have to log in once.

## Prerequisites

-   [Node.js](https://nodejs.org/) (v18 or higher recommended)
-   [Python](https://www.python.org/) (if using the Virtual Influencer/inpainting features)
-   An account with access to the OpenAI and Google Gemini APIs.

## Installation

1.  **Clone the repository:**
    ```bash
    git clone <repository-url>
    cd <repository-directory>
    ```

2.  **Install Node.js dependencies:**
    ```bash
    npm install
    ```

3.  **Install Python dependencies** (if needed for the influencer workflow):
    ```bash
    pip install -r requirements.txt 
    # Note: You may need to create a requirements.txt file for the 'edit_image.py' script's dependencies.
    ```

4.  **Set up your environment variables:**
    -   Make a copy of the `.env.example` file and name it `.env`.
    -   Open the `.env` file and add your API keys:
        ```
        OPENAI_API_KEY="YOUR_OPENAI_API_KEY_HERE"
        GEMINI_API_KEY="YOUR_GEMINI_API_KEY_HERE"
        ```

## Configuration

All major settings are controlled in `config.json`. Here you can define:
-   Default topics for posts.
-   The models used for text and image generation.
-   The URLs for social media posting.
-   The active creative profile and style.

## Usage

To run the application, use the following command:

```bash
node runAutomation.js
```

The script will launch a browser window and present a menu with the following options:
-   **Post immediately:** Interactively create and post a new cartoon.
-   **Manage Profiles:** Create, load, or delete creative profiles.
-   **Scheduler:** Start, stop, or manually trigger the automated posting schedule.
-   **Switch Platform:** Change between X and LinkedIn.

### Scheduling Posts

To schedule posts, edit the `schedule_x.json` or `schedule_linkedin.json` files. Add a new JSON object for each post you want to schedule.

**Example:**
```json
[
  {
    "topic": "A newsworthy event...",
    "postAt": "2025-07-25 10:00",
    "status": "pending",
    "speechBubbleText": "This is what the character will say!"
  }
]
```
-   `speechBubbleText` is an optional field. If included, the post will be fully automated. If omitted, the script will pause and ask for input when the post is due.
