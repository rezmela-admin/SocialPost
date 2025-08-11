import fs from 'fs';
import path from 'path';
import inquirer from 'inquirer';

const PROFILES_DIR = './prompt_profiles';

async function loadProfile(config) {
    const profiles = fs.readdirSync(PROFILES_DIR).filter(file => file.endsWith('.json'));
    if (profiles.length === 0) {
        console.log("[APP-INFO] No creative profiles found.");
        return config;
    }

    const { profileToLoad } = await inquirer.prompt([
        {
            type: 'list',
            name: 'profileToLoad',
            message: 'Which profile would you like to load?',
            choices: [...profiles, new inquirer.Separator(), 'Cancel'],
        },
    ]);

    if (profileToLoad === 'Cancel') {
        console.log("[APP-INFO] Operation cancelled.");
        return config;
    }

    try {
        const profilePath = path.join(PROFILES_DIR, profileToLoad);
        const profileContent = JSON.parse(fs.readFileSync(profilePath, 'utf8'));

        config.prompt = profileContent;
        if (!config.prompt.workflow) {
            config.prompt.workflow = 'standard';
        }
        config.prompt.profilePath = profilePath;

        console.log(`[APP-SUCCESS] Profile "${profileToLoad}" loaded for the current session.`);
    } catch (error) {
        console.error(`[APP-ERROR] Failed to load profile "${profileToLoad}":`, error);
    }
    return config;
}

async function createNewProfile(config) {
    console.log("\n--- Create New Profile ---");

    const { filename } = await inquirer.prompt([
        { type: 'input', name: 'filename', message: 'Enter a filename for the new profile (e.g., "my_style"):', validate: input => input.trim().length > 0 || 'Filename cannot be empty.' },
    ]);

    const { newStyle } = await inquirer.prompt([
        { type: 'input', name: 'newStyle', message: 'Enter the new image style:', default: "A fun, witty, satirical cartoon.", validate: input => input.trim().length > 0 || 'Style cannot be empty.' },
    ]);

    const profileTypes = {
        "Standard Cartoon": { task: "Based on the news about '{TOPIC}', you must respond with ONLY a single, raw JSON object..." },
        "Virtual Influencer": { task: "Based on the news about '{TOPIC}', you must respond with ONLY a single, raw JSON object..." },
    };

    const { profileType } = await inquirer.prompt([{ type: 'list', name: 'profileType', message: 'Choose the profile type:', choices: Object.keys(profileTypes) }]);

    const newProfile = { style: newStyle, task: profileTypes[profileType].task };

    if (profileType === "Virtual Influencer") {
        const { characterDescription } = await inquirer.prompt([{ type: 'input', name: 'characterDescription', message: 'Enter a detailed description of your virtual influencer:', validate: input => input.trim().length > 0 || 'Character description cannot be empty.' }]);
        newProfile.characterDescription = characterDescription;
    }
    const profilePath = path.join(PROFILES_DIR, `${filename}.json`);
    try {
        fs.writeFileSync(profilePath, JSON.stringify(newProfile, null, 2));
        console.log(`[APP-SUCCESS] New profile saved to "${profilePath}"`);
    } catch (e) {
        console.error(`[APP-ERROR] Failed to save profile: "${profilePath}". Error:`, e);
    }

    const { loadNow } = await inquirer.prompt([{ type: 'confirm', name: 'loadNow', message: 'Load this new profile now?', default: true }]);
    if (loadNow) {
        newProfile.profilePath = profilePath;
        config.prompt = newProfile;
        console.log(`[APP-SUCCESS] Profile "${filename}.json" is now the active configuration for this session.`);
    }
    return config;
}

async function deleteProfile() {
    const profiles = fs.readdirSync(PROFILES_DIR).filter(file => file.endsWith('.json'));
    if (profiles.length === 0) {
        console.log("[APP-INFO] No creative profiles found to delete.");
        return;
    }

    const { profileToDelete } = await inquirer.prompt([{ type: 'list', name: 'profileToDelete', message: 'Which profile would you like to delete?', choices: [...profiles, new inquirer.Separator(), 'Cancel'] }]);

    if (profileToDelete === 'Cancel') {
        console.log("[APP-INFO] Operation cancelled.");
        return;
    }

    const { confirmDelete } = await inquirer.prompt([{ type: 'confirm', name: 'confirmDelete', message: `Are you sure you want to permanently delete "${profileToDelete}"?`, default: false }]);

    if (confirmDelete) {
        try {
            fs.unlinkSync(path.join(PROFILES_DIR, profileToDelete));
            console.log(`[APP-SUCCESS] Profile "${profileToDelete}" has been deleted.`);
        } catch (e) {
            console.error(`[APP-ERROR] Failed to delete profile: "${profileToDelete}". Error:`, e);
        }
    }
}

export async function manageCreativeProfiles(config) {
    const activeProfile = config.prompt.profilePath ? path.basename(config.prompt.profilePath) : 'Default';
    const { action } = await inquirer.prompt([
        {
            type: 'list',
            name: 'action',
            message: `Creative Profiles Menu (Current: ${activeProfile})`,
            choices: [
                'Load a Profile (Switch to a different character/style)',
                'Create a New Profile (Build a new character/style)',
                'Delete a Profile',
                new inquirer.Separator(),
                'Back to Main Menu',
            ],
        },
    ]);

    switch (action) {
        case 'Load a Profile (Switch to a different character/style)':
            return await loadProfile(config);
        case 'Create a New Profile (Build a new character/style)':
            return await createNewProfile(config);
        case 'Delete a Profile':
            await deleteProfile();
            break;
        case 'Back to Main Menu':
        default:
            break;
    }
    return config;
}
