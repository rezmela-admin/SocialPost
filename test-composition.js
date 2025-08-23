import fs from 'fs';
import path from 'path';
import { select, confirm as confirmPrompt } from '@inquirer/prompts';
import { composeComicStrip } from './src/lib/comic-composer.js';
import { applyWatermark } from './src/lib/image-processor.js';
import { exportToPdf } from './src/lib/pdf-exporter.js';

// Use fs.readFileSync to ensure compatibility across Node versions
const config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));

async function testComposition() {
    console.log('--- Comic Strip Composition Tester ---');

    // 1. Find existing panel images
    const projectRoot = process.cwd();
    const files = fs.readdirSync(projectRoot);
    const panelImagePaths = files
        .filter(f => f.startsWith('temp_panel_') && f.endsWith('.png'))
        .map(f => path.join(projectRoot, f))
        .sort(); // Sort to ensure consistent panel order

    if (panelImagePaths.length === 0) {
        console.error('\n[ERROR] No "temp_panel_*.png" files found in the project root.');
        console.log('Please generate some panels first before running this test script.');
        return;
    }

    console.log(`\nFound ${panelImagePaths.length} panel images to work with:`);
    panelImagePaths.forEach(p => console.log(`- ${path.basename(p)}`));

    // 2. Ask for layout
    const allLayouts = [
        { name: '1x2 (Vertical Strip)', value: '1x2' },
        { name: '2x1 (Horizontal Strip)', value: '2x1' },
        { name: '2x2 (Classic Grid)', value: '2x2' },
        { name: '1x4 (Vertical Film Strip)', value: '1x4' },
        { name: '4x1 (Horizontal Film Strip)', value: '4x1' },
        { name: '2x3 (Standard Comic Page)', value: '2x3' },
        { name: '3x2 (Wide Comic Page)', value: '3x2' },
    ];

    const chosenLayout = await select({
        message: 'Which layout would you like to test?',
        choices: allLayouts,
    });

    // 3. Run composition and watermarking
    try {
        console.log(`\nTesting composition for layout: ${chosenLayout}...`);
        const finalImagePath = await composeComicStrip(panelImagePaths, chosenLayout, config);
        console.log('[SUCCESS] Composition complete!');
        
        console.log('Applying watermark...');
        await applyWatermark(finalImagePath, config);
        console.log('[SUCCESS] Watermark applied!');

        console.log(`\nFinal image saved to: ${finalImagePath}`);

        // 4. Ask to export PDF
        const exportAsPdf = await confirmPrompt({ message: 'Export this comic as a 6x9 PDF?', default: true });
        if (exportAsPdf) {
            const pdfPath = finalImagePath.replace('.png', '.pdf');
            await exportToPdf(finalImagePath, pdfPath, {
                pageSize: [6, 9], // 6x9 inches
                margin: 0.75      // 0.75 inches
            });
        }

    } catch (error) {
        console.error('\n[ERROR] An error occurred during the process:', error);
    }
}

testComposition();
