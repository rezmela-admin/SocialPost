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
const sessionFilePath = path.join(process.cwd(), 'x_session.json');
const placeholderImagePath = path.join(process.cwd(), 'placeholder.png');

// --- Main Test Function ---
async function testXPosting() {
    if (!fs.existsSync(sessionFilePath)) {
        console.error("[FATAL] x_session.json not found. Please log in through the main app first.");
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
        console.log("[INFO] Navigating to X compose page...");
        await page.goto(config.socialMedia.X.composeUrl);
        await page.waitForSelector('input[type="file"]', { state: 'attached', timeout: 60000 });
        
        console.log("[INFO] Uploading placeholder image...");
        await page.setInputFiles('input[type="file"]', placeholderImagePath);

        console.log("[INFO] Waiting for image to be processed...");
        await page.waitForSelector('[data-testid="tweetPhoto"]', { state: 'visible', timeout: 60000 });
        console.log("[SUCCESS] Image thumbnail is visible.");
        
        console.log("[INFO] Attempting to write post text...");
        await page.getByRole('textbox', { name: 'Post text' }).fill("This is a test post.");
        
        console.log("[INFO] Clicking post on X...");
        await page.locator('[data-testid="tweetButton"]').click();
    
        console.log("[INFO] Waiting for post confirmation...");
        await page.waitForSelector('[data-testid="toast"]', { state: 'visible', timeout: 60000 });

        console.log("\n[SUCCESS] Test post was sent successfully!");
        console.log(">>> The browser will close automatically in 3 seconds.");
        await page.waitForTimeout(3000);

    } catch (error) {
        console.error("[ERROR] An error occurred during the test:", error);
    } finally {
        // The browser will remain open due to page.pause(), but this is here for completeness
        if (browser) {
            await browser.close();
        }
    }
}

testXPosting();
