#!/usr/bin/env node
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { exportVideoFromPanels, buildExportOptionsFromArgs, printHelp as printExportHelp } from '../src/lib/video-exporter.js';

function printHelp() {
  console.log(`
Usage: node scripts/make-video-with-audio.js -i <outputs_dir> [options]

This is a one-shot helper that will:
  1) Ensure narration audio exists (generate via Gemini TTS if missing), then
  2) Export a vertical MP4 from panels and mux the narration audio.

Required:
  -i, --input <dir>        Path to outputs/<run> directory (with panels/ and metadata.json)

Audio/TTS options:
      --narration <file>   Use an existing audio file instead of generating TTS
      --skip-tts           Do not run TTS even if audio is missing
      --force-tts          Always regenerate narration audio
      --voices <csv>       Prebuilt voices to cycle per speaker (e.g., Zephyr,Puck,Oriole)
      --model <id>         TTS model id (default: gemini-2.5-pro-preview-tts)
      --speakers <csv>     Explicit speaker names (<=2) to assign unique voices
      --rewrite            Rewrite the script into single-voice narration before TTS
      --rewrite-model <id> Text model used for rewriting (default: gemini-2.0-flash-001)

Video/export options (passed through):
  -o, --out <file>         Output mp4 path (default: <dir>/video-<ts>.mp4)
      --size <WxH>         Output size (default: 1080x1920 or metadata.size)
      --fps <n>            Frames per second (default: 30)
      --duration <sec>     Default duration per panel (default: 2.0)
      --durations <csv>    Per-panel durations
  -t,  --transition <name> Default transition (e.g., fade, slideleft, wipeleft, none)
      --transitions <csv>  Per-gap transitions
      --trans-duration <s> Transition length in seconds (default: 0.5)
      --kenburns <mode>    none | in | out (or CSV per panel)
      --zoom-to <factor>   Target zoom factor for in/out (default: 1.06)
      --crf <n>            x264 CRF (default: 20)
      --preset <p>         x264 preset (default: medium)
      --dry-run            Print planned ffmpeg command without writing

Examples:
  node scripts/make-video-with-audio.js -i outputs/my-webtoon-run \
    --voices Zephyr,Puck --transition slideleft --kenburns in --zoom-to 1.08

  node scripts/make-video-with-audio.js -i outputs/my-webtoon-run \
    --narration outputs/my-webtoon-run/narration.wav --durations 2.4,1.8,1.8,1.8,1.8,2.2
`);
}

function parseArgs(argv) {
  const args = {
    voices: '',
    model: 'gemini-2.5-pro-preview-tts',
    narration: null,
    forceTts: false,
    skipTts: false,
    speakers: '',
    rewrite: false,
    rewriteModel: 'gemini-2.0-flash-001'
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const eat = () => argv[++i];
    switch (a) {
      case '-h':
      case '--help': args.help = true; break;
      case '--voices': args.voices = eat(); break;
      case '--model': args.model = eat(); break;
      case '--narration': args.narration = eat(); break;
      case '--force-tts': args.forceTts = true; break;
      case '--skip-tts': args.skipTts = true; break;
      case '--speakers': args.speakers = eat(); break;
      case '--rewrite': args.rewrite = true; break;
      case '--rewrite-model': args.rewriteModel = eat(); break;
      default:
        // ignore here — exporter parser will handle its flags
        break;
    }
  }
  return args;
}

function spawnNode(cmdArgs) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, cmdArgs, { stdio: 'inherit' });
    proc.on('error', reject);
    proc.on('exit', code => code === 0 ? resolve() : reject(new Error(`Process exited with code ${code}`)));
  });
}

async function ensureTtsIfNeeded(dir, audioPath, { voices, model, forceTts, skipTts, speakers, rewrite, rewriteModel, dryRun }) {
  if (skipTts) {
    console.log('[ONE-SHOT] Skipping TTS generation (requested).');
    return;
  }
  const exists = fs.existsSync(audioPath);
  if (exists && !forceTts) {
    console.log('[ONE-SHOT] Using existing narration audio:', audioPath);
    return;
  }
  if (dryRun) {
    console.log('[ONE-SHOT] Dry-run: would generate narration audio via TTS ->', audioPath);
    return;
  }
  const args = ['scripts/tts-from-narration-node.js', '-i', dir, '--out', audioPath];
  if (voices) args.push('--voices', voices);
  if (model) args.push('--model', model);
  if (speakers) args.push('--speakers', speakers);
  if (rewrite) args.push('--rewrite');
  if (rewriteModel) args.push('--rewrite-model', rewriteModel);
  console.log('[ONE-SHOT] Generating narration audio via TTS...');
  await spawnNode(args);
}

async function main() {
  const argv = process.argv.slice(2);
  const helper = parseArgs(argv);
  if (helper.help || argv.length === 0) {
    printHelp();
    printExportHelp();
    process.exit(helper.help ? 0 : 1);
  }

  const exportOpts = buildExportOptionsFromArgs(argv);
  if (!exportOpts.inputDir) {
    printHelp();
    printExportHelp();
    process.exit(1);
  }

  const inputDir = path.resolve(exportOpts.inputDir);
  const metaPath = path.join(inputDir, 'metadata.json');
  if (!fs.existsSync(metaPath)) {
    console.error('[ONE-SHOT] metadata.json not found in', inputDir);
    process.exit(2);
  }
  let meta = {};
  try {
    meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  } catch {}

  // Determine audio path
  const audioPath = helper.narration
    ? path.resolve(helper.narration)
    : path.join(inputDir, 'narration.wav');

  try {
    await ensureTtsIfNeeded(
      inputDir,
      audioPath,
      {
        voices: helper.voices,
        model: helper.model,
        forceTts: helper.forceTts,
        skipTts: helper.skipTts,
        speakers: helper.speakers,
        rewrite: helper.rewrite,
        rewriteModel: helper.rewriteModel,
        dryRun: !!exportOpts.dryRun,
      }
    );

    if (!exportOpts.__flags) exportOpts.__flags = {};
    if (!exportOpts.__flags.durationsProvided) {
      const durationsPath = path.join(inputDir, 'narration_durations.json');
      try {
        if (fs.existsSync(durationsPath)) {
          const raw = JSON.parse(fs.readFileSync(durationsPath, 'utf8'));
          const durations = Array.isArray(raw?.durations) ? raw.durations.map(Number).filter(d => Number.isFinite(d)) : null;
          if (durations && durations.length) {
            let panelCount = typeof meta?.panelCount === 'number' ? meta.panelCount : null;
            if (!panelCount) {
              const panelsDir = path.join(inputDir, 'panels');
              if (fs.existsSync(panelsDir)) {
                panelCount = fs.readdirSync(panelsDir)
                  .filter(name => /^panel-\d+\.png$/i.test(name)).length;
              }
            }
            if (panelCount && panelCount === durations.length) {
              const sanitized = durations.map(d => Math.max(0.1, d));
              exportOpts.durations = sanitized.map(d => d.toFixed(3)).join(',');
              exportOpts.__flags.durationsProvided = true;
              console.log('[ONE-SHOT] Loaded per-panel durations from narration_durations.json');
            } else {
              console.warn(`[ONE-SHOT] Duration count (${durations.length}) did not match panel count (${panelCount ?? 'unknown'}); ignoring narration durations.`);
            }
          }
        }
      } catch (e) {
        console.warn('[ONE-SHOT] Failed to load narration durations:', e?.message || e);
      }
    }

    console.log('[ONE-SHOT] Exporting video with audio...');
    const out = await exportVideoFromPanels({ ...exportOpts, audio: audioPath });
    console.log('[ONE-SHOT] Done:', out);
  } catch (err) {
    console.error('[ONE-SHOT] Failed:', err?.message || err);
    process.exit(3);
  }
}

main();
