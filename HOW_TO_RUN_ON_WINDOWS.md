# How to Run the Automated Cartoon Bot on Windows

This guide provides step-by-step instructions to set up and run the application on a Windows machine.

## 1. Prerequisites: Install Node.js

This application requires Node.js to run. If you don't have it installed, please download and install the latest **LTS (Long-Term Support)** version from the official website.

- **[Download Node.js for Windows](https://nodejs.org/en/download/prebuilt-installer)**

You can verify the installation by opening a Command Prompt and running:
```cmd
node -v
```
This should print the version number (e.g., `v20.11.0`).

## 2. Application Setup

Follow these steps in your project folder.

### Step A: Configure API Keys

The application needs API keys for OpenAI and Gemini to generate content.

1.  Find the file named `.env.example` in the project folder.
2.  Make a copy of this file and rename the copy to `.env`.
3.  Open the new `.env` file in a text editor (like Notepad).
4.  Paste your secret API keys into the appropriate fields:

    ```
    # .env file
    OPENAI_API_KEY="your_openai_api_key_here"
    GEMINI_API_KEY="your_gemini_api_key_here"
    ```
5.  Save and close the file.

### Step B: Install Dependencies

Next, you need to download all the required libraries for the project.

1.  Open a Command Prompt or PowerShell window.
2.  Navigate to the project directory. For example:
    ```cmd
    cd C:\Path\To\Your\Project\SocialPost
    ```
3.  Run the following command to install the libraries from `package.json`:
    ```cmd
    npm install
    ```
    This will create a `node_modules` folder in your project directory.

### Step C: Install Browsers for Automation

The application uses the Playwright library to automate posting to social media. You need to download the browsers that Playwright will use.

1.  In the same terminal, run this command:
    ```cmd
    npx playwright install
    ```
2.  This will download the necessary browser files (like Chromium) into your system.

## 3. Running the Application

You are now ready to run the bot.

1.  In your terminal (still in the project directory), run the following command:
    ```cmd
    node app.js
    ```
2.  The application menu will appear.
3.  **First-Time Use:** The first thing you should do is select the **`Initial Login Setup`** option from the menu. This will open a browser window and ask you to log in to your social media accounts (e.g., X, LinkedIn). This saves your session so the bot can post on your behalf later.
4.  After logging in, you can start generating content and queuing posts.

Enjoy using the bot!
