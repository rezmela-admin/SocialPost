import inquirer from 'inquirer';
import fs from 'fs';
import path from 'path';

export async function selectNarrativeFramework() {
    const frameworksDir = path.join(process.cwd(), 'narrative_frameworks');
    try {
        const files = fs.readdirSync(frameworksDir).filter(file => file.endsWith('.json'));
        if (files.length === 0) {
            return null; // No frameworks to select
        }

        const choices = files.map(file => {
            const frameworkPath = path.join(frameworksDir, file);
            const framework = JSON.parse(fs.readFileSync(frameworkPath, 'utf8'));
            return { name: framework.name, value: frameworkPath };
        });

        choices.unshift({ name: 'None (Default)', value: null });

        const { selectedFramework } = await inquirer.prompt([{
            type: 'list',
            name: 'selectedFramework',
            message: 'Select a narrative framework:',
            choices: choices
        }]);

        return selectedFramework;
    } catch (error) {
        console.error('[APP-ERROR] Could not read or parse narrative frameworks:', error);
        return null; // Return null on error to allow graceful failure
    }
}
