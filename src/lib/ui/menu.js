import inquirer from 'inquirer';
import path from 'path';
import fs from 'fs';
import chalk from 'chalk';
import { spawn } from 'child_process';
import { manageCreativeProfiles } from '../profile-manager.js';
import { getPendingJobCount, getAnyJobCount, clearQueue } from '../queue-manager.js';
import { generateAndQueueComicStrip, generateAndQueuePost, generateVirtualInfluencerPost } from '../workflows.js';
import { displayBanner } from './banner.js';
import { selectNarrativeFramework } from './framework-selector.js';

function getLoggedInPlatforms() {
    const loggedIn = [];
    if (fs.existsSync(path.join(process.cwd(), 'x_session.json'))) loggedIn.push('X');
    if (fs.existsSync(path.join(process.cwd(), 'linkedin_session.json'))) loggedIn.push('LinkedIn');
    if (fs.existsSync(path.join(process.cwd(), 'bluesky_credentials.json'))) loggedIn.push('Bluesky');
    return loggedIn;
}

async function runWorker() {
    console.log('\n[APP-INFO] Starting the worker process...');
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

export async function mainMenu(config, imageGenerator) {
    if (config.displaySettings && config.displaySettings.showBannerOnStartup) {
        displayBanner();
    }

    let keepGoing = true;
    while (keepGoing) {
        const activeProfile = config.prompt.profilePath ? path.basename(config.prompt.profilePath, '.json') : '<None Selected>';
        const activeFramework = config.narrativeFrameworkPath ? path.basename(config.narrativeFrameworkPath, '.json') : '<None Selected>';
        const loggedInPlatforms = getLoggedInPlatforms();
        const pendingJobs = getPendingJobCount();
        const anyJobs = getAnyJobCount();
        const hasOrphanedImages = fs.readdirSync(process.cwd()).some(f => f.startsWith('post-image-') || f.startsWith('comic-strip-'));

        console.log(chalk.yellow('\n--- Status ---'));
        console.log(`- Active Profile:      ${chalk.cyan(activeProfile)}`);
        console.log(`- Narrative Framework: ${chalk.cyan(activeFramework)}`);
        console.log(`- Logged In:           ${chalk.cyan(loggedInPlatforms.length > 0 ? loggedInPlatforms.join(', ') : 'None')}`);
        console.log(`- Pending Jobs:        ${chalk.cyan(pendingJobs)}`);
        console.log(chalk.yellow('----------------\n'));

        const message = `What would you like to do?`;
        const choices = [
            'Select Narrative Framework',
            'Generate and Queue a New Post',
            'Manage Creative Profiles',
            new inquirer.Separator(),
            'Quit'
        ];

        if (pendingJobs > 0) {
            choices.splice(2, 0, `Process Job Queue (${pendingJobs} pending)`);
        }
        if (anyJobs > 0 || hasOrphanedImages) {
            choices.splice(pendingJobs > 0 ? 4 : 3, 0, 'Clear Job Queue & Cleanup Files');
        }

        const { action } = await inquirer.prompt([{ type: 'list', name: 'action', message: message, choices: choices }]);

        switch (action) {
            case 'Generate and Queue a New Post':
                const workflow = config.prompt.workflow || 'standard';
                let answers;
                
                if (workflow === 'comicStrip') {
                    // 1. Ask for the topic
                    const topicAnswer = await inquirer.prompt([
                        { type: 'editor', name: 'topic', message: 'Enter the topic for the 4-panel comic strip:', default: config.search.defaultTopic, validate: input => input.trim().length > 0 }
                    ]);

                    // 2. Ask for the platforms
                    const platformAnswers = await inquirer.prompt([
                        { type: 'checkbox', name: 'platforms', message: 'Queue for which platforms?', choices: ['X', 'LinkedIn', 'Bluesky'], validate: i => i.length > 0 }
                    ]);

                    // 3. Ask for confirmation
                    const { confirm } = await inquirer.prompt([{ type: 'confirm', name: 'confirm', message: 'Proceed with generating this comic strip?', default: true }]);
                    
                    if (confirm) {
                        // Combine answers and call the workflow function, using the framework from config
                        const postDetails = { ...topicAnswer, ...platformAnswers };
                        await generateAndQueueComicStrip(postDetails, config, imageGenerator, config.narrativeFrameworkPath);
                    } else {
                        console.log('[APP-INFO] Comic strip generation cancelled.');
                    }
                } else { // Handles 'standard', 'virtualInfluencer', and 'multiCharacterScene'
                    answers = await inquirer.prompt([
                        { type: 'editor', name: 'topic', message: 'Enter the topic:', default: config.search.defaultTopic, validate: input => input.trim().length > 0 },
                        { type: 'confirm', name: 'skipSummarization', message: 'Use this topic directly as the post summary?', default: false },
                    ]);

                    // The narrative framework is already selected and in config, so we don't ask here. 
                    
                    const remainingAnswers = await inquirer.prompt([
                        { type: 'checkbox', name: 'platforms', message: 'Queue for which platforms?', choices: ['X', 'LinkedIn', 'Bluesky'], validate: i => i.length > 0 },
                        { type: 'confirm', name: 'confirm', message: 'Generate post?', default: true }
                    ]);

                    if (remainingAnswers.confirm) {
                        const postDetails = { topic: answers.topic, platforms: remainingAnswers.platforms };
                        if (workflow === 'virtualInfluencer') {
                            await generateVirtualInfluencerPost(postDetails, config, imageGenerator, answers.skipSummarization, config.narrativeFrameworkPath);
                        } else {
                            await generateAndQueuePost(postDetails, config, imageGenerator, answers.skipSummarization, config.narrativeFrameworkPath);
                        }
                    } else {
                        console.log('[APP-INFO] Post generation cancelled.');
                    }
                }
                break;
            case `Process Job Queue (${pendingJobs} pending)`:
                await runWorker();
                break;
            case 'Clear Job Queue & Cleanup Files':
                const { confirm } = await inquirer.prompt([{ type: 'confirm', name: 'confirm', message: 'This will delete all pending jobs and unassociated images. Are you sure?', default: false }]);
                if (confirm) {
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
                break;
            case 'Manage Creative Profiles':
                config = await manageCreativeProfiles(config);
                break;
            case 'Select Narrative Framework':
                config.narrativeFrameworkPath = await selectNarrativeFramework();
                if(config.narrativeFrameworkPath) {
                    console.log(`[APP-SUCCESS] Framework "${path.basename(config.narrativeFrameworkPath, '.json')}" selected for this session.`);
                }
                break;
            case 'Quit':
                keepGoing = false;
                break;
        }
    }
    console.log("[APP-INFO] Shutting down.");
}