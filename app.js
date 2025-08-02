// ============================================================================
// Automated Daily Cartoon Bot - Main App v27.0 (Job Queue Architecture)
// ============================================================================
// This is the user-facing application. Its sole purpose is to generate
// content and add jobs to the post_queue.json file. The separate `worker.js`
// script is responsible for processing these jobs.
// ============================================================================
import { chromium } from 'playwright';
import OpenAI from 'openai';
import { GoogleGenerativeAI, GoogleGenerativeAIFetchError } from "@google/generative-ai";
import fs from 'fs';
import path from 'path';
import inquirer from 'inquirer';
import 'dotenv/config';
import { execSync, spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import sharp from 'sharp';
import { getTextGenerator } from './src/lib/text-generators/index.js';
import { displayBanner } from './src/lib/ui/banner.js';

const PROFILES_DIR = './prompt_profiles';
const QUEUE_FILE_PATH = path.join(process.cwd(), 'post_queue.json');
const SPEECH_BUBBLE_INSTRUCTION = ' The speech bubble must be positioned so it is fully visible and not cut off by the edges of the image.';

// --- Configuration and API Initialization ---
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

let config = loadConfig();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const textGenerator = getTextGenerator(config);

// --- Utility Functions ---
function debugLog(message) {
    if (config.debug && config.debug.enabled) {
        console.log(`[APP-DEBUG] ${message}`);
    }
}

async function getApprovedInput(text, inputType) {
    while (true) {
        const { action } = await inquirer.prompt([
            { type: 'list', name: 'action', message: `Generated ${inputType}:\n\n"${text}"\n\nApprove or edit?`, choices: ['Approve', 'Edit', 'Cancel'] }
        ]);

        if (action === 'Approve') return text;
        if (action === 'Cancel') return null;
        if (action === 'Edit') {
            try {
                const { editedText } = await inquirer.prompt([
                    {
                        type: 'editor',
                        name: 'editedText',
                        message: `Editing ${inputType}. Save and close your editor to continue.`,
                        default: text,
                        waitForUserInput: true,
                    }
                ]);
                
                if (editedText.trim()) {
                    return editedText.trim();
                }
                
                console.warn(`[APP-WARN] Edited ${inputType} is empty. Please try again.`);

            } catch (error) {
                console.error(`[APP-ERROR] Failed to open or handle the editor:`, error);
            }
        }
    }
}

async function promptForSpeechBubble(initialPrompt, dialogue, isVirtualInfluencer) {
    // This function remains for interactive speech bubble creation
    const { addSpeechBubble } = await inquirer.prompt([{ type: 'confirm', name: 'addSpeechBubble', message: 'Add a speech bubble?', default: isVirtualInfluencer }]);
    if (!addSpeechBubble) return initialPrompt;
    
    const { speechBubbleText } = await inquirer.prompt([{ type: 'editor', name: 'speechBubbleText', message: 'Enter speech bubble text:', default: dialogue }]);
    
    if (isVirtualInfluencer) {
        return `${initialPrompt} The character has a speech bubble that clearly says: "${speechBubbleText}".`;
    } else {
        return `${initialPrompt}, with a speech bubble that clearly says: "${speechBubbleText}".`;
    }
}

// --- Resilient API Callers ---
async function apiRequestWithRetry(apiCall, shouldRetry, maxRetries, delay, apiName) {
    for (let i = 0; i < maxRetries; i++) {
        try { return await apiCall(); }
        catch (error) {
            if (shouldRetry(error)) {
                const waitTime = delay * Math.pow(2, i);
                console.warn(`[APP-WARN] ${apiName} API error. Retrying in ${waitTime / 1000}s...`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
            } else { throw error; }
        }
    }
    throw new Error(`[APP-FATAL] ${apiName} API call failed after ${maxRetries} retries.`);
}
async function openaiRequestWithRetry(apiCall) { 
    const shouldRetry = (error) => error instanceof OpenAI.APIError && error.message.includes('Connection error');
    return apiRequestWithRetry(apiCall, shouldRetry, 3, 5000, 'OpenAI'); 
}
async function geminiRequestWithRetry(apiCall) { return apiRequestWithRetry(apiCall, (e) => e instanceof GoogleGenerativeAIFetchError, 4, 10000, 'Gemini'); }

// --- Image Request Builder ---
function buildImageRequest(prompt, size, extraParams = {}) {
    const model = config.imageGeneration.model;
    let finalPrompt = `${prompt}, with a 5% margin of empty space around the entire image to act as a safe zone.`;
    if (prompt.includes('speech bubble')) finalPrompt += SPEECH_BUBBLE_INSTRUCTION;
    
    const request = { model, prompt: finalPrompt, n: 1, size, ...extraParams };
    if (model.startsWith('dall-e')) request.response_format = 'b64_json';
    if (model === 'gpt-image-1') request.moderation = 'low';
    
    debugLog(`OpenAI API Request: ${JSON.stringify(request, null, 2)}`);
    return request;
}

// --- [RESTORATION] Two-Phase Virtual Influencer Post Generation ---
async function generateVirtualInfluencerPost(postDetails, skipSummarization = false) {
    const originalPromptConfig = { ...config.prompt };
    if (!process.env.OPENAI_API_KEY) {
        console.error("[APP-FATAL] OpenAI API key is not configured. Please check your .env file.");
        return { success: false };
    }

    try {
        console.log(`\n[APP-INFO] Starting Two-Phase Virtual Influencer post for topic: "${postDetails.topic}"`);
        const safetySettings = [ { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' }, { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' }, { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' }, { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }];
        const activeProfileName = config.prompt.profilePath ? path.basename(config.prompt.profilePath) : 'virtual_influencer';

        // 1. Get Prompts from AI
        let summary, dialogue, backgroundPrompt;
        let parsedResult = {};

        if (!skipSummarization) {
            const taskPrompt = config.prompt.task.replace('{TOPIC}', postDetails.topic);
            const geminiRawOutput = await geminiRequestWithRetry(() => textGenerator.generate(taskPrompt, safetySettings));
            try {
                const jsonString = geminiRawOutput.substring(geminiRawOutput.indexOf('{'), geminiRawOutput.lastIndexOf('}') + 1).replace(/,\s*([}\]])/g, '$1');
                parsedResult = JSON.parse(jsonString);
                ({ summary, dialogue, backgroundPrompt } = parsedResult);
            } catch (e) {
                console.error("[APP-ERROR] Failed to parse JSON from Gemini response. Raw output:", geminiRawOutput);
                return { success: false };
            }
        } else {
            summary = postDetails.topic;
            // In skip mode, we still need dialogue and background
            const { approvedDialogue } = await inquirer.prompt([{ type: 'editor', name: 'approvedDialogue', message: 'Enter the dialogue for the speech bubble:' }]);
            const { approvedBackground } = await inquirer.prompt([{ type: 'editor', name: 'approvedBackground', message: 'Enter the prompt for the background image:' }]);
            dialogue = approvedDialogue;
            backgroundPrompt = approvedBackground;
        }

        // 2. User Approval
        const approvedSummary = await getApprovedInput(summary, 'summary');
        if (!approvedSummary) { console.log('[APP-INFO] Job creation cancelled.'); return { success: false, wasCancelled: true }; }
        summary = approvedSummary;

        const approvedDialogue = await getApprovedInput(dialogue, 'dialogue');
        if (!approvedDialogue) { console.log('[APP-INFO] Job creation cancelled.'); return { success: false, wasCancelled: true }; }
        dialogue = approvedDialogue;
        
        const approvedBackgroundPrompt = await getApprovedInput(backgroundPrompt, 'background prompt');
        if (!approvedBackgroundPrompt) { console.log('[APP-INFO] Job creation cancelled.'); return { success: false, wasCancelled: true }; }
        backgroundPrompt = approvedBackgroundPrompt;

        // --- [NEW] Framing Selection ---
        let framingChoice = '';
        const customOption = 'Custom...';
        const backOption = 'Back to Main Menu';
        const framingChoices = [...(config.framingOptions || []), new inquirer.Separator(), customOption, backOption];

        const { selectedFraming } = await inquirer.prompt([
            {
                type: 'list',
                name: 'selectedFraming',
                message: 'Choose the framing for the virtual influencer:',
                choices: framingChoices,
            },
        ]);

        if (selectedFraming === backOption) {
            console.log('[APP-INFO] Returning to main menu.');
            return { success: false, wasCancelled: true };
        } else if (selectedFraming === customOption) {
            const { customFraming } = await inquirer.prompt([
                {
                    type: 'editor',
                    name: 'customFraming',
                    message: 'Enter custom framing instructions. Save and close to continue.',
                    validate: input => !!input || 'Framing instructions cannot be empty.',
                },
            ]);
            framingChoice = customFraming;
        } else {
            framingChoice = selectedFraming;
        }

        // 3. Phase 1: Generate Character with Transparency
        console.log('[APP-INFO] Phase 1: Generating character on a neutral background for inpainting...');
        const characterPrompt = `${config.prompt.style} ${config.prompt.characterDescription.replace(/{TOPIC}/g, postDetails.topic)}. ${framingChoice} ...with a speech bubble. It is critical that the text inside the speech bubble is rendered perfectly without any spelling errors and says exactly: "${dialogue}". The background should be a solid, neutral light grey.`;
        const tempCharacterImageName = `temp_character_${Date.now()}.png`;
        const tempCharacterPath = path.join(process.cwd(), tempCharacterImageName);

        const charImageRequest = buildImageRequest(characterPrompt, config.imageGeneration.size);
        const charImageResponse = await openaiRequestWithRetry(() => openai.images.generate(charImageRequest));
        fs.writeFileSync(tempCharacterPath, Buffer.from(charImageResponse.data[0].b64_json, 'base64'));
        console.log(`[APP-SUCCESS] Phase 1 complete. Character on neutral background saved to: ${tempCharacterPath}`);

        // 4. Phase 2: Inpaint Background using Python Script
        console.log('[APP-INFO] Phase 2: Calling Python script to inpaint the background...');
        const finalImageName = `post-image-${Date.now()}.png`;
        const finalImagePath = path.join(process.cwd(), finalImageName);
        const editPrompt = `Take the person from the foreground of the provided image and place them seamlessly into a new background. The person, their clothing, and their speech bubble must not be changed. The new background is: ${backgroundPrompt}`;

        try {
            execSync(`python edit_image.py "${tempCharacterPath}" "${finalImagePath}" "${editPrompt}"`, { stdio: 'inherit' });
            console.log(`[APP-SUCCESS] Phase 2 complete. Final image saved to: ${finalImagePath}`);
        } catch (error) {
            console.error("[APP-FATAL] The Python inpainting script failed.", error);
            // fs.unlinkSync(tempCharacterPath); // Clean up temp file on failure
            return { success: false };
        }

        // 5. Cleanup
        fs.unlinkSync(tempCharacterPath);
        console.log(`[APP-INFO] Cleaned up temporary character file.`);

        // 6. Job Queueing
        const newJob = {
            id: uuidv4(),
            status: 'pending',
            createdAt: new Date().toISOString(),
            topic: postDetails.topic,
            summary: summary,
            imagePath: finalImagePath,
            platforms: postDetails.platforms,
            profile: activeProfileName,
        };

        const queue = JSON.parse(fs.readFileSync(QUEUE_FILE_PATH, 'utf8'));
        queue.push(newJob);
        fs.writeFileSync(QUEUE_FILE_PATH, JSON.stringify(queue, null, 2));
        console.log(`[APP-SUCCESS] New Virtual Influencer job ${newJob.id} added to the queue.`);
        return { success: true };

    } catch (error) {
        console.error("[APP-FATAL] An error occurred during Virtual Influencer content generation:", error);
        return { success: false };
    } finally {
        config.prompt = originalPromptConfig;
    }
}


// --- [NEW] Resilient Image Generation with Retries ---
async function generateImageWithRetry(initialPrompt, size, maxRetries = 3) {
    let lastError = null;
    for (let i = 0; i < maxRetries; i++) {
        try {
            let currentPrompt = initialPrompt;
            if (i > 0) {
                console.log(`[APP-INFO] Attempt ${i + 1} of ${maxRetries}. Regenerating prompt after safety rejection...`);
                const regenPrompt = `The previous cartoon prompt was rejected by the image generation safety system. Please generate a new, alternative prompt for a political cartoon about the same topic that is less likely to be rejected. The original prompt was: "${initialPrompt}"`;
                currentPrompt = await geminiRequestWithRetry(() => textGenerator.generate(regenPrompt));
                console.log(`[APP-INFO] New prompt: "${currentPrompt}"`);
            }
            
            const imageRequest = buildImageRequest(currentPrompt, size);
            const imageResponse = await openaiRequestWithRetry(() => openai.images.generate(imageRequest));
            
            // If successful, return the result
            return imageResponse;

        } catch (error) {
            lastError = error;
            // Specifically check for the safety system error
            if (error.status === 400 && error.error?.message?.includes('safety system')) {
                console.warn(`[APP-WARN] Image generation failed due to safety system. Retrying... (${i + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds before retrying
            } else {
                // For other errors, throw immediately
                throw error;
            }
        }
    }
    // If all retries fail, throw the last error
    console.error(`[APP-FATAL] Image generation failed after ${maxRetries} attempts.`);
    throw lastError;
}


// --- Core Content Generation Function ---
async function generateAndQueuePost(postDetails, skipSummarization = false) {
    const originalPromptConfig = { ...config.prompt };
    if (!process.env.OPENAI_API_KEY) {
        console.error("[APP-FATAL] OpenAI API key is not configured. Please check your .env file.");
        return { success: false };
    }

    try {
        console.log(`\n[APP-INFO] Generating content for topic: "${postDetails.topic}"`);
        
        const safetySettings = [ { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' }, { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' }, { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' }, { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }];
        const activeProfileName = config.prompt.profilePath ? path.basename(config.prompt.profilePath) : null;

        let summary;
        let finalImagePrompt;
        let parsedResult = {};

        if (!skipSummarization) {
            // --- AI Content Generation ---
            const taskPrompt = config.prompt.task.replace('{TOPIC}', postDetails.topic);
            const geminiRawOutput = await geminiRequestWithRetry(() => textGenerator.generate(taskPrompt, safetySettings));
            if (geminiRawOutput) {
                try {
                    const jsonString = geminiRawOutput.substring(geminiRawOutput.indexOf('{'), geminiRawOutput.lastIndexOf('}') + 1).replace(/,\s*([}\]])/g, '$1');
                    parsedResult = JSON.parse(jsonString);
                } catch (e) {
                    console.error("[APP-ERROR] Failed to parse JSON from Gemini response. Raw output:", geminiRawOutput);
                    // Provide a fallback structure to prevent downstream crashes
                    parsedResult = { summary: 'Error: Could not parse AI response', imagePrompt: 'A confused robot looking at a computer screen with an error message.' };
                }
            }
        }

        // --- Summary Handling ---
        summary = parsedResult.summary || postDetails.topic;
        if (!postDetails.isBatch && !skipSummarization) {
            const approvedSummary = await getApprovedInput(summary, 'summary');
            if (!approvedSummary) {
                console.log('[APP-INFO] Job creation cancelled.');
                return { success: false, wasCancelled: true };
            }
            summary = approvedSummary;
            // If the user edits the summary, we need to re-parse it for the image prompt
            parsedResult.summary = approvedSummary;
        }

        // --- Image Prompt Construction ---
        // [FIX] Determine the effective workflow. If the profile specifies a workflow, use it.
        // Otherwise, default to 'standard'. This prevents the hardcoded 'multiCharacterScene'
        // from causing issues when a simpler profile is active.
        const effectiveWorkflow = config.prompt.workflow || 'standard';

        if (effectiveWorkflow === 'multiCharacterScene') {
            // New multi-character logic
            const characterLibrary = JSON.parse(fs.readFileSync('./character_library.json', 'utf8'));
            const characterKeys = Object.keys(characterLibrary).map(k => `"${k}"`).join(', ');
            
            // Inject character keys into the task prompt
            config.prompt.task = config.prompt.task.replace('{CHARACTER_KEYS}', characterKeys);
            
            const { sceneDescription, characters } = parsedResult;

            if (!sceneDescription || !Array.isArray(characters) || characters.length === 0) {
                 console.warn('[APP-WARN] "multiCharacterScene" workflow was active, but the AI response was missing "sceneDescription" or "characters". Falling back to standard prompt generation.');
                 const { imagePrompt, dialogue } = parsedResult;
                 finalImagePrompt = `${config.prompt.style} ${imagePrompt || summary}`;
                 if (dialogue) {
                    finalImagePrompt += `, with a speech bubble that clearly says: "${dialogue}"`;
                 }
            } else {
                let characterPrompts = characters.map(charAction => {
                    const characterData = characterLibrary[charAction.character];
                    // [FIX] If character is not in the library, trust the AI and use the name directly.
                    const description = characterData ? characterData.description : `A depiction of ${charAction.character}`;
                    return `${description} says, "${charAction.dialogue}".`;
                }).filter(p => p).join(' ');

                finalImagePrompt = `${config.prompt.style} ${sceneDescription}. ${characterPrompts}`;
            }
        } else {
            // Original single-character / standard logic
            const { imagePrompt, dialogue } = parsedResult;
            finalImagePrompt = `${config.prompt.style} ${imagePrompt || summary}`; // Fallback to summary for image prompt

            if (!postDetails.isBatch && dialogue) {
                finalImagePrompt = await promptForSpeechBubble(finalImagePrompt, dialogue || '', false);
            } else if (dialogue && dialogue.trim() !== '') {
                console.log(`[APP-INFO] Auto-adding speech bubble with dialogue: "${dialogue}"`);
                finalImagePrompt += `, with a speech bubble that clearly says: "${dialogue}"`;
            }
        }

        // --- Final Approval and Image Generation ---
        if (!postDetails.isBatch) {
            const approvedPrompt = await getApprovedInput(finalImagePrompt, 'image prompt');
            if (!approvedPrompt) {
                console.log('[APP-INFO] Job creation cancelled.');
                return { success: false, wasCancelled: true };
            }
            finalImagePrompt = approvedPrompt;
        }

        console.log(`[APP-INFO] Sending final prompt to image generator... This may take a moment.`);
        debugLog(`Final Image Prompt: ${finalImagePrompt}`);
        
        const uniqueImageName = `post-image-${Date.now()}.png`;
        const imagePath = path.join(process.cwd(), uniqueImageName);
        
        // Use the new resilient function
        const imageResponse = await generateImageWithRetry(finalImagePrompt, config.imageGeneration.size);
        
        console.log(`[APP-DEBUG] Received response from image generator.`);
        fs.writeFileSync(imagePath, Buffer.from(imageResponse.data[0].b64_json, 'base64'));
        console.log(`[APP-SUCCESS] Image created and saved to: ${imagePath}`);

        // --- Job Queueing ---
        const newJob = {
            id: uuidv4(),
            status: 'pending',
            createdAt: new Date().toISOString(),
            topic: postDetails.topic,
            summary: summary,
            imagePath: imagePath,
            platforms: postDetails.platforms,
            profile: activeProfileName || 'default',
        };

        const queue = JSON.parse(fs.readFileSync(QUEUE_FILE_PATH, 'utf8'));
        queue.push(newJob);
        fs.writeFileSync(QUEUE_FILE_PATH, JSON.stringify(queue, null, 2));
        console.log(`[APP-SUCCESS] New job ${newJob.id} added to the queue for platforms: ${postDetails.platforms.join(', ')}.`);
        return { success: true };

    } catch (error) {
        console.error("[APP-FATAL] An error occurred during content generation:", error);
        return { success: false };
    } finally {
        config.prompt = originalPromptConfig;
    }
}

// --- [NEW] Comic Strip Generation Function ---
async function generateAndQueueComicStrip(postDetails) {
    // [FIX] To bypass any caching, read the profile directly from the path in the main config.
    const activeProfilePath = config.prompt.profilePath;
    if (!activeProfilePath || !fs.existsSync(activeProfilePath)) {
        console.error("[APP-FATAL] The active profile path is not set or the file does not exist. Please load a profile.");
        return { success: false };
    }
    const activeProfile = JSON.parse(fs.readFileSync(activeProfilePath, 'utf8'));

    const originalPromptConfig = { ...config.prompt };
    if (!process.env.OPENAI_API_KEY) {
        console.error("[APP-FATAL] OpenAI API key is not configured. Please check your .env file.");
        return { success: false };
    }

    try {
        console.log(`\n[APP-INFO] Generating 4-panel comic strip for topic: "${postDetails.topic}"`);
        
        // [REFACTOR] Load the global character library as the single source of truth.
        const characterLibrary = JSON.parse(fs.readFileSync('./character_library.json', 'utf8'));
        const hasCharacterLibrary = !!(characterLibrary && Object.keys(characterLibrary).length > 0);

        // 1. Get the story from Gemini
        const safetySettings = [ { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' }, { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' }, { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' }, { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }];
        
        let taskPrompt = activeProfile.task.replace('{TOPIC}', postDetails.topic);
        if (hasCharacterLibrary) {
            // [REFACTOR] Inject keys from the global library.
            const characterKeys = Object.keys(characterLibrary).map(key => `"${key}"`).join(', ');
            taskPrompt = taskPrompt.replace('{CHARACTER_KEYS}', characterKeys);
        }


        let parsedResult;
        try {
            console.log(`[APP-INFO] Attempting to generate valid comic panels...`);
            debugLog(`Gemini Comic Strip Prompt:\n${taskPrompt}`);
            const geminiRawOutput = await geminiRequestWithRetry(() => textGenerator.generate(taskPrompt, safetySettings));
            const jsonString = geminiRawOutput.substring(geminiRawOutput.indexOf('{'), geminiRawOutput.lastIndexOf('}') + 1).replace(/,\s*([}\]])/g, '$1');
            parsedResult = JSON.parse(jsonString);
            console.log('[APP-SUCCESS] Successfully generated comic panels from AI.');
        } catch (e) {
            console.error(`[APP-FATAL] Failed to get a valid comic strip from the AI. Aborting.`, e);
            return { success: false };
        }

        let { summary, panels } = parsedResult;

        // 2. Get user approval for the summary
        const approvedSummary = await getApprovedInput(summary, 'comic strip summary');
        if (!approvedSummary) {
            console.log('[APP-INFO] Job creation cancelled.');
            return { success: false, wasCancelled: true };
        }
        summary = approvedSummary;

        // 3. Generate each panel image
        const panelImagePaths = [];
        for (let i = 0; i < panels.length; i++) {
            console.log(`[APP-INFO] Generating panel ${i + 1} of 4...`);
            const panel = panels[i];
            let panelPrompt;

            // [FIX] Trust the AI's panel_description. It should be self-contained.
            // We no longer validate against the character library, allowing for well-known figures.
            panelPrompt = `${activeProfile.style} ${panel.panel_description || panel.description}`;
            
            if (panel.dialogue && panel.dialogue.trim() !== '') {
                panelPrompt += ` A speech bubble clearly says: "${panel.dialogue}".`;
            }

            const imageRequest = buildImageRequest(panelPrompt, config.imageGeneration.size);
            const imageResponse = await openaiRequestWithRetry(() => openai.images.generate(imageRequest));
            const tempImagePath = path.join(process.cwd(), `temp_panel_${i}.png`);
            fs.writeFileSync(tempImagePath, Buffer.from(imageResponse.data[0].b64_json, 'base64'));
            panelImagePaths.push(tempImagePath);
            console.log(`[APP-SUCCESS] Panel ${i + 1} created: ${tempImagePath}`);
        }

        // 4. Stitch images together into a 2x2 grid
        console.log('[APP-INFO] All panels generated. Composing final comic strip...');
        const finalImagePath = path.join(process.cwd(), `comic-strip-${Date.now()}.png`);
        const [width, height] = config.imageGeneration.size.split('x').map(Number);

        await sharp({
            create: {
                width: width * 2,
                height: height * 2,
                channels: 4,
                background: { r: 255, g: 255, b: 255, alpha: 1 }
            }
        })
        .composite(
            [
                { input: panelImagePaths[0], top: 0, left: 0 },
                { input: panelImagePaths[1], top: 0, left: width },
                { input: panelImagePaths[2], top: height, left: 0 },
                { input: panelImagePaths[3], top: height, left: width }
            ]
        )
        .png()
        .toFile(finalImagePath);

        console.log(`[APP-SUCCESS] Final comic strip saved to: ${finalImagePath}`);

        // 5. Clean up temporary panel images
        for (const p of panelImagePaths) {
            fs.unlinkSync(p);
        }
        console.log('[APP-INFO] Cleaned up temporary panel images.');

        // 6. Queue the final job
        const newJob = {
            id: uuidv4(),
            status: 'pending',
            createdAt: new Date().toISOString(),
            topic: postDetails.topic,
            summary: summary,
            imagePath: finalImagePath,
            platforms: postDetails.platforms,
            profile: path.basename(config.prompt.profilePath || 'default'),
        };

        const queue = JSON.parse(fs.readFileSync(QUEUE_FILE_PATH, 'utf8'));
        queue.push(newJob);
        fs.writeFileSync(QUEUE_FILE_PATH, JSON.stringify(queue, null, 2));
        console.log(`[APP-SUCCESS] New comic strip job ${newJob.id} added to the queue.`);
        return { success: true };

    } catch (error) {
        console.error("[APP-FATAL] An error occurred during comic strip generation:", error);
        return { success: false };
    } finally {
        config.prompt = originalPromptConfig;
    }
}

// --- Creative Profile Management ---

async function manageCreativeProfiles() {
    const activeProfile = config.prompt.profilePath ? path.basename(config.prompt.profilePath) : 'Default';
    const { action } = await inquirer.prompt([
        {
            type: 'list',
            name: 'action',
            message: `Creative Profiles Menu (Current: ${activeProfile})`,
            choices: [
                'Load a Profile (Switch to a different character/style)',
                'Create a New Profile (Build a new character/style)',
                'Delete a Profile',
                new inquirer.Separator(),
                'Back to Main Menu',
            ],
        },
    ]);

    switch (action) {
        case 'Load a Profile (Switch to a different character/style)':
            await loadProfile();
            break;
        case 'Create a New Profile (Build a new character/style)':
            await createNewProfile();
            break;
        case 'Delete a Profile':
            await deleteProfile();
            break;
        case 'Back to Main Menu':
        default:
            return;
    }
}

async function loadProfile() {
    const profiles = fs.readdirSync(PROFILES_DIR).filter(file => file.endsWith('.json'));
    if (profiles.length === 0) {
        console.log("[APP-INFO] No creative profiles found.");
        return;
    }

    const { profileToLoad } = await inquirer.prompt([
        {
            type: 'list',
            name: 'profileToLoad',
            message: 'Which profile would you like to load?',
            choices: [...profiles, new inquirer.Separator(), 'Cancel'],
        },
    ]);

    if (profileToLoad === 'Cancel') {
        console.log("[APP-INFO] Operation cancelled.");
        return;
    }

    try {
        const profilePath = path.join(PROFILES_DIR, profileToLoad);
        const profileContent = JSON.parse(fs.readFileSync(profilePath, 'utf8'));

        // Overwrite the prompt section of the IN-MEMORY config
        config.prompt = profileContent;

        // Explicitly set the workflow based on the profile.
        if (!config.prompt.workflow) {
            config.prompt.workflow = 'standard';
        }

        // Store the path to the loaded profile file for state tracking
        config.prompt.profilePath = profilePath;

        console.log(`[APP-SUCCESS] Profile "${profileToLoad}" loaded for the current session.`);
        // No file is written, the change is only for this session.

    } catch (error) {
        console.error(`[APP-ERROR] Failed to load profile "${profileToLoad}":`, error);
    }
}

async function createNewProfile() {
    console.log("\n--- Create New Profile ---");

    const { filename } = await inquirer.prompt([
        { type: 'input', name: 'filename', message: 'Enter a filename for the new profile (e.g., "my_style"):', validate: input => !!input },
    ]);
    
    const { newStyle } = await inquirer.prompt([
        { type: 'input', name: 'newStyle', message: 'Enter the new image style:', default: "A fun, witty, satirical cartoon." },
    ]);

    const profileTypes = {
        "Standard Cartoon": { task: "Based on the news about '{TOPIC}', you must respond with ONLY a single, raw JSON object..." },
        "Virtual Influencer": { task: "Based on the news about '{TOPIC}', you must respond with ONLY a single, raw JSON object..." },
    };

    const { profileType } = await inquirer.prompt([{ type: 'list', name: 'profileType', message: 'Choose the profile type:', choices: Object.keys(profileTypes) }]);

    const newProfile = { style: newStyle, task: profileTypes[profileType].task };

    if (profileType === "Virtual Influencer") {
        const { characterDescription } = await inquirer.prompt([{ type: 'input', name: 'characterDescription', message: 'Enter a detailed description of your virtual influencer:', validate: input => !!input }]);
        newProfile.characterDescription = characterDescription;
    }

    const profilePath = path.join(PROFILES_DIR, `${filename}.json`);
    try {
        fs.writeFileSync(profilePath, JSON.stringify(newProfile, null, 2));
        console.log(`[APP-SUCCESS] New profile saved to "${profilePath}"`);
    } catch (e) {
        console.error(`[APP-ERROR] Failed to save profile: "${profilePath}". Error:`, e);
        return;
    }

    const { loadNow } = await inquirer.prompt([{ type: 'confirm', name: 'loadNow', message: 'Load this new profile now?', default: true }]);
    if (loadNow) {
        // Store the path to the new profile file for state tracking
        newProfile.profilePath = profilePath;
        config.prompt = newProfile;
        try {
            fs.writeFileSync('./config.json', JSON.stringify(config, null, 2));
            console.log(`[APP-SUCCESS] Profile "${filename}.json" is now the active configuration.`);
        } catch (e) {
            console.error(`[APP-ERROR] Failed to save active profile to config.json. Error:`, e);
        }
    }
}

async function deleteProfile() {
    const profiles = fs.readdirSync(PROFILES_DIR).filter(file => file.endsWith('.json'));
    if (profiles.length === 0) {
        console.log("[APP-INFO] No creative profiles found to delete.");
        return;
    }

    const { profileToDelete } = await inquirer.prompt([{ type: 'list', name: 'profileToDelete', message: 'Which profile would you like to delete?', choices: [...profiles, new inquirer.Separator(), 'Cancel'] }]);
    
    if (profileToDelete === 'Cancel') {
        console.log("[APP-INFO] Operation cancelled.");
        return;
    }

    const { confirmDelete } = await inquirer.prompt([{ type: 'confirm', name: 'confirmDelete', message: `Are you sure you want to permanently delete "${profileToDelete}"?`, default: false }]);

    if (confirmDelete) {
        try {
            fs.unlinkSync(path.join(PROFILES_DIR, profileToDelete));
            console.log(`[APP-SUCCESS] Profile "${profileToDelete}" has been deleted.`);
        } catch (e) {
            console.error(`[APP-ERROR] Failed to delete profile: "${profileToDelete}". Error:`, e);
        }
    }
}

// --- [NEW] AI-Powered Batch Generation ---
async function runAIBatchGeneration() {
    console.log("\n--- AI-Powered Batch Post Generation ---");

    const { theme } = await inquirer.prompt([
        { type: 'input', name: 'theme', message: 'Enter a high-level theme for the batch:', default: 'US political news this week' }
    ]);

    const { count } = await inquirer.prompt([
        { type: 'number', name: 'count', message: 'How many posts should the AI generate?', default: 3 }
    ]);

    const { platforms } = await inquirer.prompt([
        { type: 'checkbox', name: 'platforms', message: 'Queue the entire batch for which platforms?', choices: ['X', 'LinkedIn'], validate: i => i.length > 0 }
    ]);

    const { confirmBatch } = await inquirer.prompt([
        { 
            type: 'confirm', 
            name: 'confirmBatch', 
            message: `Proceed with generating ${count} posts on the theme "${theme}" for ${platforms.join(', ')}?`,
            default: true 
        }
    ]);

    if (!confirmBatch) {
        console.log('[APP-INFO] Batch generation cancelled.');
        return;
    }

    console.log(`[APP-INFO] Asking the AI to generate ${count} distinct topics based on the theme: "${theme}"...`);

    // --- AI Content Planner Prompt ---
    const plannerPrompt = `You are a content planner for a political cartoon series. Based on the theme "${theme}", generate a list of ${count} distinct and specific topics suitable for individual cartoons. Please respond with ONLY a single, raw JSON object. The object must have a single key "topics" which is an array of strings. Do not include markdown ticks or any other explanatory text.`;

    let topics = [];
    try {
        const geminiRawOutput = await geminiRequestWithRetry(() => textGenerator.generate(plannerPrompt));
        const jsonString = geminiRawOutput.substring(geminiRawOutput.indexOf('{'), geminiRawOutput.lastIndexOf('}') + 1);
        const parsedResult = JSON.parse(jsonString);
        topics = parsedResult.topics;
    } catch (e) {
        console.error("[APP-ERROR] The AI content planner returned invalid JSON. Raw output:", e);
    }

    if (!topics || topics.length === 0) {
        console.error("[APP-ERROR] The AI content planner did not return any topics. Aborting batch generation.");
        return;
    }

    console.log(`[APP-SUCCESS] AI generated ${topics.length} topics. Starting content generation for each...`);

    // --- Non-interactive Generation Loop ---
    for (const topic of topics) {
        console.log(`\n--- Generating content for topic: "${topic}" ---`);
        // We reuse the core content generation logic, but in a non-interactive way.
        // We pass a simplified post object and set isImmediatePost to false.
        const postDetails = {
            topic: topic,
            platforms: platforms,
        };
        
        // This is a simplified, non-interactive version of the single post generation logic
        // It skips all the `inquirer` prompts.
        const contentResult = await generateAndQueuePost({ ...postDetails, isBatch: true });

        if (contentResult && contentResult.success) {
            console.log(`[APP-SUCCESS] Successfully generated and queued post for topic: "${topic}"`);
        } else {
            console.error(`[APP-ERROR] Failed to generate content for topic: "${topic}". Skipping.`);
        }
    }

    console.log("\n[APP-SUCCESS] AI batch generation complete.");
}

// --- [NEW] Create Post from Local Media ---
async function createPostFromLocalMedia() {
    console.log("\n--- Create New Post from Local Media File ---");

    const answers = await inquirer.prompt([
        {
            type: 'input',
            name: 'imagePath',
            message: 'Enter the full, absolute path to your local image or video file:',
            validate: (input) => {
                if (!path.isAbsolute(input)) {
                    return 'Please provide an absolute path.';
                }
                if (!fs.existsSync(input)) {
                    return 'File not found at the specified path. Please check the path and try again.';
                }
                return true;
            }
        },
        {
            type: 'editor',
            name: 'summary',
            message: 'Enter the post summary/text:',
            validate: (input) => input.trim().length > 0 || 'Summary cannot be empty.'
        },
        {
            type: 'checkbox',
            name: 'platforms',
            message: 'Queue for which platforms?',
            choices: ['X', 'LinkedIn'],
            validate: (input) => input.length > 0 || 'Please select at least one platform.'
        },
        {
            type: 'confirm',
            name: 'confirm',
            message: (answers) => `Queue post with media "${path.basename(answers.imagePath)}" for ${answers.platforms.join(', ')}?`,
            default: true,
        }
    ]);

    if (!answers.confirm) {
        console.log('[APP-INFO] Post creation cancelled.');
        return;
    }

    try {
        const newJob = {
            id: uuidv4(),
            status: 'pending',
            createdAt: new Date().toISOString(),
            topic: 'Post from local media', // Use a generic topic
            summary: answers.summary,
            imagePath: answers.imagePath, // The user-provided absolute path
            platforms: answers.platforms,
            profile: 'local_media', // A special profile name for these types of posts
        };

        const queue = JSON.parse(fs.readFileSync(QUEUE_FILE_PATH, 'utf8'));
        queue.push(newJob);
        fs.writeFileSync(QUEUE_FILE_PATH, JSON.stringify(queue, null, 2));
        console.log(`[APP-SUCCESS] New job ${newJob.id} added to the queue for platforms: ${answers.platforms.join(', ')}.`);

    } catch (error) {
        console.error("[APP-FATAL] An error occurred while queueing the local media post:", error);
    }
}


// --- Initial Login Setup ---

async function initialLogin() {
    console.log('[APP-INFO] Starting initial login setup...');
    const { platforms } = await inquirer.prompt([{        type: 'checkbox',
        name: 'platforms',
        message: 'Select platforms to log in to. This will open a browser window.',
        choices: ['X', 'LinkedIn'],
        validate: input => input.length > 0 || 'Please select at least one platform.'
    }]);

    for (const platform of platforms) {
        const sessionFilePath = path.join(process.cwd(), `${platform.toLowerCase()}_session.json`);
        if (fs.existsSync(sessionFilePath)) {
            console.log(`[APP-INFO] Session for ${platform} already exists. Skipping login.`);
            continue;
        }

        let browser = null;
        try {
            browser = await chromium.launch({ headless: false });
            const context = await browser.newContext();
            const page = await context.newPage();
            const platformConfig = config.socialMedia[platform];

            console.log(`\n>>> ACTION REQUIRED: Please log in to your ${platform} account in the browser window.`);
            await page.goto(platformConfig.loginUrl);
            await page.waitForURL(`**${platformConfig.homeUrl}**`, { timeout: 180000 });
            
            console.log(`[APP-SUCCESS] Login for ${platform} detected. Saving session...`);
            await context.storageState({ path: sessionFilePath });
        } catch (error) {
            console.error(`[APP-ERROR] Login process for ${platform} failed:`, error);
        } finally {
            if (browser) await browser.close();
        }
    }
    console.log('[APP-INFO] Initial login setup complete.');
}


// --- [NEW] Worker Execution ---
async function runWorker() {
    console.log('\n[APP-INFO] Starting the worker process...');
    return new Promise((resolve, reject) => {
        const workerProcess = spawn('node', ['worker.js'], { stdio: 'inherit' });

        workerProcess.on('close', async (code) => {
            console.log(`\n[APP-INFO] Worker process finished with exit code ${code}.`);
            // This prompt ensures that we wait for user input before proceeding,
            // which prevents the main menu from appearing prematurely and causing
            // the "double enter" issue.
            await inquirer.prompt([{
                type: 'input',
                name: 'continue',
                message: 'Press Enter to return to the main menu...',
            }]);
            resolve();
        });

        workerProcess.on('error', (err) => {
            console.error('[APP-ERROR] Failed to start worker process:', err);
            reject(err);
        });
    });
}

function getPendingJobCount() {
    try {
        if (!fs.existsSync(QUEUE_FILE_PATH)) {
            // If the queue file doesn't exist, create it.
            fs.writeFileSync(QUEUE_FILE_PATH, JSON.stringify([], null, 2));
            return 0;
        }
        const queue = JSON.parse(fs.readFileSync(QUEUE_FILE_PATH, 'utf8'));
        return queue.filter(j => j.status === 'pending').length;
    } catch (error) {
        console.error('[APP-ERROR] Could not read or parse queue file:', error);
        return 0; // Return 0 on error to prevent crashing
    }
}

async function clearQueueAndCleanup() {
    console.log("\n--- Clear Job Queue & Cleanup Files ---");

    const { confirm } = await inquirer.prompt([
        {
            type: 'confirm',
            name: 'confirm',
            message: 'This will delete all pending jobs from the queue and remove any unassociated image files. Are you sure?',
            default: false,
        }
    ]);

    if (!confirm) {
        console.log('[APP-INFO] Operation cancelled.');
        return;
    }

    try {
        // Clear the queue
        try {
            fs.writeFileSync(QUEUE_FILE_PATH, JSON.stringify([], null, 2));
            console.log('[APP-SUCCESS] Job queue has been cleared.');
        } catch (e) {
            console.error('[APP-ERROR] Failed to clear the job queue. Error:', e);
        }

        // Cleanup image files
        const files = fs.readdirSync(process.cwd());
        const imageFiles = files.filter(f => f.startsWith('post-image-') || f.startsWith('comic-strip-'));
        
        let deletedCount = 0;
        for (const file of imageFiles) {
            // In a real scenario, you'd check if the file is associated with a COMPLETED job
            // but for this request, we're keeping it simple and deleting all of them.
            try {
                fs.unlinkSync(path.join(process.cwd(), file));
                deletedCount++;
            } catch (err) {
                console.warn(`[APP-WARN] Could not delete file: ${file}. It might be in use.`);
            }
        }

        if (deletedCount > 0) {
            console.log(`[APP-SUCCESS] Removed ${deletedCount} old image files.`);
        } else {
            console.log('[APP-INFO] No old image files found to remove.');
        }

    } catch (error) {
        console.error('[APP-FATAL] An error occurred during cleanup:', error);
    }
}


function getLoggedInPlatforms() {
    const loggedIn = [];
    if (fs.existsSync(path.join(process.cwd(), 'x_session.json'))) {
        loggedIn.push('X');
    }
    if (fs.existsSync(path.join(process.cwd(), 'linkedin_session.json'))) {
        loggedIn.push('LinkedIn');
    }
    return loggedIn;
}

// --- Main Application Loop ---
async function main() {
    config = loadConfig();
    if (config.displaySettings && config.displaySettings.showBannerOnStartup) {
        displayBanner();
    }
    let keepGoing = true;
    while (keepGoing) {
        const activeProfile = config.prompt.profilePath 
            ? path.basename(config.prompt.profilePath, '.json') 
            : 'Default (from config.json)';
        const loggedInPlatforms = getLoggedInPlatforms();
        const pendingJobs = getPendingJobCount();

        const message = `What would you like to do?\n  - Active Profile: ${activeProfile}\n  - Logged In: ${loggedInPlatforms.length > 0 ? loggedInPlatforms.join(', ') : 'None'}\n`;

        const choices = [
            'Generate and Queue a New Post',
            'Create Post from Local Media',
            'Generate Batch of Posts with AI',
        ];

        if (pendingJobs > 0) {
            choices.push(`Process Job Queue (${pendingJobs} pending)`);
        }

        choices.push(
            'Clear Job Queue & Cleanup Files',
            'Manage Creative Profiles',
            'Initial Login Setup (Run this first!)',
            new inquirer.Separator(),
            'Quit'
        );

        const { action } = await inquirer.prompt([{            
            type: 'list',
            name: 'action',
            message: message,
            choices: choices,
        }]);

        switch (action) {
            case 'Generate and Queue a New Post':
                // [IMPROVEMENT] Use the 'workflow' key for robust and clear routing.
                if (config.prompt.workflow === 'comicStrip') {
                    // Comic Strip Workflow
                    const comicAnswers = await inquirer.prompt([
                        { type: 'editor', name: 'topic', message: 'Enter the topic for the 4-panel comic strip:', default: config.search.defaultTopic },
                        { type: 'checkbox', name: 'platforms', message: 'Queue for which platforms?', choices: ['X', 'LinkedIn'], validate: i => i.length > 0 },
                        { type: 'confirm', name: 'confirm', message: 'Proceed with generating this comic strip?', default: true }
                    ]);

                    if (comicAnswers.confirm) {
                        await generateAndQueueComicStrip({ topic: comicAnswers.topic, platforms: comicAnswers.platforms });
                    } else {
                        console.log('[APP-INFO] Comic strip generation cancelled.');
                    }
                } else if (config.prompt.workflow === 'virtualInfluencer') {
                    // [RESTORATION] Restored Virtual Influencer Workflow
                    const answers = await inquirer.prompt([
                        { type: 'editor', name: 'topic', message: 'Enter the topic for the Virtual Influencer:', default: config.search.defaultTopic },
                        { type: 'confirm', name: 'skipSummarization', message: 'Use this topic directly as the post summary (skips AI summary generation)?', default: false, when: (answers) => answers.topic.trim().length > 0 },
                        { type: 'checkbox', name: 'platforms', message: 'Queue for which platforms?', choices: ['X', 'LinkedIn'], validate: i => i.length > 0 },
                        { type: 'confirm', name: 'confirm', message: (answers) => `Generate post about "${answers.topic}" for ${answers.platforms.join(', ')}?`, default: true, when: (answers) => answers.topic && answers.platforms.length > 0 }
                    ]);

                    if (answers.confirm) {
                        await generateVirtualInfluencerPost({ topic: answers.topic, platforms: answers.platforms }, answers.skipSummarization);
                    } else {
                        console.log('[APP-INFO] Post generation cancelled.');
                    }
                } else {
                    // Standard or Multi-Character Scene Workflow
                    const answers = await inquirer.prompt([
                        { type: 'editor', name: 'topic', message: 'Enter the topic:', default: config.search.defaultTopic },
                        { type: 'confirm', name: 'skipSummarization', message: 'Use this topic directly as the post summary (skips AI summary generation)?', default: false, when: (answers) => answers.topic.trim().length > 0 },
                        { type: 'checkbox', name: 'platforms', message: 'Queue for which platforms?', choices: ['X', 'LinkedIn'], validate: i => i.length > 0 },
                        { type: 'confirm', name: 'confirm', message: (answers) => `Generate post about "${answers.topic}" for ${answers.platforms.join(', ')}?`, default: true, when: (answers) => answers.topic && answers.platforms.length > 0 }
                    ]);

                    if (answers.confirm) {
                        await generateAndQueuePost({ topic: answers.topic, platforms: answers.platforms }, answers.skipSummarization);
                    } else {
                        console.log('[APP-INFO] Post generation cancelled.');
                    }
                }
                break;
            case 'Create Post from Local Media':
                await createPostFromLocalMedia();
                break;
            case 'Generate Batch of Posts with AI':
                await runAIBatchGeneration();
                break;
            case `Process Job Queue (${pendingJobs} pending)`:
                await runWorker();
                break;
            case 'Clear Job Queue & Cleanup Files':
                await clearQueueAndCleanup();
                break;
            case 'Manage Creative Profiles':
                await manageCreativeProfiles();
                break;
            case 'Initial Login Setup (Run this first!)':
                await initialLogin();
                break;
            case 'Quit':
                keepGoing = false;
                break;
        }
    }
    console.log("[APP-INFO] Shutting down.");
}

// --- Entry Point ---
const __filename = fileURLToPath(import.meta.url);
if (path.resolve(process.argv[1]) === path.resolve(__filename)) {
    main();
}