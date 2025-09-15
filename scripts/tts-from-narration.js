#!/usr/bin/env node
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

function printHelp() {
  console.log(`
Usage: node scripts/tts-from-narration.js -i <outputs_dir> [--model <id>] [--voices <csv>] [--out <file>]

Requires:
  - Python 3
  - pip install google-genai
  - GEMINI_API_KEY must be set in the environment

Behavior:
  - Prefers <dir>/narration.json; falls back to <dir>/narration.txt
  - Writes narration.wav (or the provided --out path)

Examples:
  node scripts/tts-from-narration.js -i outputs/<run>
  node scripts/tts-from-narration.js -i outputs/<run> --voices Zephyr,Puck,Oriole --out outputs/<run>/narration.wav
`);
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('-h') || argv.includes('--help') || argv.length === 0) {
    printHelp();
    process.exit(0);
  }
  let inputDir = null;
  let outFile = null;
  let model = 'gemini-2.5-pro-preview-tts';
  let voices = '';

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    const eat = () => { i++; return next; };
    switch (a) {
      case '-i':
      case '--input': inputDir = eat(); break;
      case '--out': outFile = eat(); break;
      case '--model': model = eat(); break;
      case '--voices': voices = eat(); break;
    }
  }

  if (!inputDir) {
    console.error('[TTS] Missing -i/--input <outputs_dir>');
    printHelp();
    process.exit(1);
  }
  const dir = path.resolve(inputDir);
  const jsonPath = path.join(dir, 'narration.json');
  const txtPath = path.join(dir, 'narration.txt');
  let narrationPath = null;
  if (fs.existsSync(jsonPath)) narrationPath = jsonPath;
  else if (fs.existsSync(txtPath)) narrationPath = txtPath;
  else {
    console.error('[TTS] Could not find narration.json or narration.txt in', dir);
    process.exit(2);
  }

  const py = process.platform === 'win32' ? 'python' : 'python3';
  const args = ['scripts/tts_from_narration.py', '--input', narrationPath, '--model', model];
  if (voices) { args.push('--voices', voices); }
  if (outFile) { args.push('--out', path.resolve(outFile)); }
  console.log('[TTS] Running:', py, args.join(' '));
  const res = spawnSync(py, args, { stdio: 'inherit' });
  process.exit(res.status || 0);
}

main();
