// ============================================================================
// Orphaned Image Cleanup Script
// ============================================================================
// This script finds and deletes generated images that are no longer
// referenced by any job in the post_queue.json file.
// ============================================================================

import fs from 'fs';
import path from 'path';
import inquirer from 'inquirer';

const QUEUE_FILE_PATH = path.join(process.cwd(), 'post_queue.json');
const IMAGE_PREFIX = 'post-image-';
const IMAGE_EXT = '.png';

async function cleanupOrphanedImages() {
    console.log('[CLEANUP-INFO] Starting cleanup process...');

    // --- Step 1: Get all referenced image paths from the queue ---
    let referencedImagePaths;
    try {
        const queue = JSON.parse(fs.readFileSync(QUEUE_FILE_PATH, 'utf8'));
        // Use a Set for efficient lookup
        referencedImagePaths = new Set(queue.map(job => job.imagePath));
        console.log(`[CLEANUP-INFO] Found ${referencedImagePaths.size} image(s) referenced in the job queue.`);
    } catch (error) {
        console.error('[CLEANUP-FATAL] Could not read or parse queue file. Aborting.', error);
        return;
    }

    // --- Step 2: Get all generated image files from the directory ---
    let actualImageFiles;
    try {
        actualImageFiles = fs.readdirSync(process.cwd())
            .filter(file => file.startsWith(IMAGE_PREFIX) && file.endsWith(IMAGE_EXT))
            .map(file => path.join(process.cwd(), file)); // Get absolute paths
        console.log(`[CLEANUP-INFO] Found ${actualImageFiles.length} generated image file(s) in the directory.`);
    } catch (error) {
        console.error('[CLEANUP-FATAL] Could not scan the directory for images. Aborting.', error);
        return;
    }

    // --- Step 3: Find the orphans by comparing the two lists ---
    const orphanedImages = actualImageFiles.filter(imagePath => !referencedImagePaths.has(imagePath));

    if (orphanedImages.length === 0) {
        console.log('[CLEANUP-SUCCESS] No orphaned images found. Your directory is clean!');
        return;
    }

    // --- Step 4: Ask for confirmation before deleting ---
    console.log(`\n[CLEANUP-WARN] Found ${orphanedImages.length} orphaned image(s) to delete:`);
    orphanedImages.forEach(image => console.log(`  - ${path.basename(image)}`));

    const { confirmDelete } = await inquirer.prompt([
        {
            type: 'confirm',
            name: 'confirmDelete',
            message: '\nAre you sure you want to permanently delete these files?',
            default: false,
        },
    ]);

    // --- Step 5: Delete the confirmed orphans ---
    if (confirmDelete) {
        let deleteCount = 0;
        orphanedImages.forEach(imagePath => {
            try {
                fs.unlinkSync(imagePath);
                console.log(`[CLEANUP-INFO] Deleted: ${path.basename(imagePath)}`);
                deleteCount++;
            } catch (error) {
                console.error(`[CLEANUP-ERROR] Failed to delete ${path.basename(imagePath)}:`, error);
            }
        });
        console.log(`\n[CLEANUP-SUCCESS] Successfully deleted ${deleteCount} orphaned image(s).`);
    } else {
        console.log('[CLEANUP-INFO] Deletion cancelled by user.');
    }
}

// --- Entry Point ---
cleanupOrphanedImages();
