import fs from 'fs';
import path from 'path';

function setNarrativeFramework(config, frameworkPath) {
    config.narrativeFrameworkPath = frameworkPath;
    if (frameworkPath) {
        console.log(`[APP-SUCCESS] Framework "${path.basename(frameworkPath, '.json')}" selected for this session.`);
    } else {
        console.log(`[APP-INFO] Narrative framework selection cleared.`);
    }
}

export function buildFrameworksMenu(config) {
    const frameworksDir = path.join(process.cwd(), 'narrative_frameworks');
    try {
        const files = fs.readdirSync(frameworksDir).filter(file => file.endsWith('.json'));
        
        const choices = files.map(file => {
            const frameworkPath = path.join(frameworksDir, file);
            const framework = JSON.parse(fs.readFileSync(frameworkPath, 'utf8'));
            return { 
                name: framework.name, 
                value: frameworkPath,
                action: () => setNarrativeFramework(config, frameworkPath),
                popAfterAction: true
            };
        });

        choices.unshift({ 
            name: 'None (Default)', 
            value: 'none',
            action: () => setNarrativeFramework(config, null),
            popAfterAction: true
        });

        return {
            title: 'Select Narrative Framework',
            message: 'Choose a framework:',
            choices: choices
        };

    } catch (error) {
        console.error('[APP-ERROR] Could not read or parse narrative frameworks:', error);
        return {
            title: 'Error',
            message: 'Could not load narrative frameworks.',
            choices: []
        };
    }
}
