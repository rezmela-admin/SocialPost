import inquirer from 'inquirer';
import path from 'path';
import fs from 'fs';
import chalk from 'chalk';
import { spawn } from 'child_process';
import { manageCreativeProfiles } from '../profile-manager.js';
import { getPendingJobCount, clearQueue } from '../queue-manager.js';
import { generateAndQueueComicStrip, generateAndQueuePost, generateVirtualInfluencerPost } from '../workflows.js';
import { displayBanner } from './banner.js';

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
        const loggedInPlatforms = getLoggedInPlatforms();
        const pendingJobs = getPendingJobCount();

        console.log(chalk.yellow('\n--- Status ---'));
        console.log(`- Active Profile: ${chalk.cyan(activeProfile)}`);
        console.log(`- Logged In:      ${chalk.cyan(loggedInPlatforms.length > 0 ? loggedInPlatforms.join(', ') : 'None')}`);
        console.log(`- Pending Jobs:   ${chalk.cyan(pendingJobs)}`);
        console.log(chalk.yellow('----------------\n'));

        const message = `What would you like to do?`;
        const choices = [
            'Generate and Queue a New Post',
            'Manage Creative Profiles',
            new inquirer.Separator(),
            'Quit'
        ];
        if (pendingJobs > 0) {
            choices.splice(1, 0, `Process Job Queue (${pendingJobs} pending)`);
            choices.splice(2, 0, 'Clear Job Queue & Cleanup Files');
        }

        const { action } = await inquirer.prompt([{ type: 'list', name: 'action', message: message, choices: choices }]);

        switch (action) {
            case 'Generate and Queue a New Post':
                const workflow = config.prompt.workflow || 'standard';
                let answers;
                switch(workflow) {
                    case 'comicStrip':
                        answers = await inquirer.prompt([
                            { type: 'editor', name: 'topic', message: 'Enter the topic for the 4-panel comic strip:', default: config.search.defaultTopic, validate: input => input.trim().length > 0 },
                            { type: 'checkbox', name: 'platforms', message: 'Queue for which platforms?', choices: ['X', 'LinkedIn', 'Bluesky'], validate: i => i.length > 0 },
                            { type: 'confirm', name: 'confirm', message: 'Proceed with generating this comic strip?', default: true }
                        ]);
                        if (answers.confirm) {
                            await generateAndQueueComicStrip({ topic: answers.topic, platforms: answers.platforms }, config, imageGenerator);
                        } else {
                            console.log('[APP-INFO] Comic strip generation cancelled.');
                        }
                        break;
                    case 'virtualInfluencer':
                         answers = await inquirer.prompt([
                            { type: 'editor', name: 'topic', message: 'Enter the topic for the Virtual Influencer:', default: config.search.defaultTopic, validate: input => input.trim().length > 0 },
                            { type: 'confirm', name: 'skipSummarization', message: 'Use this topic directly as the post summary?', default: false },
                            { type: 'checkbox', name: 'platforms', message: 'Queue for which platforms?', choices: ['X', 'LinkedIn', 'Bluesky'], validate: i => i.length > 0 },
                            { type: 'confirm', name: 'confirm', message: 'Generate post?', default: true }
                        ]);
                        if (answers.confirm) {
                            await generateVirtualInfluencerPost({ topic: answers.topic, platforms: answers.platforms }, config, imageGenerator, answers.skipSummarization);
                        } else {
                            console.log('[APP-INFO] Post generation cancelled.');
                        }
                        break;
                    default: // standard or multiCharacterScene
                         answers = await inquirer.prompt([
                            { type: 'editor', name: 'topic', message: 'Enter the topic:', default: config.search.defaultTopic, validate: input => input.trim().length > 0 },
                            { type: 'confirm', name: 'skipSummarization', message: 'Use this topic directly as the post summary?', default: false },
                            { type: 'checkbox', name: 'platforms', message: 'Queue for which platforms?', choices: ['X', 'LinkedIn', 'Bluesky'], validate: i => i.length > 0 },
                            { type: 'confirm', name: 'confirm', message: 'Generate post?', default: true }
                        ]);
                        if (answers.confirm) {
                            await generateAndQueuePost({ topic: answers.topic, platforms: answers.platforms }, config, imageGenerator, answers.skipSummarization);
                        } else {
                            console.log('[APP-INFO] Post generation cancelled.');
                        }
                        break;
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
            case 'Quit':
                keepGoing = false;
                break;
        }
    }
    console.log("[APP-INFO] Shutting down.");
}
