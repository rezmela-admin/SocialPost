import fs from 'fs';
import path from 'path';
import { select, editor, confirm as confirmPrompt, Separator } from '@inquirer/prompts';
import { pathToFileURL } from 'url';
import open from 'open';
import { GoogleGenerativeAIFetchError } from "@google/generative-ai";
import { jsonrepair } from 'jsonrepair';
import { spawnSync } from 'child_process';




export async function generateImageWithRetry(imageGenerator, initialPrompt, config, textGenerator, maxRetries = 3) {
    let lastError = null;
    const normalizedRetries = Number.isFinite(maxRetries) ? Math.max(0, Math.floor(maxRetries)) : 0;
    const attemptCount = Math.max(1, normalizedRetries);
    for (let i = 0; i < attemptCount; i++) {
        try {
            let currentPrompt = initialPrompt;
            if (i > 0) {
                console.log(`[APP-INFO] Attempt ${i + 1} of ${attemptCount}. Regenerating a safer prompt...`);
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
                console.warn(`[APP-WARN] Image generation failed due to safety system. Retrying... (${i + 1}/${attemptCount})`);
                await new Promise(resolve => setTimeout(resolve, 2000));
            } else if (error.message && error.message.includes('Could not find image data in Gemini response.')) {
                console.warn(`[APP-WARN] No image data returned. Retrying... (${i + 1}/${attemptCount})`);
            } else {
                throw error;
            }
        }
    }
    console.error(`[APP-FATAL] Image generation failed after ${attemptCount} attempts.`);
    throw lastError;
}

// Shortens a dialogue line non-interactively if it exceeds the allowed word count.
export async function shortenDialogueIfNeeded(textGenerator, text, maxWords = 12, sessionState = null) {
    try {
        const original = (text || '').trim();
        const words = original.split(/\s+/).filter(Boolean);
        const effectiveMax = (sessionState && sessionState.speechBubbles && typeof sessionState.speechBubbles.maxWords === 'number')
            ? sessionState.speechBubbles.maxWords
            : maxWords;
        if (words.length <= effectiveMax) return original;
        const prompt = `Shorten the following dialogue text to at most ${effectiveMax} words, preserving its meaning and tone. Respond with ONLY the shortened text, without quotes or extra commentary. Text: "${original}"`;
        const shortened = await geminiRequestWithRetry(() => textGenerator.generate(prompt));
        const cleaned = (shortened || '').trim().replace(/^"|"$/g, '');
        if (cleaned && cleaned.length > 0) {
            if (sessionState && sessionState.speechBubbles && sessionState.speechBubbles.shortenDebug) {
                const before = words.length;
                const after = cleaned.split(/\s+/).filter(Boolean).length;
                debugLog(sessionState, `Shortened dialogue from ${before} to ${after} words: "${original}" -> "${cleaned}"`);
            }
            return cleaned;
        }
        return original;
    } catch {
        return text; // fail-safe: return original on any error
    }
}

export async function getPostApproval(imagePath, sessionState) {
    // Open the image once for review, then return a decision for the caller to act on.
    try {
        await open(pathToFileURL(imagePath).href);
    } catch (error) {
        console.warn(`[APP-WARN] Could not automatically open the image. Please open it manually: ${imagePath}`);
    }

    process.stdin.resume();
    const action = await select({
        message: 'Image should have opened for review. What would you like to do?',
        choices: [
            { name: 'Approve', value: 'Approve' },
            { name: 'Retry', value: 'Retry' },
            { name: 'Edit Prompt', value: 'Edit' },
            { name: 'Cancel', value: 'Cancel' }
        ]
    });

    if (action === 'Approve') {
        return { decision: 'approve' };
    }
    if (action === 'Retry') {
        return { decision: 'retry' };
    }
    if (action === 'Edit') {
        const editedPrompt = await editor({
            message: 'Edit the prompt for this image:',
            default: sessionState.finalImagePrompt,
        });
        sessionState.finalImagePrompt = editedPrompt;
        return { decision: 'retry', editedPrompt };
    }
    // Cancel
    try { fs.unlinkSync(imagePath); } catch {}
    return { decision: 'cancel' };
}

export async function getPanelApproval(panel, panelIndex, imageGenerator, config, textGenerator, selectedStyle, characterLibrary, totalPanels) {
    let approvedImagePath = null;
    let userAction = '';

    // Helpers
    const sanitizePanelDescription = (desc) => {
        if (!desc) return '';
        // Remove any leading "Panel N:" the model may have added
        const stripped = desc.replace(/^\s*Panel\s*\d+\s*:\s*/i, '').trim();
        return stripped.endsWith('.') ? stripped : `${stripped}.`;
    };
    const normalizeSpeakerName = (name) => {
        if (!name) return '';
        let n = String(name);
        // Strip common titles repeatedly until none remain at start
        const titleRegex = /^(dr\.?|doctor|mr\.?|mrs\.?|ms\.?|mx\.?|prof\.?|professor|mayor|president|governor|senator|rep\.?|representative|minister|chancellor|secretary|capt\.?|captain|gen\.?|general|lt\.?|lieutenant|sgt\.?|sergeant|officer)\s+/i;
        while (titleRegex.test(n)) {
            n = n.replace(titleRegex, '');
        }
        return n
            .toLowerCase()
            .normalize('NFKD').replace(/[\u0300-\u036f]/g, '') // strip accents
            .replace(/[\._:,;\-–—'"`’“”()\[\]{}]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    };

    const conciseGuidance = 'Speech bubbles: use large, bold, high-contrast lettering; keep each bubble concise (ideally under 12 words); if needed, split into up to two short lines; ensure all text is fully visible and not cut off; do not include speaker labels or attributions (e.g., "Name:" or "—Name"); natural mentions of names within the sentence are allowed.';

    // Initialize panelPrompt with the full, composite prompt text.
    let promptParts = [
        `${selectedStyle.prompt}`,
        `Panel ${panelIndex + 1}: ${sanitizePanelDescription(panel.panel_description || panel.description)}`
    ];

    const featureFlag = !!(config?.features && config.features.avantgardePromptMapping);
    const profilePath = config?.prompt?.profilePath || '';
    const isAvantProfile = /avantgarde/i.test(profilePath);
    const hasAvantFields = !!(panel && (panel.shot || panel.framing || panel.crop || panel.tempo || panel.panel_type || panel.sfx || panel.transition));
    const enableAvant = featureFlag || isAvantProfile || hasAvantFields;

    if (enableAvant) {
        const shot = (panel.shot || '').toString().trim().toLowerCase();
        const framing = (panel.framing || '').toString().trim();
        const crop = (panel.crop || '').toString().trim().toLowerCase();
        const tempo = (panel.tempo || '').toString().trim().toLowerCase();
        const panelType = (panel.panel_type || '').toString().trim().toLowerCase();
        const transition = (panel.transition || '').toString().trim().toLowerCase();
        const sfxArr = Array.isArray(panel.sfx) ? panel.sfx.filter(s => typeof s === 'string' && s.trim().length > 0) : [];

        const SHOTS = new Set(['ecu','cu','mcu','ms','ws','ews','birdseye','low-angle','dutch-angle']);
        if (SHOTS.has(shot)) {
            let cameraLine = '';
            if (shot === 'ecu') cameraLine = 'Camera: extreme close-up; 85–100mm macro; very shallow depth of field; fill the frame with a single feature.';
            else if (shot === 'cu') cameraLine = 'Camera: close-up; ~85mm; shallow depth; face dominates the frame.';
            else if (shot === 'mcu') cameraLine = 'Camera: medium close-up; 50–85mm; chest-up composition.';
            else if (shot === 'ms') cameraLine = 'Camera: medium shot; 35–50mm; waist-up; balanced subject/background.';
            else if (shot === 'ws') cameraLine = 'Camera: wide shot; 24–35mm; full body with environmental context.';
            else if (shot === 'ews') cameraLine = 'Camera: extreme wide shot; 18–24mm; small figures in a vast environment.';
            else if (shot === 'birdseye') cameraLine = 'Camera: bird’s-eye view (top-down).';
            else if (shot === 'low-angle') cameraLine = 'Camera: low-angle upward; emphasize scale and dominance.';
            else if (shot === 'dutch-angle') cameraLine = 'Camera: dutch (canted) angle; tilted horizon for unease.';
            if (cameraLine) promptParts.push(cameraLine);
        }

        if (framing) {
            promptParts.push(`Framing: ${framing}.`);
        }

        if (crop) {
            if (crop.includes('9:16')) promptParts.push('Composition: tall 9:16 vertical panel; generous breathing space; guide the eye downwards.');
            else if (crop.includes('21:9')) promptParts.push('Composition: cinematic 21:9 letterboxed panel; keep key subjects within safe center area.');
            else if (crop.includes('1:1') || crop.includes('square')) promptParts.push('Composition: square 1:1; centered or rule-of-thirds subject placement.');
        }

        if (tempo) {
            if (tempo === 'linger') promptParts.push('Tempo: linger on a single moment; minimal motion; sparse background; single beat.');
            else if (tempo === 'beat') promptParts.push('Tempo: one clear beat; strong focal point; uncluttered composition.');
            else if (tempo === 'impact') promptParts.push('Tempo: freeze the impact moment; high contrast; speed lines or motion accents.');
            else if (tempo === 'smash') promptParts.push('Tempo: dynamic smash beat; aggressive diagonals; implied debris/motion blur.');
            else if (tempo === 'transition') promptParts.push('Tempo: transitional panel; eye-path guidance toward next panel.');
        }

        if (panelType) {
            if (panelType === 'splash') promptParts.push('Panel type: splash; dramatic scale; increased rendering detail; near full-bleed feel.');
            else if (panelType === 'micro-reaction') promptParts.push('Panel type: micro-reaction; focus tightly on subtle expression or gesture.');
            else if (panelType === 'establishing') promptParts.push('Panel type: establishing; emphasize environment and spatial context.');
            else if (panelType === 'action-beat') promptParts.push('Panel type: action-beat; a single, readable action with clear silhouette.');
            else if (panelType === 'caption-only') promptParts.push('Panel type: caption-only; no speech bubbles; optional caption box only.');
        }

        if (Array.isArray(sfxArr) && sfxArr.length > 0) {
            const list = sfxArr.slice(0, 4).map(s => `"${s.trim()}"`).join(', ');
            promptParts.push(`Include stylized SFX text near motion/impact: ${list}.`);
        }

        if (transition) {
            promptParts.push(`Visual transition into next panel: ${transition}.`);
        }
    }

    // Build a lookup of dialogue by character for interleaving (normalized keys),
    // with a non-interactive pre-check to shorten long lines.
    const dialogueByCharacter = new Map();
    if (panel.dialogue && Array.isArray(panel.dialogue)) {
        for (const d of panel.dialogue) {
            const key = normalizeSpeakerName(d.character);
            const shortened = await shortenDialogueIfNeeded(textGenerator, d.speech, 12, config);
            if (!dialogueByCharacter.has(key)) dialogueByCharacter.set(key, []);
            dialogueByCharacter.get(key).push(shortened);
        }
    }

    // Add one-time, per-panel bubble guidance if any dialogue exists
    if (dialogueByCharacter.size > 0) {
        promptParts.push(conciseGuidance);
    }

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
            // Describe the character
            promptParts.push(`The character ${characterName} MUST be depicted as: ${finalDescription}.`);

            // Immediately pair any dialogue for this character
            const lines = dialogueByCharacter.get(normalizeSpeakerName(characterName)) || [];
            lines.forEach(line => {
                promptParts.push(`Place a clear speech bubble near ${characterName} containing exactly: "${line}".`);
            });
            // Remove consumed lines so we can handle any leftovers later
            if (lines.length > 0) dialogueByCharacter.delete(normalizeSpeakerName(characterName));
        });
    }

    // If there are dialogue lines for characters not explicitly listed in panel.characters,
    // include them as generic instructions without aggregating unrelated content.
    if (dialogueByCharacter.size > 0) {
        dialogueByCharacter.forEach((lines, normName) => {
            // Try to keep the original name if present in panel.dialogue; otherwise use the normalized as-is
            let displayName = '';
            for (const d of panel.dialogue) {
                if (normalizeSpeakerName(d.character) === normName) { displayName = d.character; break; }
            }
            const characterName = displayName || normName;
            lines.forEach(line => {
                promptParts.push(`Include a speech bubble for ${characterName} containing exactly: "${line}". Place it adjacent to the correct speaker.`);
            });
        });
    }
    
    let panelPrompt = promptParts.join(' ');

    do {
        console.log(`[APP-INFO] Generating panel ${panelIndex + 1} of ${totalPanels}...`);

        let imageB64;
        try {
            const retries = (config?.imageGeneration && typeof config.imageGeneration.maxRetries === 'number')
                ? config.imageGeneration.maxRetries
                : 0;
            imageB64 = await generateImageWithRetry(imageGenerator, panelPrompt, config, textGenerator, retries);
        } catch (error) {
            console.warn(`[APP-WARN] Image generation failed for panel ${panelIndex + 1}. ${error.message || error}`);
            const choice = await select({
                message: `Panel ${panelIndex + 1}: image generation failed. Choose an option:`,
                choices: [
                    { name: 'Retry as-is', value: 'retry' },
                    { name: 'Try safer rewording', value: 'safer' },
                    { name: 'Edit prompt', value: 'edit' },
                    { name: 'Cancel', value: 'cancel' }
                ]
            });
            if (choice === 'cancel') {
                userAction = 'Cancel';
                break;
            }
            if (choice === 'edit') {
                const edited = await editor({ message: 'Edit the full prompt for this panel:', default: panelPrompt });
                if (edited && edited.trim()) panelPrompt = edited.trim();
                userAction = 'Retry';
                continue;
            }
            if (choice === 'safer') {
                try {
                    const regenPrompt = `The previous image prompt was rejected by a safety system or did not return an image. Please rewrite it to be safer but still faithful to this panel. Original prompt: "${panelPrompt}"`;
                    const safer = await geminiRequestWithRetry(() => textGenerator.generate(regenPrompt));
                    if (safer && safer.trim()) panelPrompt = safer.trim();
                } catch {}
                userAction = 'Retry';
                continue;
            }
            // choice === 'retry'
            userAction = 'Retry';
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

    return { imagePath: approvedImagePath, prompt: panelPrompt };
}

// Lightweight environment diagnostics for Playwright and FFmpeg.
export async function checkDependencies(options = {}) {
    const { quick = false, quiet = false } = options;
    const results = {
        playwright: { ok: false, message: '' },
        ffmpeg: { ok: false, message: '' },
    };

    // Playwright check: try to import and launch Chromium headless.
    try {
        const { chromium } = await import('playwright');
        try {
            const browser = await chromium.launch({ headless: true });
            await browser.close();
            results.playwright.ok = true;
            results.playwright.message = 'Playwright ready';
            if (!quiet && !quick) console.log('[CHECK-OK] Playwright: Ready');
        } catch (e) {
            const msg = e?.message || String(e);
            results.playwright.ok = false;
            results.playwright.message = msg;
            if (!quiet) {
                if (msg.includes('Host system is missing dependencies')) {
                    console.warn("[CHECK-WARN] Playwright missing OS dependencies. On Debian/Ubuntu: npx playwright install-deps");
                } else {
                    console.warn('[CHECK-WARN] Playwright launch failed:', msg);
                }
            }
        }
    } catch (e) {
        results.playwright.ok = false;
        results.playwright.message = 'Playwright not installed';
        if (!quiet) console.warn('[CHECK-WARN] Playwright not installed. Install with: npm i -D playwright');
    }

    // FFmpeg check: verify binary is on PATH.
    try {
        const res = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
        if (res.status === 0) {
            results.ffmpeg.ok = true;
            results.ffmpeg.message = 'FFmpeg found';
            if (!quiet && !quick) console.log('[CHECK-OK] FFmpeg: Found');
        } else {
            results.ffmpeg.ok = false;
            results.ffmpeg.message = 'ffmpeg not found in PATH';
            if (!quiet) console.warn('[CHECK-WARN] FFmpeg not found. Install it and ensure ffmpeg is in PATH.');
        }
    } catch (e) {
        results.ffmpeg.ok = false;
        results.ffmpeg.message = 'ffmpeg not found';
        if (!quiet) console.warn('[CHECK-WARN] FFmpeg not found. Install it and ensure ffmpeg is in PATH.');
    }

    if (!quiet && !quick) {
        console.log('[CHECK-INFO] Summary:', {
            playwright: results.playwright.ok ? 'ok' : 'missing',
            ffmpeg: results.ffmpeg.ok ? 'ok' : 'missing',
        });
    }

    return results;
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

    // Decide whether to include multi-panel guidance based on profile.
    const explicitPanelCount = typeof activeProfile.expectedPanelCount === 'number' ? activeProfile.expectedPanelCount : null;
    const panelCountMatch = activeProfile.task.match(/(\w+)-panel comic strip/);
    const panelCountTextFromTask = panelCountMatch ? panelCountMatch[1] : null;

    let guidanceTail;
    if (explicitPanelCount) {
        guidanceTail = `Now, generate the ${explicitPanelCount}-panel comic strip based on the user's topic.`;
    } else if (panelCountTextFromTask) {
        guidanceTail = `Now, generate the ${panelCountTextFromTask}-panel comic strip based on the user's topic.`;
    } else {
        // Single-panel or generic cartoon; avoid multi-panel phrasing.
        guidanceTail = `Now, generate the cartoon based on the user's topic.`;
    }

    const characterConsistencyInstruction = `
CRITICAL INSTRUCTION: Before generating the details, you must first establish a consistent voice and personality for each character in the story.
1. For well-known public figures: Use your internal knowledge to accurately model their famous speech patterns, cadence, and vocabulary.
2. For all other characters (original or lesser-known): You must invent a distinct and consistent persona for them. Define their speaking style, and then adhere strictly to that definition to ensure continuity.
${guidanceTail}
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
    
    const nameRule = ' Do not include speaker labels or attributions (e.g., "Name:" or "—Name") inside the bubble; natural mentions of names within the spoken sentence are allowed. Keep the text concise (ideally under 12 words); if needed, split into up to two short lines.';
    if (isVirtualInfluencer) {
        return `${initialPrompt} A rectangular dialogue box near the character contains the text: "${speechBubbleText}". Use large, bold, high-contrast lettering sized for easy reading on mobile devices. Ensure all text is fully visible and not cut off.${nameRule}`;
    } else {
        return `${initialPrompt}, with a rectangular dialogue box containing the text: "${speechBubbleText}". Use large, bold, high-contrast lettering sized for easy reading on mobile devices. Ensure all text is fully visible and not cut off.${nameRule}`;
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
