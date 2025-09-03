// ============================================================================
// Asynchronous Job Queue Worker v1.0
// ============================================================================
// This worker runs in the background, processing jobs from post_queue.json.
// It is designed to be run on a schedule (e.g., via a cron job).
// ============================================================================
import { BskyAgent } from '@atproto/api';
import { chromium } from 'playwright';
import fsPromises from 'fs/promises';
import fs from 'fs';
import path from 'path';
import 'dotenv/config';
import sharp from 'sharp';

const QUEUE_FILE_PATH = path.join(process.cwd(), 'post_queue.json');

// --- Archiving Helpers ---
function toSlug(text, maxLen = 80) {
    if (!text) return 'untitled';
    return text
        .toLowerCase()
        .replace(/[^a-z0-9\s-_]/g, '')
        .trim()
        .replace(/[\s_-]+/g, '-')
        .slice(0, maxLen) || 'untitled';
}

async function archivePostedAsset(job, absoluteImagePath, config, errors) {
    try {
        const root = config.postProcessing?.archiveFolderPath || './post_archive';
        const created = job.createdAt ? new Date(job.createdAt) : new Date();
        const yyyy = String(created.getFullYear());
        const mm = String(created.getMonth() + 1).padStart(2, '0');
        const dd = String(created.getDate()).padStart(2, '0');
        const profile = (job.profile || 'default').toString().replace(/[^a-zA-Z0-9_-]/g, '_');
        const topicSlug = toSlug(job.topic, 80);
        const jobDir = path.join(root, yyyy, mm, dd, profile, `${job.id}_${topicSlug}`);
        await fsPromises.mkdir(jobDir, { recursive: true });

        // Move image
        const imageExt = path.extname(absoluteImagePath) || '.png';
        const destImagePath = path.join(jobDir, `image${imageExt}`);
        await fsPromises.rename(absoluteImagePath, destImagePath);

        // Move optional PDF (same basename, .pdf)
        const pdfCandidate = absoluteImagePath.replace(/\.[^.]+$/, '.pdf');
        try {
            await fsPromises.access(pdfCandidate);
            const destPdfPath = path.join(jobDir, 'image.pdf');
            await fsPromises.rename(pdfCandidate, destPdfPath);
        } catch (_) {
            // no pdf present
        }

        // Write metadata
        const metadata = {
            id: job.id,
            topic: job.topic,
            summary: job.summary,
            platforms: job.platforms,
            profile: job.profile,
            createdAt: job.createdAt,
            processedAt: job.processedAt || new Date().toISOString(),
            status: 'completed',
            errors: errors || [],
            files: {
                image: path.basename(destImagePath),
                pdf: 'image.pdf'
            },
            archiveVersion: 1
        };
        await fsPromises.writeFile(path.join(jobDir, 'metadata.json'), JSON.stringify(metadata, null, 2));
        console.log(`[WORKER-INFO] Archived job ${job.id} to: ${jobDir}`);
    } catch (e) {
        console.warn(`[WORKER-WARN] Failed to archive job ${job.id}:`, e.message);
    }
}

// --- Configuration Loading ---
async function loadConfig() {
    try {
        const configFileContent = await fsPromises.readFile('./config.json', 'utf8');
        return JSON.parse(configFileContent);
    } catch (error) {
        console.error("[WORKER-FATAL] Error loading or parsing config.json:", error);
        process.exit(1);
    }
}

// --- Bluesky Posting Logic ---
async function postToBluesky(job, config) {
    const handle = process.env.BLUESKY_HANDLE;
    const appPassword = process.env.BLUESKY_APP_PASSWORD;

    if (!handle || !appPassword) {
        throw new Error('Bluesky handle or app password not set in .env file.');
    }
    
    const agent = new BskyAgent({ service: config.socialMedia.Bluesky.serviceUrl });
    await agent.login({ identifier: handle, password: appPassword });
    
    const absoluteImagePath = path.join(process.cwd(), job.imagePath);
    
    let imageBuffer;
    const stats = await fsPromises.stat(absoluteImagePath);
    const fileSizeInMB = stats.size / (1024 * 1024);

    if (fileSizeInMB > 0.95) { // Check if file size is > 0.95MB
        console.log(`[WORKER-INFO] Image is ${fileSizeInMB.toFixed(2)}MB, resizing for Bluesky...`);
        imageBuffer = await sharp(absoluteImagePath)
            .resize(1024, null, { withoutEnlargement: true }) // Resize width to 1024px
            .jpeg({ quality: 85 }) // Convert to JPEG for smaller size
            .toBuffer();
    } else {
        imageBuffer = await fsPromises.readFile(absoluteImagePath);
    }

    const uploadResponse = await agent.uploadBlob(imageBuffer, { encoding: 'image/jpeg' });
    
    await agent.post({
        text: job.summary,
        embed: {
            $type: 'app.bsky.embed.images',
            images: [{ image: uploadResponse.data.blob, alt: job.topic }]
        }
    });
}

// --- Generic Posting Logic ---
async function postToPlatform(page, job, platformConfig, timeouts) {
    const absoluteImagePath = path.join(process.cwd(), job.imagePath);
    const { summary, imagePath } = job;
    const { composeUrl, selectors } = platformConfig;

    console.log(`[WORKER-INFO] Navigating to compose URL: ${composeUrl}`);
    await page.goto(composeUrl, { timeout: timeouts.pageLoad });

    // Optional: Click a button to start a post if necessary (e.g., LinkedIn)
    if (selectors.startPostButton) {
        console.log("[WORKER-INFO] Clicking 'Start a post' button...");
        await page.locator(selectors.startPostButton).click({ timeout: timeouts.selector });
    }

    // Uploading the image
    console.log("[WORKER-INFO] Preparing to upload image...");
    if (selectors.fileInput) {
        // Direct file input (e.g., X)
        await page.waitForSelector(selectors.fileInput, { state: 'attached', timeout: timeouts.selector });
        // Use the generic selector for X, as it's more reliable.
        if (platformConfig.composeUrl.includes('x.com')) {
            await page.setInputFiles('input[type="file"]', absoluteImagePath, { timeout: timeouts.selector });
        } else {
            await page.locator(selectors.fileInput).setInputFiles(absoluteImagePath, { timeout: timeouts.selector });
        }
    } else if (selectors.addMediaButton) {
        // File chooser dialog (e.g., LinkedIn)
        const fileChooserPromise = page.waitForEvent('filechooser', { timeout: timeouts.selector });
        await page.locator(selectors.addMediaButton).click({ timeout: timeouts.selector });
        const fileChooser = await fileChooserPromise;
        await fileChooser.setFiles(absoluteImagePath);
    }
     if (selectors.imagePreview) {
        console.log("[WORKER-INFO] Waiting for image to be processed...");
        await page.waitForSelector(selectors.imagePreview, { state: 'visible', timeout: timeouts.selector });
    }

    // Optional: Click a 'Next' button after upload if necessary
    if (selectors.nextButton) {
        console.log("[WORKER-INFO] Clicking 'Next' after image upload...");
        await page.locator(selectors.nextButton).click({ timeout: timeouts.selector });
    }

    // Writing the post text
    console.log("[WORKER-INFO] Writing post text...");
    const postTextBox = page.locator(selectors.textBox);
    await postTextBox.waitFor({ state: 'visible', timeout: timeouts.textBoxVisible });

    // --- [NEW] Dynamic Timeout Logic ---
    const typingTimeout = timeouts.typing.base + (summary.length * timeouts.typing.perChar);
    const typingDelay = timeouts.typing.delay;
    console.log(`[WORKER-INFO] Typing summary of ${summary.length} chars. Using delay: ${typingDelay}ms, timeout: ${typingTimeout}ms.`);

    // Use the robust 'getByRole' for X, but the standard selector for others.
    if (platformConfig.composeUrl.includes('x.com')) {
        // Using .type() with a delay to simulate human typing and avoid race conditions with hashtag popups.
        const textbox = page.getByRole('textbox', { name: 'Post text' });
        await textbox.type(summary, { delay: typingDelay, timeout: typingTimeout });
    } else {
        // Using .type() with a delay for other platforms as well for robustness.
        await postTextBox.type(summary, { delay: typingDelay, timeout: typingTimeout });
    }

    // Clicking the final post button
    console.log("[WORKER-INFO] Clicking final post button...");
    await page.locator(selectors.postButton).click({ timeout: timeouts.postButton });

    // --- [REVISED] Confirmation Logic ---
    // The confirmation method is now driven by the selectors available in the config.
    console.log("[WORKER-INFO] Waiting for post confirmation...");

    // For X, wait for navigation to home timeline as a primary confirmation
    if (platformConfig.homeUrl && platformConfig.composeUrl.includes('x.com')) {
        console.log(`[WORKER-INFO] Waiting for navigation to home timeline (${platformConfig.homeUrl})...`);
        await page.waitForURL(platformConfig.homeUrl, { timeout: timeouts.confirmation });
    }

    if (selectors.confirmationLocator) {
        // Method 1: Wait for a specific confirmation element to be visible.
        await page.locator(selectors.confirmationLocator).waitFor({ state: 'visible', timeout: timeouts.confirmation });
        console.log("[WORKER-SUCCESS] Confirmation element is visible.");

    } else if (selectors.composeModal) {
        // Method 2: Wait for the compose modal to disappear.
        await page.locator(selectors.composeModal).waitFor({ state: 'hidden', timeout: timeouts.confirmation });
        console.log("[WORKER-SUCCESS] Compose modal has disappeared.");

    } else {
        // If no confirmation method is specified, we can't be sure of success.
        throw new Error(`No valid confirmation selector (confirmationLocator or composeModal) found for this platform in the config.`);
    }

    console.log("[WORKER-SUCCESS] Platform post confirmed successfully!");
}


// --- Worker Main Logic ---
async function processJob(job, config) {
    console.log(`[WORKER-INFO] Found job ${job.id}. Locking and processing...`);
    
    // Read the queue, find the specific job, and mark it as 'processing'
    let queue = JSON.parse(await fsPromises.readFile(QUEUE_FILE_PATH, 'utf8'));
    const jobToProcess = queue.find(j => j.id === job.id);
    if (!jobToProcess || jobToProcess.status !== 'pending') {
        console.log(`[WORKER-INFO] Job ${job.id} is no longer pending. Skipping.`);
        return; // Job was already processed by another worker or is not pending
    }
    jobToProcess.status = 'processing';
    jobToProcess.processedAt = new Date().toISOString();
    await fsPromises.writeFile(QUEUE_FILE_PATH, JSON.stringify(queue, null, 2));

    let overallSuccess = true;
    const errors = [];
    let browser = null; // Reuse a single browser for all non-Bluesky platforms

    for (const platformName of job.platforms) {
        try {
            console.log(`[WORKER-INFO] Processing platform: ${platformName} for job ${job.id}`);
            if (platformName === 'Bluesky') {
                await postToBluesky(job, config);
            } else {
                // This is a browser-based platform
                const sessionFilePath = path.join(process.cwd(), `${platformName.toLowerCase()}_session.json`);
                const platformConfig = config.socialMedia[platformName];
                if (!platformConfig || !platformConfig.selectors) {
                    throw new Error(`Configuration for platform "${platformName}" is missing or incomplete.`);
                }
                if (!config.timeouts) {
                    throw new Error(`'timeouts' configuration is missing from config.json.`);
                }
                if (!fs.existsSync(sessionFilePath)) {
                    throw new Error(`Session file for ${platformName} not found. Please log in first.`);
                }
                if (!browser) {
                    browser = await chromium.launch({ headless: false });
                }
                const context = await browser.newContext({ storageState: sessionFilePath });
                const page = await context.newPage();
                await postToPlatform(page, job, platformConfig, config.timeouts);
                await context.close();
            }
            console.log(`[WORKER-SUCCESS] Successfully posted to ${platformName}.`);
        } catch (error) {
            console.error(`[WORKER-ERROR] Failed to post to ${platformName} for job ${job.id}:`, error.message);
            overallSuccess = false;
            errors.push({ platform: platformName, error: error.message, timestamp: new Date().toISOString() });
        }
    }

    if (browser) {
        try { await browser.close(); } catch {}
    }

    // Re-read the queue, find the job, and update its final status
    queue = JSON.parse(await fsPromises.readFile(QUEUE_FILE_PATH, 'utf8'));
    let jobToUpdate = queue.find(j => j.id === job.id);
    if (jobToUpdate) {
        jobToUpdate.status = overallSuccess ? 'completed' : 'failed';
        jobToUpdate.errors = errors;
        await fsPromises.writeFile(QUEUE_FILE_PATH, JSON.stringify(queue, null, 2));
        console.log(`[WORKER-INFO] Job ${job.id} finished with status: ${jobToUpdate.status}.`);
    }

    // Post-processing (cleanup)
    if (overallSuccess && (!config.debug || !config.debug.preserveTemporaryFiles)) {
        const absoluteImagePath = path.join(process.cwd(), job.imagePath);
        try {
            await fsPromises.access(absoluteImagePath);
            const action = config.postProcessing?.actionAfterSuccess || 'delete';
            if (action === 'backup') {
                const backupDir = config.postProcessing?.backupFolderPath || './post_backups';
                await fsPromises.mkdir(backupDir, { recursive: true });
                const backupPath = path.join(backupDir, path.basename(job.imagePath));
                await fsPromises.rename(absoluteImagePath, backupPath);
                console.log(`[WORKER-INFO] Image for job ${job.id} backed up to: ${backupPath}`);
            } else if (action === 'archive') {
                await archivePostedAsset(jobToUpdate || job, absoluteImagePath, config, errors);
            } else {
                await fsPromises.unlink(absoluteImagePath);
                console.log(`[WORKER-INFO] Image for job ${job.id} deleted.`);
            }
        } catch (error) {
            if (error.code !== 'ENOENT') {
                console.warn(`[WORKER-WARN] Could not clean up file ${job.imagePath}:`, error);
            }
        }
    }
}

async function processQueue() {
    console.log('[WORKER-INFO] Worker started. Checking for pending jobs...');
    const config = await loadConfig();

    // Check for Playwright dependencies once at the start
    try {
        await chromium.launch({ headless: true });
    } catch (e) {
        if (e.message.includes('Host system is missing dependencies')) {
            console.error(`[WORKER-FATAL] Playwright dependencies are not installed. Please run 'npx playwright install-deps'`);
            process.exit(1);
        }
    }

    const exitAfterSingleJob = config.worker?.exitAfterSingleJob === true;

    if (exitAfterSingleJob) {
        console.log('[WORKER-INFO] Mode: Process a single job and exit.');
        const queue = JSON.parse(await fsPromises.readFile(QUEUE_FILE_PATH, 'utf8'));
        const job = queue.find(j => j.status === 'pending');
        if (job) {
            await processJob(job, config);
        } else {
            console.log('[WORKER-INFO] No pending jobs found.');
        }
    } else {
        console.log('[WORKER-INFO] Mode: Process all pending jobs.');
        while (true) {
            const queue = JSON.parse(await fsPromises.readFile(QUEUE_FILE_PATH, 'utf8'));
            const job = queue.find(j => j.status === 'pending');
            if (!job) {
                console.log('[WORKER-INFO] No more pending jobs found.');
                break; // Exit the loop
            }
            await processJob(job, config);
            await new Promise(resolve => setTimeout(resolve, 500)); // Small delay
        }
    }
}

// --- Entry Point ---
processQueue().then(() => {
    console.log('[WORKER-INFO] Worker has finished its tasks.');
    process.exit(0);
}).catch(error => {
    console.error('[WORKER-FATAL] An unhandled error occurred in the worker:', error);
    process.exit(1);
});
