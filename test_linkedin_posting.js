import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import 'dotenv/config';

// --- Load Configuration ---
function loadConfig() {
    try {
        const configFile = fs.readFileSync('./config.json', 'utf8');
        return JSON.parse(configFile);
    } catch (error) {
        console.error("[FATAL] Error loading or parsing config.json:", error);
        process.exit(1);
    }
}

const config = loadConfig();
const sessionFilePath = path.join(process.cwd(), 'linkedin_session.json');
const placeholderImagePath = path.join(process.cwd(), 'placeholder.png');

// --- Main Test Function ---
async function testLinkedInPosting() {
    if (!fs.existsSync(sessionFilePath)) {
        console.error("[FATAL] linkedin_session.json not found. Please log in through the main app first.");
        return;
    }
    if (!fs.existsSync(placeholderImagePath)) {
        console.error("[FATAL] placeholder.png not found. Please create a placeholder image.");
        return;
    }

    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext({ storageState: sessionFilePath });
    const page = await context.newPage();

    try {
        console.log("[INFO] Navigating to LinkedIn feed...");
        await page.goto(config.socialMedia.LinkedIn.composeUrl);
        
        console.log("[INFO] Clicking 'Start a post' on LinkedIn...");
        await page.getByRole('button', { name: 'Start a post' }).click();
        
        console.log("[INFO] Preparing to upload placeholder image...");
        const fileChooserPromise = page.waitForEvent('filechooser');
        await page.getByRole('button', { name: 'Add media' }).click();
        const fileChooser = await fileChooserPromise;
        await fileChooser.setFiles(placeholderImagePath);
        
        console.log("[INFO] Clicking 'Next' after image upload...");
        await page.getByRole('button', { name: 'Next' }).click();

        console.log("[INFO] Writing test post text for LinkedIn...");
        const postTextBox = page.locator('div[role="textbox"]');
        await postTextBox.waitFor({ state: 'visible', timeout: 10000 });
        await postTextBox.fill("This is a test post.");

        console.log("[INFO] Ensuring 'Post' button is enabled...");
        const postButton = page.getByRole('button', { name: 'Post', exact: true });
        
        console.log("[INFO] Clicking post on LinkedIn...");
        await postButton.click();

        console.log("[INFO] Waiting for post confirmation on LinkedIn...");
        const composeModal = page.getByRole('dialog', { name: /share-to-linkedin-modal/i });
        await composeModal.waitFor({ state: 'hidden', timeout: 60000 });

        console.log("\n[SUCCESS] Test post was sent successfully to LinkedIn!");
        console.log(">>> The browser will close automatically in 3 seconds.");
        await page.waitForTimeout(3000);

    } catch (error) {
        console.error("[ERROR] An error occurred during the LinkedIn test:", error);
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

testLinkedInPosting();