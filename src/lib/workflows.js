import fs from 'fs';
import path from 'path';
import { select, editor, confirm as confirmPrompt } from '@inquirer/prompts';
import { execSync } from 'child_process';
import sharp from 'sharp';
import { getTextGenerator } from './text-generators/index.js';
import { getApprovedInput, geminiRequestWithRetry, selectGraphicStyle, debugLog, promptForSpeechBubble, buildTaskPrompt, sanitizeAndParseJson, getPanelApproval, generateImageWithRetry, generateAndParseJsonWithRetry } from './utils.js';
import { addJob } from './queue-manager.js';

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
        try {
            parsedResult = await generateAndParseJsonWithRetry(textGenerator, taskPrompt);
            console.log('[APP-SUCCESS] Successfully generated and sanitized comic panels from AI.');
        } catch (e) {
            console.error(`[APP-FATAL] Failed to get a valid comic strip from the AI after multiple attempts. Aborting.`, e);
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
            const panel = panels[i];
            const approvedPanelPath = await getPanelApproval(panel, i, imageGenerator, config, textGenerator, selectedStyle, characterLibrary);

            if (!approvedPanelPath) {
                console.log('[APP-INFO] Comic strip generation cancelled by user.');
                // Clean up any previously approved panels
                panelImagePaths.forEach(p => fs.unlinkSync(p));
                return { success: false, wasCancelled: true };
            }
            panelImagePaths.push(approvedPanelPath);
        }

        console.log('[APP-INFO] All panels generated. Composing final comic strip...');
        const finalImagePath = path.join(process.cwd(), `comic-strip-${Date.now()}.png`);
        const activeProvider = config.imageGeneration.provider;
        const providerConfig = config.imageGeneration.providers[activeProvider];
        const [width, height] = providerConfig.size.split('x').map(Number);
        const borderSize = config.imageGeneration.comicBorderSize || 10; // Default to 10px if not set

        const numPanels = panelImagePaths.length;
        const cols = numPanels > 1 ? 2 : 1;
        const rows = Math.ceil(numPanels / cols);

        const finalWidth = (width * cols) + (borderSize * (cols + 1));
        const finalHeight = (height * rows) + (borderSize * (rows + 1));

        const compositeOptions = panelImagePaths.map((panelPath, i) => {
            const row = Math.floor(i / cols);
            const col = i % cols;
            return {
                input: panelPath,
                top: (row * height) + ((row + 1) * borderSize),
                left: (col * width) + ((col + 1) * borderSize)
            };
        });

        await sharp({
            create: {
                width: finalWidth,
                height: finalHeight,
                channels: 4,
                background: { r: 255, g: 255, b: 255, alpha: 1 }
            }
        })
        .composite(compositeOptions)
        .png()
        .toFile(finalImagePath);

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
            try {
                parsedResult = await generateAndParseJsonWithRetry(textGenerator, taskPrompt);
            } catch (e) {
                console.error("[APP-ERROR] Failed to get a valid response from the AI after multiple attempts.", e);
                parsedResult = { summary: 'Error: Could not parse AI response', imagePrompt: 'A confused robot looking at a computer screen with an error message.' };
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
            try {
                parsedResult = await generateAndParseJsonWithRetry(textGenerator, taskPrompt);
                ({ summary, dialogue, backgroundPrompt } = parsedResult);
            } catch (e) {
                console.error("[APP-ERROR] Failed to get a valid response from the AI after multiple attempts.", e);
                return { success: false };
            }
        } else {
            summary = postDetails.topic;
            dialogue = await editor({ message: 'Enter the dialogue for the speech bubble:', validate: input => input.trim().length > 0 });
            backgroundPrompt = await editor({ message: 'Enter the prompt for the background image:', validate: input => input.trim().length > 0 });
        }

        summary = await getApprovedInput(summary, 'summary') || summary;
        dialogue = await getApprovedInput(dialogue, 'dialogue') || dialogue;
        backgroundPrompt = await getApprovedInput(backgroundPrompt, 'background prompt') || backgroundPrompt;

        const framingChoices = [...(config.framingOptions || []), 'Custom...'].map(c => ({name: c, value: c}));
        const selectedFraming = await select({ message: 'Choose framing:', choices: framingChoices });
        const framingChoice = selectedFraming === 'Custom...' ? await editor({ message: 'Enter custom framing:' }) : selectedFraming;

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
