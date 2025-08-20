import fs from 'fs';
import path from 'path';

// Load configuration synchronously at module load time.
// This is generally safe for CLI applications on startup.
let config;
try {
    config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
} catch (error) {
    console.error("[IMAGE-FACTORY-FATAL] Failed to load or parse config.json. Please ensure it exists and is valid.", error);
    // If config fails to load, the application cannot proceed.
    process.exit(1);
}

/**
 * Dynamically imports and returns the image generation function from the configured provider.
 * This factory function allows the application to switch between different image generation
 * services (like OpenAI, Gemini, etc.) without changing the core application logic.
 *
 * @returns {Promise<Function>} A promise that resolves to the `generateImage` function
 * from the selected provider.
 * @throws {Error} If the configured provider is not supported or fails to load.
 */
export async function getImageGenerator() {
    const imageConfig = config.imageGeneration;
    const providerName = imageConfig.provider;

    if (!providerName || !imageConfig.providers || !imageConfig.providers[providerName]) {
        throw new Error('[IMAGE-FACTORY-FATAL] Image generation "provider" is not specified or invalid in config.json.');
    }

    const providerConfig = imageConfig.providers[providerName];
    // Combine the specific provider config with any top-level settings (like comicBorderSize)
    const finalConfig = { ...imageConfig, ...providerConfig };

    console.log(`[IMAGE-FACTORY-INFO] Loading image generation provider: ${providerName}`);

    try {
        let provider;
        switch (providerName.toLowerCase()) {
            case 'openai': {
                provider = await import('./openai-provider.js');
                break;
            }
            case 'gemini': {
                provider = await import('./gemini-provider.js');
                break;
            }
            default:
                throw new Error(`Unsupported image generation provider: "${providerName}". Please check your config.json.`);
        }

        // Return a new function that passes the final, correct configuration to the provider.
        return (prompt) => provider.generateImage(prompt, finalConfig);

    } catch (error) {
        console.error(`[IMAGE-FACTORY-FATAL] Failed to load the "${providerName}" image provider.`, error);
        // Re-throw the error to be handled by the application's main error handler.
        throw error;
    }
}