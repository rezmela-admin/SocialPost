import { GoogleGenAI } from "@google/genai";
import { debugLog as appDebugLog } from '../utils.js';

// Note: The GoogleGenAI client is now initialized inside the generateImage function.
let ai;

export async function generateImage(prompt, sessionState) {
    if (!process.env.GEMINI_API_KEY) {
        throw new Error("[GEMINI-PROVIDER-FATAL] Gemini API key is not configured. Please check your .env file or .gemini/settings.json.");
    }

    // Initialize the client here, now that we know the key is present.
    if (!ai) {
        ai = new GoogleGenAI(process.env.GEMINI_API_KEY);
    }

    const providerConfig = sessionState.imageGeneration.providers.gemini;
    const model = providerConfig.model;
    appDebugLog(sessionState, `[GEMINI-PROVIDER-DEBUG] Gemini SDK Request: Model=${model}, Prompt="${prompt}"`);

    try {
        const payload = {
            model: model,
            prompt: prompt,
            config: {
                numberOfImages: 1,
            },
        };
        
        appDebugLog(sessionState, `[GEMINI-PROVIDER-DEBUG] Payload: ${JSON.stringify(payload, null, 2)}`);

        const response = await ai.models.generateImages(payload);

        if (response.generatedImages && response.generatedImages.length > 0) {
            const imageBytes = response.generatedImages[0].image.imageBytes;
            return Buffer.from(imageBytes, 'base64').toString('base64');
        }
        
        throw new Error('Could not find image data in Gemini response.');

    } catch (error) {
        console.error("Error making API call to Gemini:", error);
        throw error;
    }
}
