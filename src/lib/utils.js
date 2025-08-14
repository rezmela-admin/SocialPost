import fs from 'fs';
import path from 'path';
import inquirer from 'inquirer';
import { GoogleGenerativeAIFetchError } from "@google/generative-ai";
import { jsonrepair } from 'jsonrepair';

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
        
    return taskPrompt;
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

