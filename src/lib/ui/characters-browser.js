import fs from 'fs';
import path from 'path';

function buildCharacterDetailsMenu(name, description) {
  return {
    title: name,
    message: description || '(no description provided)\n\nUse the exact name in your topic to apply this visual blueprint.',
    choices: []
  };
}

export function buildCharactersMenu() {
  try {
    const libPath = path.join(process.cwd(), 'character_library.json');
    const content = fs.readFileSync(libPath, 'utf8');
    const lib = JSON.parse(content);

    const names = Object.keys(lib).sort((a, b) => a.localeCompare(b));
    const choices = names.map(n => ({
      name: n,
      value: n,
      submenu: buildCharacterDetailsMenu(n, lib[n])
    }));

    return {
      title: 'Characters',
      message: 'Browse character blueprints. Use exact names in your topic to apply them:',
      choices
    };
  } catch (error) {
    console.error('[APP-ERROR] Could not read or parse character_library.json:', error);
    return {
      title: 'Characters',
      message: 'Could not load character library. Ensure character_library.json exists and is valid JSON.',
      choices: []
    };
  }
}

