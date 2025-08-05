# Automated Social Media Bot v2.0

This project contains an automated bot for generating and posting content to social media. It uses a worker-based architecture to separate content creation from the posting process, allowing for asynchronous and reliable operation.

## Features

- **Cost-Effective Automation:** Bypasses expensive API fees on platforms like X and LinkedIn by using intelligent browser automation, making it accessible for everyone.
- **Hybrid Platform Support:** Uses stable, official APIs where available (e.g., Bluesky) and robust browser automation for platforms with restrictive APIs (e.g., X, LinkedIn).
- **Asynchronous Job Queue:** Create multiple posts without waiting for each one to upload.
- **AI-Powered Content Generation:**
  - Uses Google Gemini for text generation.
  - Uses OpenAI DALL-E for image generation.
- **Flexible Content Creation:**
  - Generate content from a news topic.
  - Provide your own post text and generate only an image.
  - Post directly from local image or video files.
- **Advanced Creative Control:** Use creative profiles to switch between different artistic styles and prompt structures.
- **Batch Processing:** Generate and queue multiple posts from a single high-level theme.
- **Secure Session Management:** Saves your social media login sessions so you only have to log in once.

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

#### Selecting the Image Generation Provider

You can choose between different AI providers for image generation by editing the `config.json` file.

-   Open `config.json`.
-   Locate the `imageGeneration` section.
-   Set the `provider` key to `"openai"` or `"gemini"`.
-   Set the `model` key to a model supported by your chosen provider.

**Example for OpenAI:**
```json
"imageGeneration": {
  "provider": "openai",
  "model": "gpt-image-1",
  "size": "1024x1024",
  "imageFileName": "daily_cartoon.png"
}
```

**Example for Gemini:**
```json
"imageGeneration": {
  "provider": "gemini",
  "model": "imagen-4",
  "size": "1024x1024",
  "imageFileName": "daily_cartoon.png"
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

### Step 2: Generate and Queue a Post

1.  Run `node app.js`.
2.  Choose one of the content creation options from the menu:
    - **Generate and Queue a New Post:** The standard workflow.
    - **Create Post from Local Media:** Post a local image or video.
    - **Generate Batch of Posts with AI:** Create multiple posts at once.
3.  Follow the prompts to generate and approve your content. A new job will be added to the `post_queue.json` file.

### Step 3: Process the Queue

When you are ready to publish your queued posts, run the worker:

```bash
node worker.js
```

The worker will find pending jobs in the queue and post them one by one. You can run this script at any time. For full automation, consider setting up a scheduled task (like a cron job or Windows Task Scheduler) to run it periodically.