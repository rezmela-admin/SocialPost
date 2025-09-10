// ============================================================================
// Automated Daily Cartoon Bot - Main App v29.0
// ============================================================================
import 'dotenv/config'; // Load environment variables from .env file
import { getImageGenerator } from './src/lib/image-generators/index.js';
import { mainMenu } from './src/lib/ui/menu.js';
import { menuManager } from './src/lib/ui/menu-manager.js';
import fs from 'fs/promises';
import path from 'path';
import { pathToFileURL } from 'url';
import { checkDependencies as checkDeps } from './src/lib/utils.js';

function validateConfig(cfg) {
    const errors = [];
    const imgProv = cfg?.imageGeneration?.provider;
    const txtProv = cfg?.textGeneration?.provider;

    if (!imgProv) errors.push('imageGeneration.provider is missing');
    if (!cfg?.imageGeneration?.providers?.[imgProv]) errors.push(`imageGeneration.providers.${imgProv} is missing`);
    if (!txtProv) errors.push('textGeneration.provider is missing');
    if (!cfg?.textGeneration?.providers?.[txtProv]) errors.push(`textGeneration.providers.${txtProv} is missing`);
    if (!cfg?.timeouts) errors.push('timeouts is missing');
    if (!cfg?.search?.defaultTopic) errors.push('search.defaultTopic is missing');

    if (errors.length) {
        throw new Error('Invalid config:\n- ' + errors.join('\n- '));
    }
}

function preflightProviders(state) {
    try {
        const imgProv = (state?.imageGeneration?.provider || '').toLowerCase();
        if (imgProv === 'openai' && !process.env.OPENAI_API_KEY) {
            console.warn("[APP-WARN] Missing OPENAI_API_KEY for image provider 'openai'.");
        } else if ((imgProv === 'gemini' || imgProv === 'gemini-flash') && !process.env.GEMINI_API_KEY) {
            console.warn("[APP-WARN] Missing GEMINI_API_KEY for image provider '" + imgProv + "'.");
        }

        const txtProv = state?.textGeneration?.provider;
        const txtEnv = state?.textGeneration?.providers?.[txtProv]?.apiKeyEnv;
        if (txtEnv && !process.env[txtEnv]) {
            console.warn(`[APP-WARN] Missing ${txtEnv} for text provider '${txtProv}'.`);
        }

        // Optional: Bluesky credentials (used by worker)
        if (!process.env.BLUESKY_HANDLE || !process.env.BLUESKY_APP_PASSWORD) {
            console.warn('[APP-WARN] Bluesky credentials not set (BLUESKY_HANDLE/BLUESKY_APP_PASSWORD). Bluesky posting will be unavailable.');
        }
    } catch (e) {
        console.warn('[APP-WARN] Preflight checks encountered an issue:', e?.message || e);
    }
}

function resolveConfigPath() {
    const argv = process.argv || [];
    const envPath = process.env.CONFIG_PATH;
    let cliPath = null;
    const idxLong = argv.indexOf('--config');
    const idxShort = idxLong === -1 ? argv.indexOf('-c') : idxLong;
    if (idxShort !== -1 && argv[idxShort + 1]) cliPath = argv[idxShort + 1];
    return envPath || cliPath || path.join(process.cwd(), 'config.json');
}

export async function loadInitialState() {
    try {
        console.log("[APP-INFO] Loading initial state from config.json...");
        const configPath = resolveConfigPath();
        const charactersPath = path.join(process.cwd(), 'character_library.json');
        const config = JSON.parse(await fs.readFile(configPath, 'utf8'));

        console.log("[APP-INFO] Loading character library...");
        config.characterLibrary = JSON.parse(await fs.readFile(charactersPath, 'utf8'));

        validateConfig(config);
        return config;
    } catch (error) {
        console.error("[APP-FATAL] Error loading initial state (config or character library):", error);
        process.exit(1);
    }
}

process.on('unhandledRejection', (e) => {
    console.error('[APP-FATAL] Unhandled Promise rejection:', e);
    process.exit(1);
});
process.on('uncaughtException', (e) => {
    console.error('[APP-FATAL] Uncaught exception:', e);
    process.exit(1);
});

async function start() {
    const sessionState = await loadInitialState();
    preflightProviders(sessionState);
    // Quick dependency check (non-fatal): warn only
    await checkDeps({ quick: true, quiet: false });
    let imageGenerator;

    try {
        imageGenerator = await getImageGenerator(sessionState);
    } catch (error) {
        console.error("[APP-FATAL] Could not initialize the application.", error);
        process.exit(1);
    }

    await menuManager(sessionState, mainMenu(sessionState, imageGenerator));
}

// Only auto-start when executed directly (not when imported by tests/tools)
if (process.argv[1]) {
    try {
        if (import.meta.url === pathToFileURL(process.argv[1]).href) {
            start();
        }
    } catch (e) {
        // If comparison fails due to odd argv state, do nothing (avoid auto-start on import)
    }
}
