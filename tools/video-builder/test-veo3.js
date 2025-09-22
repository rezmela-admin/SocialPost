#!/usr/bin/env node
import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import { GoogleGenAI } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error(chalk.red('GEMINI_API_KEY environment variable not set.'));
    process.exit(1);
  }

  const ai = new GoogleGenAI({ apiKey });

  console.log('[veo3-test] Submitting sample job...');
  let operation = await ai.models.generateVideos({
    model: 'veo-3.0-generate-preview',
    prompt: 'an attractive lady in a two piece swim wear dancing on the beach on this hot summer day',
    config: {
      numberOfVideos: 1,
      negativePrompt: 'barking, woofing',
    },
  });

  while (!operation.done) {
    console.log('[veo3-test] Waiting for completion...');
    await new Promise((resolve) => setTimeout(resolve, 20000));
    operation = await ai.operations.getVideosOperation({ operation });
  }

  if (operation.error) {
    throw new Error(`VEO3 job failed: ${JSON.stringify(operation.error)}`);
  }

  const videos = operation.response?.generatedVideos;
  if (!videos || videos.length === 0) {
    throw new Error('VEO3 response did not include generated videos');
  }

  const outPath = path.join(__dirname, 'veo3_sample.mp4');
  await ai.files.download({
    file: videos[0],
    downloadPath: outPath,
  });

  console.log('[veo3-test] Saved', outPath);
}

main().catch((error) => {
  console.error(chalk.red(`[veo3-test] Failed: ${error.message}`));
  process.exit(1);
});
