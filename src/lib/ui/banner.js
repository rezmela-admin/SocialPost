import chalk from 'chalk';
import fs from 'fs';
import path from 'path';

function getVersion() {
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    return packageJson.version || '1.0';
}

export function displayBanner() {
    const version = getVersion();

    const cartoonBanner = [
        ' ██████╗ █████╗ ██████╗ ████████╗ ██████╗  ██████╗ ███╗   ██╗',
        '██╔════╝██╔══██╗██╔══██╗╚══██╔══╝██╔═══██╗██╔═══██╗████╗  ██║',
        '██║     ███████║██████╔╝   ██║   ██║   ██║██║   ██║██╔██╗ ██║',
        '██║     ██╔══██║██╔══██╗   ██║   ██║   ██║██║   ██║██║╚██╗██║',
        '╚██████╗██║  ██║██║  ██║   ██║   ╚██████╔╝╚██████╔╝██║ ╚████║',
        ' ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝    ╚═════╝  ╚═════╝ ╚═╝  ╚═══╝'
    ];

    const botBanner = [
        '  ██████╗  ██████╗ ████████╗',
        '  ██╔══██╗██╔═══██╗╚══██╔══╝',
        '  ██████╔╝██║   ██║   ██║   ',
        '  ██╔══██╗██║   ██║   ██║   ',
        '  ██████╔╝╚██████╔╝   ██║   ',
        '  ╚═════╝  ╚═════╝    ╚═╝   '
    ];

    const subtitle = `Automated Content Generation & Posting | v${version}`;

    // Determine the inner width of the box based on the longest line of content.
    const bannerWidth = cartoonBanner[0].length + botBanner[0].length;
    const contentWidth = Math.max(bannerWidth, subtitle.length);
    const innerWidth = contentWidth + 4; // Add 2 spaces of padding on each side

    // Helper to create a centered, padded line for any text content.
    const createPaddedLine = (content = '') => {
        const paddingTotal = innerWidth - content.length;
        const paddingLeft = Math.floor(paddingTotal / 2);
        const paddingRight = paddingTotal - paddingLeft;
        return ' '.repeat(paddingLeft) + content + ' '.repeat(paddingRight);
    };

    // --- Drawing the Box ---
    console.log(chalk.cyan('╔' + '═'.repeat(innerWidth) + '╗'));
    console.log(chalk.cyan('║' + ' '.repeat(innerWidth) + '║')); // Top padding line

    for (let i = 0; i < cartoonBanner.length; i++) {
        const artLine = createPaddedLine(cartoonBanner[i] + botBanner[i]);
        // Manually re-color the two parts of the art
        const coloredLine = artLine.replace(cartoonBanner[i], chalk.green(cartoonBanner[i]))
                                   .replace(botBanner[i], chalk.yellow(botBanner[i]));
        console.log(chalk.cyan('║') + coloredLine + chalk.cyan('║'));
    }

    console.log(chalk.cyan('║' + ' '.repeat(innerWidth) + '║')); // Padding line between art and subtitle
    console.log(chalk.cyan('╟' + '─'.repeat(innerWidth) + '╢'));
    console.log(chalk.cyan('║') + chalk.yellow(createPaddedLine(subtitle)) + chalk.cyan('║'));
    console.log(chalk.cyan('║' + ' '.repeat(innerWidth) + '║')); // Bottom padding line
    console.log(chalk.cyan('╚' + '═'.repeat(innerWidth) + '╝'));
    console.log(''); // Add a final newline for spacing
}