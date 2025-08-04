import { BskyAgent } from '@atproto/api';
import fs from 'fs/promises';
import 'dotenv/config';

async function testBluesky() {
    console.log('--- Running Bluesky Post Test ---');

    const handle = process.env.BLUESKY_HANDLE;
    const appPassword = process.env.BLUESKY_APP_PASSWORD;

    if (!handle || !appPassword) {
        console.error('Error: Please set BLUESKY_HANDLE and BLUESKY_APP_PASSWORD in your .env file.');
        return;
    }

    try {
        const agent = new BskyAgent({ service: 'https://bsky.social' });
        console.log('Logging in to Bluesky...');
        await agent.login({ identifier: handle, password: appPassword });
        console.log('Login successful!');

        console.log('Uploading test image...');
        const imageBuffer = await fs.readFile('./test_image.png');
        const uploadResponse = await agent.uploadBlob(imageBuffer, { encoding: 'image/png' });
        console.log('Image upload successful!');

        console.log('Creating test post...');
        await agent.post({
            text: 'This is a test post from the Automated Social Media Bot!',
            embed: {
                $type: 'app.bsky.embed.images',
                images: [{ image: uploadResponse.data.blob, alt: 'A test image' }]
            }
        });
        console.log('Post created successfully!');

        console.log('--- Bluesky Post Test Complete ---');

    } catch (error) {
        console.error('Bluesky test failed:', error);
    }
}

// Create a dummy test image if it doesn't exist
async function createTestImage() {
    try {
        await fs.access('./test_image.png');
    } catch (error) {
        console.log('Creating dummy test image...');
        const sharp = (await import('sharp')).default;
        await sharp({
            create: {
                width: 800,
                height: 600,
                channels: 4,
                background: { r: 255, g: 255, b: 0, alpha: 1 }
            }
        })
        .png()
        .toFile('./test_image.png');
    }
}

createTestImage().then(testBluesky);
