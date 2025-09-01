import { GoogleGenerativeAI } from "@google/generative-ai";

let ai;

function debugLog(sessionState, message) {
    if (sessionState.debug && sessionState.debug.enabled) {
        console.log(`[GEMINI-FLASH-PROVIDER-DEBUG] ${message}`);
    }
}

export async function generateImage(prompt, sessionState) {
    if (!process.env.GEMINI_API_KEY) {
        throw new Error("[GEMINI-FLASH-PROVIDER-FATAL] Gemini API key is not configured. Please check your .env file.");
    }

    if (!ai) {
        ai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    }

    // Correctly access the model from the nested sessionState object.
    const providerConfig = sessionState.imageGeneration.providers['gemini-flash'];
    const modelName = providerConfig.model;

    if (!modelName) {
        throw new Error("[GEMINI-FLASH-PROVIDER-FATAL] Model name not found for gemini-flash provider in session state.");
    }

    debugLog(sessionState, `Gemini Flash SDK Request: Model=${modelName}, Prompt="${prompt}"`);

    try {
        const model = ai.getGenerativeModel({ model: modelName });
        const result = await model.generateContent([prompt]);
        const response = await result.response;

        if (response.candidates && response.candidates.length > 0) {
            const candidate = response.candidates[0];
            if (candidate.content && candidate.content.parts) {
                for (const part of candidate.content.parts) {
                    if (part.inlineData) {
                        return part.inlineData.data; // This is already a base64 string
                    }
                }
            }
        }
        
        throw new Error('Could not find image data in Gemini Flash response.');

    } catch (error) {
        console.error("Error making API call to Gemini Flash:", error);
        throw error;
    }
}
