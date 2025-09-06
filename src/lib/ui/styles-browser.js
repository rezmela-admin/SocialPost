import fs from 'fs';
import path from 'path';

function buildStyleDetailsMenu(style) {
  return {
    title: style.name,
    message: style.prompt || '(no prompt provided)\n\nUse this style text as part of your image prompt.',
    choices: []
  };
}

export function buildStylesMenu() {
  try {
    const stylesPath = path.join(process.cwd(), 'graphic_styles.json');
    const content = fs.readFileSync(stylesPath, 'utf8');
    const styles = JSON.parse(content);

    const choices = styles.map(s => ({
      name: s.name || '(Unnamed Style)',
      value: s.name || Math.random().toString(36).slice(2),
      submenu: buildStyleDetailsMenu(s)
    }));

    return {
      title: 'Graphic Styles',
      message: 'Browse visual treatments used in image prompts:',
      choices
    };
  } catch (error) {
    console.error('[APP-ERROR] Could not read or parse graphic_styles.json:', error);
    return {
      title: 'Graphic Styles',
      message: 'Could not load styles. Ensure graphic_styles.json exists and is valid JSON.',
      choices: []
    };
  }
}

