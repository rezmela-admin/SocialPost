import fs from 'fs';
import path from 'path';
import { select, editor, confirm as confirmPrompt, Separator } from '@inquirer/prompts';
import { pathToFileURL } from 'url';
import open from 'open';
import { GoogleGenerativeAIFetchError } from "@google/generative-ai";
import { jsonrepair } from 'jsonrepair';




export async function generateImageWithRetry(imageGenerator, initialPrompt, config, textGenerator, maxRetries = 3) {
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
            // Pass the entire session config to the provider
            const imageB64 = await imageGenerator(currentPrompt, config);
            return imageB64;
        } catch (error) {
            lastError = error;
            if (error.message && error.message.toLowerCase().includes('safety')) {
                console.warn(`[APP-WARN] Image generation failed due to safety system. Retrying... (${i + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, 2000));
            } else if (error.message && error.message.includes('Could not find image data in Gemini response.')) {
                console.warn(`[APP-WARN] Image generation failed as no image data was returned from Gemini. Retrying... (${i + 1}/${maxRetries})`);
            } else {
                throw error;
            }
        }
    }
    console.error(`[APP-FATAL] Image generation failed after ${maxRetries} attempts.`);
    throw lastError;
}

export async function getPanelApproval(panel, panelIndex, imageGenerator, config, textGenerator, selectedStyle, characterLibrary, totalPanels) {
    let approvedImagePath = null;
    let userAction = '';

    // Initialize panelPrompt with the full, composite prompt text.
    let promptParts = [
        `${selectedStyle.prompt}`,
        `Panel ${panelIndex + 1}: ${panel.panel_description || panel.description}.`
    ];

    if (panel.characters && Array.isArray(panel.characters)) {
        panel.characters.forEach(charObj => {
            const characterName = charObj.name;
            let finalDescription;
            if (characterLibrary[characterName]) {
                finalDescription = characterLibrary[characterName];
            } else {
                finalDescription = charObj.description || `A character named ${characterName}.`;
                console.warn(`[APP-WARN] Character "${characterName}" not found in library, using AI description.`);
            }
            promptParts.push(`The character ${characterName} MUST be depicted as: ${finalDescription}.`);
        });
    }

    if (panel.dialogue && Array.isArray(panel.dialogue) && panel.dialogue.length > 0) {
        const dialogueText = panel.dialogue.map(d => `${d.character} says: '${d.speech}'`).join('; ');
        promptParts.push(`The panel must contain rectangular dialogue boxes. IMPORTANT: These boxes MUST NOT have tails or pointers; their position near the speaker is the only indicator of who is talking. ${dialogueText}. The text must be clear, fully visible, and not cut off.`);
    }
    
    let panelPrompt = promptParts.join(' ');

    do {
        console.log(`[APP-INFO] Generating panel ${panelIndex + 1} of ${totalPanels}...`);

        let imageB64;
        try {
            imageB64 = await generateImageWithRetry(imageGenerator, panelPrompt, config, textGenerator);
        } catch (error) {
            console.error(`[APP-ERROR] Image generation failed for panel ${panelIndex + 1}. Error: ${error.message}`);
            userAction = 'Retry'; // Force a retry
            continue;
        }
        const tempImagePath = path.join(process.cwd(), `temp_panel_for_approval_${Date.now()}.png`);
        fs.writeFileSync(tempImagePath, Buffer.from(imageB64, 'base64'));
        
        console.log(`[APP-INFO] Panel ${panelIndex + 1} image generated: ${tempImagePath}`);
        
        try {
            await open(pathToFileURL(tempImagePath).href);
        } catch (error) {
            console.warn(`[APP-WARN] Could not automatically open the image. Please open it manually: ${tempImagePath}`);
        }

        process.stdin.resume();
        const action = await select({
            message: `Panel ${panelIndex + 1} should have opened for review. What would you like to do?`,
            choices: [
                { name: 'Approve', value: 'Approve' },
                { name: 'Retry', value: 'Retry' },
                { name: 'Edit', value: 'Edit' },
                { name: 'Cancel', value: 'Cancel' }
            ]
        });
        
        userAction = action;

        if (userAction === 'Approve') {
            approvedImagePath = path.join(process.cwd(), `temp_panel_${panelIndex}.png`);
            fs.renameSync(tempImagePath, approvedImagePath);
            console.log(`[APP-SUCCESS] Panel ${panelIndex + 1} approved: ${approvedImagePath}`);
        } else if (userAction === 'Edit') {
            const editedPrompt = await editor({
                message: 'Edit the full prompt for this panel:',
                default: panelPrompt, // Pass the full prompt to the editor
            });
            panelPrompt = editedPrompt; // Update the prompt with the user's edits
        } else {
            fs.unlinkSync(tempImagePath);
        }

    } while (userAction === 'Retry' || userAction === 'Edit');

    if (userAction === 'Cancel') {
        return null;
    }

    return approvedImagePath;
}

export function buildTaskPrompt({ activeProfile, narrativeFrameworkPath, topic }) {
    let taskPrompt = activeProfile.task.replace('{TOPIC}', topic);

    if (narrativeFrameworkPath) {
        try {
            const framework = JSON.parse(fs.readFileSync(narrativeFrameworkPath, 'utf8'));
            if (framework.template) {
                taskPrompt = `${framework.template}\n\n${taskPrompt}`;
            }
        } catch (error) {
            console.error(`[APP-WARN] Could not read or parse framework file: ${narrativeFrameworkPath}`, error);
        }
    }

    // Extract panel count from the task description.
    const panelCountMatch = activeProfile.task.match(/(\w+)-panel comic strip/);
    const panelCountText = panelCountMatch ? panelCountMatch[1] : 'four'; // Default to four if not found

    const characterConsistencyInstruction = `
CRITICAL INSTRUCTION: Before generating the panel details, you must first establish a consistent voice and personality for each character in the story.
1. For well-known public figures: Use your internal knowledge to accurately model their famous speech patterns, cadence, and vocabulary.
2. For all other characters (original or lesser-known): You must invent a distinct and consistent persona for them. Define their speaking style, and then adhere strictly to that definition to ensure continuity across all panels.
This is a mandatory first step. Now, generate the ${panelCountText}-panel comic strip based on the user's topic.
`;
        
    return `${characterConsistencyInstruction}\n\n${taskPrompt}`;
}


export function debugLog(config, message) {
    if (config.debug && config.debug.enabled) {
        console.log(`[APP-DEBUG] ${message}`);
    }
}

export async function getApprovedInput(text, inputType) {
    let currentText = text;
    while (true) {
        const action = await select({
            message: `Generated ${inputType}:\n\n"${currentText}"\n\nApprove or edit?`,
            choices: [
                { name: 'Approve', value: 'Approve' },
                { name: 'Edit', value: 'Edit' },
                { name: 'Cancel', value: 'Cancel' }
            ]
        });

        if (action === 'Approve') return currentText;
        if (action === 'Cancel') return null;
        if (action === 'Edit') {
            const editedText = await editor({
                message: `Editing ${inputType}. Save and close your editor to continue.`, 
                default: currentText,
                validate: input => input.trim().length > 0 || `Edited ${inputType} cannot be empty.`,
            });
            currentText = editedText.trim();
        }
    }
}

export async function promptForSpeechBubble(initialPrompt, dialogue, isVirtualInfluencer) {
    const addSpeechBubble = await confirmPrompt({ message: 'Add a speech bubble?', default: isVirtualInfluencer });
    if (!addSpeechBubble) return initialPrompt;
    
    const speechBubbleText = await editor({
        message: 'Enter speech bubble text:',
        default: dialogue,
        validate: input => input.trim().length > 0 || 'Speech bubble text cannot be empty.'
    });
    
    if (isVirtualInfluencer) {
        return `${initialPrompt} A rectangular dialogue box near the character contains the text: "${speechBubbleText}".`;
    } else {
        return `${initialPrompt}, with a rectangular dialogue box containing the text: "${speechBubbleText}".`;
    }
}

export async function apiRequestWithRetry(apiCall, shouldRetry, maxRetries, delay, apiName) {
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

export async function geminiRequestWithRetry(apiCall) {
    return apiRequestWithRetry(apiCall, (e) => e instanceof GoogleGenerativeAIFetchError, 4, 10000, 'Gemini');
}

export async function selectGraphicStyle() {
    try {
        const stylesData = fs.readFileSync('./graphic_styles.json', 'utf8');
        const styles = JSON.parse(stylesData);

        const choices = [
            ...styles.map(s => ({ name: s.name, value: s.name })),
            new Separator(),
            { name: 'Cancel', value: 'Cancel' }
        ];

        const selectedStyleName = await select({
            message: 'Choose a graphic style for the image:',
            choices: choices,
        });

        if (selectedStyleName === 'Cancel') {
            return null;
        }

        return styles.find(s => s.name === selectedStyleName);

    } catch (error) {
        console.error("[APP-ERROR] Could not load or parse graphic_styles.json:", error);
        return null; // Return an empty object on failure
    }
}

export function sanitizeAndParseJson(rawOutput) {
    // Use a regular expression to find the JSON block, which is more robust.
    const jsonRegex = /```json\s*([\s\S]*?)\s*```/;
    const match = rawOutput.match(jsonRegex);

    if (!match || !match[1]) {
        // Fallback for cases where the AI might not use markdown
        try {
            const repaired = jsonrepair(rawOutput);
            return JSON.parse(repaired);
        } catch (e) {
            throw new Error("No valid JSON markdown block found and could not repair the raw output.");
        }
    }

    // Extract the JSON string.
    let jsonString = match[1].trim();

    try {
        const repaired = jsonrepair(jsonString);
        return JSON.parse(repaired);
    } catch (e) {
        // If parsing still fails, log the sanitized string for debugging.
        debugLog({ debug: { enabled: true } }, `Repaired JSON that failed to parse:
${jsonString}`);
        // Re-throw the original error to be caught by the calling function.
        throw e;
    }
}

export async function generateAndParseJsonWithRetry(textGenerator, prompt, maxRetries = 3) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            const geminiRawOutput = await geminiRequestWithRetry(() => textGenerator.generate(prompt));
            const parsedResult = sanitizeAndParseJson(geminiRawOutput);
            // If parsing is successful, return the result immediately.
            return parsedResult;
        } catch (error) {
            console.warn(`[APP-WARN] Failed to parse JSON on attempt ${i + 1}/${maxRetries}. Retrying...`);
            // If this was the last attempt, re-throw the error.
            if (i + 1 === maxRetries) {
                console.error(`[APP-FATAL] Failed to get a valid JSON response from the AI after ${maxRetries} attempts.`);
                throw error;
            }
        }
    }
}

export async function loadCharacterLibrary() {
    try {
        const libraryData = fs.readFileSync('./character_library.json', 'utf8');
        return JSON.parse(libraryData);
    } catch (error) {
        console.error("[APP-ERROR] Could not load or parse character_library.json:", error);
        return {}; // Return an empty object on failure
    }
}
