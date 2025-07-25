// ============================================================================
// Automated Daily Cartoon Bot v26.0 (API First)
// ============================================================================
// This version migrates from the unreliable Gemini CLI to the official
// Google AI Node.js library for robust, direct API communication.
// ============================================================================
import { chromium } from 'playwright';
import OpenAI from 'openai';
import { GoogleGenerativeAI, GoogleGenerativeAIFetchError } from "@google/generative-ai";
import fs from 'fs';
import path from 'path';
import inquirer from 'inquirer';
import moment from 'moment-timezone';
import sharp from 'sharp';
import 'dotenv/config';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const PROFILES_DIR = './prompt_profiles';
const SPEECH_BUBBLE_INSTRUCTION = ' The speech bubble must be positioned so it is fully visible and not cut off by the edges of the image.';

// --- (1) Read Configuration from external file ---
export function loadConfig() {
    try {
        console.log("[INFO] Loading configuration from config.json...");
        const configFile = fs.readFileSync('./config.json', 'utf8');
        return JSON.parse(configFile);
    } catch (error) {
        console.error("[FATAL] Error loading or parsing config.json:", error);
        process.exit(1);
    }
}

let config = loadConfig();
const imageOutputPath = path.join(process.cwd(), config.imageGeneration.imageFileName);

// --- API Client Initialization ---
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const geminiModel = genAI.getGenerativeModel({ model: config.textGeneration.model });

// --- Utility Functions ---
function debugLog(message) {
    if (config.debug && config.debug.enabled) {
        console.log(`[DEBUG] ${message}`);
    }
}

// --- Consolidated function to get user approval for text input ---
async function getApprovedInput(text, inputType) {
    const tempFile = `${inputType}_for_editing.txt`;

    while (true) {
        const { action } = await inquirer.prompt([
            {
                type: 'list',
                name: 'action',
                message: `Generated ${inputType}:\n\n"${text}"\n\nDo you want to approve this ${inputType} or edit it?`,
                choices: ['Approve', 'Edit', 'Cancel'],
            },
        ]);

        if (action === 'Approve') {
            return text;
        }

        if (action === 'Cancel') {
            console.log('[INFO] Post cycle cancelled by user.');
            return null; // Return null to indicate cancellation
        }

        if (action === 'Edit') {
            try {
                fs.writeFileSync(tempFile, text);
                console.log(`[INFO] Please edit the ${inputType} in the text editor that just opened. Save and close the file to continue.`);

                // Open the file in the default text editor
                if (process.platform === 'win32') {
                    execSync(`start ${tempFile}`);
                } else if (process.platform === 'darwin') {
                    execSync(`open ${tempFile}`);
                } else {
                    execSync(`xdg-open ${tempFile}`);
                }

                // Wait for the user to confirm they are done editing
                await inquirer.prompt([{ type: 'input', name: 'continue', message: 'Press Enter when you have finished editing...' }]);

                const editedText = fs.readFileSync(tempFile, 'utf8').trim();
                fs.unlinkSync(tempFile); // Clean up the temp file

                if (editedText) {
                    console.log(`[SUCCESS] ${inputType} updated.`);
                    return editedText;
                } else {
                    console.warn(`[WARN] Edited ${inputType} is empty. Please try again.`);
                }
            } catch (error) {
                console.error(`[ERROR] Failed to open or read the temporary ${inputType} file:`, error);
                if (fs.existsSync(tempFile)) {
                    fs.unlinkSync(tempFile);
                }
            }
        }
    }
}

// --- Centralized function to handle speech bubble logic ---
async function promptForSpeechBubble(initialPrompt, dialogue, isVirtualInfluencer) {
    const { addSpeechBubble } = await inquirer.prompt([
        {
            type: 'confirm',
            name: 'addSpeechBubble',
            message: isVirtualInfluencer ? 'Add a speech bubble to the image?' : 'Do you want to add a speech bubble to the cartoon?',
            default: isVirtualInfluencer,
        },
    ]);

    if (!addSpeechBubble) {
        return initialPrompt;
    }

    let speechBubbleText = '';
    let needsEditing = true;

    // Initial prompt for the text
    const { initialText } = await inquirer.prompt([
        {
            type: 'input',
            name: 'initialText',
            message: 'Enter the text for the speech bubble:',
            default: dialogue,
            validate: (input) => input.trim() !== '' || 'Speech bubble text cannot be empty.',
        },
    ]);
    speechBubbleText = initialText;

    while (needsEditing) {
        const wordCount = speechBubbleText.split(/\s+/).length;
        const charCount = speechBubbleText.length;

        if (wordCount > 15 || charCount > 80) {
            console.log("\n[WARN] The speech bubble text is quite long and may not fit well in the image.");
            const { action } = await inquirer.prompt([
                {
                    type: 'list',
                    name: 'action',
                    message: 'What would you like to do?',
                    choices: [
                        { name: 'Let the AI try to shorten it.', value: 'ai' },
                        { name: 'Let me edit it myself.', value: 'user' },
                        { name: 'Use the long text anyway.', value: 'force' },
                    ],
                },
            ]);

            if (action === 'force') {
                needsEditing = false;
            } else if (action === 'user') {
                const { editedText } = await inquirer.prompt([
                    {
                        type: 'editor',
                        name: 'editedText',
                        message: 'Edit the text in the editor. Save and close to continue.',
                        default: speechBubbleText,
                    },
                ]);
                speechBubbleText = editedText.trim();
            } else if (action === 'ai') {
                console.log("[INFO] Asking the AI to shorten the text...");
                const shortenPrompt = `Please shorten the following text to be concise and witty, suitable for a speech bubble in a cartoon (ideally under 15 words). Respond with ONLY the shortened text, without any extra formatting or quotation marks: "${speechBubbleText}"`;
                
                const result = await geminiRequestWithRetry(() => 
                    geminiModel.generateContent(shortenPrompt)
                );
                const response = await result.response;
                const shortenedText = response.text().trim().replace(/"/g, ''); // Remove quotes

                console.log(`[INFO] AI Suggestion: "${shortenedText}"`);
                speechBubbleText = shortenedText;
            }
        } else {
            needsEditing = false;
        }
    }

    if (isVirtualInfluencer) {
        return `${initialPrompt} The character has a speech bubble that clearly says: "${speechBubbleText}".`;
    } else {
        return `${initialPrompt}, with a speech bubble that clearly says: "${speechBubbleText}".`;
    }
}


// --- Resilient API Callers with Retry Logic ---
async function apiRequestWithRetry(apiCall, shouldRetry, maxRetries, delay, apiName) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await apiCall();
        } catch (error) {
            if (shouldRetry(error)) {
                // Use exponential backoff for the delay
                const waitTime = delay * Math.pow(2, i);
                console.warn(`[WARN] ${apiName} API error. Retrying in ${waitTime / 1000}s... (${i + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
            } else {
                throw error;
            }
        }
    }
    throw new Error(`[FATAL] ${apiName} API call failed after ${maxRetries} retries.`);
}

async function openaiRequestWithRetry(apiCall, maxRetries = 3, delay = 5000) {
    const shouldRetry = (error) => error instanceof OpenAI.APIError && error.message.includes('Connection error');
    return apiRequestWithRetry(apiCall, shouldRetry, maxRetries, delay, 'OpenAI');
}

async function geminiRequestWithRetry(apiCall, maxRetries = 4, delay = 10000) {
    const shouldRetry = (error) => error instanceof GoogleGenerativeAIFetchError && error.status === 503;
    return apiRequestWithRetry(apiCall, shouldRetry, maxRetries, delay, 'Gemini');
}


// --- OpenAI API Request Builder ---
function buildImageRequest(prompt, size, extraParams = {}) {
    const model = config.imageGeneration.model;
    
    // Add a safe zone instruction to the prompt to prevent cropping on social media feeds
    let finalPrompt = `${prompt}, with a 5% margin of empty space around the entire image to act as a safe zone.`;

    // If a speech bubble is present, append the critical instruction at the very end
    if (prompt.includes('speech bubble')) {
        finalPrompt += SPEECH_BUBBLE_INSTRUCTION;
    }

    const request = {
        model,
        prompt: finalPrompt,
        n: 1,
        size,
        ...extraParams,
    };

    // DALL-E 2 and 3 support/require response_format
    if (model.startsWith('dall-e')) {
        request.response_format = 'b64_json';
    }

    // gpt-image-1 has specific, modern parameters
    if (model === 'gpt-image-1') {
        request.moderation = 'low'; // Set safety moderation to the lowest setting
    }
    
    debugLog(`OpenAI API Request: ${JSON.stringify(request, null, 2)}`);
    return request;
}


// --- Platform-Specific Posting Logic ---

export async function postToX(page, summary, tempImagePath) {
    console.log("[INFO] Navigating to X compose page...");
    await page.goto(config.socialMedia.X.composeUrl);
    await page.waitForSelector('input[type="file"]', { state: 'attached', timeout: 60000 });
    
    console.log("[INFO] Uploading image to X...");
    await page.setInputFiles('input[type="file"]', [tempImagePath]);

    console.log("[INFO] Waiting for image to be processed by X...");
    await page.waitForSelector('[data-testid="tweetPhoto"]', { state: 'visible', timeout: 60000 });
    console.log("[SUCCESS] Image thumbnail is visible.");
    
    console.log("[INFO] Writing post text for X...");
    await page.getByRole('textbox', { name: 'Post text' }).fill(summary);
    
    console.log("[INFO] Clicking post on X...");
    await page.locator('[data-testid="tweetButton"]').click();
    
    // --- FINAL CONFIRMATION ---
    // Wait for the "Your post was sent" confirmation toast. This is the
    // definitive sign that the post is successful.
    console.log("[INFO] Waiting for post confirmation...");
    await page.waitForSelector('[data-testid="toast"]', { state: 'visible', timeout: 60000 });

    console.log("[SUCCESS] X post confirmed successfully!");
}

export async function postToLinkedIn(page, summary, tempImagePath) {
    console.log("[INFO] Navigating to LinkedIn feed...");
    await page.goto(config.socialMedia.LinkedIn.composeUrl);
    
    console.log("[INFO] Clicking 'Start a post' on LinkedIn...");
    await page.getByRole('button', { name: 'Start a post' }).click();
    
    console.log("[INFO] Preparing to upload image to LinkedIn...");
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Add media' }).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles([tempImagePath]);
    
    console.log("[INFO] Clicking 'Next' after image upload...");
    await page.getByRole('button', { name: 'Next' }).click();

    console.log("[INFO] Writing post text for LinkedIn...");
    const postTextBox = page.locator('div[role="textbox"]');
    await postTextBox.waitFor({ state: 'visible', timeout: 10000 });
    await postTextBox.fill(summary);

    // --- DEFINITIVE ROBUSTNESS FIX ---
    console.log("[INFO] Ensuring 'Post' button is enabled...");
    const postButton = page.getByRole('button', { name: 'Post', exact: true });
    
    console.log("[INFO] Clicking post on LinkedIn...");
    await postButton.click();

    console.log("[INFO] Waiting for post confirmation on LinkedIn...");
    // The most reliable confirmation is waiting for the compose modal to disappear.
    const composeModal = page.getByRole('dialog', { name: /share-to-linkedin-modal/i });
    await composeModal.waitFor({ state: 'hidden', timeout: 60000 });

    console.log("[SUCCESS] LinkedIn post confirmed successfully by modal closing.");
}


// The core automation logic, now accepts a post object
async function runSinglePostCycle(page, post, platform, isImmediatePost = false) {
    let tempImagePath = '';
    let success = false;
    const tempFiles = []; // Keep track of temp files for cleanup
    const topic = post.topic;
    const originalPromptConfig = { ...config.prompt }; // Shallow copy is enough

    try {
        // --- Profile Loading Logic for Scheduled Posts ---
        if (post.profile) {
            const profilePath = path.join(PROFILES_DIR, post.profile);
            if (fs.existsSync(profilePath)) {
                console.log(`[INFO] Loading temporary profile for this post: ${post.profile}`);
                const profileData = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
                config.prompt = profileData; // Temporarily override the prompt config
            } else {
                console.warn(`[WARN] Profile "${post.profile}" not found. Using the default active profile.`);
            }
        }

        console.log(`\n[INFO] Processing topic: "${topic}" for ${platform}`);

        // --- Generate Content with Gemini API ---
        const safetySettings = [
            { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
        ];
        const characterDescription = config.prompt.characterDescription;
        const isVirtualInfluencer = !!characterDescription;
        let summary, imagePrompt, backgroundPrompt, dialogue;

        // --- Build the correct prompt for Gemini ---
        let taskPrompt = config.prompt.task;
        // Only ask for dialogue from Gemini if it's an immediate, standard post.
        // For scheduled posts, the dialogue comes from the schedule file.
        // For influencer posts, the user provides it interactively.
        if (isImmediatePost && !isVirtualInfluencer) {
            taskPrompt = taskPrompt.replace('exactly two string keys', 'exactly three string keys');
            taskPrompt = taskPrompt.replace("and 'imagePrompt'", ", 'imagePrompt', and 'dialogue' (a short, witty line of text, under 15 words, for a speech bubble)");
        }
        const finalNewsPrompt = taskPrompt.replace('{TOPIC}', topic);
        debugLog(`Gemini Prompt: ${finalNewsPrompt}`);

        console.log("[INFO] Sending prompt to the Gemini API...");
        const geminiResult = await geminiRequestWithRetry(() =>
            geminiModel.generateContent({ contents: [{ role: "user", parts: [{ text: finalNewsPrompt }] }], safetySettings })
        );
        const geminiResponse = await geminiResult.response;
        const geminiRawOutput = geminiResponse.text();
        debugLog(`Gemini Raw Output: ${geminiRawOutput}`);

        let parsedResult;
        try {
            const jsonStart = geminiRawOutput.indexOf('{');
            const jsonEnd = geminiRawOutput.lastIndexOf('}');
            if (jsonStart === -1 || jsonEnd === -1) throw new Error("No JSON object found in Gemini response.");
            
            // Sanitize the JSON string to remove trailing commas
            let jsonString = geminiRawOutput.substring(jsonStart, jsonEnd + 1);
            jsonString = jsonString.replace(/,\s*([}\]])/g, '$1'); // Remove trailing commas

            parsedResult = JSON.parse(jsonString);
        } catch (error) {
            console.error("[ERROR] Failed to parse JSON from Gemini:", error);
            console.error("[ERROR] Raw Gemini Output:", geminiRawOutput);
            return success;
        }

        // --- Assign variables based on workflow ---
        if (isVirtualInfluencer) {
            summary = parsedResult.summary;
            backgroundPrompt = parsedResult.backgroundPrompt;
            dialogue = ''; // Influencer dialogue comes from the user later
        } else {
            summary = parsedResult.summary;
            imagePrompt = parsedResult.imagePrompt;
            // Use dialogue from Gemini only if it's an immediate post
            dialogue = isImmediatePost ? parsedResult.dialogue : '';
        }

        // --- Get user approval for summary if interactive ---
        if (isImmediatePost) {
            const approvedSummary = await getApprovedInput(summary, 'summary');
            if (!approvedSummary) {
                console.log('[INFO] Post cycle cancelled during summary approval.');
                return success;
            }
            summary = approvedSummary;
        }

        if (!summary || (!imagePrompt && !backgroundPrompt)) {
            console.error("[ERROR] Gemini response is missing 'summary' or a valid image prompt.");
            return success;
        }
        console.log(`[SUCCESS] Final Summary: "${summary}"`);
        if (imagePrompt) console.log(`[SUCCESS] Image Prompt: "${imagePrompt}"`);
        if (backgroundPrompt) console.log(`[SUCCESS] Background Prompt: "${backgroundPrompt}"`);
        
        // --- Image Generation ---
        if (typeof summary !== 'string' || !summary.trim()) {
            console.error("[FATAL] Cannot proceed to image generation: The post summary is empty or invalid.");
            return success;
        }

        if (isVirtualInfluencer) {
            // VIRTUAL INFLUENCER MODE (Hybrid Node/Python Workflow)
            console.log("[INFO] Executing Hybrid Node/Python Influencer Workflow...");

            if (isImmediatePost) {
                const approvedBackgroundPrompt = await getApprovedInput(backgroundPrompt, 'background prompt');
                if (!approvedBackgroundPrompt) {
                    console.log('[INFO] Post cycle cancelled during background prompt approval.');
                    return success;
                }
                backgroundPrompt = approvedBackgroundPrompt;

                let framingChoice = '';
                const customOption = 'Custom...';
                const backOption = 'Go Back to Main Menu';
                const framingChoices = [...(config.framingOptions || []), new inquirer.Separator(), customOption, backOption];

                const { selectedFraming } = await inquirer.prompt([
                    {
                        type: 'list',
                        name: 'selectedFraming',
                        message: 'Choose the framing for the virtual influencer:',
                        choices: framingChoices,
                    },
                ]);

                if (selectedFraming === backOption) return 'back';

                if (selectedFraming === customOption) {
                    const { customFraming } = await inquirer.prompt([
                        {
                            type: 'editor',
                            name: 'customFraming',
                            message: 'Enter the custom framing instructions. Save and close to continue.',
                            validate: input => !!input || 'Framing instructions cannot be empty.',
                        },
                    ]);
                    framingChoice = customFraming;
                } else {
                    framingChoice = selectedFraming;
                }
                 let sourcePrompt = `${config.prompt.style} ${characterDescription}. ${framingChoice} The character should be posed appropriately for a discussion about '${summary}'. The background should be a solid, neutral light grey.`;
            
				// Add character placement instruction if available
				if (config.prompt.characterPlacement) {
					sourcePrompt += ` ${config.prompt.characterPlacement}`;
				}
			} else {
				// Non-interactive path for scheduled posts
				let sourcePrompt = `${config.prompt.style} ${characterDescription}. The character should be posed appropriately for a discussion about '${summary}'. The background should be a solid, neutral light grey.`;
				if (config.prompt.characterPlacement) {
					sourcePrompt += ` ${config.prompt.characterPlacement}`;
				}
			}

            // --- Speech Bubble Logic ---
            if (isImmediatePost) {
                sourcePrompt = await promptForSpeechBubble(sourcePrompt, dialogue, true);
            } else if (post.speechBubbleText) {
                console.log("[INFO] Adding pre-configured speech bubble for scheduled post.");
                sourcePrompt += ` The character has a speech bubble that clearly says: "${post.speechBubbleText}".`;
            }

            console.log("[INFO] Step 1 (Node.js): Generating source influencer image...");
            const sourceRequest = buildImageRequest(sourcePrompt, config.imageGeneration.size);
            const sourceResponse = await openaiRequestWithRetry(() => openai.images.generate(sourceRequest));
            const sourceB64 = sourceResponse.data[0].b64_json;
            
            const tempSourcePath = path.join(process.cwd(), 'temp_source_for_python.png');
            fs.writeFileSync(tempSourcePath, Buffer.from(sourceB64, 'base64'));
            tempFiles.push(tempSourcePath);
            console.log(`[DEBUG] Saved source image for Python to ${tempSourcePath}`);

            console.log("[INFO] Step 2 (Python): Invoking Python script for high-fidelity edit...");
            const finalImagePath = imageOutputPath;
            const editPrompt = `Take the person from the foreground of the provided image and place them seamlessly into a new background. The person, their clothing, and their speech bubble must not be changed. The new background is: ${backgroundPrompt}`;
            
            const pythonCommand = `python edit_image.py "${tempSourcePath}" "${finalImagePath}" "${editPrompt}"`;
            
            try {
                execSync(pythonCommand, { stdio: 'inherit' });
                console.log("[SUCCESS] Python script executed successfully.");
                tempImagePath = finalImagePath;
                tempFiles.push(finalImagePath);
            } catch (error) {
                console.error("[FATAL] Python script execution failed.");
                throw new Error("The Python image editing script failed.");
            }

        } else {
            // STANDARD MODE (ONE-PASS)
            let finalImagePrompt = `${config.prompt.style} ${imagePrompt}`;
            
            // --- Speech Bubble Logic ---
            if (isImmediatePost) {
                finalImagePrompt = await promptForSpeechBubble(finalImagePrompt, dialogue, false);
            } else if (post.speechBubbleText) {
                console.log("[INFO] Adding pre-configured speech bubble for scheduled post.");
                finalImagePrompt += `, with a speech bubble that clearly says: "${post.speechBubbleText}".`;
            }
            
            if (isImmediatePost) {
                const approvedImagePrompt = await getApprovedInput(finalImagePrompt, 'image prompt');
                if (!approvedImagePrompt) return success;
                finalImagePrompt = approvedImagePrompt;
            }

            console.log(`[INFO] Sending final prompt to the ${config.imageGeneration.model} API...`);
            console.log(`[INFO] Final Prompt: "${finalImagePrompt}"`);

            const imageRequest = buildImageRequest(finalImagePrompt, config.imageGeneration.size);
            const imageResponse = await openaiRequestWithRetry(() => openai.images.generate(imageRequest));
            
            const imageB64 = imageResponse.data[0].b64_json;
            tempImagePath = imageOutputPath;
            tempFiles.push(tempImagePath);
            fs.writeFileSync(tempImagePath, Buffer.from(imageB64, 'base64'));
            console.log(`[SUCCESS] Image created and saved to: ${tempImagePath}`);
        }

        // --- Post the Image to Social Media ---
        if (platform === 'X') {
            await postToX(page, summary, tempImagePath);
        } else if (platform === 'LinkedIn') {
            await postToLinkedIn(page, summary, tempImagePath);
        } else {
            console.error(`[ERROR] Unknown platform: ${platform}`);
            return false;
        }
        
        success = true;

    } catch (error) {
        if (error instanceof OpenAI.APIError) {
            console.error("[ERROR] OpenAI API Error:", error.status, error.name, error.message);
        } else if (error.constructor.name === 'TimeoutError') {
            console.error("[ERROR] Playwright operation timed out:", error.message);
        } else {
            console.error("[ERROR] An unexpected error occurred:", error);
        }
    } finally {
        config.prompt = originalPromptConfig; // Restore original config
        if (config.debug && config.debug.preserveTemporaryFiles) {
            console.log("[INFO] File cleanup skipped because 'preserveTemporaryFiles' is true in config.json.");
            console.log("[INFO] The following files have been preserved for you to inspect:");
            tempFiles.forEach(file => {
                if (fs.existsSync(file)) {
                    console.log(`  - ${file}`);
                }
            });
        } else {
            console.log("[INFO] Cleaning up temporary files...");
            tempFiles.forEach(file => {
                if (fs.existsSync(file)) {
                    fs.unlinkSync(file);
                    console.log(`[INFO] Deleted: ${file}`);
                }
            });
        }
    }
    return success;
}

// --- Scheduler Function ---
export async function processScheduledPosts(page, platform, postCycleFn = runSinglePostCycle) {
    const scheduleFileName = `schedule_${platform.toLowerCase()}.json`;
    const scheduleFilePath = path.join(process.cwd(), scheduleFileName);

    if (!fs.existsSync(scheduleFilePath)) {
        console.log(`[INFO] No \`${scheduleFileName}\` file found for ${platform}. Nothing to process.`);
        return;
    }

    let schedule = JSON.parse(fs.readFileSync(scheduleFilePath, 'utf8'));
    
    console.log(`\n[DIAGNOSTIC] Current script time (UTC): ${moment.utc().toISOString()}`);
    console.log(`[DIAGNOSTIC] Timezone for scheduling: ${config.timezone}`);

    const duePosts = schedule.filter(post => {
        if (post.status !== 'pending') {
            return false;
        }
        const postDate = moment.tz(post.postAt, "YYYY-MM-DD HH:mm", config.timezone);
        return postDate.isValid() && postDate.isSameOrBefore(moment());
    });

    if (duePosts.length === 0) {
        console.log(`[INFO] No pending posts are due for ${platform}. Everything is up to date.`);
        return;
    }

    console.log(`\n[INFO] Found ${duePosts.length} due post(s) for ${platform}. Locking them for processing...`);

    const processingTopics = duePosts.map(p => p.topic);
    schedule.forEach(post => {
        if (processingTopics.includes(post.topic) && post.status === 'pending') {
            post.status = 'processing';
        }
    });
    fs.writeFileSync(scheduleFilePath, JSON.stringify(schedule, null, 2));
    console.log("[INFO] Posts locked. Starting processing cycle.");


    for (const post of duePosts) {
        const success = await postCycleFn(page, post, platform, false);
        
        const originalPostIndex = schedule.findIndex(p => p.topic === post.topic && p.status === 'processing');
        if (originalPostIndex !== -1) {
            schedule[originalPostIndex].status = success ? 'posted' : 'failed';
            console.log(`[INFO] Updated status for post "${post.topic}" to "${schedule[originalPostIndex].status}".`);
        }
    }

    fs.writeFileSync(scheduleFilePath, JSON.stringify(schedule, null, 2));
    console.log(`[SUCCESS] Schedule processing complete for ${platform}. \`${scheduleFileName}\` has been updated.`);
}

// --- Creative Profile Management ---
async function manageCreativeProfiles() {
    const { action } = await inquirer.prompt([
        {
            type: 'list',
            name: 'action',
            message: 'Creative Profiles Menu',
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
        console.log("[INFO] No creative profiles found.");
        return;
    }

    const { profileToLoad } = await inquirer.prompt([
        {
            type: 'list',
            name: 'profileToLoad',
            message: 'Which profile would you like to load?',
            choices: profiles,
        },
    ]);

    try {
        const profilePath = path.join(PROFILES_DIR, profileToLoad);
        const profileData = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
        
        // Update the main config object
        config.prompt = profileData;
        
        // Save the updated config to config.json to make it persistent
        fs.writeFileSync('./config.json', JSON.stringify(config, null, 2));
        console.log(`[SUCCESS] Profile "${profileToLoad}" loaded and set as the active configuration.`);

    } catch (error) {
        console.error(`[ERROR] Failed to load profile "${profileToLoad}":`, error);
    }
}

async function createNewProfile() {
    console.log("\n--- Create New Profile ---");

    const { filename } = await inquirer.prompt([
        {
            type: 'input',
            name: 'filename',
            message: 'Enter a filename for the new profile (e.g., "my_style"):',
            validate: input => !!input || 'Filename cannot be empty.',
        },
    ]);
    
    const { newStyle } = await inquirer.prompt([
        {
            type: 'input',
            name: 'newStyle',
            message: 'Enter the new image style:',
            default: "A fun, witty, satirical cartoon.",
        },
    ]);

    const profileTypes = {
        "Standard Cartoon": {
            task: "Based on the news about '{TOPIC}', you must respond with ONLY a single, raw JSON object. Do not include markdown ticks ```json or any other explanatory text. The JSON object must have exactly two string keys: 'summary' (a short, witty summary of the news) and 'imagePrompt' (a detailed visual description for an AI image generator based on the news).",
        },
        "Virtual Influencer": {
            task: "Based on the news about '{TOPIC}', you must respond with ONLY a single, raw JSON object. Do not include markdown ticks ```json or any other explanatory text. The JSON object must have exactly two string keys: 'summary' (a summary of the news from the perspective of a virtual influencer) and 'backgroundPrompt' (a detailed description of a realistic setting where the influencer would be, related to the news).",
        },
    };

    const { profileType } = await inquirer.prompt([
        {
            type: 'list',
            name: 'profileType',
            message: 'Choose the profile type:',
            choices: Object.keys(profileTypes),
        },
    ]);

    const newProfile = {
        style: newStyle,
        task: profileTypes[profileType].task,
    };

    if (profileType === "Virtual Influencer") {
        const { characterDescription } = await inquirer.prompt([
            {
                type: 'input',
                name: 'characterDescription',
                message: 'Enter a detailed description of your virtual influencer:',
                validate: input => !!input || 'Description cannot be empty.',
            },
        ]);
        newProfile.characterDescription = characterDescription;
    }

    const profilePath = path.join(PROFILES_DIR, `${filename}.json`);
    try {
        fs.writeFileSync(profilePath, JSON.stringify(newProfile, null, 2));
        console.log(`[SUCCESS] New profile saved to "${profilePath}"`);

        const { loadNow } = await inquirer.prompt([
            {
                type: 'confirm',
                name: 'loadNow',
                message: 'Would you like to load this new profile now?',
                default: true,
            },
        ]);

        if (loadNow) {
            config.prompt = newProfile;
            fs.writeFileSync('./config.json', JSON.stringify(config, null, 2));
            console.log(`[SUCCESS] Profile "${filename}.json" is now the active configuration.`);
        }
    } catch (error) {
        console.error("[ERROR] Failed to save the new profile:", error);
    }
}

async function deleteProfile() {
    const profiles = fs.readdirSync(PROFILES_DIR).filter(file => file.endsWith('.json'));
    if (profiles.length === 0) {
        console.log("[INFO] No creative profiles found to delete.");
        return;
    }

    const { profileToDelete } = await inquirer.prompt([
        {
            type: 'list',
            name: 'profileToDelete',
            message: 'Which profile would you like to delete?',
            choices: profiles,
        },
    ]);

    const { confirmDelete } = await inquirer.prompt([
        {
            type: 'confirm',
            name: 'confirmDelete',
            message: `Are you sure you want to permanently delete "${profileToDelete}"?`,
            default: false,
        },
    ]);

    if (confirmDelete) {
        try {
            fs.unlinkSync(path.join(PROFILES_DIR, profileToDelete));
            console.log(`[SUCCESS] Profile "${profileToDelete}" has been deleted.`);
        } catch (error) {
            console.error(`[ERROR] Failed to delete profile:`, error);
        }
    } else {
        console.log("[INFO] Deletion cancelled.");
    }
}


// The Main Program that manages the session
async function main() {
    let browser;
    let context;
    let page;
    let currentPlatform = 'X'; // Default platform

    const getSessionFilePath = (platform) => path.join(process.cwd(), `${platform.toLowerCase()}_session.json`);

    const switchPlatform = async (newPlatform, browser) => {
        currentPlatform = newPlatform;
        console.log(`[INFO] Switched to ${currentPlatform}.`);
        
        if (context) {
            await context.close();
        }
        
        const sessionFilePath = getSessionFilePath(currentPlatform);
        context = fs.existsSync(sessionFilePath)
            ? await browser.newContext({ storageState: sessionFilePath })
            : await browser.newContext();
        
        page = await context.newPage();
        await checkLogin();
    };

    const checkLogin = async () => {
        const platformConfig = config.socialMedia[currentPlatform];
        const sessionFilePath = getSessionFilePath(currentPlatform);

        console.log(`[INFO] Checking login status for ${currentPlatform}...`);
        await page.goto(platformConfig.homeUrl);
        
        try {
            await page.waitForURL(`**${platformConfig.homeUrl}**`, { timeout: 5000 });
            console.log(`[SUCCESS] Session is valid for ${currentPlatform}. Automation is ready.`);
        } catch (e) {
            console.log(`[INFO] No valid session found for ${currentPlatform}. Manual login is required.`);
            if (fs.existsSync(sessionFilePath)) {
                fs.unlinkSync(sessionFilePath);
            }
            await page.goto(platformConfig.loginUrl);
            console.log(`\n>>> ACTION REQUIRED: Please log in to your ${currentPlatform} account in the browser window.`);
            await page.waitForURL(`**${platformConfig.homeUrl}**`, { timeout: 180000 });
            console.log("[SUCCESS] Login detected. Saving session for future use...");
            await context.storageState({ path: sessionFilePath });
            console.log(`[SUCCESS] Session state saved to ${sessionFilePath}`);
        }
    };

    // 1. Launch browser
    browser = await chromium.launch({ headless: false });
    await switchPlatform(currentPlatform, browser); // Initial setup

    try {
        // 2. Start the main automation loop
        let schedulerInterval;
        let keepGoing = true;

        const startScheduler = () => {
            if (schedulerInterval) {
                console.log("[INFO] Scheduler is already running.");
                return;
            }
            console.log(`[INFO] Starting the scheduler for ${currentPlatform} to check for posts every minute.`);
            schedulerInterval = setInterval(() => processScheduledPosts(page, currentPlatform), 60000); // Check every 60 seconds
        };

        const stopScheduler = () => {
            if (schedulerInterval) {
                clearInterval(schedulerInterval);
                schedulerInterval = null;
            }
        };

        while (keepGoing) {
            const { action } = await inquirer.prompt([
                {
                    type: 'list',
                    name: 'action',
                    message: `Current Platform: ${currentPlatform}. What would you like to do?`,
                    choices: [
                        { name: `Post a new cartoon to ${currentPlatform} immediately`, value: 'post' },
                        { name: 'Manage Creative Profiles (Switch character, style, etc.)', value: 'profiles' },
                        new inquirer.Separator('--- Posting Scheduler ---'),
                        { name: `Start the scheduler for ${currentPlatform} (Run in background)`, value: 'start' },
                        { name: 'Stop the scheduler', value: 'stop' },
                        { name: `Process scheduled posts for ${currentPlatform} manually (Run once)`, value: 'schedule' },
                        new inquirer.Separator('--- App Management ---'),
                        { name: 'Switch Platform (Login to another social media account)', value: 'switch' },
                        { name: 'Reload the configuration file (config.json)', value: 'reload' },
                        { name: 'Quit', value: 'quit' },
                    ],
                },
            ]);

            if (action === 'switch') {
                const { newPlatform } = await inquirer.prompt([
                    {
                        type: 'list',
                        name: 'newPlatform',
                        message: 'Choose a platform:',
                        choices: ['X', 'LinkedIn'],
                    },
                ]);
                if (newPlatform !== currentPlatform) {
                    await switchPlatform(newPlatform, browser);
                }
            } else if (action === 'profiles') {
                await manageCreativeProfiles();
            } else if (action === 'start') {
                startScheduler();
                await processScheduledPosts(page, currentPlatform);
            } else if (action === 'stop') {
                stopScheduler();
            } else if (action === 'schedule') {
                await processScheduledPosts(page, currentPlatform);
            } else if (action === 'post') {
                stopScheduler();
                const { topic } = await inquirer.prompt([
                    {
                        type: 'editor',
                        name: 'topic',
                        message: 'Enter the topic for the new cartoon in the editor. Save and close to continue.',
                        default: config.search.defaultTopic,
                    },
                ]);
                const result = await runSinglePostCycle(page, { topic }, currentPlatform, true);
                if (result === 'back') {
                    console.log('[INFO] Returning to main menu.');
                    continue; // This will restart the while loop, showing the main menu
                }

            } else if (action === 'reload') {
                config = loadConfig();
                console.log("[SUCCESS] Configuration reloaded.");
            } else {
                keepGoing = false;
            }
        }

        stopScheduler();

    } catch (error) {
        console.error("[FATAL] A critical error occurred:", error);
    } finally {
        console.log("[INFO] Shutting down...");
        if (context) {
            await context.close();
        }
        if (browser) {
            await browser.close();
            console.log("[INFO] Browser closed.");
        }
        console.log("[COMPLETE] Automation finished.");
        process.exit(0); // Force exit
    }
}

// This block ensures that the main function is called only when the script is executed directly
const __filename = fileURLToPath(import.meta.url);
if (path.resolve(process.argv[1]) === path.resolve(__filename)) {
    main();
}