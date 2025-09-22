import fs from 'fs/promises';
import { spawn } from 'child_process';

export async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

function spawnPromise(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { stdio: options.stdio ?? 'inherit', ...options });
    proc.on('error', reject);
    proc.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

export async function runFfmpeg(args, options = {}) {
  await spawnPromise('ffmpeg', args, options);
}

export async function runFfprobe(args, options = {}) {
  return new Promise((resolve, reject) => {
    let output = '';
    const proc = spawn('ffprobe', args, { stdio: ['ignore', 'pipe', 'pipe'], ...options });
    proc.stdout.on('data', (chunk) => { output += chunk.toString(); });
    proc.stderr.on('data', () => {});
    proc.on('error', reject);
    proc.on('exit', (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(`ffprobe exited with code ${code}`));
    });
  });
}

export async function probeDurationSeconds(file) {
  try {
    const output = await runFfprobe(['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nk=1:nw=1', file]);
    const num = parseFloat(String(output).trim());
    if (Number.isFinite(num)) return num;
  } catch (error) {
    throw new Error(`Failed to probe duration for ${file}: ${error.message}`);
  }
  return null;
}

