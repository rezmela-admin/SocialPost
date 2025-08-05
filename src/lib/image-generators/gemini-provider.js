import { GoogleGenAI } from "@google/genai";
import fs from 'fs';

function debugLog(message) {
    try {
        const config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
        if (config.debug && config.debug.enabled) {
            console.log(`[GEMINI-PROVIDER-DEBUG] ${message}`);
        }
    } catch (error) {
        // Ignore if config doesn't exist
    }
}

export async function generateImage(prompt, options) {
    if (!process.env.GEMINI_API_KEY) {
        throw new Error("[GEMINI-PROVIDER-FATAL] Gemini API key is not configured. Please check your .env file.");
    }

    const ai = new GoogleGenAI(process.env.GEMINI_API_KEY);

    debugLog(`Gemini SDK Request: Model=${options.model}, Prompt="${prompt}"`);

    try {
        const response = await ai.models.generateImages({
            model: options.model,
            prompt: prompt,
            config: {
                numberOfImages: 1,
            },
        });

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