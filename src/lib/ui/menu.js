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
                    name: `Set Topic (Current: ${draft.topic})`,
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
                        sessionState.draftPost = {
                            topic: sessionState.search.defaultTopic,
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

        return menu;
    };
}
