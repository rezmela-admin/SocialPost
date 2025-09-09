import sharp from 'sharp';
import path from 'path';

/**
 * Filters available layouts based on the number of panels.
 * @param {number} panelCount - The number of panels required.
 * @returns {Array<object>} - An array of compatible layout objects.
 */
function getAvailableLayouts(panelCount) {
    const allLayouts = [
        { name: '1x2 (Vertical Strip)', value: '1x2', panels: 2 },
        { name: '2x1 (Horizontal Strip)', value: '2x1', panels: 2 },
        { name: '2x2 (Classic Grid)', value: '2x2', panels: 4 },
        { name: '1x4 (Vertical Film Strip)', value: '1x4', panels: 4 },
        { name: '4x1 (Horizontal Film Strip)', value: '4x1', panels: 4 },
        { name: '2x3 (Standard Comic Page)', value: '2x3', panels: 6 },
        { name: '3x2 (Wide Comic Page)', value: '3x2', panels: 6 },
    ];
    return allLayouts.filter(layout => layout.panels === panelCount);
}

/**
 * Composes a comic strip from individual panel images.
 * @param {Array<string>} panelImagePaths - Array of absolute paths to the panel images.
 * @param {string} layout - The selected layout string (e.g., '2x2').
 * @param {number} panelWidth - The width of a single panel.
 * @param {number} panelHeight - The height of a single panel.
 * @param {number} borderSize - The size of the border around panels.
 * @returns {Promise<string>} - The absolute path to the final composed image.
 */
async function composeComicStrip(panelImagePaths, layout, panelWidth, panelHeight, borderSize) {
    const [cols, rows] = layout.split('x').map(Number);

    const finalWidth = (cols * panelWidth) + ((cols + 1) * borderSize);
    const finalHeight = (rows * panelHeight) + ((rows + 1) * borderSize);

    const compositeOptions = panelImagePaths.map((imagePath, index) => {
        const col = index % cols;
        const row = Math.floor(index / cols);
        return {
            input: imagePath,
            top: (row * panelHeight) + ((row + 1) * borderSize),
            left: (col * panelWidth) + ((col + 1) * borderSize),
        };
    });

    const outputPath = path.join(process.cwd(), `final-comic-${Date.now()}.png`);

    await sharp({
        create: {
            width: finalWidth,
            height: finalHeight,
            channels: 4,
            background: { r: 255, g: 255, b: 255, alpha: 1 },
        },
    })
    .composite(compositeOptions)
    .toFile(outputPath);

    console.log(`[COMIC-COMPOSER] Successfully composed comic strip: ${outputPath}`);
    return outputPath;
}

/**
 * Stacks panels vertically for a Webtoon-style export.
 * Each panel is resized to the target width while preserving aspect ratio.
 * @param {Array<string>} panelImagePaths
 * @param {number} targetWidth - Pixel width of the final image and each panel.
 * @param {number} gutter - Vertical spacing between panels (px).
 * @param {object} background - RGBA background color, e.g., { r:255,g:255,b:255,alpha:1 }
 * @returns {Promise<string>} - The absolute path to the final composed image.
 */
async function composeVerticalWebtoon(panelImagePaths, targetWidth, gutter = 120, background = { r: 255, g: 255, b: 255, alpha: 1 }) {
    // Pre-compute resized heights from metadata to avoid buffering large images twice
    const resizedHeights = [];
    for (const imgPath of panelImagePaths) {
        const meta = await sharp(imgPath).metadata();
        const width = meta.width || targetWidth;
        const height = meta.height || targetWidth;
        const scale = targetWidth / Math.max(1, width);
        resizedHeights.push(Math.round(height * scale));
    }

    const totalHeight = resizedHeights.reduce((sum, h) => sum + h, 0) + gutter * (panelImagePaths.length + 1);
    const finalWidth = targetWidth; // no side borders for mobile-friendly scroll

    const composites = [];
    let currentTop = gutter;
    for (let i = 0; i < panelImagePaths.length; i++) {
        const inputBuffer = await sharp(panelImagePaths[i]).resize({ width: targetWidth }).toBuffer();
        composites.push({ input: inputBuffer, top: currentTop, left: 0 });
        currentTop += resizedHeights[i] + gutter;
    }

    const outputPath = path.join(process.cwd(), `final-webtoon-${Date.now()}.png`);
    await sharp({
        create: {
            width: finalWidth,
            height: totalHeight,
            channels: 4,
            background,
        },
    })
    .composite(composites)
    .toFile(outputPath);

    console.log(`[COMIC-COMPOSER] Successfully composed vertical webtoon: ${outputPath}`);
    return outputPath;
}

export {
    getAvailableLayouts,
    composeComicStrip,
    composeVerticalWebtoon,
};
