# Automated Social Media Bot

This project contains an automated bot that performs the following cycle:
1.  Fetches a topic from the user or a schedule file.
2.  Uses the Google Gemini API to generate a news summary and a creative prompt for an image.
3.  Uses the OpenAI DALL-E API to generate an image based on the prompt.
4.  Adds the post to a queue, which is then processed by a background worker to post on social media (currently supports X/Twitter and LinkedIn).

## Core Architecture

This application now runs on a worker-based architecture to improve reliability and separate concerns.

*   **`app.js` (The Frontend):** This is the main interactive script you run. Its job is to handle user input, generate the content and image, and then add a "job" to the `post_queue.json` file. It does **not** do the posting itself.
*   **`worker.js` (The Backend):** This script runs in the background. Its only job is to check the `post_queue.json` for pending jobs, process them one by one (i.e., log in and post to the specified platform), and update their status.
*   **`post_queue.json`:** This file acts as the communication channel between the app and the worker.

## Features

-   **Asynchronous Posting:** Jobs are added to a queue, so you can create multiple posts without waiting for each one to upload.
-   **Multi-Platform:** Post to X (Twitter) and LinkedIn.
-   **Interactive & Scheduled Modes:** Run posts immediately or schedule them for later.
-   **Creative Profiles:** Switch between different artistic styles and character personas.
-   **Session Management:** Securely saves your social media sessions so you only have to log in once per platform.

## Prerequisites

-   [Node.js](https://nodejs.org/) (v18 or higher recommended)
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

3.  **Set up your environment variables:**
    -   Make a copy of the `.env.example` file and name it `.env`.
    -   Open the `.env` file and add your API keys.

## Configuration

All major settings are controlled in `config.json`. Here you can define:
-   Default topics for posts.
-   The models used for text and image generation.
-   The URLs and selectors for social media posting.
-   The active creative profile and style.

## Usage

The application now has two parts that you need to run.

### Step 1: Run the Worker (Do this once)

In your terminal, start the worker process. It will run in the background, watching for new jobs.

```bash
node worker.js
```

The worker will check the queue every minute for new posts to process.

### Step 2: Run the App (To create posts)

In a **separate terminal**, run the main application to create and schedule your posts.

```bash
node app.js
```

The app will present a menu to:
-   Create and queue a post immediately.
-   Manage creative profiles.
-   Schedule posts by editing the `schedule_x.json` or `schedule_linkedin.json` files.