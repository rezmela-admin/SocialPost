// ============================================================================
// Automated Daily Cartoon Bot - Main App v28.2 (Corrected)
// ============================================================================
import 'dotenv/config'; // Load environment variables from .env file
import { getImageGenerator } from './src/lib/image-generators/index.js';
import { mainMenu } from './src/lib/ui/menu.js';
import { menuManager } from './src/lib/ui/menu-manager.js';
import fs from 'fs';

export function loadInitialState() {
    try {
        console.log("[APP-INFO] Loading initial state from config.json...");
        const config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
        
        console.log("[APP-INFO] Loading character library...");
        config.characterLibrary = JSON.parse(fs.readFileSync('./character_library.json', 'utf8'));
        
        return config;
    } catch (error) {
        console.error("[APP-FATAL] Error loading initial state (config or character library):", error);
        process.exit(1);
    }
}

async function start() {
    const sessionState = loadInitialState();
    let imageGenerator;

    try {
        imageGenerator = await getImageGenerator(sessionState);
    } catch (error) {
        console.error("[APP-FATAL] Could not initialize the application.", error);
        process.exit(1);
    }

    await menuManager(sessionState, mainMenu(sessionState, imageGenerator));
}

start();