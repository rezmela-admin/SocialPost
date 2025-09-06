import fs from 'fs';
import path from 'path';

function setNarrativeFramework(config, frameworkPath) {
    config.narrativeFrameworkPath = frameworkPath;
    if (frameworkPath) {
        console.log(`[APP-SUCCESS] Story Pattern "${path.basename(frameworkPath, '.json')}" selected for this session.`);
    } else {
        console.log(`[APP-INFO] Story Pattern selection cleared.`);
    }
}

function friendlyName(name) {
    // Replace separators with spaces and capitalize words
    return name
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\b\w/g, c => c.toUpperCase());
}

function buildDirectoryMenu(config, dir, title = 'Choose Story Pattern', isRoot = false) {
    try {
        const dirents = fs.readdirSync(dir, { withFileTypes: true });
        const choices = [];

        // Add subdirectories as categories
        for (const d of dirents.filter(d => d.isDirectory())) {
            const subdir = path.join(dir, d.name);
            const submenu = buildDirectoryMenu(config, subdir, friendlyName(d.name), false);
            // Only include submenus that have at least one choice
            if (submenu && submenu.choices && submenu.choices.length > 0) {
                choices.push({
                    name: `📁 ${friendlyName(d.name)}`,
                    value: subdir,
                    submenu
                });
            }
        }

        // Add JSON files in this directory
        for (const f of dirents.filter(d => d.isFile() && d.name.endsWith('.json'))) {
            const frameworkPath = path.join(dir, f.name);
            try {
                const framework = JSON.parse(fs.readFileSync(frameworkPath, 'utf8'));
                const displayName = framework?.name || friendlyName(path.basename(f.name, '.json'));
                choices.push({
                    name: displayName,
                    value: frameworkPath,
                    action: () => setNarrativeFramework(config, frameworkPath),
                    popAfterAction: true
                });
            } catch (err) {
                console.warn(`[APP-WARN] Skipping invalid framework file: ${frameworkPath}`);
            }
        }

        // At root, offer to clear selection
        if (isRoot) {
            choices.unshift({
                name: 'No Template (Default)',
                value: 'none',
                action: () => setNarrativeFramework(config, null),
                popAfterAction: true
            });
        }

        return {
            title,
            message: 'Pick a story pattern:',
            choices
        };
    } catch (error) {
        console.error('[APP-ERROR] Could not read or parse narrative frameworks:', error);
        return {
            title: 'Error',
            message: 'Could not load story templates.',
            choices: []
        };
    }
}

export function buildFrameworksMenu(config) {
    const frameworksDir = path.join(process.cwd(), 'narrative_frameworks');
    return buildDirectoryMenu(config, frameworksDir, 'Choose Story Pattern', true);
}
