import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import chalk from 'chalk';

import { ensureDir, runFfmpeg } from './media-utils.js';

async function createConcatList(clips) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'veo3-concat-'));
  const listPath = path.join(tmpDir, 'list.txt');
  const lines = clips.map((clip) => `file '${clip.absolutePath.replace(/'/g, "'\\''")}'`).join('\n');
  await fs.writeFile(listPath, `${lines}\n`, 'utf8');
  return { listPath, tmpDir };
}

export async function assembleClips({ clips, outputPath, reencode = true, logger = console, dryRun = false }) {
  if (!clips.length) throw new Error('No clips provided for assembly');
  await ensureDir(path.dirname(outputPath));

  const { listPath, tmpDir } = await createConcatList(clips);
  const args = reencode
    ? ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c:v', 'libx264', '-c:a', 'aac', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', outputPath]
    : ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', outputPath];

  try {
    if (dryRun) {
      logger.log(chalk.gray(`[assemble] Dry run -> ffmpeg ${args.join(' ')}`));
      return outputPath;
    }
    logger.log(chalk.cyan(`[assemble] Combining ${clips.length} clips -> ${path.basename(outputPath)}`));
    await runFfmpeg(args);
    return outputPath;
  } finally {
    try {
      await fs.unlink(listPath);
      await fs.rmdir(tmpDir);
    } catch (error) {
      // ignore cleanup errors
    }
  }
}

