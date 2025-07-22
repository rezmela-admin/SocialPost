# Application Porting Guide for Windows

This document outlines the steps required to move the Automated Daily Cartoon Bot to a new Windows machine and ensure it runs correctly.

## 1. Prerequisites

Before you begin, you must install the following software on the new Windows machine:

*   **Node.js (LTS):** This is the runtime environment for the application.
    *   Download the "LTS" (Long-Term Support) version from the official [Node.js website](https://nodejs.org/).
    *   The installer also includes `npm` (Node Package Manager), which is required for installing dependencies.
*   **Git:** This is the recommended tool for copying the project files.
    *   Download and install [Git for Windows](https://git-scm.com/download/win).

## 2. Transferring the Application

Follow these steps to move the application files and configure the environment.

### Step 2.1: Copy the Project Files

The most reliable method is to use Git. If your project is in a Git repository, simply clone it on the new machine:

```bash
# Open a terminal (Command Prompt or PowerShell) and navigate to where you want to store the project
git clone <your_repository_url>
cd <project_directory_name>
```

**Alternatively**, if you are not using Git, manually copy the entire project folder from the old machine to the new one.

**IMPORTANT:** When copying manually, you should **exclude** the `node_modules` folder. This folder contains thousands of small files and should be regenerated on the new machine.

Ensure the following files and folders are copied:
- `runAutomation.js`
- `config.json`
- `package.json`
- `package-lock.json`
- `.env`
- The entire `prompt_profiles` directory
- Any `schedule_*.json` files you wish to preserve
- (Optional) `x_session.json` and `linkedin_session.json` (see Step 2.4)

### Step 2.2: Install Dependencies

Once the files are on the new machine, you need to install the required Node.js libraries.

1.  Open a terminal (Command Prompt, PowerShell, or Git Bash).
2.  Navigate into the project's root directory.
3.  Run the following command:

```bash
npm install
```
This command reads the `package.json` file and downloads all the necessary libraries (like Playwright, OpenAI, etc.) into a new `node_modules` folder.

### Step 2.3: Configure API Keys

The application requires API keys for OpenAI and Google Gemini. These are stored in a `.env` file.

1.  In the project's root directory, create a new file named `.env`.
2.  Open the file in a text editor and add the following lines, replacing the placeholders with your actual keys:

```
OPENAI_API_KEY="your_openai_api_key_here"
GEMINI_API_KEY="your_google_gemini_api_key_here"
```
*   You can get your OpenAI key from the [OpenAI API Keys](https://platform.openai.com/api-keys) page.
*   You can get your Gemini key from the [Google AI Studio](https://aistudio.google.com/app/apikey) page.

### Step 2.4: (Optional) Transfer Login Sessions

To avoid having to manually log in to X and LinkedIn on the first run, you can copy the session files from the old machine to the new one.

- `x_session.json`
- `linkedin_session.json`

**Note:** This step is entirely optional. If you skip it, the application will simply prompt you to log in manually in the browser on the first run. After you log in successfully, the application will automatically create these files for you on the new machine.

Copy the files from the root directory of your old project folder to the root directory of your new one.

## 3. Running the Application

After completing the steps above, the application is ready to run.

1.  Open a terminal in the project's root directory.
2.  Run the start command:

```bash
node runAutomation.js
```

The application should launch, and if the session files were transferred correctly, it will be logged in and ready to use. If not, a browser window will open, and you will be prompted to log in to the respective social media platform.
