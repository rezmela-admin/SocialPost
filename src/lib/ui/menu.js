import { editor, checkbox, confirm as confirmPrompt } from '@inquirer/prompts';
import path from 'path';
import fs from 'fs';
import chalk from 'chalk';
import { spawn } from 'child_process';
import { manageCreativeProfiles } from '../profile-manager.js';
import { getPendingJobCount, getAnyJobCount, clearQueue } from '../queue-manager.js';
import { generateAndQueueComicStrip, generateAndQueuePost, generateVirtualInfluencerPost } from '../workflows.js';
import { displayBanner } from './banner.js';
import { buildFrameworksMenu } from './framework-selector.js';

function getLoggedInPlatforms() {
    const loggedIn = [];
    if (fs.existsSync(path.join(process.cwd(), 'x_session.json'))) loggedIn.push('X');
    if (fs.existsSync(path.join(process.cwd(), 'linkedin_session.json'))) loggedIn.push('LinkedIn');
    if (fs.existsSync(path.join(process.cwd(), 'bluesky_credentials.json'))) loggedIn.push('Bluesky');
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

function generatePostMenu(config, imageGenerator) {
    const postDetails = {
        topic: config.search.defaultTopic,
        platforms: [],
        skipSummarization: false
    };

    return () => {
        const menu = {
            title: 'Generate New Post',
            message: 'Configure the post details:',
            choices: [
                {
                    name: `Set Topic (Current: ${postDetails.topic})`,
                    value: 'setTopic',
                    action: async () => {
                        postDetails.topic = await editor({ message: 'Enter the topic:', default: postDetails.topic, validate: input => input.trim().length > 0 });
                    }
                },
                {
                    name: `Select Platforms (Current: ${postDetails.platforms.join(', ') || 'None'})`,
                    value: 'selectPlatforms',
                    action: async () => {
                        postDetails.platforms = await checkbox({ message: 'Queue for which platforms?', choices: [{name: 'X', value: 'X'}, {name: 'LinkedIn', value: 'LinkedIn'}, {name: 'Bluesky', value: 'Bluesky'}], default: postDetails.platforms, validate: i => i.length > 0 });
                    }
                }
            ]
        };

        if (config.prompt.workflow !== 'comicStrip') {
            menu.choices.push({
                name: `Use Topic as Summary (Current: ${postDetails.skipSummarization})`,
                value: 'toggleSkipSummarization',
                action: async () => {
                    postDetails.skipSummarization = await confirmPrompt({ message: 'Use this topic directly as the post summary?', default: postDetails.skipSummarization });
                }
            });
        }

        menu.choices.push({
            name: 'Confirm and Generate Post',
            value: 'generate',
            action: async () => {
                if (!postDetails.topic || postDetails.platforms.length === 0) {
                    console.log(chalk.red('\n[APP-ERROR] Topic and at least one platform must be set before generating.'));
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    return;
                }
                const confirmed = await confirmPrompt({ message: 'Proceed with generating this post?', default: true });
                if (confirmed) {
                    if (config.prompt.workflow === 'comicStrip') {
                        await generateAndQueueComicStrip(postDetails, config, imageGenerator, config.narrativeFrameworkPath);
                    } else if (config.prompt.workflow === 'virtualInfluencer') {
                        await generateVirtualInfluencerPost(postDetails, config, imageGenerator, postDetails.skipSummarization, config.narrativeFrameworkPath);
                    } else {
                        await generateAndQueuePost(postDetails, config, imageGenerator, postDetails.skipSummarization, config.narrativeFrameworkPath);
                    }
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
        const imageFiles = files.filter(f => f.startsWith('post-image-') || f.startsWith('comic-strip-'));
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

export function mainMenu(config, imageGenerator) {
    if (config.displaySettings && config.displaySettings.showBannerOnStartup) {
        displayBanner();
        config.displaySettings.showBannerOnStartup = false; // Only show once
    }

    return () => {
        const activeProfile = config.prompt.profilePath ? path.basename(config.prompt.profilePath, '.json') : '<None Selected>';
        const activeFramework = config.narrativeFrameworkPath ? path.basename(config.narrativeFrameworkPath, '.json') : '<None Selected>';
        const loggedInPlatforms = getLoggedInPlatforms();
        const pendingJobs = getPendingJobCount();
        const anyJobs = getAnyJobCount();
        const hasOrphanedImages = fs.readdirSync(process.cwd()).some(f => f.startsWith('post-image-') || f.startsWith('comic-strip-'));

        console.log(chalk.yellow(`\n--- Status ---`));
        console.log(`- Active Profile:      ${chalk.cyan(activeProfile)}`);
        console.log(`- Narrative Framework: ${chalk.cyan(activeFramework)}`);
        console.log(`- Logged In:           ${chalk.cyan(loggedInPlatforms.length > 0 ? loggedInPlatforms.join(', ') : 'None')}`);
        console.log(`- Pending Jobs:        ${chalk.cyan(pendingJobs)}`);
        console.log(chalk.yellow(`----------------\n`));

        const menu = {
            title: 'Main Menu',
            message: 'What would you like to do?',
            choices: [
                { name: 'Select Narrative Framework', value: 'selectNarrativeFramework', submenu: buildFrameworksMenu(config) },
                { name: 'Generate and Queue a New Post', value: 'generateAndQueueNewPost', submenu: generatePostMenu(config, imageGenerator) },
                { name: 'Manage Creative Profiles', value: 'manageCreativeProfiles', action: () => manageCreativeProfiles(config) },
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