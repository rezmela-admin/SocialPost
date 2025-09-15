import { editor, checkbox, confirm as confirmPrompt, select, input } from '@inquirer/prompts';
import path from 'path';
import fs from 'fs';
import chalk from 'chalk';
import { spawn } from 'child_process';
import { manageCreativeProfiles } from '../profile-manager.js';
import { getPendingJobCount, getAnyJobCount, clearQueue } from '../queue-manager.js';
import { generateAndQueueComicStrip, generateAndQueuePost, generateVirtualInfluencerPost } from '../workflows.js';
import { getAvailableLayouts } from '../comic-composer.js';
import { displayBanner } from './banner.js';
import { buildStylesMenu } from './styles-browser.js';
import { buildCharactersMenu } from './characters-browser.js';
import { buildFrameworksMenu } from './framework-selector.js';
import { editTopic } from './topic-editor.js';
import { getImageGenerator } from '../image-generators/index.js';
import { getTextGenerator } from '../text-generators/index.js';
import { exportVideoFromPanels } from '../video-exporter.js';
import { checkDependencies } from '../utils.js';
import { addJob } from '../queue-manager.js';

function getLoggedInPlatforms() {
    const loggedIn = [];
    // X and LinkedIn use persisted session state files
    if (fs.existsSync(path.join(process.cwd(), 'x_session.json'))) loggedIn.push('X');
    if (fs.existsSync(path.join(process.cwd(), 'linkedin_session.json'))) loggedIn.push('LinkedIn');
    // Bluesky uses env vars in the worker; fall back to credentials file if present
    if (process.env.BLUESKY_HANDLE && process.env.BLUESKY_APP_PASSWORD) {
        loggedIn.push('Bluesky');
    } else if (fs.existsSync(path.join(process.cwd(), 'bluesky_credentials.json'))) {
        loggedIn.push('Bluesky');
    }
    return loggedIn;
}

async function setImageSize(sessionState) {
    const activeProvider = sessionState.imageGeneration.provider;
    const providerCfg = sessionState.imageGeneration.providers[activeProvider] || {};
    const current = providerCfg.size || '<provider default>';

    const choice = await select({
        message: `Choose image size for provider "${activeProvider}" (Current: ${current})`,
        choices: [
            { name: 'Square — 1024x1024', value: '1024x1024' },
            { name: 'Portrait — 1024x1536 (2:3)', value: '1024x1536' },
            { name: 'Landscape — 1536x1024 (3:2)', value: '1536x1024' },
            { name: 'Custom…', value: 'custom' },
            { name: 'Cancel', value: 'cancel' }
        ]
    });

    if (choice === 'cancel') return;

    let finalSize = choice;
    if (choice === 'custom') {
        const custom = await input({
            message: 'Enter size as WIDTHxHEIGHT (e.g., 1536x1024):',
            validate: (v) => /^(\d+)x(\d+)$/.test(v.trim()) || 'Format must be WIDTHxHEIGHT with digits only.'
        });
        finalSize = custom.trim();
    }

    // Apply to active provider only for this session
    sessionState.imageGeneration.providers[activeProvider] = {
        ...providerCfg,
        size: finalSize
    };
    console.log(`[APP-SUCCESS] Image size set to ${finalSize} for provider "${activeProvider}" (session only).`);
}

async function runWorker() {
    console.log(`\n[APP-INFO] Processing scheduled posts...`);
    return new Promise((resolve, reject) => {
        const workerProcess = spawn('node', ['worker.js'], { stdio: 'inherit' });
        workerProcess.on('close', (code) => {
            console.log(`\n[APP-INFO] Finished processing scheduled posts (exit code ${code}).`);
            resolve();
        });
        workerProcess.on('error', (err) => {
            console.error('[APP-ERROR] Failed to start worker process:', err);
            reject(err);
        });
    });
}

function toggleFooterOverlay(sessionState) {
    if (!sessionState.composition) sessionState.composition = {};
    if (!sessionState.composition.footer) {
        sessionState.composition.footer = {
            enabled: false,
            text: 'To be continued…',
            font: 'Arial',
            fontColor: '#FFFFFF',
            fontSize: 28,
            bandColor: '#000000',
            bandOpacity: 0.45,
            position: 'bottom-center',
            margin: 24,
        };
    }
    const current = !!sessionState.composition.footer.enabled;
    sessionState.composition.footer.enabled = !current;
    console.log(`[APP-INFO] Footer overlay is now ${sessionState.composition.footer.enabled ? 'ENABLED' : 'DISABLED'}.`);
}

function generatePostMenu(sessionState, imageGenerator) {
    // This menu is now STATELESS. It reads from and writes to sessionState.draftPost.
    return () => {
        // Always pick the latest image generator if user changed provider
        const currentImageGenerator = sessionState.__imageGenerator || imageGenerator;
        const draft = sessionState.draftPost;
        const topicFirstLine = String(draft.topic || '').split('\n')[0];
        const topicPreview = topicFirstLine.length > 60 ? topicFirstLine.slice(0, 60) + '…' : topicFirstLine;

        const isComicWorkflow = !!(sessionState?.prompt && (sessionState.prompt.workflow === 'comic' || sessionState.prompt.hasOwnProperty('expectedPanelCount')));
        const menu = {
            title: isComicWorkflow ? 'Create New Comic' : 'Create New Cartoon',
            message: 'Configure the details:',
            choices: [
                {
                    name: `Select Platforms (Current: ${draft.platforms.join(', ') || 'None'})`,
                    value: 'selectPlatforms',
                    action: async () => {
                        draft.platforms = await checkbox({ message: 'Queue for which platforms?', choices: [{name: 'X', value: 'X'}, {name: 'LinkedIn', value: 'LinkedIn'}, {name: 'Bluesky', value: 'Bluesky'}], default: draft.platforms, validate: i => i.length > 0 });
                    }
                },
                {
                    name: `Set Topic (Current: ${topicPreview || '<empty>'})`,
                    value: 'setTopic',
                    action: async () => {
                        const newTopic = await editTopic(draft.topic, { startInEditMode: true });
                        if (newTopic) {
                            draft.topic = newTopic;
                        }
                    }
                }
            ]
        };

        const activeProfile = sessionState.prompt;
        const isComic = activeProfile.hasOwnProperty('expectedPanelCount');
        const isWebtoonProfile = !!(activeProfile?.profilePath && /avantgarde-webtoon/i.test(activeProfile.profilePath));

        if (isComic) {
            const expectedPanelCount = activeProfile.expectedPanelCount || 4;
            const availableLayouts = getAvailableLayouts(expectedPanelCount);
            
            if (isWebtoonProfile) {
                // Webtoon mode: no grid layout selection; expose gutter control instead
                if (typeof draft.webtoonGutter !== 'number') {
                    const defaultGutter = Number.isInteger(sessionState?.composition?.webtoonGutterDefault)
                        ? sessionState.composition.webtoonGutterDefault
                        : 120;
                    draft.webtoonGutter = defaultGutter;
                }
                menu.choices.push({
                    name: `Webtoon Gutter (px) (Current: ${draft.webtoonGutter})`,
                    value: 'setWebtoonGutter',
                    action: async () => {
                        const val = await editor({
                            message: 'Enter vertical gutter in pixels (recommend 100–180):',
                            default: String(draft.webtoonGutter),
                            validate: (t) => /^\s*\d+\s*$/.test(t) || 'Enter an integer number of pixels.'
                        });
                        const n = parseInt(String(val).trim(), 10);
                        if (!Number.isNaN(n)) draft.webtoonGutter = n;
                    }
                });
            } else {
                if (!draft.comicLayout && availableLayouts.length > 0) {
                    draft.comicLayout = availableLayouts[0].value;
                }
                menu.choices.push({
                    name: `Select Layout (Current: ${draft.comicLayout || 'None'})`,
                    value: 'selectLayout',
                    action: async () => {
                        if (availableLayouts.length === 0) {
                            console.log(chalk.red(`
[APP-ERROR] No layouts available for a ${expectedPanelCount}-panel comic. Please check your profile.`));
                            await new Promise(resolve => setTimeout(resolve, 2000));
                            return;
                        }
                        draft.comicLayout = await select({
                            message: 'Choose a comic strip layout:',
                            choices: availableLayouts
                        });
                    }
                });
            }
        } else {
            menu.choices.push({
                name: `Use Topic as Caption (Current: ${draft.skipSummarization})`,
                value: 'toggleSkipSummarization',
                action: async () => {
                    draft.skipSummarization = await confirmPrompt({ message: 'Use this topic directly as the caption?', default: draft.skipSummarization });
                }
            });
        }

        menu.choices.push({
            name: 'Create and Schedule',
            value: 'generate',
            action: async () => {
                if (!draft.topic || draft.platforms.length === 0) {
                    console.log(chalk.red(`
[APP-ERROR] Topic and at least one platform must be set before generating.`));
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    return;
                }
                const isWebtoon = !!(sessionState?.prompt?.profilePath && /avantgarde-webtoon/i.test(sessionState.prompt.profilePath));
                if (isComicWorkflow && !isWebtoon && !draft.comicLayout) {
                    console.log(chalk.red(`
[APP-ERROR] A comic strip layout must be selected before generating.`));
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    return;
                }
                const confirmed = await confirmPrompt({ message: 'Proceed with generating this post?', default: true });
                if (confirmed) {
                    if (isComic) {
                        await generateAndQueueComicStrip(sessionState, draft, currentImageGenerator);
                    } else if (sessionState.prompt.workflow === 'virtualInfluencer') {
                        await generateVirtualInfluencerPost(sessionState, draft, currentImageGenerator, draft.skipSummarization);
                    } else {
                        await generateAndQueuePost(sessionState, draft, currentImageGenerator, draft.skipSummarization);
                    }
                    sessionState.draftPost = null; // Clean up draft state
                } else {
                    console.log('[APP-INFO] Post generation cancelled.');
                }
            },
            popAfterAction: true
        });

        return menu;
    };
}

async function clearJobQueueAndCleanupFiles() {
    const confirmed = await confirmPrompt({ message: 'This will delete all pending jobs and unassociated images. Are you sure?', default: false });
    if (confirmed) {
        clearQueue();
        const files = fs.readdirSync(process.cwd());
        const imageFiles = files.filter(f =>
            f.startsWith('post-image-') ||
            f.startsWith('comic-strip-') ||
            f.startsWith('final-comic-')
        );
        let deletedCount = 0;
        for (const file of imageFiles) {
            try {
                fs.unlinkSync(path.join(process.cwd(), file));
                deletedCount++;
            } catch (err) {
                console.warn(`[APP-WARN] Could not delete file: ${file}.`);
            }
        }
        if (deletedCount > 0) console.log(`[APP-SUCCESS] Removed ${deletedCount} old image files.`);
    }
}

export function mainMenu(sessionState, imageGenerator) {
    if (sessionState.displaySettings && sessionState.displaySettings.showBannerOnStartup) {
        displayBanner();
        sessionState.displaySettings.showBannerOnStartup = false; // Only show once
    }

    return () => {
        const activeProfile = sessionState.prompt.profilePath ? path.basename(sessionState.prompt.profilePath, '.json') : '<None Selected>';
        const activeFramework = sessionState.narrativeFrameworkPath ? path.basename(sessionState.narrativeFrameworkPath, '.json') : '<None Selected>';
        const loggedInPlatforms = getLoggedInPlatforms();
        const pendingJobs = getPendingJobCount();
        const anyJobs = getAnyJobCount();
        const hasOrphanedImages = fs.readdirSync(process.cwd()).some(f =>
            f.startsWith('post-image-') || f.startsWith('comic-strip-') || f.startsWith('final-comic-')
        );

        console.log(chalk.yellow(`
--- Status ---
`));
        console.log(`- Comic Format:        ${chalk.cyan(activeProfile)}`);
        const activeProvider = sessionState.imageGeneration?.provider || '<none>';
        const sizeNow = sessionState.imageGeneration?.providers?.[activeProvider]?.size || '<default>'; 
        console.log(`- Image Provider:      ${chalk.cyan(activeProvider)} ${chalk.gray(`(size: ${sizeNow})`)}`);
        const activeTextProvider = sessionState.textGeneration?.provider || '<none>';
        console.log(`- Text Provider:       ${chalk.cyan(activeTextProvider)}`);
        const footerState = !!(sessionState.composition && sessionState.composition.footer && sessionState.composition.footer.enabled);
        console.log(`- Footer Overlay:      ${chalk.cyan(footerState ? 'On' : 'Off')}`);
        const storyPatternStatus = sessionState.narrativeFrameworkPath
            ? `${chalk.cyan(activeFramework)}`
            : `${chalk.cyan('<None>')} ${chalk.gray('(using default)')}`;
        console.log(`- Story Pattern:       ${storyPatternStatus}`);
        console.log(`- Connected Accounts:  ${chalk.cyan(loggedInPlatforms.length > 0 ? loggedInPlatforms.join(', ') : 'None')}`);
        console.log(`- Scheduled Posts:     ${chalk.cyan(pendingJobs)}`);
        console.log(chalk.yellow(`----------------
`));
        if (!sessionState.prompt?.profilePath) {
            console.log(chalk.gray('Tip: Open "Comic Format" to set panels and layout.'));
        }

        const isComicWorkflow = !!(sessionState?.prompt && (sessionState.prompt.workflow === 'comic' || sessionState.prompt.hasOwnProperty('expectedPanelCount')));
        const isWebtoonProfile = !!(sessionState?.prompt?.profilePath && /avantgarde-webtoon/i.test(sessionState.prompt.profilePath));
        const createLabel = isComicWorkflow ? (isWebtoonProfile ? 'Create New Webtoon' : 'Create New Comic') : 'Create New Cartoon';

        const menu = {
            title: 'Main Menu',
            message: 'What would you like to do?',
            choices: [
                { name: 'Comic Format (panels & layout)', value: 'manageCreativeProfiles', action: async () => {
                    const newSessionState = await manageCreativeProfiles(sessionState);
                    Object.assign(sessionState, newSessionState);
                } },
                { name: 'Story Pattern (narrative structure)', value: 'selectNarrativeFramework', submenu: buildFrameworksMenu(sessionState) },
                {
                    name: () => {
                        const active = sessionState.imageGeneration?.provider || '<none>';
                        return `Image Provider (Current: ${active})`;
                    },
                    value: 'setImageProvider',
                    action: async () => {
                        try {
                            const providers = Object.keys(sessionState.imageGeneration?.providers || {});
                            if (providers.length === 0) {
                                console.log(chalk.red('\n[APP-ERROR] No image providers found in config.json.'));
                                await new Promise(r => setTimeout(r, 1500));
                                return;
                            }
                            const choice = await select({
                                message: 'Choose image provider:',
                                choices: providers.map(p => ({ name: p, value: p }))
                            });
                            const prev = sessionState.imageGeneration.provider;
                            // Preflight without mutating state in case it fails
                            const testState = {
                                ...sessionState,
                                imageGeneration: { ...sessionState.imageGeneration, provider: choice }
                            };
                            const newGen = await getImageGenerator(testState);
                            // Commit only after success
                            sessionState.imageGeneration.provider = choice;
                            sessionState.__imageGenerator = newGen;
                            console.log(`[APP-SUCCESS] Image provider set to "${choice}".`);
                        } catch (err) {
                            console.error('[APP-ERROR] Could not set image provider:', err.message || err);
                        }
                    }
                },
                {
                    name: () => {
                        const active = sessionState.textGeneration?.provider || '<none>';
                        return `Text Provider (Current: ${active})`;
                    },
                    value: 'setTextProvider',
                    action: async () => {
                        try {
                            const providers = Object.keys(sessionState.textGeneration?.providers || {});
                            if (providers.length === 0) {
                                console.log(chalk.red('\n[APP-ERROR] No text providers found in config.json.'));
                                await new Promise(r => setTimeout(r, 1500));
                                return;
                            }
                            const choice = await select({
                                message: 'Choose text provider:',
                                choices: providers.map(p => ({ name: p, value: p }))
                            });
                            // Preflight provider to avoid breaking later
                            const testState = {
                                ...sessionState,
                                textGeneration: { ...sessionState.textGeneration, provider: choice }
                            };
                            try {
                                // Attempt to instantiate to validate env/config; ignore returned instance
                                getTextGenerator(testState);
                            } catch (e) {
                                console.error('[APP-ERROR] Selected text provider is not usable now (check API key and model). Keeping previous provider.');
                                await new Promise(r => setTimeout(r, 1500));
                                return;
                            }
                            sessionState.textGeneration.provider = choice;
                            console.log(`[APP-SUCCESS] Text provider set to "${choice}".`);
                        } catch (err) {
                            console.error('[APP-ERROR] Could not set text provider:', err.message || err);
                        }
                    }
                },
                { 
                    name: 'Image Size (resolution)',
                    value: 'setImageSize',
                    action: async () => { await setImageSize(sessionState); }
                },
                {
                    name: () => {
                        const on = !!(sessionState.composition && sessionState.composition.footer && sessionState.composition.footer.enabled);
                        return `Footer Overlay (final image) — ${on ? 'On' : 'Off'}`;
                    },
                    value: 'toggleFooter',
                    action: async () => { toggleFooterOverlay(sessionState); }
                },
                { 
                    name: 'Default Platforms (for new posts)',
                    value: 'setDefaultPlatforms',
                    action: async () => {
                        const loggedIn = getLoggedInPlatforms();
                        const current = Array.isArray(sessionState.defaultPlatforms) && sessionState.defaultPlatforms.length > 0
                            ? sessionState.defaultPlatforms
                            : loggedIn;
                        const selected = await checkbox({
                            message: 'Select default platforms for new posts:',
                            choices: [{name: 'X', value: 'X'}, {name: 'LinkedIn', value: 'LinkedIn'}, {name: 'Bluesky', value: 'Bluesky'}],
                            default: current
                        });
                        sessionState.defaultPlatforms = selected;
                    }
                },
                { 
                    name: createLabel, 
                    value: 'generateAndQueueNewPost', 
                    action: async () => {
                        // Prerequisite: Creative profile (Comic Format)
                        if (!sessionState.prompt?.profilePath) {
                            console.log(chalk.red(`\n[APP-INFO] Please choose "Comic Format" before creating a cartoon or comic.`));
                            await new Promise(resolve => setTimeout(resolve, 1500));
                            return;
                        }
                        // Story Pattern is optional; if not set, we proceed with no template.
                        // Initialize the draft state
                        // If a Story Pattern with an example is selected, preload that example into the editor
                        let initialTopic = sessionState.search.defaultTopic;
                        try {
                            const fwPath = sessionState.narrativeFrameworkPath;
                            if (fwPath && fs.existsSync(fwPath)) {
                                const fw = JSON.parse(fs.readFileSync(fwPath, 'utf8'));
                                if (fw && typeof fw.example === 'string' && fw.example.trim().length > 0) {
                                    initialTopic = fw.example.trim();
                                    console.log('[APP-INFO] Preloaded topic with example from selected Story Pattern.');
                                }
                            }
                        } catch (e) {
                            console.warn('[APP-WARN] Could not read example from selected Story Pattern:', e?.message || e);
                        }
                        sessionState.draftPost = {
                            topic: initialTopic,
                            platforms: (Array.isArray(sessionState.defaultPlatforms) && sessionState.defaultPlatforms.length > 0)
                                ? [...sessionState.defaultPlatforms]
                                : getLoggedInPlatforms(),
                            skipSummarization: false,
                            comicLayout: null
                        };
                        // If no platforms yet, prompt to choose before editing topic
                        if (!sessionState.draftPost.platforms || sessionState.draftPost.platforms.length === 0) {
                            sessionState.draftPost.platforms = await checkbox({ message: 'Queue for which platforms?', choices: [{name: 'X', value: 'X'}, {name: 'LinkedIn', value: 'LinkedIn'}, {name: 'Bluesky', value: 'Bluesky'}], default: [], validate: i => i.length > 0 });
                        }
                        // Now open the topic editor
                        const newTopic = await editTopic(sessionState.draftPost.topic, { startInEditMode: true });
                        if (newTopic) {
                            sessionState.draftPost.topic = newTopic;
                        } else {
                            // User cancelled the editor, so we clear the draft to prevent the submenu from opening.
                            sessionState.draftPost = null; 
                        }
                    },
                    submenu: () => {
                        // Only return the submenu if a draft post exists (i.e., the user didn't cancel the topic editor)
                        if (sessionState.draftPost) {
                            // We no longer need the "Set Topic" option here, as it's been handled.
                            const menu = generatePostMenu(sessionState, imageGenerator)();
                            menu.choices = menu.choices.filter(c => c.value !== 'setTopic');
                            return menu;
                        }
                        return null;
                    } 
                }, 
                { name: 'Graphic Styles (visual treatment)', value: 'browseStyles', submenu: buildStylesMenu() },
                { name: 'Characters (visual blueprints)', value: 'browseCharacters', submenu: buildCharactersMenu() },
                { name: 'Export Video (FFmpeg from panels)', value: 'exportVideo', action: async () => { await exportVideoFlow(); } },
                { name: 'Export Video with Narration (one‑shot)', value: 'exportVideoWithAudio', action: async () => { await makeVideoWithAudioFlow(); } },
                { name: 'Queue Video Post (upload mp4 like image)', value: 'queueVideoPost', action: async () => { await queueVideoPostFlow(sessionState); } },
            ]
        };

        if (pendingJobs > 0) {
            // Insert right after "Create New" to keep it near the top
            const createIdx = menu.choices.findIndex(c => c.value === 'generateAndQueueNewPost');
            const insertAt = createIdx >= 0 ? createIdx + 1 : 3;
            menu.choices.splice(insertAt, 0, { name: `Process Scheduled Posts (${pendingJobs} pending)`, value: 'runWorker', action: runWorker });
        }
        if (anyJobs > 0 || hasOrphanedImages) {
            // Maintenance action: keep at the bottom
            menu.choices.push({ name: 'Clear Scheduled & Delete Draft Images', value: 'clearJobQueueAndCleanupFiles', action: clearJobQueueAndCleanupFiles });
        }

        // Environment diagnostics
        menu.choices.push({ name: 'Check Dependencies (Playwright, FFmpeg)', value: 'checkDeps', action: async () => { await checkDependencies({ quick: false, quiet: false }); } });

        return menu;
    };
}

async function exportVideoFlow() {
    try {
        const outputsRoot = path.join(process.cwd(), 'outputs');
        if (!fs.existsSync(outputsRoot)) {
            console.log(chalk.red('[APP-ERROR] outputs/ folder not found. Generate a comic first.'));
            await new Promise(r => setTimeout(r, 1500));
            return;
        }
        const dirs = fs.readdirSync(outputsRoot, { withFileTypes: true })
            .filter(d => d.isDirectory())
            .map(d => d.name)
            .filter(name => fs.existsSync(path.join(outputsRoot, name, 'metadata.json')) && fs.existsSync(path.join(outputsRoot, name, 'panels')))
            .sort((a, b) => fs.statSync(path.join(outputsRoot, b)).mtimeMs - fs.statSync(path.join(outputsRoot, a)).mtimeMs);

        if (dirs.length === 0) {
            console.log(chalk.red('[APP-INFO] No exportable outputs found in outputs/.'));
            await new Promise(r => setTimeout(r, 1200));
            return;
        }

        const chosenDir = await select({
            message: 'Select an output folder to export as MP4:',
            choices: dirs.map(n => ({ name: n, value: path.join(outputsRoot, n) }))
        });

        // Read metadata for defaults
        let meta = {};
        try { meta = JSON.parse(fs.readFileSync(path.join(chosenDir, 'metadata.json'), 'utf8')); } catch {}
        const metaSize = meta.size || '';
        const defaultSizeLabel = metaSize ? `${metaSize} (from metadata)` : '1080x1920 (default)';

        const sizeChoice = await select({
            message: `Video size (Current: ${defaultSizeLabel})`,
            choices: [
                { name: defaultSizeLabel, value: '' },
                { name: 'Custom…', value: 'custom' }
            ]
        });
        let size = null;
        if (sizeChoice === 'custom') {
            const entered = await input({ message: 'Enter size as WIDTHxHEIGHT (e.g., 1080x1920):', validate: v => /^(\d+)x(\d+)$/.test(v.trim()) || 'Format WIDTHxHEIGHT' });
            size = entered.trim();
        }

        const fpsStr = await input({ message: 'FPS (frames per second):', default: '30', validate: v => /^\d+$/.test(v.trim()) || 'Enter integer' });
        const defaultDur = await input({ message: 'Default seconds per panel:', default: '2.0', validate: v => /^\d+(?:\.\d+)?$/.test(v.trim()) || 'Enter number' });

        // Compute panel list and initial durations (from list.txt if available, else default)
        const panelsDir = path.join(chosenDir, 'panels');
        let panelFilesAbs = [];
        if (Array.isArray(meta.panelFiles) && meta.panelFiles.length) {
            panelFilesAbs = meta.panelFiles.map(p => path.join(chosenDir, String(p).replace(/\\/g, '/')));
        } else {
            panelFilesAbs = fs.readdirSync(panelsDir)
                .filter(f => /panel-\d+\.png$/i.test(f))
                .sort()
                .map(f => path.join(panelsDir, f));
        }
        const panelCount = panelFilesAbs.length;
        const listPath = path.join(panelsDir, 'list.txt');
        const baseDur = parseFloat(String(defaultDur).trim());
        let initialDurations = Array(panelCount).fill(baseDur);
        if (fs.existsSync(listPath)) {
            try {
                const txt = fs.readFileSync(listPath, 'utf8');
                const lines = txt.split(/\r?\n/);
                const m = new Map();
                let last = null;
                for (const line of lines) {
                    const mf = /^\s*file\s+'([^']+)'\s*$/i.exec(line);
                    if (mf) { last = mf[1]; continue; }
                    const md = /^\s*duration\s+([0-9]+(?:\.[0-9]+)?)\s*$/i.exec(line);
                    if (md && last) { m.set(last.replace(/\\/g, '/'), parseFloat(md[1])); last = null; }
                }
                initialDurations = panelFilesAbs.map(p => m.get(path.basename(p)) ?? baseDur);
            } catch {}
        }

        let durationsCSV = null;
        if (panelCount > 0) {
            const wantsEditDurations = await confirmPrompt({ message: `Edit per-panel durations? (${panelCount} panels)`, default: false });
            if (wantsEditDurations) {
                const csvDefault = initialDurations.map(n => n.toFixed(2)).join(',');
                const entered = await input({ message: `Enter ${panelCount} comma-separated durations:`, default: csvDefault });
                durationsCSV = String(entered).trim();
            }
        }

        const transChoice = await select({
            message: 'Default transition (applied where metadata not specific):',
            choices: [
                { name: 'Auto (use metadata where available; fallback fade)', value: 'auto' },
                { name: 'Fade', value: 'fade' },
                { name: 'Fade to Black', value: 'fadeblack' },
                { name: 'Slide Left', value: 'slideleft' },
                { name: 'Wipe Left', value: 'wipeleft' },
                { name: 'None (hard cut)', value: 'none' },
            ]
        });
        const transDur = await input({ message: 'Transition duration (seconds):', default: '0.5', validate: v => /^\d+(?:\.\d+)?$/.test(v.trim()) || 'Enter number' });
        const kbChoice = await select({
            message: 'Ken Burns default (applied where metadata not specific):',
            choices: [
                { name: 'Auto (use metadata where available; fallback none)', value: 'auto' },
                { name: 'None', value: 'none' },
                { name: 'Zoom In', value: 'in' },
                { name: 'Zoom Out', value: 'out' },
            ]
        });
        const zoomTo = await input({ message: 'Zoom-to factor for in/out:', default: '1.06', validate: v => /^\d+(?:\.\d+)?$/.test(v.trim()) || 'Enter number' });

        const opts = {
            inputDir: chosenDir,
            fps: parseInt(fpsStr.trim(), 10),
            defaultDuration: parseFloat(defaultDur.trim()),
            transitionDuration: parseFloat(transDur.trim()),
            zoomTo: parseFloat(zoomTo.trim()),
        };
        if (size) opts.size = size;
        if (transChoice !== 'auto') {
            opts.transition = transChoice;
            opts.__flags = { ...(opts.__flags || {}), transitionProvided: true };
        }
        if (kbChoice !== 'auto') {
            opts.kenburns = kbChoice;
            opts.__flags = { ...(opts.__flags || {}), kenburnsProvided: true };
        }
        if (durationsCSV) {
            opts.durations = durationsCSV;
            opts.__flags = { ...(opts.__flags || {}), durationsProvided: true };
            // Persist edited durations to panels/list.txt for future runs
            try {
                const durationsArr = durationsCSV.split(',').map(s => parseFloat(String(s).trim())).filter(n => Number.isFinite(n));
                while (durationsArr.length < panelCount) durationsArr.push(baseDur);
                durationsArr.length = panelCount;
                const baseNames = panelFilesAbs.map(p => path.basename(p));
                const lines = [];
                for (let i = 0; i < baseNames.length; i++) {
                    lines.push(`file '${baseNames[i]}'`);
                    lines.push(`duration ${durationsArr[i].toFixed(3)}`);
                }
                if (baseNames.length > 0) lines.push(`file '${baseNames[baseNames.length - 1]}'`);
                fs.writeFileSync(listPath, lines.join('\n'), 'utf8');
                console.log(chalk.gray(`[APP-INFO] Saved per-panel durations to ${path.relative(process.cwd(), listPath)}.`));
            } catch (e) {
                console.warn(chalk.yellow('[APP-WARN] Could not save durations to panels/list.txt:', e?.message || e));
            }
        }

        console.log('[APP-INFO] Starting video export...');
        const outPath = await exportVideoFromPanels(opts);
        console.log(chalk.green(`[APP-SUCCESS] Video exported: ${outPath}`));
    } catch (err) {
        console.error(chalk.red('[APP-ERROR] Video export failed:'), err?.message || err);
        await new Promise(r => setTimeout(r, 1500));
    }
}

async function makeVideoWithAudioFlow() {
    try {
        const outputsRoot = path.join(process.cwd(), 'outputs');
        if (!fs.existsSync(outputsRoot)) {
            console.log(chalk.red('[APP-ERROR] outputs/ folder not found. Generate a comic first.'));
            await new Promise(r => setTimeout(r, 1500));
            return;
        }
        const dirs = fs.readdirSync(outputsRoot, { withFileTypes: true })
            .filter(d => d.isDirectory())
            .map(d => d.name)
            .filter(name => fs.existsSync(path.join(outputsRoot, name, 'metadata.json')) && fs.existsSync(path.join(outputsRoot, name, 'panels')))
            .sort((a, b) => fs.statSync(path.join(outputsRoot, b)).mtimeMs - fs.statSync(path.join(outputsRoot, a)).mtimeMs);

        if (dirs.length === 0) {
            console.log(chalk.red('[APP-INFO] No exportable outputs found in outputs/.'));
            await new Promise(r => setTimeout(r, 1200));
            return;
        }

        const chosenDir = await select({
            message: 'Select an output folder to export as MP4 (with narration):',
            choices: dirs.map(n => ({ name: n, value: path.join(outputsRoot, n) }))
        });

        // Read metadata for defaults
        let meta = {};
        try { meta = JSON.parse(fs.readFileSync(path.join(chosenDir, 'metadata.json'), 'utf8')); } catch {}
        const metaSize = meta.size || '';
        const defaultSizeLabel = metaSize ? `${metaSize} (from metadata)` : '1080x1920 (default)';

        const sizeChoice = await select({
            message: `Video size (Current: ${defaultSizeLabel})`,
            choices: [
                { name: defaultSizeLabel, value: '' },
                { name: 'Custom…', value: 'custom' }
            ]
        });
        let size = null;
        if (sizeChoice === 'custom') {
            const entered = await input({ message: 'Enter size as WIDTHxHEIGHT (e.g., 1080x1920):', validate: v => /^(\d+)x(\d+)$/.test(v.trim()) || 'Format WIDTHxHEIGHT' });
            size = entered.trim();
        }

        const fpsStr = await input({ message: 'FPS (frames per second):', default: '30', validate: v => /^\d+$/.test(v.trim()) || 'Enter integer' });
        const defaultDur = await input({ message: 'Default seconds per panel:', default: '2.0', validate: v => /^\d+(?:\.\d+)?$/.test(v.trim()) || 'Enter number' });

        // Compute panel list and initial durations (from list.txt if available, else default)
        const panelsDir = path.join(chosenDir, 'panels');
        let panelFilesAbs = [];
        if (Array.isArray(meta.panelFiles) && meta.panelFiles.length) {
            panelFilesAbs = meta.panelFiles.map(p => path.join(chosenDir, String(p).replace(/\\/g, '/')));
        } else {
            panelFilesAbs = fs.readdirSync(panelsDir)
                .filter(f => /panel-\d+\.png$/i.test(f))
                .sort()
                .map(f => path.join(panelsDir, f));
        }
        const panelCount = panelFilesAbs.length;
        const listPath = path.join(panelsDir, 'list.txt');
        const baseDur = parseFloat(String(defaultDur).trim());
        let initialDurations = Array(panelCount).fill(baseDur);
        if (fs.existsSync(listPath)) {
            try {
                const txt = fs.readFileSync(listPath, 'utf8');
                const lines = txt.split(/\r?\n/);
                const m = new Map();
                let last = null;
                for (const line of lines) {
                    const mf = /^\s*file\s+'([^']+)'\s*$/i.exec(line);
                    if (mf) { last = mf[1]; continue; }
                    const md = /^\s*duration\s+([0-9]+(?:\.[0-9]+)?)\s*$/i.exec(line);
                    if (md && last) { m.set(last.replace(/\\/g, '/'), parseFloat(md[1])); last = null; }
                }
                initialDurations = panelFilesAbs.map(p => m.get(path.basename(p)) ?? baseDur);
            } catch {}
        }

        let durationsCSV = null;
        if (panelCount > 0) {
            const wantsEditDurations = await confirmPrompt({ message: `Edit per-panel durations? (${panelCount} panels)`, default: false });
            if (wantsEditDurations) {
                const csvDefault = initialDurations.map(n => n.toFixed(2)).join(',');
                const entered = await input({ message: `Enter ${panelCount} comma-separated durations:`, default: csvDefault });
                durationsCSV = String(entered).trim();
            }
        }

        const transChoice = await select({
            message: 'Default transition (applied where metadata not specific):',
            choices: [
                { name: 'Auto (use metadata where available; fallback fade)', value: 'auto' },
                { name: 'Fade', value: 'fade' },
                { name: 'Fade to Black', value: 'fadeblack' },
                { name: 'Slide Left', value: 'slideleft' },
                { name: 'Wipe Left', value: 'wipeleft' },
                { name: 'None (hard cut)', value: 'none' },
            ]
        });
        const transDur = await input({ message: 'Transition duration (seconds):', default: '0.5', validate: v => /^\d+(?:\.\d+)?$/.test(v.trim()) || 'Enter number' });
        const kbChoice = await select({
            message: 'Ken Burns default (applied where metadata not specific):',
            choices: [
                { name: 'Auto (use metadata where available; fallback none)', value: 'auto' },
                { name: 'None', value: 'none' },
                { name: 'Zoom In', value: 'in' },
                { name: 'Zoom Out', value: 'out' },
            ]
        });
        const zoomTo = await input({ message: 'Zoom-to factor for in/out:', default: '1.06', validate: v => /^\d+(?:\.\d+)?$/.test(v.trim()) || 'Enter number' });

        // Audio selection
        const defaultAudio = path.join(chosenDir, 'narration.wav');
        const audioExists = fs.existsSync(defaultAudio);
        const audioMode = await select({
            message: 'Narration audio:',
            choices: [
                { name: audioExists ? 'Use narration.wav if present; generate TTS if missing' : 'Generate narration via TTS', value: 'auto' },
                { name: 'Always regenerate narration via TTS', value: 'force' },
                { name: 'Use a custom audio file…', value: 'custom' },
                { name: 'Cancel', value: '__cancel__' },
            ]
        });
        if (audioMode === '__cancel__') return;
        let customAudio = null;
        let voices = '';
        let ttsModel = 'gemini-2.5-pro-preview-tts';
        if (audioMode === 'custom') {
            const entered = await input({ message: 'Enter path to an audio file (wav/mp3/m4a/aac):' });
            const p = path.resolve(process.cwd(), String(entered || '').trim());
            if (!fs.existsSync(p)) {
                console.log(chalk.red('[APP-ERROR] File not found.'));
                await new Promise(r => setTimeout(r, 1200));
                return;
            }
            customAudio = p;
        } else {
            // Ask optional voices/model
            voices = await input({ message: 'TTS voices (CSV) — leave blank for defaults:', default: '' });
            ttsModel = await input({ message: 'TTS model id:', default: 'gemini-2.5-pro-preview-tts' });
        }

        // Build one-shot command
        const args = ['scripts/make-video-with-audio.js', '-i', chosenDir];
        if (size) { args.push('--size', size); }
        if (fpsStr) { args.push('--fps', String(parseInt(fpsStr.trim(), 10))); }
        if (durationsCSV) { args.push('--durations', durationsCSV); }
        else if (defaultDur) { args.push('--duration', String(parseFloat(defaultDur.trim()))); }
        if (transChoice !== 'auto') { args.push('--transition', transChoice); }
        if (transDur) { args.push('--trans-duration', String(parseFloat(transDur.trim()))); }
        if (kbChoice !== 'auto') { args.push('--kenburns', kbChoice); }
        if (zoomTo) { args.push('--zoom-to', String(parseFloat(zoomTo.trim()))); }

        if (audioMode === 'custom' && customAudio) {
            args.push('--narration', customAudio);
        } else {
            if (audioMode === 'force') args.push('--force-tts');
            if (voices && voices.trim()) { args.push('--voices', voices.trim()); }
            if (ttsModel && ttsModel.trim()) { args.push('--model', ttsModel.trim()); }
        }

        console.log('[APP-INFO] Running one‑shot export (video + narration)...');
        await new Promise((resolve, reject) => {
            const child = spawn('node', args, { stdio: 'inherit' });
            child.on('error', reject);
            child.on('exit', (code) => {
                if (code === 0) resolve();
                else reject(new Error(`one-shot exporter exited with code ${code}`));
            });
        });
        console.log(chalk.green('[APP-SUCCESS] One‑shot export complete.'));
    } catch (err) {
        console.error(chalk.red('[APP-ERROR] One‑shot export failed:'), err?.message || err);
        await new Promise(r => setTimeout(r, 1500));
    }
}

async function queueVideoPostFlow(sessionState) {
    try {
        const outputsRoot = path.join(process.cwd(), 'outputs');
        let candidates = [];
        if (fs.existsSync(outputsRoot)) {
            const dirs = fs.readdirSync(outputsRoot, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name);
            for (const d of dirs) {
                const dirPath = path.join(outputsRoot, d);
                const files = fs.readdirSync(dirPath).filter(f => /\.mp4$/i.test(f));
                for (const f of files) candidates.push(path.join(dirPath, f));
            }
        }
        const choices = [
            ...candidates.slice(0, 24).map(p => ({ name: path.relative(process.cwd(), p), value: p })),
            { name: 'Browse… (enter a file path)', value: '__browse__' },
            { name: 'Cancel', value: '__cancel__' },
        ];
        const pick = await select({ message: 'Select a video to post (mp4):', choices });
        if (pick === '__cancel__') return;
        let videoAbs = pick;
        if (pick === '__browse__') {
            const entered = await input({ message: 'Enter path to an .mp4 file:' });
            const p = path.resolve(process.cwd(), String(entered || '').trim());
            if (!fs.existsSync(p) || !/\.mp4$/i.test(p)) {
                console.log(chalk.red('[APP-ERROR] File not found or not an .mp4.'));
                await new Promise(r => setTimeout(r, 1200));
                return;
            }
            videoAbs = p;
        }

        const caption = await editor({ message: 'Enter the caption text for the video post:' });
        const loggedIn = getLoggedInPlatforms();
        const platforms = await checkbox({ message: 'Queue for which platforms?', choices: [{name: 'X', value: 'X'}, {name: 'LinkedIn', value: 'LinkedIn'}, {name: 'Bluesky', value: 'Bluesky'}], default: loggedIn, validate: i => i.length > 0 });

        const rel = path.relative(process.cwd(), videoAbs);
        addJob({
            topic: caption?.slice(0, 100) || path.basename(videoAbs),
            summary: caption || '',
            mediaType: 'video',
            mediaPath: rel,
            platforms,
            profile: sessionState?.prompt?.profilePath ? path.basename(sessionState.prompt.profilePath) : 'default'
        });
        console.log(chalk.green('[APP-SUCCESS] Video job queued. Process Scheduled Posts to upload.'));
    } catch (err) {
        console.error(chalk.red('[APP-ERROR] Could not queue video post:'), err?.message || err);
        await new Promise(r => setTimeout(r, 1200));
    }
}
