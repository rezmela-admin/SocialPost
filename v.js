// v.js - A simple file versioning utility

import fs from 'fs';
import path from 'path';

const backupDir = './backups';

// --- Helper Functions ---

// Ensures the backup directory exists.
function ensureBackupDir() {
    if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir);
        console.log(`[INFO] Created backup directory: ${backupDir}`);
    }
}

// Generates a timestamp string for filenames.
function getTimestamp() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    return `${year}${month}${day}_${hours}${minutes}${seconds}`;
}

// Parses filename and extension.
function parseFilename(filePath) {
    const ext = path.extname(filePath);
    const base = path.basename(filePath, ext);
    return { base, ext };
}

// Finds the latest backup for a given file.
function findLatestBackup(targetFile) {
    const { base: targetBase, ext: targetExt } = parseFilename(targetFile);
    const backupPrefix = `${targetBase}_`;
    const backupSuffix = targetExt;

    if (!fs.existsSync(backupDir)) {
        return null;
    }

    const backups = fs.readdirSync(backupDir)
        .filter(file => file.startsWith(backupPrefix) && file.endsWith(backupSuffix))
        .sort() // Sorts alphabetically, which works for our timestamp format YYYYMMDD_HHMMSS
        .reverse();

    return backups.length > 0 ? path.join(backupDir, backups[0]) : null;
}


// --- Command Functions ---

function save(targetFile) {
    if (!fs.existsSync(targetFile)) {
        console.error(`[ERROR] File not found: ${targetFile}`);
        return;
    }
    ensureBackupDir();
    const { base, ext } = parseFilename(targetFile);
    const timestamp = getTimestamp();
    const backupFileName = `${base}_${timestamp}${ext}`;
    const backupFilePath = path.join(backupDir, backupFileName);

    fs.copyFileSync(targetFile, backupFilePath);
    console.log(`[SUCCESS] Saved version of ${targetFile} to ${backupFilePath}`);
}

function restore(targetFile) {
    const latestBackup = findLatestBackup(targetFile);

    if (!latestBackup) {
        console.error(`[ERROR] No backups found for ${targetFile}`);
        return;
    }

    fs.copyFileSync(latestBackup, targetFile);
    console.log(`[SUCCESS] Restored ${targetFile} from ${latestBackup}`);
}

function list(targetFile) {
    const { base: targetBase, ext: targetExt } = parseFilename(targetFile);
    const backupPrefix = `${targetBase}_`;
    const backupSuffix = targetExt;

    if (!fs.existsSync(backupDir)) {
        console.log(`[INFO] No backup directory found. Nothing to list.`);
        return;
    }

    const backups = fs.readdirSync(backupDir)
        .filter(file => file.startsWith(backupPrefix) && file.endsWith(backupSuffix))
        .sort();

    if (backups.length === 0) {
        console.log(`[INFO] No backups found for ${targetFile}`);
        return;
    }

    console.log(`[INFO] Available backups for ${targetFile}:`);
    backups.forEach(file => console.log(`- ${file}`));
}

function printUsage() {
    console.log(`
Simple File Versioning Utility (v.js)
-------------------------------------
Usage: node v.js [command] [filename]

Commands:
  save    <filename>  - Creates a timestamped backup of the file.
  restore <filename>  - Restores the most recent backup of the file.
  list    <filename>  - Lists all available backups for the file.

Example:
  node v.js save runAutomation.js
    `);
}

// --- Main Execution ---

const [,, command, targetFile] = process.argv;

if (!command || !targetFile) {
    printUsage();
    process.exit(1);
}

switch (command.toLowerCase()) {
    case 'save':
        save(targetFile);
        break;
    case 'restore':
        restore(targetFile);
        break;
    case 'list':
        list(targetFile);
        break;
    default:
        console.error(`[ERROR] Unknown command: ${command}`);
        printUsage();
        process.exit(1);
}
