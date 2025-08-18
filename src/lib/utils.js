import fs from 'fs';
import path from 'path';
import inquirer from 'inquirer';
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
            const imageB64 = await imageGenerator(currentPrompt, config.imageGeneration);
            return imageB64;
        } catch (error) {
            lastError = error;
            if (error.message && error.message.toLowerCase().includes('safety')) {
                console.warn(`[APP-WARN] Image generation failed due to safety system. Retrying... (${i + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, 2000));
            } else {
                throw error;
            }
        }
    }
    console.error(`[APP-FATAL] Image generation failed after ${maxRetries} attempts.`);
    throw lastError;
}

export async function getPanelApproval(panel, panelIndex, imageGenerator, config, textGenerator, selectedStyle, characterLibrary) {
    let approvedImagePath = null;
    let userAction = '';
    let panelPrompt = '';

    do {
        console.log(`[APP-INFO] Generating panel ${panelIndex + 1} of 4...`);

        if (userAction !== 'Edit') {
            const characterDetails = panel.characters.map(charObj => {
                const libraryData = characterLibrary[charObj.name] || {};
                const description = charObj.description || libraryData.description || `A depiction of ${charObj.name}`;
                return { name: charObj.name, description: description };
            });

            let promptParts = [
                `${selectedStyle.prompt}`,
                `Panel ${panelIndex + 1}: ${panel.panel_description || panel.description}.`
            ];

            characterDetails.forEach(char => {
                promptParts.push(`The character ${char.name} MUST be depicted as: ${char.description}.`);
            });

            if (panel.dialogue && Array.isArray(panel.dialogue) && panel.dialogue.length > 0) {
                const dialogueText = panel.dialogue.map(d => `${d.character} says: "${d.speech}"`).join(' ');
                promptParts.push(`The panel must contain speech bubbles for the following dialogue: ${dialogueText}. The bubbles and text must be clear, fully visible, and not cut off.`);
            }

            panelPrompt = promptParts.join(' ');
        }

        const imageB64 = await generateImageWithRetry(imageGenerator, panelPrompt, config, textGenerator);
        const tempImagePath = path.join(process.cwd(), `temp_panel_for_approval.png`);
        fs.writeFileSync(tempImagePath, Buffer.from(imageB64, 'base64'));
        
        console.log(`[APP-INFO] Panel ${panelIndex + 1} image generated: ${tempImagePath}`);
        
        try {
            await open(tempImagePath);
        } catch (error) {
            console.warn(`[APP-WARN] Could not automatically open the image. Please open it manually: ${tempImagePath}`);
        }

        process.stdin.resume(); // Add this line to fix the focus issue
        const { action } = await inquirer.prompt([
            {
                type: 'list',
                name: 'action',
                message: `Panel ${panelIndex + 1} should have opened for review. What would you like to do?`,
                choices: ['Approve', 'Retry', 'Edit', 'Cancel'],
            },
        ]);
        
        userAction = action;

        if (userAction === 'Approve') {
            approvedImagePath = path.join(process.cwd(), `temp_panel_${panelIndex}.png`);
            fs.renameSync(tempImagePath, approvedImagePath);
            console.log(`[APP-SUCCESS] Panel ${panelIndex + 1} approved: ${approvedImagePath}`);
        } else if (userAction === 'Edit') {
            const { editedPrompt } = await inquirer.prompt([
                {
                    type: 'editor',
                    name: 'editedPrompt',
                    message: 'Edit the prompt for this panel:',
                    default: panelPrompt,
                },
            ]);
            panelPrompt = editedPrompt;
        } else {
            fs.unlinkSync(tempImagePath); // Clean up the rejected image
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

    const characterConsistencyInstruction = `
CRITICAL INSTRUCTION: Before generating the panel details, you must first establish a consistent voice and personality for each character in the story.
1. For well-known public figures: Use your internal knowledge to accurately model their famous speech patterns, cadence, and vocabulary.
2. For all other characters (original or lesser-known): You must invent a distinct and consistent persona for them. Define their speaking style, and then adhere strictly to that definition throughout all four panels to ensure continuity.
This is a mandatory first step. Now, generate the 4-panel comic strip based on the user's topic.
`;
        
    return `${characterConsistencyInstruction}\n\n${taskPrompt}`;
}


export function debugLog(config, message) {
    if (config.debug && config.debug.enabled) {
        console.log(`[APP-DEBUG] ${message}`);
    }
}

export async function getApprovedInput(text, inputType) {
    while (true) {
        const { action } = await inquirer.prompt([
            { type: 'list', name: 'action', message: `Generated ${inputType}:\n\n"${text}"\n\nApprove or edit?`, choices: ['Approve', 'Edit', 'Cancel'] }
        ]);

        if (action === 'Approve') return text;
        if (action === 'Cancel') return null;
        if (action === 'Edit') {
            const { editedText } = await inquirer.prompt([
                {
                    type: 'editor',
                    name: 'editedText',
                    message: `Editing ${inputType}. Save and close your editor to continue.`, 
                    default: text,
                    validate: input => input.trim().length > 0 || `Edited ${inputType} cannot be empty.`, 
                }
            ]);
            return editedText.trim();
        }
    }
}

export async function promptForSpeechBubble(initialPrompt, dialogue, isVirtualInfluencer) {
    const { addSpeechBubble } = await inquirer.prompt([{ type: 'confirm', name: 'addSpeechBubble', message: 'Add a speech bubble?', default: isVirtualInfluencer }]);
    if (!addSpeechBubble) return initialPrompt;
    
    const { speechBubbleText } = await inquirer.prompt([{ 
        type: 'editor',
        name: 'speechBubbleText',
        message: 'Enter speech bubble text:',
        default: dialogue,
        validate: input => input.trim().length > 0 || 'Speech bubble text cannot be empty.'
    }]);
    
    if (isVirtualInfluencer) {
        return `${initialPrompt} The character has a speech bubble that clearly says: "${speechBubbleText}".`;
    } else {
        return `${initialPrompt}, with a speech bubble that clearly says: "${speechBubbleText}".`;
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

        const { selectedStyleName } = await inquirer.prompt([
            {
                type: 'list',
                name: 'selectedStyleName',
                message: 'Choose a graphic style for the image:',
                choices: [...styles.map(s => s.name), new inquirer.Separator(), 'Cancel'],
            },
        ]);

        if (selectedStyleName === 'Cancel') {
            return null;
        }

        return styles.find(s => s.name === selectedStyleName);

    } catch (error) {
        console.error("[APP-ERROR] Could not load or parse graphic_styles.json:", error);
        return null;
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

