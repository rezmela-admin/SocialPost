import fs from 'fs';
import path from 'path';
import moment from 'moment-timezone';
import { processScheduledPosts } from './runAutomation.js';

// --- Determine Platform from Command Line ---
const platformArg = process.argv[2];
if (!platformArg) {
    console.log("Usage: node test_scheduler.js <platform>");
    console.log("Example: node test_scheduler.js X");
    console.log("Example: node test_scheduler.js LinkedIn");
    process.exit(1);
}
const platform = platformArg.charAt(0).toUpperCase() + platformArg.slice(1).toLowerCase();


// --- Mock Functions ---

// This is a fake, placeholder function that we will pass to the scheduler.
// It simulates the action of posting without making any real API calls.
async function mockPostCycle(page, post, postPlatform, isImmediatePost) {
    console.log(`[TEST] Mock processing of post: "${post.topic}" for platform: ${postPlatform}`);
    // In a real test framework, we might add assertions here.
    // For now, we just log and return true to simulate success.
    return true;
}

// A mock page object to satisfy the function signature. It does nothing.
const MOCK_PAGE = {};

// --- Test Setup ---

const TEST_SCHEDULE_FILE_NAME = `schedule_${platform.toLowerCase()}.json`;
const TEST_SCHEDULE_FILE_PATH = path.join(process.cwd(), TEST_SCHEDULE_FILE_NAME);
const BACKUP_SCHEDULE_FILE_PATH = `${TEST_SCHEDULE_FILE_PATH}.bak`;

function setupTestSchedule() {
    // If a real schedule file exists, back it up.
    if (fs.existsSync(TEST_SCHEDULE_FILE_PATH)) {
        fs.renameSync(TEST_SCHEDULE_FILE_PATH, BACKUP_SCHEDULE_FILE_PATH);
        console.log(`[TEST] Backed up existing ${TEST_SCHEDULE_FILE_NAME}`);
    }

    // Create a dummy schedule file with various post times
    const now = moment();
    const scheduleContent = [
        {
            "topic": "Post from 1 hour ago (should be processed)",
            "postAt": now.clone().subtract(1, 'hours').format("YYYY-MM-DD HH:mm"),
            "status": "pending"
        },
        {
            "topic": "Post from 2 days ago (should be processed)",
            "postAt": now.clone().subtract(2, 'days').format("YYYY-MM-DD HH:mm"),
            "status": "pending"
        },
        {
            "topic": "Post for tomorrow (should be ignored)",
            "postAt": now.clone().add(1, 'days').format("YYYY-MM-DD HH:mm"),
            "status": "pending"
        },
        {
            "topic": "Already posted (should be ignored)",
            "postAt": now.clone().subtract(3, 'days').format("YYYY-MM-DD HH:mm"),
            "status": "posted"
        }
    ];

    fs.writeFileSync(TEST_SCHEDULE_FILE_PATH, JSON.stringify(scheduleContent, null, 2));
    console.log(`[TEST] Created dummy test schedule file for ${platform}.`);
}

function cleanupTestSchedule() {
    // Delete the dummy schedule file
    if (fs.existsSync(TEST_SCHEDULE_FILE_PATH)) {
        fs.unlinkSync(TEST_SCHEDULE_FILE_PATH);
    }

    // Restore the original schedule file if it was backed up
    if (fs.existsSync(BACKUP_SCHEDULE_FILE_PATH)) {
        fs.renameSync(BACKUP_SCHEDULE_FILE_PATH, TEST_SCHEDULE_FILE_PATH);
        console.log(`[TEST] Restored original ${TEST_SCHEDULE_FILE_NAME}`);
    }
}

// --- Test Runner ---

async function runSchedulerTest() {
    console.log(`\n[TEST] Starting scheduler functionality test for ${platform}...`);
    
    try {
        setupTestSchedule();

        console.log('\n[TEST] Running scheduler processor with mock function...');
        // Run the scheduler process, passing our FAKE post cycle function
        await processScheduledPosts(MOCK_PAGE, platform, mockPostCycle);
        console.log('[TEST] Scheduler processor finished.');

    } catch (error) {
        console.error('[TEST] An error occurred during the test:', error);
    } finally {
        cleanupTestSchedule();
        console.log('\n[TEST] Test finished. Check console output to verify which posts were processed.');
        console.log('[TEST] A successful test will show mock processing for the two posts scheduled in the past.');
    }
}

runSchedulerTest();