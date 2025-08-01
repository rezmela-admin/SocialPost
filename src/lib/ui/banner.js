import chalk from 'chalk';
import fs from 'fs';
import path from 'path';

function getVersion() {
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    return packageJson.version || 'N/A';
}

export function displayBanner() {
    const version = getVersion();
    
    // Corrected "Cartoon" text
    const cartoonBanner = [
        ' ██████╗ █████╗ ██████╗ ████████╗ ██████╗  ██████╗ ███╗   ██╗',
        '██╔════╝██╔══██╗██╔══██╗╚══██╔══╝██╔═══██╗██╔═══██╗████╗  ██║',
        '██║     ███████║██████╔╝   ██║   ██║   ██║██║   ██║██╔██╗ ██║',
        '██║     ██╔══██║██╔══██╗   ██║   ██║   ██║██║   ██║██║╚██╗██║',
        '╚██████╗██║  ██║██║  ██║   ██║   ╚██████╔╝╚██████╔╝██║ ╚████║',
        ' ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝    ╚═════╝  ╚═════╝ ╚═╝  ╚═══╝'
    ];

    // "Bot" text
    const botBanner = [
        '  ██████╗  ██████╗ ████████╗',
        '  ██╔══██╗██╔═══██╗╚══██╔══╝',
        '  ██████╔╝██║   ██║   ██║   ',
        '  ██╔══██╗██║   ██║   ██║   ',
        '  ██████╔╝╚██████╔╝   ██║   ',
        '  ╚═════╝  ╚═════╝    ╚═╝   '
    ];

    // Print line by line, combining the two colored parts
    for (let i = 0; i < cartoonBanner.length; i++) {
        const cartoonLine = chalk.green(cartoonBanner[i]);
        const botLine = chalk.yellow(botBanner[i]); // Using yellow for contrast
        console.log(`${cartoonLine}${botLine}`);
    }

    console.log(chalk.yellow(`      Automated Content Generation & Posting | v${version}`));
    console.log(chalk.dim('      Type "help" for a list of commands.'));
    console.log('\n' + '-'.repeat(60) + '\n');
}