# How to Use the Asynchronous Cartoon Bot

This guide explains how to use the new, asynchronous version of the cartoon bot. The application is now split into two main parts: a user-facing app for creating content and a background worker for posting it.

## Core Files

*   **`app.js`**: This is the main interactive application you will run. You use it to generate content and add posting jobs to a queue.
*   **`worker.js`**: This is a non-interactive script that runs in the background. Its only job is to find pending posts in the queue and publish them to the social media platforms.
*   **`post_queue.json`**: This file is the "to-do list" for the worker. `app.js` adds jobs here, and `worker.js` reads from it. You generally don't need to edit this file manually.
*   **`config.json`**: The main configuration file, just like before.

---

## Step-by-Step Guide

### Step 1: Initial Login (One-Time Setup)

Before you can queue any posts, you must log in to each social media platform at least once to create a valid session file for the worker.

1.  Run the main application:
    ```bash
    node app.js
    ```
2.  From the main menu, select **Initial Login Setup (Run this first!)**.
3.  Use the spacebar to select the platforms you want to log in to (e.g., X and LinkedIn) and press Enter.
4.  A browser window will open for each platform you selected. Log in to your account as you normally would.
5.  Once you have successfully logged in, the application will save a session file (e.g., `x_session.json`). You can then close the browser.

You only need to do this once per platform, or whenever your session expires.

### Step 2: Generate and Queue a Post

This is how you create a new cartoon and schedule it for posting.

1.  Run the main application if it's not already running:
    ```bash
    node app.js
    ```
2.  From the main menu, select **Generate and Queue a New Post**.
3.  Enter the topic for your cartoon in the text editor that appears.
4.  Next, you will be asked to **select the platforms** you want to post to. Use the spacebar to check all the platforms where you want this cartoon to appear (e.g., select both X and LinkedIn).
5.  The application will then guide you through approving the generated summary and image prompt.
6.  Once approved, the content will be generated, and a new job will be added to the `post_queue.json` file. The app will confirm this and return you to the main menu.

**The key benefit:** You can repeat this step to queue up many different posts without waiting for any of them to be published.

### Step 3: Process the Queue with the Worker

When you are ready to publish the posts you've queued, you need to run the worker.

1.  In your terminal, run the worker script:
    ```bash
    node worker.js
    ```

The worker will start, find the oldest pending job in `post_queue.json`, and begin posting it to the platforms specified in the job. It will process one job at a time until the queue is empty. You will see its progress logged in the console.

You can run `node worker.js` at any time. For full automation, you could set up a scheduled task (like a cron job on Linux or a Task Scheduler job on Windows) to run this command automatically every few minutes.
