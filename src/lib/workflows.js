import fs from 'fs';
import path from 'path';
import inquirer from 'inquirer';
import { execSync } from 'child_process';
import sharp from 'sharp';
import { getTextGenerator } from './text-generators/index.js';
import { getApprovedInput, geminiRequestWithRetry, selectGraphicStyle, debugLog, promptForSpeechBubble, buildTaskPrompt, sanitizeAndParseJson } from './utils.js';
import { addJob } from './queue-manager.js';

async function generateImageWithRetry(imageGenerator, initialPrompt, config, textGenerator, maxRetries = 3) {
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

export async function generateAndQueueComicStrip(postDetails, config, imageGenerator, narrativeFrameworkPath) {
    debugLog(config, "Entered generateAndQueueComicStrip function.");
    const activeProfilePath = config.prompt.profilePath;
    if (!activeProfilePath || !fs.existsSync(activeProfilePath)) {
        console.error("[APP-FATAL] The active profile path is not set or the file does not exist. Please load a profile.");
        return { success: false };
    }
    const activeProfile = JSON.parse(fs.readFileSync(activeProfilePath, 'utf8'));
    const textGenerator = getTextGenerator(config);

    try {
        console.log(`\n[APP-INFO] Generating 4-panel comic strip for topic: "${postDetails.topic}"`);
        const characterLibrary = JSON.parse(fs.readFileSync('./character_library.json', 'utf8'));
        const hasCharacterLibrary = !!(characterLibrary && Object.keys(characterLibrary).length > 0);

        let taskPrompt = buildTaskPrompt({
            activeProfile,
            narrativeFrameworkPath,
            topic: postDetails.topic
        });

        if (hasCharacterLibrary) {
            const characterKeys = Object.keys(characterLibrary).map(key => `"${key}"`).join(', ');
            taskPrompt = taskPrompt.replace('{CHARACTER_KEYS}', characterKeys);
        }

        let parsedResult;
        let geminiRawOutput; // Declare here to be available in the catch block
        try {
            console.log(`[APP-INFO] Attempting to generate valid comic panels...`);
            debugLog(config, `Gemini Comic Strip Prompt:
${taskPrompt}`);
            geminiRawOutput = await geminiRequestWithRetry(() => textGenerator.generate(taskPrompt));
            parsedResult = sanitizeAndParseJson(geminiRawOutput);
            console.log('[APP-SUCCESS] Successfully generated and sanitized comic panels from AI.');
        } catch (e) {
            console.error(`[APP-FATAL] Failed to get a valid comic strip from the AI. Aborting.`, e);
            // Log the problematic output for debugging
            if (geminiRawOutput) {
                debugLog(config, `Problematic AI Output:
${geminiRawOutput}`);
            }
            return { success: false };
        }

        let { summary, panels } = parsedResult;
        debugLog(config, `Parsed panels from AI: ${JSON.stringify(panels, null, 2)}`);

        const approvedSummary = await getApprovedInput(summary, 'comic strip summary');
        if (!approvedSummary) {
            console.log('[APP-INFO] Job creation cancelled.');
            return { success: false, wasCancelled: true };
        }
        summary = approvedSummary;

        const panelImagePaths = [];
        const selectedStyle = await selectGraphicStyle();
        if (!selectedStyle) {
            console.log('[APP-INFO] Style selection cancelled. Returning to main menu.');
            return { success: false, wasCancelled: true };
        }

        for (let i = 0; i < panels.length; i++) {
            console.log(`[APP-INFO] Generating panel ${i + 1} of 4...`);
            const panel = panels[i];

            const characterDetails = panel.characters.map(charObj => {
                // The AI now provides a description directly in the panel data.
                // We prioritize that, but can fall back to the library if needed.
                const libraryData = characterLibrary[charObj.name] || {};
                const description = charObj.description || libraryData.description || `A depiction of ${charObj.name}`;
                return { name: charObj.name, description: description };
            });

            debugLog(config, `Panel ${i + 1} character details: ${JSON.stringify(characterDetails, null, 2)}`);

            let promptParts = [
                `${selectedStyle.prompt}`,
                `Panel ${i + 1}: ${panel.panel_description || panel.description}.`
            ];

            characterDetails.forEach(char => {
                promptParts.push(`The character ${char.name} MUST be depicted as: ${char.description}.`);
            });

            if (panel.dialogue && Array.isArray(panel.dialogue) && panel.dialogue.length > 0) {
                const dialogueText = panel.dialogue.map(d => `${d.character} says: "${d.speech}"`).join(' ');
                promptParts.push(`The panel must contain speech bubbles for the following dialogue: ${dialogueText}. The bubbles and text must be clear, fully visible, and not cut off.`);
            }

            let panelPrompt = promptParts.join(' ');

            const imageB64 = await generateImageWithRetry(imageGenerator, panelPrompt, config, textGenerator);
            const tempImagePath = path.join(process.cwd(), `temp_panel_${i}.png`);
            fs.writeFileSync(tempImagePath, Buffer.from(imageB64, 'base64'));
            panelImagePaths.push(tempImagePath);
            console.log(`[APP-SUCCESS] Panel ${i + 1} created: ${tempImagePath}`);
        }

        console.log('[APP-INFO] All panels generated. Composing final comic strip...');
        const finalImagePath = path.join(process.cwd(), `comic-strip-${Date.now()}.png`);
        const [width, height] = config.imageGeneration.size.split('x').map(Number);
        const borderSize = config.imageGeneration.comicBorderSize || 10; // Default to 10px if not set

        const finalWidth = (width * 2) + (borderSize * 3);
        const finalHeight = (height * 2) + (borderSize * 3);

        await sharp({
            create: {
                width: finalWidth,
                height: finalHeight,
                channels: 4,
                background: { r: 255, g: 255, b: 255, alpha: 1 }
            }
        }).composite([
            { input: panelImagePaths[0], top: borderSize, left: borderSize },
            { input: panelImagePaths[1], top: borderSize, left: width + (borderSize * 2) },
            { input: panelImagePaths[2], top: height + (borderSize * 2), left: borderSize },
            { input: panelImagePaths[3], top: height + (borderSize * 2), left: width + (borderSize * 2) }
        ]).png().toFile(finalImagePath);

        console.log(`[APP-SUCCESS] Final comic strip saved to: ${finalImagePath}`);
        panelImagePaths.forEach(p => fs.unlinkSync(p));
        console.log('[APP-INFO] Cleaned up temporary panel images.');

        addJob({
            topic: postDetails.topic,
            summary: summary,
            imagePath: path.basename(finalImagePath),
            platforms: postDetails.platforms,
            profile: path.basename(config.prompt.profilePath || 'default'),
        });
        return { success: true };

    } catch (error) {
        console.error("[APP-FATAL] An error occurred during comic strip generation:", error);
        return { success: false };
    }
}

export async function generateAndQueuePost(postDetails, config, imageGenerator, skipSummarization = false, narrativeFrameworkPath) {
    const textGenerator = getTextGenerator(config);
    try {
        console.log(`\n[APP-INFO] Generating content for topic: "${postDetails.topic}"`);
        const activeProfileName = config.prompt.profilePath ? path.basename(config.prompt.profilePath) : null;

        let summary, finalImagePrompt, parsedResult = {};

        if (!skipSummarization) {
            const activeProfile = JSON.parse(fs.readFileSync(config.prompt.profilePath, 'utf8'));
            const taskPrompt = buildTaskPrompt({
                activeProfile,
                narrativeFrameworkPath,
                topic: postDetails.topic
            });
            const geminiRawOutput = await geminiRequestWithRetry(() => textGenerator.generate(taskPrompt));
            if (geminiRawOutput) {
                try {
                    parsedResult = sanitizeAndParseJson(geminiRawOutput);
                } catch (e) {
                    console.error("[APP-ERROR] Failed to parse JSON from Gemini response.", e);
                    parsedResult = { summary: 'Error: Could not parse AI response', imagePrompt: 'A confused robot looking at a computer screen with an error message.' };
                }
            }
        }

        summary = parsedResult.summary || postDetails.topic;
        if (!postDetails.isBatch && !skipSummarization) {
            summary = await getApprovedInput(summary, 'summary') || summary;
        }

        const selectedStyle = await selectGraphicStyle();
        if (!selectedStyle) return { success: false, wasCancelled: true };

        const { imagePrompt, dialogue } = parsedResult;
        finalImagePrompt = `${selectedStyle.prompt} ${imagePrompt || summary}`;

        if (!postDetails.isBatch && dialogue) {
            finalImagePrompt = await promptForSpeechBubble(finalImagePrompt, dialogue || '', false);
        } else if (dialogue && dialogue.trim() !== '') {
            finalImagePrompt += `, with a speech bubble that clearly says: "${dialogue}"`;
        }

        if (!postDetails.isBatch) {
            finalImagePrompt = await getApprovedInput(finalImagePrompt, 'image prompt') || finalImagePrompt;
        }

        console.log(`[APP-INFO] Sending final prompt to image generator...`);
        debugLog(config, `Final Image Prompt: ${finalImagePrompt}`);
        
        const imageB64 = await generateImageWithRetry(imageGenerator, finalImagePrompt, config, textGenerator);
        const uniqueImageName = `post-image-${Date.now()}.png`;
        const imagePath = path.join(process.cwd(), uniqueImageName);
        fs.writeFileSync(imagePath, Buffer.from(imageB64, 'base64'));
        console.log(`[APP-SUCCESS] Image created and saved to: ${imagePath}`);

        addJob({
            topic: postDetails.topic,
            summary: summary,
            imagePath: path.basename(imagePath),
            platforms: postDetails.platforms,
            profile: activeProfileName || 'default',
        });
        return { success: true };

    } catch (error) {
        console.error("[APP-FATAL] An error occurred during content generation:", error);
        return { success: false };
    }
}

export async function generateVirtualInfluencerPost(postDetails, config, imageGenerator, skipSummarization = false, narrativeFrameworkPath) {
     const textGenerator = getTextGenerator(config);
    try {
        console.log(`\n[APP-INFO] Starting Two-Phase Virtual Influencer post for topic: "${postDetails.topic}"`);
        const activeProfileName = config.prompt.profilePath ? path.basename(config.prompt.profilePath) : 'virtual_influencer';

        let summary, dialogue, backgroundPrompt, parsedResult = {};

        if (!skipSummarization) {
            const activeProfile = JSON.parse(fs.readFileSync(config.prompt.profilePath, 'utf8'));
            const taskPrompt = buildTaskPrompt({
                activeProfile,
                narrativeFrameworkPath,
                topic: postDetails.topic
            });
            const geminiRawOutput = await geminiRequestWithRetry(() => textGenerator.generate(taskPrompt));
            try {
                parsedResult = sanitizeAndParseJson(geminiRawOutput);
                ({ summary, dialogue, backgroundPrompt } = parsedResult);
            } catch (e) {
                console.error("[APP-ERROR] Failed to parse JSON from Gemini response.", e);
                return { success: false };
            }
        } else {
            summary = postDetails.topic;
            const { approvedDialogue, approvedBackground } = await inquirer.prompt([
                { type: 'editor', name: 'approvedDialogue', message: 'Enter the dialogue for the speech bubble:', validate: input => input.trim().length > 0 },
                { type: 'editor', name: 'approvedBackground', message: 'Enter the prompt for the background image:', validate: input => input.trim().length > 0 }
            ]);
            dialogue = approvedDialogue;
            backgroundPrompt = approvedBackground;
        }

        summary = await getApprovedInput(summary, 'summary') || summary;
        dialogue = await getApprovedInput(dialogue, 'dialogue') || dialogue;
        backgroundPrompt = await getApprovedInput(backgroundPrompt, 'background prompt') || backgroundPrompt;

        const { selectedFraming } = await inquirer.prompt([{ type: 'list', name: 'selectedFraming', message: 'Choose framing:', choices: [...(config.framingOptions || []), 'Custom...'] }]);
        const framingChoice = selectedFraming === 'Custom...' ? (await inquirer.prompt([{ type: 'editor', name: 'custom', message: 'Enter custom framing:' }])).custom : selectedFraming;

        const selectedStyle = await selectGraphicStyle();
        if (!selectedStyle) return { success: false, wasCancelled: true };

        console.log('[APP-INFO] Phase 1: Generating character...');
        const characterPrompt = `${selectedStyle.prompt} ${config.prompt.characterDescription.replace(/{TOPIC}/g, postDetails.topic)}. ${framingChoice} ...with a speech bubble saying: "${dialogue}". The background should be a solid, neutral light grey.`;
        const tempCharacterPath = path.join(process.cwd(), `temp_character_${Date.now()}.png`);
        const charImageB64 = await generateImageWithRetry(imageGenerator, characterPrompt, config, textGenerator);
        fs.writeFileSync(tempCharacterPath, Buffer.from(charImageB64, 'base64'));
        console.log(`[APP-SUCCESS] Phase 1 complete: ${tempCharacterPath}`);

        console.log('[APP-INFO] Phase 2: Inpainting background...');
        const finalImagePath = path.join(process.cwd(), `post-image-${Date.now()}.png`);
        const editPrompt = `Take the person and their speech bubble from the foreground and place them into a new background: ${backgroundPrompt}`;
        try {
            execSync(`python edit_image.py "${tempCharacterPath}" "${finalImagePath}" "${editPrompt}"`, { stdio: 'inherit' });
            console.log(`[APP-SUCCESS] Phase 2 complete: ${finalImagePath}`);
        } catch (error) {
            console.error("[APP-FATAL] Python inpainting script failed.", error);
            return { success: false };
        }

        fs.unlinkSync(tempCharacterPath);
        console.log(`[APP-INFO] Cleaned up temporary file.`);

        addJob({
            topic: postDetails.topic,
            summary: summary,
            imagePath: path.basename(finalImagePath),
            platforms: postDetails.platforms,
            profile: activeProfileName,
        });
        return { success: true };

    } catch (error) {
        console.error("[APP-FATAL] An error occurred during Virtual Influencer content generation:", error);
        return { success: false };
    }
}
