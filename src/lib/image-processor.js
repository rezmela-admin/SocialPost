import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

export async function applyFooter(imagePath, config) {
    const footerCfg = config?.composition?.footer;
    if (!footerCfg || footerCfg.enabled !== true) return;

    try {
        const {
            text = 'To be continued…',
            font = 'Arial',
            fontColor = '#FFFFFF',
            fontSize = 28,
            bandColor = '#000000',
            bandOpacity = 0.45,
            position = 'bottom-center',
            margin = 24,
        } = footerCfg;

        const image = sharp(imagePath);
        const meta = await image.metadata();
        const width = meta.width || 1024;

        const bandHeight = Math.max( Math.round(fontSize + margin * 2), fontSize + 10 );
        const svg = `\n        <svg width="${width}" height="${bandHeight}" viewBox="0 0 ${width} ${bandHeight}" xmlns="http://www.w3.org/2000/svg">\n            <rect x="0" y="0" width="${width}" height="${bandHeight}" fill="${bandColor}" opacity="${bandOpacity}"/>\n            <text x="${width/2}" y="${bandHeight/2}" text-anchor="middle" dominant-baseline="middle" font-family="${font}" font-size="${fontSize}" fill="${fontColor}">${text}</text>\n        </svg>`;

        const gravityMap = {
            'bottom-right': 'southeast',
            'bottom-left': 'southwest',
            'top-right': 'northeast',
            'top-left': 'northwest',
            'center': 'centre',
            'bottom-center': 'south',
            'top-center': 'north'
        };
        const gravity = gravityMap[position] || 'south';

        const tempOut = `${imagePath}.footer.png`;
        await image
            .composite([{ input: Buffer.from(svg), gravity }])
            .toFile(tempOut);
        fs.renameSync(tempOut, imagePath);
        console.log(`[APP-INFO] Footer applied to ${path.basename(imagePath)}`);
    } catch (error) {
        console.error(`[APP-WARN] Could not apply footer to ${path.basename(imagePath)}:`, error);
    }
}

export async function applyWatermark(imagePath, config) {
    const wmConfig = config.imageWatermarking;
    if (!wmConfig || !wmConfig.enabled) {
        return;
    }

    try {
        const { 
            text, 
            font, 
            fontColor, 
            fontSize, 
            watermarkBackgroundColor, 
            watermarkBackgroundOpacity 
        } = wmConfig;

        const image = sharp(imagePath);
        const metadata = await image.metadata();

        const padding = Math.round(fontSize * 0.5);
        const textLength = text.length;
        const textWidth = Math.round((fontSize * textLength * 0.6) + (padding * 2)); 
        const textHeight = Math.round(fontSize + (padding * 2));

        const svg = `
        <svg width="${textWidth}" height="${textHeight}">
            <rect
                x="0" y="0"
                width="${textWidth}" height="${textHeight}"
                fill="${watermarkBackgroundColor || '#000'}"
                opacity="${watermarkBackgroundOpacity || 0.5}"
            />
            <text
                x="50%" y="50%"
                text-anchor="middle"
                dy=".3em"
                font-family="${font}"
                font-size="${fontSize}"
                fill="${fontColor}"
            >
                ${text}
            </text>
        </svg>
        `;

        const svgBuffer = Buffer.from(svg);
        const tempImagePath = `${imagePath}.watermarked.png`;

        // Map position from config to Sharp gravity
        const gravityMap = {
            'bottom-right': 'southeast',
            'bottom-left': 'southwest',
            'top-right': 'northeast',
            'top-left': 'northwest',
            'center': 'centre',
            'bottom-center': 'south',
            'top-center': 'north'
        };
        const gravity = gravityMap[wmConfig.position] || 'southeast';

        await image
            .composite([{ 
                input: svgBuffer, 
                gravity,
            }])
            .toFile(tempImagePath);

        fs.renameSync(tempImagePath, imagePath);
        console.log(`[APP-INFO] Watermark applied to ${path.basename(imagePath)}`);

    } catch (error) {
        console.error(`[APP-WARN] Could not apply watermark to ${path.basename(imagePath)}:`, error);
    }
}
