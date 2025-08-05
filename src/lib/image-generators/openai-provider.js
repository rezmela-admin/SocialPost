import OpenAI from 'openai';
import fs from 'fs';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function debugLog(message) {
    // A simple logger. In a real app, this would be more robust.
    // We check for config existence to avoid crashing if used standalone.
    try {
        const config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
        if (config.debug && config.debug.enabled) {
            console.log(`[OPENAI-PROVIDER-DEBUG] ${message}`);
        }
    } catch (error) {
        // Ignore if config doesn't exist
    }
}

/**
 * Builds the request object for the OpenAI Images API.
 * @param {string} prompt The prompt for the image.
 * @param {string} size The size of the image (e.g., "1024x1024").
 * @param {object} options The configuration object.
 * @param {object} extraParams Additional parameters for the request.
 * @returns {object} The OpenAI API request object.
 */
function buildImageRequest(prompt, size, options, extraParams = {}) {
    const model = options.model;
    // This instruction is specific to how DALL-E interprets prompts.
    const SPEECH_BUBBLE_INSTRUCTION = ' The speech bubble must be positioned so it is fully visible and not cut off by the edges of the image.';
    
    let finalPrompt = `${prompt}, with a 5% margin of empty space around the entire image to act as a safe zone.`;
    if (prompt.includes('speech bubble')) {
        finalPrompt += SPEECH_BUBBLE_INSTRUCTION;
    }
    
    const request = {
        model,
        prompt: finalPrompt,
        n: 1,
        size,
        ...extraParams
    };

    // DALL-E models require this format to return a Base64 string.
    if (model.startsWith('dall-e')) {
        request.response_format = 'b64_json';
    }
    
    // Specific parameter for a particular model version.
    if (model === 'gpt-image-1') {
        request.moderation = 'low';
    }
    
    debugLog(`OpenAI API Request: ${JSON.stringify(request, null, 2)}`);
    return request;
}

/**
 * A wrapper for making API requests with a retry mechanism.
 * @param {Function} apiCall The async function to call.
 * @param {Function} shouldRetry A function that takes an error and returns true if the call should be retried.
 * @param {number} maxRetries The maximum number of retries.
 * @param {number} delay The base delay between retries in ms.
 * @param {string} apiName The name of the API for logging.
 * @returns {Promise<any>} The result of the API call.
 */
async function apiRequestWithRetry(apiCall, shouldRetry, maxRetries, delay, apiName) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await apiCall();
        } catch (error) {
            if (shouldRetry(error)) {
                const waitTime = delay * Math.pow(2, i);
                console.warn(`[${apiName}-PROVIDER-WARN] API error. Retrying in ${waitTime / 1000}s...`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
            } else {
                throw error;
            }
        }
    }
    throw new Error(`[${apiName}-PROVIDER-FATAL] API call failed after ${maxRetries} retries.`);
}

/**
 * Makes a request to the OpenAI API with a specific retry logic for connection errors.
 * @param {Function} apiCall The async function to call.
 * @returns {Promise<any>} The result of the API call.
 */
async function openaiRequestWithRetry(apiCall) { 
    const shouldRetry = (error) => error instanceof OpenAI.APIError && error.message.includes('Connection error');
    return apiRequestWithRetry(apiCall, shouldRetry, 3, 5000, 'OpenAI'); 
}

/**
 * Generates an image using the OpenAI DALL-E API.
 * @param {string} prompt The text prompt for the image.
 * @param {object} options The image generation options from config.json (includes model, size, etc.).
 * @returns {Promise<string>} A Promise that resolves to the Base64 encoded image string.
 */
export async function generateImage(prompt, options) {
    if (!process.env.OPENAI_API_KEY) {
        throw new Error("[OPENAI-PROVIDER-FATAL] OpenAI API key is not configured. Please check your .env file.");
    }

    const imageRequest = buildImageRequest(prompt, options.size, options);
    
    // The core API call.
    const imageResponse = await openaiRequestWithRetry(() => openai.images.generate(imageRequest));
    
    // The response for b64_json format is an object with a `data` array.
    if (imageResponse.data && imageResponse.data[0].b64_json) {
        return imageResponse.data[0].b64_json;
    } else {
        throw new Error('[OPENAI-PROVIDER-FATAL] No Base64 image data found in the OpenAI API response.');
    }
}
