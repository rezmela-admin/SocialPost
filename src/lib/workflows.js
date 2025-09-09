import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { confirm as confirmPrompt, editor, select } from '@inquirer/prompts';
import { getTextGenerator } from './text-generators/index.js';
import { addJob } from './queue-manager.js';
import { exportToPdf } from './pdf-exporter.js';
import { composeComicStrip, composeVerticalWebtoon } from './comic-composer.js';
import { applyFooter, applyWatermark } from './image-processor.js';
import { 
    debugLog, 
    buildTaskPrompt, 
    generateAndParseJsonWithRetry, 
    getApprovedInput, 
    generateImageWithRetry, 
    selectGraphicStyle,
    promptForSpeechBubble,
    getPanelApproval,
    getPostApproval
} from './utils.js';

export async function generateAndQueueComicStrip(sessionState, postDetails, imageGenerator) {
    const narrativeFrameworkPath = sessionState.narrativeFrameworkPath;
    debugLog(sessionState, "Entered generateAndQueueComicStrip function.");
    
    const activeProfile = sessionState.prompt;
    if (!activeProfile || !activeProfile.profilePath) {
        console.error("[APP-FATAL] No Comic Format selected. Open 'Comic Format' from the main menu and load a profile.");
        return { success: false };
    }
    
    const textGenerator = getTextGenerator(sessionState);

    try {
        console.log(`\n[APP-INFO] Generating comic strip for topic: "${postDetails.topic}"`);
        const characterLibrary = sessionState.characterLibrary;
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

        const expectedPanelCount = activeProfile.expectedPanelCount || 4;

        let parsedResult;
        let attempts = 0;
        const maxAttempts = 3;
        let isValid = false;

        while (attempts < maxAttempts && !isValid) {
            attempts++;
            try {
                console.log(`\n[APP-INFO] Attempting to generate a valid ${expectedPanelCount}-panel comic from AI (Attempt ${attempts}/${maxAttempts})...`);
                parsedResult = await generateAndParseJsonWithRetry(textGenerator, taskPrompt);
                
                if (parsedResult.panels && parsedResult.panels.length === expectedPanelCount) {
                    isValid = true;
                    console.log(`[APP-SUCCESS] Successfully generated and validated ${parsedResult.panels.length}-panel comic script.`);
                } else {
                    console.warn(`[APP-WARN] AI did not return the expected ${expectedPanelCount} panels. Received ${parsedResult.panels?.length || 0}. Retrying...`);
                }
            } catch (e) {
                console.error(`[APP-ERROR] Attempt ${attempts} failed to get a valid comic strip from the AI.`, e);
            }
        }

        if (!isValid) {
            console.error(`[APP-FATAL] Failed to get a valid ${expectedPanelCount}-panel comic strip from the AI after ${maxAttempts} attempts. Aborting.`);
            return { success: false };
        }

        let { summary, panels } = parsedResult;
        debugLog(sessionState, `Parsed panels from AI: ${JSON.stringify(panels, null, 2)}`);

        const approvedSummary = await getApprovedInput(summary, 'comic strip summary');
        if (!approvedSummary) {
            console.log('[APP-INFO] Job creation cancelled.');
            return { success: false, wasCancelled: true };
        }
        summary = approvedSummary;

        const panelImagePaths = [];
        const panelPromptInfos = [];
        const selectedStyle = await selectGraphicStyle();
        if (!selectedStyle) {
            console.log('[APP-INFO] Style selection cancelled. Returning to main menu.');
            return { success: false, wasCancelled: true };
        }

        for (let i = 0; i < panels.length; i++) {
            const panel = panels[i];
            const panelApproval = await getPanelApproval(panel, i, imageGenerator, sessionState, textGenerator, selectedStyle, characterLibrary, panels.length);

            if (!panelApproval) {
                console.log('[APP-INFO] Comic strip generation cancelled by user.');
                panelImagePaths.forEach(p => { try { fs.unlinkSync(p); } catch {} });
                return { success: false, wasCancelled: true };
            }
            panelImagePaths.push(panelApproval.imagePath);
            panelPromptInfos.push({ index: i + 1, prompt: panelApproval.prompt });
        }

        console.log('[APP-INFO] All panels generated. Composing final comic strip...');
        const activeProvider = sessionState.imageGeneration.provider;
        const providerConfig = sessionState.imageGeneration.providers[activeProvider];
        const [panelWidth, panelHeight] = providerConfig.size.split('x').map(Number);
        const borderSize = sessionState.imageGeneration.comicBorderSize || 10;

        // Prefer vertical stacking for avant-garde webtoon format
        const profilePath = sessionState.prompt?.profilePath || '';
        const isWebtoonProfile = /avantgarde-webtoon/i.test(profilePath);
        const isWebtoonParsed = (parsedResult?.format && String(parsedResult.format).toLowerCase() === 'webtoon');
        const useWebtoonStack = isWebtoonProfile || isWebtoonParsed;

        let finalImagePath;
        let gutterUsed = null;
        if (useWebtoonStack) {
            const userGutter = Number.isInteger(postDetails?.webtoonGutter) ? postDetails.webtoonGutter : null;
            const cfgGutter = Number.isInteger(sessionState?.composition?.webtoonGutterDefault) ? sessionState.composition.webtoonGutterDefault : null;
            const gutter = userGutter ?? (Number.isInteger(parsedResult?.gutter) ? parsedResult.gutter : (cfgGutter ?? 120));
            gutterUsed = gutter;
            finalImagePath = await composeVerticalWebtoon(panelImagePaths, panelWidth, gutter, { r: 255, g: 255, b: 255, alpha: 1 });
        } else {
            finalImagePath = await composeComicStrip(panelImagePaths, postDetails.comicLayout, panelWidth, panelHeight, borderSize);
        }

        // Apply optional footer before watermark to avoid overlap conflicts
        await applyFooter(finalImagePath, sessionState);
        await applyWatermark(finalImagePath, sessionState);

        console.log(`[APP-SUCCESS] Final comic strip saved to: ${finalImagePath}`);

        const keepPanels = !!(sessionState?.debug && sessionState.debug.preserveTemporaryFiles);
        if (keepPanels) {
            try {
                const finalBase = path.basename(finalImagePath);
                const tsMatch = finalBase.match(/final-(?:webtoon|comic)-(\d+)\.png$/);
                const runTs = tsMatch ? tsMatch[1] : String(Date.now());
                const profileBase = path.basename(profilePath || 'profile', '.json');
                const outDir = path.join(process.cwd(), 'outputs', `${profileBase}-${runTs}`);
                const panelsDir = path.join(outDir, 'panels');
                fs.mkdirSync(panelsDir, { recursive: true });

                const movedPanelFiles = [];
                const panelDetails = [];
                for (let i = 0; i < panelImagePaths.length; i++) {
                    const src = panelImagePaths[i];
                    const dst = path.join(panelsDir, `panel-${String(i + 1).padStart(2, '0')}.png`);
                    try { fs.renameSync(src, dst); } catch { fs.copyFileSync(src, dst); fs.unlinkSync(src); }
                    movedPanelFiles.push(path.relative(outDir, dst));
                    const promptInfo = panelPromptInfos[i]?.prompt || null;
                    panelDetails.push({ file: path.relative(outDir, dst), prompt: promptInfo });
                }
                // Copy final into folder for convenience
                const finalCopy = path.join(outDir, 'final.png');
                try { fs.copyFileSync(finalImagePath, finalCopy); } catch {}

                const metadata = {
                    topic: postDetails.topic,
                    summary,
                    profile: profileBase,
                    provider: activeProvider,
                    size: providerConfig.size,
                    layout: useWebtoonStack ? 'webtoon' : (postDetails.comicLayout || ''),
                    gutter: gutterUsed,
                    panelCount: panelImagePaths.length,
                    panelFiles: movedPanelFiles,
                    panelDetails,
                    scriptFormat: parsedResult?.format || null
                };
                fs.writeFileSync(path.join(outDir, 'metadata.json'), JSON.stringify(metadata, null, 2));
                console.log(`[APP-INFO] Kept panels and metadata in: ${outDir}`);
            } catch (e) {
                console.warn('[APP-WARN] Failed to archive panels/metadata:', e?.message || e);
            }
        } else {
            panelImagePaths.forEach(p => { try { fs.unlinkSync(p); } catch {} });
            console.log('[APP-INFO] Cleaned up temporary panel images.');
        }

        const exportAsPdf = await confirmPrompt({ message: 'Export this comic as a PDF?', default: false });
        if (exportAsPdf) {
            const pdfPath = finalImagePath.replace('.png', '.pdf');
            await exportToPdf(finalImagePath, pdfPath);
        }

        addJob({
            topic: postDetails.topic,
            summary: summary,
            imagePath: path.basename(finalImagePath),
            platforms: postDetails.platforms,
            profile: path.basename(sessionState.prompt.profilePath || 'default'),
        });
        return { success: true };

    } catch (error) {
        console.error("[APP-FATAL] An error occurred during comic strip generation:", error);
        return { success: false };
    }
}

export async function generateAndQueuePost(sessionState, postDetails, imageGenerator, skipSummarization = false) {
    const narrativeFrameworkPath = sessionState.narrativeFrameworkPath;
    const textGenerator = getTextGenerator(sessionState);
    try {
        console.log(`\n[APP-INFO] Generating content for topic: "${postDetails.topic}"`);
        const activeProfileName = sessionState.prompt.profilePath ? path.basename(sessionState.prompt.profilePath) : null;

        let summary;
        let parsedResult = {};

        const activeProfile = sessionState.prompt;
        if (!activeProfile || !activeProfile.profilePath) {
            console.error("[APP-FATAL] No Comic Format selected. Open 'Comic Format' from the main menu and load a profile.");
            return { success: false };
        }
        
        const promptTopic = skipSummarization ? `Return a JSON object with an imagePrompt and a short, engaging dialogue for a social media post about "${postDetails.topic}". The summary will be the topic itself.` : postDetails.topic;

        const taskPrompt = buildTaskPrompt({
            activeProfile,
            narrativeFrameworkPath,
            topic: promptTopic
        });

        try {
            parsedResult = await generateAndParseJsonWithRetry(textGenerator, taskPrompt);
        } catch (e) {
            console.error("[APP-ERROR] Failed to get a valid response from the AI after multiple attempts.", e);
            parsedResult = { summary: 'Error: Could not parse AI response', imagePrompt: 'A confused robot looking at a computer screen with an error message.' };
        }

        if (skipSummarization) {
            summary = postDetails.topic;
        } else {
            summary = parsedResult.summary || postDetails.topic;
            if (!postDetails.isBatch) {
                summary = await getApprovedInput(summary, 'summary') || summary;
            }
        }

        const selectedStyle = await selectGraphicStyle();
        if (!selectedStyle) return { success: false, wasCancelled: true };

        let { imagePrompt, dialogue } = parsedResult;

        const baseImagePromptText = (typeof imagePrompt === 'string' && imagePrompt.trim().length > 0)
            ? imagePrompt
            : summary;

        let finalImagePrompt = `${selectedStyle.prompt} ${baseImagePromptText}`;

        // Non-interactive pre-check: auto-shorten overly long dialogue
        if (dialogue && typeof dialogue === 'string') {
            try {
                const tg = getTextGenerator(sessionState);
                const { shortenDialogueIfNeeded } = await import('./utils.js');
                dialogue = await shortenDialogueIfNeeded(tg, dialogue, 12, sessionState);
            } catch {}
        }

        if (!postDetails.isBatch && dialogue) {
            finalImagePrompt = await promptForSpeechBubble(finalImagePrompt, dialogue || '', false);
        } else if (dialogue && dialogue.trim() !== '') {
            finalImagePrompt += `, with a speech bubble that clearly says: "${dialogue}" using large, bold, high-contrast lettering sized for easy reading on mobile devices; keep the text concise (ideally under 12 words); ensure all text is fully visible and not cut off; do not include speaker labels or attributions (e.g., "Name:" or "—Name") inside the bubble; natural mentions of names within the spoken sentence are allowed`;
        }

        if (!postDetails.isBatch) {
            finalImagePrompt = await getApprovedInput(finalImagePrompt, 'image prompt') || finalImagePrompt;
        }
        
        sessionState.finalImagePrompt = finalImagePrompt;

        // Approval-driven generation loop: regenerate on Retry/Edit
        let currentPrompt = finalImagePrompt;
        let imagePath;
        while (true) {
            console.log(`[APP-INFO] Sending final prompt to image generator...\n`);
            debugLog(sessionState, `Final Image Prompt: ${currentPrompt}`);

            const retries = (sessionState?.imageGeneration && typeof sessionState.imageGeneration.maxRetries === 'number')
                ? sessionState.imageGeneration.maxRetries
                : 0;
            let imageB64;
            try {
                imageB64 = await generateImageWithRetry(imageGenerator, currentPrompt, sessionState, textGenerator, retries);
            } catch (error) {
                console.warn(`[APP-WARN] Image generation failed: ${error.message || error}`);
                const choice = await select({
                    message: 'Image generation failed. Choose an option:',
                    choices: [
                        { name: 'Retry as-is', value: 'retry' },
                        { name: 'Try safer rewording', value: 'safer' },
                        { name: 'Edit prompt', value: 'edit' },
                        { name: 'Cancel', value: 'cancel' },
                    ],
                });

                if (choice === 'cancel') {
                    console.log('[APP-INFO] Post generation cancelled by user.');
                    return { success: false, wasCancelled: true };
                }
                if (choice === 'edit') {
                    const edited = await editor({ message: 'Edit the final image prompt:', default: currentPrompt });
                    if (edited && edited.trim()) {
                        currentPrompt = edited.trim();
                        sessionState.finalImagePrompt = currentPrompt;
                    }
                    continue; // retry loop
                }
                if (choice === 'safer') {
                    try {
                        const regenPrompt = `The previous cartoon prompt was rejected by a safety system or did not return an image. Please rewrite it to be safer and still relevant. Original prompt: "${currentPrompt}"`;
                        const safer = await (await import('./utils.js')).geminiRequestWithRetry(() => textGenerator.generate(regenPrompt));
                        if (safer && safer.trim()) {
                            currentPrompt = safer.trim();
                            sessionState.finalImagePrompt = currentPrompt;
                        }
                    } catch {}
                    continue; // retry loop
                }
                // choice === 'retry' -> fall through and continue
                continue;
            }
            const uniqueImageName = `post-image-${Date.now()}.png`;
            imagePath = path.join(process.cwd(), uniqueImageName);
            fs.writeFileSync(imagePath, Buffer.from(imageB64, 'base64'));

            const approval = await getPostApproval(imagePath, sessionState);
            if (approval?.decision === 'approve') {
                break;
            }
            if (approval?.decision === 'cancel') {
                console.log('[APP-INFO] Post generation cancelled by user.');
                return { success: false, wasCancelled: true };
            }
            // retry path: optionally with edited prompt
            try { fs.unlinkSync(imagePath); } catch {}
            if (approval?.editedPrompt && approval.editedPrompt.trim()) {
                currentPrompt = approval.editedPrompt.trim();
                sessionState.finalImagePrompt = currentPrompt;
            }
        }

        // Apply optional footer before watermark
        await applyFooter(imagePath, sessionState);
        await applyWatermark(imagePath, sessionState);

        console.log(`[APP-SUCCESS] Image created and saved to: ${imagePath}`);

        const exportAsPdf = await confirmPrompt({ message: 'Export this image as a PDF?', default: false });
        if (exportAsPdf) {
            const pdfPath = imagePath.replace('.png', '.pdf');
            await exportToPdf(imagePath, pdfPath);
        }

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

export async function generateVirtualInfluencerPost(sessionState, postDetails, imageGenerator, skipSummarization = false) {
    const narrativeFrameworkPath = sessionState.narrativeFrameworkPath;
    const textGenerator = getTextGenerator(sessionState);
    try {
        console.log(`\n[APP-INFO] Starting Two-Phase Virtual Influencer post for topic: "${postDetails.topic}"`);
        const activeProfileName = sessionState.prompt.profilePath ? path.basename(sessionState.prompt.profilePath) : 'virtual_influencer';

        let summary, dialogue, backgroundPrompt, parsedResult = {};

        if (!skipSummarization) {
            const activeProfile = sessionState.prompt;
            if (!activeProfile || !activeProfile.profilePath) {
                console.error("[APP-FATAL] No Comic Format selected. Open 'Comic Format' from the main menu and load a profile.");
                return { success: false };
            }
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
        // Non-interactive pre-check: auto-shorten overly long dialogue after approval
        try {
            const tg = getTextGenerator(sessionState);
            const { shortenDialogueIfNeeded } = await import('./utils.js');
            dialogue = await shortenDialogueIfNeeded(tg, dialogue, 12, sessionState);
        } catch {}
        backgroundPrompt = await getApprovedInput(backgroundPrompt, 'background prompt') || backgroundPrompt;

        const framingChoices = [...(sessionState.framingOptions || []), 'Custom...'].map(c => ({name: c, value: c}));
        const selectedFraming = await select({ message: 'Choose framing:', choices: framingChoices });
        const framingChoice = selectedFraming === 'Custom...' ? await editor({ message: 'Enter custom framing:' }) : selectedFraming;

        const selectedStyle = await selectGraphicStyle();
        if (!selectedStyle) return { success: false, wasCancelled: true };

        console.log('[APP-INFO] Phase 1: Generating character...');
        const characterPrompt = `${selectedStyle.prompt} ${sessionState.prompt.characterDescription.replace(/{TOPIC}/g, postDetails.topic)}. ${framingChoice} ...with a speech bubble saying: "${dialogue}". Keep the text concise (ideally under 12 words). Do not include speaker labels or attributions (e.g., "Name:" or "—Name") inside the bubble; natural mentions of names within the spoken sentence are allowed. The background should be a solid, neutral light grey.`;
        const tempCharacterPath = path.join(process.cwd(), `temp_character_${Date.now()}.png`);
        const retries = (sessionState?.imageGeneration && typeof sessionState.imageGeneration.maxRetries === 'number')
            ? sessionState.imageGeneration.maxRetries
            : 0;
        const charImageB64 = await generateImageWithRetry(imageGenerator, characterPrompt, sessionState, textGenerator, retries);
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
