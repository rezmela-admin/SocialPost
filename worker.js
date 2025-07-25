// ============================================================================
// Asynchronous Job Queue Worker v1.0
// ============================================================================
// This worker runs in the background, processing jobs from post_queue.json.
// It is designed to be run on a schedule (e.g., via a cron job).
// ============================================================================
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import 'dotenv/config';

const QUEUE_FILE_PATH = path.join(process.cwd(), 'post_queue.json');

// --- Configuration Loading ---
function loadConfig() {
    try {
        const configFile = fs.readFileSync('./config.json', 'utf8');
        return JSON.parse(configFile);
    } catch (error) {
        console.error("[WORKER-FATAL] Error loading or parsing config.json:", error);
        process.exit(1);
    }
}

const config = loadConfig();

// --- Generic Posting Logic ---
async function postToPlatform(page, job, platformConfig) {
    const { summary, imagePath } = job;
    const { composeUrl, selectors } = platformConfig;

    console.log(`[WORKER-INFO] Navigating to compose URL: ${composeUrl}`);
    await page.goto(composeUrl);

    // Optional: Click a button to start a post if necessary (e.g., LinkedIn)
    if (selectors.startPostButton) {
        console.log("[WORKER-INFO] Clicking 'Start a post' button...");
        await page.locator(selectors.startPostButton).click();
    }

    // Uploading the image
    console.log("[WORKER-INFO] Preparing to upload image...");
    if (selectors.fileInput) {
        // Direct file input (e.g., X)
        await page.waitForSelector(selectors.fileInput, { state: 'attached', timeout: 60000 });
        // Use the generic selector for X, as it's more reliable.
        if (platformConfig.composeUrl.includes('x.com')) {
            await page.setInputFiles('input[type="file"]', imagePath);
        } else {
            await page.locator(selectors.fileInput).setInputFiles(imagePath);
        }
    } else if (selectors.addMediaButton) {
        // File chooser dialog (e.g., LinkedIn)
        const fileChooserPromise = page.waitForEvent('filechooser');
        await page.locator(selectors.addMediaButton).click();
        const fileChooser = await fileChooserPromise;
        await fileChooser.setFiles(imagePath);
    }
     if (selectors.imagePreview) {
        console.log("[WORKER-INFO] Waiting for image to be processed...");
        await page.waitForSelector(selectors.imagePreview, { state: 'visible', timeout: 60000 });
    }

    // Optional: Click a 'Next' button after upload if necessary
    if (selectors.nextButton) {
        console.log("[WORKER-INFO] Clicking 'Next' after image upload...");
        await page.locator(selectors.nextButton).click();
    }

    // Writing the post text
    console.log("[WORKER-INFO] Writing post text...");
    const postTextBox = page.locator(selectors.textBox);
    await postTextBox.waitFor({ state: 'visible', timeout: 10000 });

    // Use the robust 'getByRole' for X, but the standard selector for others.
    if (platformConfig.composeUrl.includes('x.com')) {
        await page.getByRole('textbox', { name: 'Post text' }).fill(summary);
    } else {
        await postTextBox.fill(summary);
    }

    // Clicking the final post button
    console.log("[WORKER-INFO] Clicking final post button...");
    await page.locator(selectors.postButton).click({ timeout: 60000 });

    // --- [REVISED] Confirmation Logic ---
    // The confirmation method is now driven by the selectors available in the config.
    console.log("[WORKER-INFO] Waiting for post confirmation...");

    // For X, wait for navigation to home timeline as a primary confirmation
    if (platformConfig.homeUrl && platformConfig.composeUrl.includes('x.com')) {
        console.log(`[WORKER-INFO] Waiting for navigation to home timeline (${platformConfig.homeUrl})...`);
        await page.waitForURL(platformConfig.homeUrl, { timeout: 60000 });
    }

    if (selectors.confirmationLocator) {
        // Method 1: Wait for a specific confirmation element to be visible.
        await page.locator(selectors.confirmationLocator).waitFor({ state: 'visible', timeout: 60000 });
        console.log("[WORKER-SUCCESS] Confirmation element is visible.");

    } else if (selectors.composeModal) {
        // Method 2: Wait for the compose modal to disappear.
        await page.locator(selectors.composeModal).waitFor({ state: 'hidden', timeout: 60000 });
        console.log("[WORKER-SUCCESS] Compose modal has disappeared.");

    } else {
        // If no confirmation method is specified, we can't be sure of success.
        throw new Error(`No valid confirmation selector (confirmationLocator or composeModal) found for this platform in the config.`);
    }

    console.log("[WORKER-SUCCESS] Platform post confirmed successfully!");
}


// --- Worker Main Logic ---
async function processQueue() {
    console.log('[WORKER-INFO] Worker started. Checking for pending jobs...');

    let queue = [];
    try {
        queue = JSON.parse(fs.readFileSync(QUEUE_FILE_PATH, 'utf8'));
    } catch (error) {
        console.error('[WORKER-FATAL] Could not read or parse queue file:', error);
        return;
    }

    const job = queue.find(j => j.status === 'pending');

    if (!job) {
        console.log('[WORKER-INFO] No pending jobs found. Worker shutting down.');
        return;
    }

    console.log(`[WORKER-INFO] Found job ${job.id}. Locking and processing...`);
    
    // Lock the job
    job.status = 'processing';
    job.processedAt = new Date().toISOString();
    fs.writeFileSync(QUEUE_FILE_PATH, JSON.stringify(queue, null, 2));

    let overallSuccess = true;

    for (const platformName of job.platforms) {
        let browser = null;
        const sessionFilePath = path.join(process.cwd(), `${platformName.toLowerCase()}_session.json`);
        const platformConfig = config.socialMedia[platformName];

        if (!platformConfig || !platformConfig.selectors) {
            console.error(`[WORKER-ERROR] Configuration for platform "${platformName}" is missing or incomplete.`);
            overallSuccess = false;
            continue; // Skip to the next platform
        }

        try {
            console.log(`[WORKER-INFO] Processing platform: ${platformName} for job ${job.id}`);
            browser = await chromium.launch({ headless: false }); // Headless can be true for production

            if (!fs.existsSync(sessionFilePath)) {
                throw new Error(`Session file for ${platformName} not found. Please log in first using the main application.`);
            }
            const context = await browser.newContext({ storageState: sessionFilePath });
            const page = await context.newPage();

            await postToPlatform(page, job, platformConfig);

        } catch (error) {
            console.error(`[WORKER-ERROR] Failed to post to ${platformName} for job ${job.id}:`, error);
            overallSuccess = false;
            job.errors = job.errors || [];
            job.errors.push({ platform: platformName, error: error.message, timestamp: new Date().toISOString() });
        } finally {
            if (browser) {
                await browser.close();
            }
            console.log(`[WORKER-INFO] Finished processing ${platformName}.`);
        }
    }

    // Update the job status
    job.status = overallSuccess ? 'completed' : 'failed';
    fs.writeFileSync(QUEUE_FILE_PATH, JSON.stringify(queue, null, 2));

    console.log(`[WORKER-INFO] Job ${job.id} finished with status: ${job.status}.`);
    
    // --- [NEW] Post-Processing Logic ---
    // Clean up the image file if the job was successful and not in debug mode
    if (overallSuccess && (!config.debug || !config.debug.preserveTemporaryFiles)) {
        if (fs.existsSync(job.imagePath)) {
            const action = config.postProcessing?.actionAfterSuccess || 'delete';
            
            if (action === 'backup') {
                const backupDir = config.postProcessing?.backupFolderPath || './post_backups';
                if (!fs.existsSync(backupDir)) {
                    fs.mkdirSync(backupDir, { recursive: true });
                }
                const backupPath = path.join(backupDir, path.basename(job.imagePath));
                fs.renameSync(job.imagePath, backupPath);
                console.log(`[WORKER-INFO] Image for job ${job.id} backed up to: ${backupPath}`);
            } else { // Default to delete
                fs.unlinkSync(job.imagePath);
                console.log(`[WORKER-INFO] Image for job ${job.id} deleted.`);
            }
        }
    }
}

// --- Entry Point ---
processQueue();
