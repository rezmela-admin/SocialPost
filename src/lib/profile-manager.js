import fs from 'fs';
import path from 'path';
import { select, input, confirm as confirmPrompt, Separator } from '@inquirer/prompts';

const PROFILES_DIR = './prompt_profiles';

async function loadProfile(sessionState) {
    const profiles = fs.readdirSync(PROFILES_DIR).filter(file => file.endsWith('.json'));
    if (profiles.length === 0) {
        console.log("[APP-INFO] No creative profiles found.");
        return sessionState;
    }

    const choices = [
        ...profiles.map(p => ({ name: p, value: p })),
        new Separator(),
        { name: 'Cancel', value: 'Cancel' }
    ];

    const profileToLoad = await select({
        message: 'Which profile would you like to load?',
        choices: choices,
    });

    if (profileToLoad === 'Cancel') {
        console.log("[APP-INFO] Operation cancelled.");
        return sessionState;
    }

    try {
        const profilePath = path.join(PROFILES_DIR, profileToLoad);
        const profileContent = JSON.parse(fs.readFileSync(profilePath, 'utf8'));

        sessionState.prompt = profileContent;
        if (!sessionState.prompt.workflow) {
            sessionState.prompt.workflow = 'standard';
        }
        sessionState.prompt.profilePath = profilePath;

        console.log(`[APP-SUCCESS] Profile "${profileToLoad}" loaded for the current session.`);
    } catch (error) {
        console.error(`[APP-ERROR] Failed to load profile "${profileToLoad}":`, error);
    }
    return sessionState;
}

async function createNewProfile(sessionState) {
    console.log("\n--- Create New Profile ---");

    const filename = await input({
        message: 'Enter a filename for the new profile (e.g., "my_style"):', validate: input => input.trim().length > 0 || 'Filename cannot be empty.'
    });

    const newStyle = await input({
        message: 'Enter the new image style:',
        default: "A fun, witty, satirical cartoon.",
        validate: input => input.trim().length > 0 || 'Style cannot be empty.'
    });

    const profileTypes = {
        "Standard Cartoon": { task: "Based on the news about '{TOPIC}', you must respond with ONLY a single, raw JSON object..." },
        "Virtual Influencer": { task: "Based on the news about '{TOPIC}', you must respond with ONLY a single, raw JSON object..." },
    };

    const profileType = await select({
        message: 'Choose the profile type:',
        choices: Object.keys(profileTypes).map(p => ({ name: p, value: p }))
    });

    const newProfile = { style: newStyle, task: profileTypes[profileType].task };

    if (profileType === "Virtual Influencer") {
        const characterDescription = await input({
            message: 'Enter a detailed description of your virtual influencer:',
            validate: input => input.trim().length > 0 || 'Character description cannot be empty.'
        });
        newProfile.characterDescription = characterDescription;
    }
    const profilePath = path.join(PROFILES_DIR, `${filename}.json`);
    try {
        fs.writeFileSync(profilePath, JSON.stringify(newProfile, null, 2));
        console.log(`[APP-SUCCESS] New profile saved to "${profilePath}"`);
    } catch (e) {
        console.error(`[APP-ERROR] Failed to save profile: "${profilePath}". Error:`, e);
    }

    const loadNow = await confirmPrompt({ message: 'Load this new profile now?', default: true });
    if (loadNow) {
        newProfile.profilePath = profilePath;
        sessionState.prompt = newProfile;
        console.log(`[APP-SUCCESS] Profile "${filename}.json" is now the active configuration for this session.`);
    }
    return sessionState;
}

async function deleteProfile() {
    const profiles = fs.readdirSync(PROFILES_DIR).filter(file => file.endsWith('.json'));
    if (profiles.length === 0) {
        console.log("[APP-INFO] No creative profiles found to delete.");
        return;
    }

    const choices = [
        ...profiles.map(p => ({ name: p, value: p })),
        new Separator(),
        { name: 'Cancel', value: 'Cancel' }
    ];

    const profileToDelete = await select({
        message: 'Which profile would you like to delete?',
        choices: choices
    });

    if (profileToDelete === 'Cancel') {
        console.log("[APP-INFO] Operation cancelled.");
        return;
    }

    const confirmDelete = await confirmPrompt({
        message: `Are you sure you want to permanently delete "${profileToDelete}"?`,
        default: false
    });

    if (confirmDelete) {
        try {
            fs.unlinkSync(path.join(PROFILES_DIR, profileToDelete));
            console.log(`[APP-SUCCESS] Profile "${profileToDelete}" has been deleted.`);
        } catch (e) {
            console.error(`[APP-ERROR] Failed to delete profile: "${profileToDelete}". Error:`, e);
        }
    }
}

export async function manageCreativeProfiles(sessionState) {
    const activeProfile = sessionState.prompt.profilePath ? path.basename(sessionState.prompt.profilePath) : 'Default';
    
    const choices = [
        { name: 'Load a Profile (Switch to a different character/style)', value: 'Load a Profile (Switch to a different character/style)' },
        { name: 'Create a New Profile (Build a new character/style)', value: 'Create a New Profile (Build a new character/style)' },
        { name: 'Delete a Profile', value: 'Delete a Profile' },
        new Separator(),
        { name: 'Back to Main Menu', value: 'Back to Main Menu' },
    ];

    const action = await select({
        message: `Creative Profiles Menu (Current: ${activeProfile})`,
        choices: choices,
    });

    switch (action) {
        case 'Load a Profile (Switch to a different character/style)':
            return await loadProfile(sessionState);
        case 'Create a New Profile (Build a new character/style)':
            return await createNewProfile(sessionState);
        case 'Delete a Profile':
            await deleteProfile();
            break;
        case 'Back to Main Menu':
        default:
            break;
    }
    return sessionState;
}

