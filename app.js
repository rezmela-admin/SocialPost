// ============================================================================
// Automated Daily Cartoon Bot - Main App v28.2 (Corrected)
// ============================================================================
import 'dotenv/config'; // Load environment variables from .env file
import { getImageGenerator } from './src/lib/image-generators/index.js';
import { mainMenu } from './src/lib/ui/menu.js';
import fs from 'fs';

export function loadConfig() {
    try {
        console.log("[APP-INFO] Loading configuration from config.json...");
        const configFile = fs.readFileSync('./config.json', 'utf8');
        return JSON.parse(configFile);
    } catch (error) {
        console.error("[APP-FATAL] Error loading or parsing config.json:", error);
        process.exit(1);
    }
}

async function start() {
    const config = loadConfig();
    let imageGenerator;

    try {
        imageGenerator = await getImageGenerator();
    } catch (error) {
        console.error("[APP-FATAL] Could not initialize the application.", error);
        process.exit(1);
    }

    await mainMenu(config, imageGenerator);
}

start();
