import { editor, checkbox, confirm as confirmPrompt, select } from '@inquirer/prompts';
import path from 'path';
import fs from 'fs';
import chalk from 'chalk';
import { spawn } from 'child_process';
import { manageCreativeProfiles } from '../profile-manager.js';
import { getPendingJobCount, getAnyJobCount, clearQueue } from '../queue-manager.js';
import { generateAndQueueComicStrip, generateAndQueuePost, generateVirtualInfluencerPost } from '../workflows.js';
import { getAvailableLayouts } from '../comic-composer.js';
import { displayBanner } from './banner.js';
import { buildFrameworksMenu } from './framework-selector.js';
import { editTopic } from './topic-editor.js';

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

async function runWorker() {
    console.log(`\n[APP-INFO] Starting the worker process...`);
    return new Promise((resolve, reject) => {
        const workerProcess = spawn('node', ['worker.js'], { stdio: 'inherit' });
        workerProcess.on('close', (code) => {
            console.log(`\n[APP-INFO] Worker process finished with exit code ${code}.`);
            resolve();
        });
        workerProcess.on('error', (err) => {
            console.error('[APP-ERROR] Failed to start worker process:', err);
            reject(err);
        });
    });
}

function generatePostMenu(sessionState, imageGenerator) {
    // This menu is now STATELESS. It reads from and writes to sessionState.draftPost.
    return () => {
        const draft = sessionState.draftPost;

        const menu = {
            title: 'Generate New Post',
            message: 'Configure the post details:',
            choices: [
                {
                    name: `Set Topic (Current: ${draft.topic})`,
                    value: 'setTopic',
                    action: async () => {
                        const newTopic = await editTopic(draft.topic, { startInEditMode: true });
                        if (newTopic) {
                            draft.topic = newTopic;
                        }
                    }
                },
                {
                    name: `Select Platforms (Current: ${draft.platforms.join(', ') || 'None'})`,
                    value: 'selectPlatforms',
                    action: async () => {
                        draft.platforms = await checkbox({ message: 'Queue for which platforms?', choices: [{name: 'X', value: 'X'}, {name: 'LinkedIn', value: 'LinkedIn'}, {name: 'Bluesky', value: 'Bluesky'}], default: draft.platforms, validate: i => i.length > 0 });
                    }
                }
            ]
        };

        const activeProfile = sessionState.prompt;
        const isComicWorkflow = activeProfile.hasOwnProperty('expectedPanelCount');

        if (isComicWorkflow) {
            const expectedPanelCount = activeProfile.expectedPanelCount || 4;
            const availableLayouts = getAvailableLayouts(expectedPanelCount);
            
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
        } else {
            menu.choices.push({
                name: `Use Topic as Summary (Current: ${draft.skipSummarization})`,
                value: 'toggleSkipSummarization',
                action: async () => {
                    draft.skipSummarization = await confirmPrompt({ message: 'Use this topic directly as the post summary?', default: draft.skipSummarization });
                }
            });
        }

        menu.choices.push({
            name: 'Confirm and Generate Post',
            value: 'generate',
            action: async () => {
                if (!draft.topic || draft.platforms.length === 0) {
                    console.log(chalk.red(`
[APP-ERROR] Topic and at least one platform must be set before generating.`));
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    return;
                }
                if (isComicWorkflow && !draft.comicLayout) {
                    console.log(chalk.red(`
[APP-ERROR] A comic strip layout must be selected before generating.`));
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    return;
                }
                const confirmed = await confirmPrompt({ message: 'Proceed with generating this post?', default: true });
                if (confirmed) {
                    if (isComicWorkflow) {
                        await generateAndQueueComicStrip(sessionState, draft, imageGenerator);
                    } else if (sessionState.prompt.workflow === 'virtualInfluencer') {
                        await generateVirtualInfluencerPost(sessionState, draft, imageGenerator, draft.skipSummarization);
                    } else {
                        await generateAndQueuePost(sessionState, draft, imageGenerator, draft.skipSummarization);
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
        console.log(`- Active Profile:      ${chalk.cyan(activeProfile)}`);
        console.log(`- Narrative Framework: ${chalk.cyan(activeFramework)}`);
        console.log(`- Logged In:           ${chalk.cyan(loggedInPlatforms.length > 0 ? loggedInPlatforms.join(', ') : 'None')}`);
        console.log(`- Pending Jobs:        ${chalk.cyan(pendingJobs)}`);
        console.log(chalk.yellow(`----------------
`));

        const menu = {
            title: 'Main Menu',
            message: 'What would you like to do?',
            choices: [
                { name: 'Select Narrative Framework', value: 'selectNarrativeFramework', submenu: buildFrameworksMenu(sessionState) },
                { 
                    name: 'Generate and Queue a New Post', 
                    value: 'generateAndQueueNewPost', 
                    action: async () => {
                        // Initialize the draft state
                        sessionState.draftPost = {
                            topic: sessionState.search.defaultTopic,
                            platforms: [],
                            skipSummarization: false,
                            comicLayout: null
                        };
                        // Immediately open the editor
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
                { name: 'Manage Creative Profiles', value: 'manageCreativeProfiles', action: async () => {
                    const newSessionState = await manageCreativeProfiles(sessionState);
                    Object.assign(sessionState, newSessionState);
                } },
            ]
        };

        if (pendingJobs > 0) {
            menu.choices.splice(2, 0, { name: `Process Job Queue (${pendingJobs} pending)`, value: 'runWorker', action: runWorker });
        }
        if (anyJobs > 0 || hasOrphanedImages) {
            menu.choices.splice(pendingJobs > 0 ? 4 : 3, 0, { name: 'Clear Job Queue & Cleanup Files', value: 'clearJobQueueAndCleanupFiles', action: clearJobQueueAndCleanupFiles });
        }

        return menu;
    };
}
