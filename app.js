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
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const geminiModel = genAI.getGenerativeModel({ model: config.textGeneration.model });

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
async function openaiRequestWithRetry(apiCall) { return apiRequestWithRetry(apiCall, (e) => e instanceof OpenAI.APIError, 3, 5000, 'OpenAI'); }
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

// --- Core Content Generation Function ---
async function generateAndQueuePost(postDetails) {
    const originalPromptConfig = { ...config.prompt };
    if (!process.env.OPENAI_API_KEY) {
        console.error("[APP-FATAL] OpenAI API key is not configured. Please check your .env file.");
        return { success: false };
    }

    try {
        console.log(`\n[APP-INFO] Generating content for topic: "${postDetails.topic}"`);
        
        const safetySettings = [ { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' }, { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' }, { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' }, { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }];
        const isVirtualInfluencer = !!config.prompt.characterDescription;
        let taskPrompt = config.prompt.task.replace('{TOPIC}', postDetails.topic);
        
        // --- [FIX-2] Correctly modify the prompt for dialogue using simple string replacement ---
        if (!isVirtualInfluencer) {
            taskPrompt = taskPrompt.replace('exactly two string keys', 'exactly three string keys');
            // This is a more robust way to add the dialogue requirement without regex.
            const closingParenIndex = taskPrompt.lastIndexOf(')');
            if (closingParenIndex !== -1) {
                taskPrompt = taskPrompt.slice(0, closingParenIndex) + 
                             "), and 'dialogue' (a short, witty line of text, under 15 words, for a speech bubble)" + 
                             taskPrompt.slice(closingParenIndex + 1);
            }
        }
        
        const geminiResult = await geminiRequestWithRetry(() => geminiModel.generateContent({ contents: [{ role: "user", parts: [{ text: taskPrompt }] }], safetySettings }));
        const geminiRawOutput = (await geminiResult.response).text();
        const jsonString = geminiRawOutput.substring(geminiRawOutput.indexOf('{'), geminiRawOutput.lastIndexOf('}') + 1).replace(/,\s*([}\]])/g, '$1');
        const parsedResult = JSON.parse(jsonString);

        let { summary, imagePrompt, backgroundPrompt, dialogue } = parsedResult;
        
        if (!postDetails.isBatch) {
            summary = await getApprovedInput(summary, 'summary');
            if (!summary) {
                console.log('[APP-INFO] Job creation cancelled.');
                return { success: false, wasCancelled: true };
            }
        }

        const uniqueImageName = `post-image-${Date.now()}.png`;
        const imagePath = path.join(process.cwd(), uniqueImageName);
        let finalImagePrompt = isVirtualInfluencer ? `${config.prompt.style} ${config.prompt.characterDescription}` : `${config.prompt.style} ${imagePrompt}`;
        
        // Handle speech bubble: interactive for single posts, automatic for batch
        if (!postDetails.isBatch) {
            finalImagePrompt = await promptForSpeechBubble(finalImagePrompt, dialogue || '', isVirtualInfluencer);
            finalImagePrompt = await getApprovedInput(finalImagePrompt, 'image prompt');
            if (!finalImagePrompt) {
                console.log('[APP-INFO] Job creation cancelled.');
                return { success: false, wasCancelled: true };
            }
        } else if (dialogue && dialogue.trim() !== '') {
            // In batch mode, automatically add the speech bubble if dialogue was generated
            console.log(`[APP-INFO] Auto-adding speech bubble with dialogue: "${dialogue}"`);
            finalImagePrompt += `, with a speech bubble that clearly says: "${dialogue}"`;
        }

        console.log(`[APP-INFO] Sending final prompt to image generator... This may take a moment.`);
        debugLog(`Final Image Prompt: ${finalImagePrompt}`);
        const imageRequest = buildImageRequest(finalImagePrompt, config.imageGeneration.size);
        const imageResponse = await openaiRequestWithRetry(() => openai.images.generate(imageRequest));
        console.log(`[APP-DEBUG] Received response from image generator.`);
        fs.writeFileSync(imagePath, Buffer.from(imageResponse.data[0].b64_json, 'base64'));
        console.log(`[APP-SUCCESS] Image created and saved to: ${imagePath}`);

        const newJob = {
            id: uuidv4(),
            status: 'pending',
            createdAt: new Date().toISOString(),
            topic: postDetails.topic,
            summary: summary,
            imagePath: imagePath,
            platforms: postDetails.platforms,
            profile: path.basename(config.prompt.profilePath || 'default'),
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
        const profileData = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
        
        // Assign the loaded profile data to the config
        config.prompt = profileData;
        // Store the path to the loaded profile file for state tracking
        config.prompt.profilePath = profilePath;
        
        fs.writeFileSync('./config.json', JSON.stringify(config, null, 2));
        console.log(`[APP-SUCCESS] Profile "${profileToLoad}" loaded and set as the active configuration.`);

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
    fs.writeFileSync(profilePath, JSON.stringify(newProfile, null, 2));
    console.log(`[APP-SUCCESS] New profile saved to "${profilePath}"`);

    const { loadNow } = await inquirer.prompt([{ type: 'confirm', name: 'loadNow', message: 'Load this new profile now?', default: true }]);
    if (loadNow) {
        // Store the path to the new profile file for state tracking
        newProfile.profilePath = profilePath;
        config.prompt = newProfile;
        fs.writeFileSync('./config.json', JSON.stringify(config, null, 2));
        console.log(`[APP-SUCCESS] Profile "${filename}.json" is now the active configuration.`);
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
        fs.unlinkSync(path.join(PROFILES_DIR, profileToDelete));
        console.log(`[APP-SUCCESS] Profile "${profileToDelete}" has been deleted.`);
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

    const geminiResult = await geminiRequestWithRetry(() => geminiModel.generateContent(plannerPrompt));
    const geminiRawOutput = (await geminiResult.response).text();
    const jsonString = geminiRawOutput.substring(geminiRawOutput.indexOf('{'), geminiRawOutput.lastIndexOf('}') + 1);
    const parsedResult = JSON.parse(jsonString);
    const topics = parsedResult.topics;

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
        // Spawn the worker.js script as a new Node.js process
        // 'inherit' pipes the child's stdio to the parent, so we see its output
        const workerProcess = spawn('node', ['worker.js'], { stdio: 'inherit' });

        workerProcess.on('close', (code) => {
            console.log(`\n[APP-INFO] Worker process finished with exit code ${code}.`);
            // A short delay to allow the user to read the final output
            setTimeout(() => resolve(), 2000); 
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
            'Generate Batch of Posts with AI',
        ];

        if (pendingJobs > 0) {
            choices.push(`Process Job Queue (${pendingJobs} pending)`);
        }

        choices.push(
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
                const answers = await inquirer.prompt([
                    { 
                        type: 'editor', 
                        name: 'topic', 
                        message: 'Enter the topic:', 
                        default: config.search.defaultTopic 
                    },
                    { 
                        type: 'checkbox', 
                        name: 'platforms', 
                        message: 'Queue for which platforms?', 
                        choices: ['X', 'LinkedIn'] 
                    },
                    { 
                        type: 'confirm', 
                        name: 'confirm', 
                        message: (answers) => `Generate post about "${answers.topic}" for ${answers.platforms.join(', ')}?`, 
                        default: true,
                        when: (answers) => answers.topic && answers.platforms.length > 0
                    }
                ]);

                if (answers.confirm) {
                    await generateAndQueuePost({ topic: answers.topic, platforms: answers.platforms });
                } else {
                    console.log('[APP-INFO] Post generation cancelled.');
                }
                break;
            case 'Generate Batch of Posts with AI':
                await runAIBatchGeneration();
                break;
            case `Process Job Queue (${pendingJobs} pending)`:
                await runWorker();
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