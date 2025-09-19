#!/usr/bin/env node
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { select, checkbox, editor } from '@inquirer/prompts';
import { spawnSync } from 'child_process';
import { GoogleGenAI } from '@google/genai';

const DEFAULT_REWRITE_MODEL = 'gemini-2.0-flash-001';

function printHelp() {
  console.log(`
Usage: node scripts/tts-from-narration-node.js -i <outputs_dir> [--out <file>] [--voices <csv>] [--model <id>]
       [--speakers <name[,name]>] [--rewrite] [--rewrite-model <id>]

Reads narration.json (preferred) or narration.txt from the given outputs directory,
uses Gemini TTS via @google/genai to synthesize audio, and writes a WAV file.

Options:
  -i, --input   Path to outputs/<run> directory
      --out     Output audio file (default: <dir>/narration.wav)
      --voices  Comma list of prebuilt voice names to cycle per speaker (default: Zephyr,Puck,Oriole,Breeze)
      --model   TTS model id (default: gemini-2.5-pro-preview-tts)
      --speakers <csv>  Explicit speaker names (<=2) to synthesize with distinct voices
      --rewrite         Rewrite dialogue into single-voice narration before TTS
      --rewrite-model <id>  Text model used when rewriting (default: gemini-2.0-flash-001)

Environment:
  Requires GEMINI_API_KEY in .env or environment variables.
`);
}

function parseArgs(argv) {
  const args = {
    inputDir: null,
    outFile: null,
    voices: '',
    model: 'gemini-2.5-pro-preview-tts',
    speakers: [],
    rewrite: false,
    rewriteModel: DEFAULT_REWRITE_MODEL,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const eat = () => argv[++i];
    switch (a) {
      case '-h':
      case '--help': args.help = true; break;
      case '-i':
      case '--input': args.inputDir = eat(); break;
      case '--out': args.outFile = eat(); break;
      case '--voices': args.voices = eat(); break;
      case '--model': args.model = eat(); break;
      case '--speakers': {
        const raw = eat() || '';
        args.speakers = raw.split(',').map(s => s.trim()).filter(Boolean).slice(0, 2);
        break;
      }
      case '--rewrite': args.rewrite = true; break;
      case '--rewrite-model': args.rewriteModel = eat() || DEFAULT_REWRITE_MODEL; break;
    }
  }
  return args;
}

function readNarration(dir) {
  const jsonPath = path.join(dir, 'narration.json');
  const txtPath = path.join(dir, 'narration.txt');
  if (fs.existsSync(jsonPath)) {
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const segs = Array.isArray(data.segments) ? data.segments : [];
    const segments = segs.map(s => String(s.text || '').trim()).filter(Boolean);
    return { segments, meta: data };
  }
  if (!fs.existsSync(txtPath)) {
    throw new Error('Could not find narration.json or narration.txt in ' + dir);
  }
  const raw = fs.readFileSync(txtPath, 'utf8');
  const segments = [];
  for (const lineRaw of raw.split(/\r?\n/)) {
    let line = lineRaw.trim();
    if (!line) continue;
    if (/^(Topic|Lesson|Takeaway|Summary):/i.test(line)) continue;
    if (/^Panel\s+\d+:/i.test(line)) {
      line = line.split(':', 2)[1]?.trim() || '';
      if (!line) continue;
    }
    segments.push(line);
  }
  return { segments, meta: null };
}

function collectSpeakers(segments) {
  const headingPrefixes = [
    'panel', 'segment', 'scene', 'topic', 'summary', 'story', 'lesson', 'takeaway',
    'snapshot', 'spark', 'turning beat', 'turning point', 'turning', 'outcome',
    'aftermath', 'legacy', 'context', 'resonance', 'small conflict'
  ];
  const speakers = new Set();
  for (const line of segments) {
    const m = /^\s*([^:]{1,60}):\s+/.exec(line);
    if (m) {
      const name = m[1].trim();
      if (!name) continue;
      const normalized = name.toLowerCase();
      if (headingPrefixes.some(prefix => normalized.startsWith(prefix))) {
        continue;
      }
      if (/^\d+$/.test(name.replace(/\s+/g, ''))) {
        continue;
      }
      speakers.add(name);
    }
  }
  return Array.from(speakers);
}

function buildRewritePrompt(segments, meta) {
  const instructions = [
    'You will receive numbered lines from a comic script with character-labelled dialogue.',
    'Rewrite each line so a single narrator voice can perform it.',
    'Keep the original order and produce engaging prose that clearly states who speaks, using varied verbs and tone.',
    'Avoid repetitive "NAME says" patterns; feel free to add short scene cues.',
    'Return a JSON array of strings (one per original line).',
    'Respond with JSON only.'
  ];
  const context = [];
  if (meta?.topic) context.push(`Topic: ${meta.topic}`);
  if (meta?.summary) context.push(`Summary: ${meta.summary}`);
  const numbered = segments.map((seg, idx) => `${idx + 1}. ${seg}`);
  return [
    instructions.join(' '),
    context.length ? `Context:\n${context.join('\n')}` : null,
    'Lines:',
    numbered.join('\n'),
  ].filter(Boolean).join('\n\n');
}

async function rewriteSegmentsWithNarration(ai, segments, { model = DEFAULT_REWRITE_MODEL, meta } = {}) {
  if (!model) throw new Error('Rewrite model id is required.');
  const prompt = buildRewritePrompt(segments, meta);
  const response = await ai.models.generateContent({
    model,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.85,
      responseMimeType: 'application/json',
    },
  });
  const raw = response?.text;
  if (!raw || !raw.trim()) {
    throw new Error('Rewrite model returned empty response.');
  }
  let cleaned = raw.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)```$/i.exec(cleaned);
  if (fenced) {
    cleaned = fenced[1].trim();
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```[^\n]*\n?/, '').replace(/```$/, '').trim();
  }
  if (!cleaned.startsWith('[')) {
    const start = cleaned.indexOf('[');
    const end = cleaned.lastIndexOf(']');
    if (start !== -1 && end !== -1 && end > start) {
      cleaned = cleaned.slice(start, end + 1).trim();
    }
  }
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`Rewrite model did not return valid JSON: ${err?.message || err}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error('Rewrite model response is not an array.');
  }
  if (parsed.length !== segments.length) {
    console.warn(`[TTS] Rewrite response length ${parsed.length} differs from original ${segments.length}; falling back for missing entries.`);
  }
  return segments.map((original, idx) => {
    const value = parsed[idx];
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
    return original;
  });
}

function persistSingleVoiceNarration(dir, segments, meta, rewriteInfo) {
  const txtPath = path.join(dir, 'narration.single_voice.txt');
  const jsonPath = path.join(dir, 'narration.single_voice.json');
  const header = [];
  if (meta?.topic) header.push(`Topic: ${meta.topic}`);
  if (meta?.summary) header.push(`Summary: ${meta.summary}`);
  if (rewriteInfo?.model) header.push(`Rewrite Model: ${rewriteInfo.model}`);
  const body = segments.map((text, idx) => `Segment ${idx + 1}: ${text}`);
  const txt = [...header, header.length ? '' : null, ...body].filter(Boolean).join('\n');
  fs.writeFileSync(txtPath, txt, 'utf8');

  const payload = {
    source: 'single-voice-rewrite',
    segments: segments.map((text, idx) => ({ index: idx + 1, text })),
  };
  if (meta?.topic) payload.topic = meta.topic;
  if (meta?.summary) payload.summary = meta.summary;
  if (meta?.defaultDurationSec) payload.defaultDurationSec = meta.defaultDurationSec;
  if (rewriteInfo?.model) payload.rewriteModel = rewriteInfo.model;
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2));
  return { txtPath, jsonPath };
}

function deriveSegmentsFromSingleVoiceFile(txtPath, fallbackSegments) {
  try {
    const raw = fs.readFileSync(txtPath, 'utf8');
    const lines = raw.split(/\r?\n/);
    const updated = fallbackSegments.map(seg => seg);
    let captured = 0;
    const re = /^Segment\s+(\d+):\s*(.*)$/i;
    for (const line of lines) {
      const match = re.exec(line);
      if (!match) continue;
      const index = parseInt(match[1], 10) - 1;
      if (Number.isInteger(index) && index >= 0 && index < updated.length) {
        updated[index] = match[2].trim();
        captured++;
      }
    }
    if (captured === 0) {
      return fallbackSegments;
    }
    return updated;
  } catch (err) {
    console.warn('[TTS] Failed to read edited narration file:', err?.message || err);
    return fallbackSegments;
  }
}

async function reviewSingleVoiceNarration(dir, initialSegments, meta, rewriteInfo) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    const saved = persistSingleVoiceNarration(dir, initialSegments, meta, rewriteInfo);
    console.log('[TTS] Non-interactive environment detected; using rewritten narration as-is.');
    console.log(`[TTS] Review file if needed: ${saved.txtPath}`);
    return { accepted: true, segments: initialSegments };
  }

  const editorCmd = process.env.VISUAL || process.env.EDITOR || (process.platform === 'win32' ? 'notepad' : 'nano');
  let currentSegments = initialSegments.map(seg => seg);

  while (true) {
    const saved = persistSingleVoiceNarration(dir, currentSegments, meta, rewriteInfo);
    console.log('[TTS] Proposed single-voice narration:');
    currentSegments.forEach((text, idx) => {
      console.log(`  ${idx + 1}. ${text}`);
    });
    console.log(`[TTS] The text above is saved at: ${saved.txtPath}`);

    const answer = await select({
      message: 'Review rewritten narration before TTS:',
      choices: [
        { name: 'Approve rewrite', value: 'approve' },
        { name: 'Edit in editor', value: 'edit' },
        { name: 'Cancel rewrite (return to original dialogue)', value: 'cancel' }
      ],
      default: 'approve'
    });

    if (answer === 'approve') {
      console.log('[TTS] Single-voice narration approved.');
      return { accepted: true, segments: currentSegments };
    }

    if (answer === 'cancel') {
      try { fs.unlinkSync(saved.txtPath); } catch {}
      try { fs.unlinkSync(saved.jsonPath); } catch {}
      console.log('[TTS] User declined rewrite; using original script.');
      return { accepted: false };
    }

    if (answer === 'edit') {
      console.log(`[TTS] Opening ${editorCmd} for manual edits...`);
      try {
        const result = spawnSync(editorCmd, [saved.txtPath], { stdio: 'inherit' });
        if (result?.error) {
          console.warn('[TTS] Editor failed to launch:', result.error.message || result.error);
        }
      } catch (err) {
        console.warn('[TTS] Error launching editor:', err?.message || err);
      }

      currentSegments = deriveSegmentsFromSingleVoiceFile(saved.txtPath, currentSegments);
      continue;
    }
  }
}

function parseAudioMime(mimeType = 'audio/L16;rate=24000') {
  let bitsPerSample = 16, sampleRate = 24000;
  const parts = String(mimeType).split(';').map(s => s.trim());
  const main = parts[0] || 'audio/L16';
  const m = /^audio\/L(\d+)/i.exec(main);
  if (m) bitsPerSample = parseInt(m[1], 10) || 16;
  for (const p of parts.slice(1)) {
    const [k, v] = p.split('=');
    if ((k || '').toLowerCase() === 'rate') {
      const r = parseInt(v || '', 10);
      if (Number.isFinite(r)) sampleRate = r;
    }
  }
  return { bitsPerSample, sampleRate };
}

function toWav(pcmBuffer, mimeType) {
  const { bitsPerSample, sampleRate } = parseAudioMime(mimeType);
  const numChannels = 1;
  const dataSize = pcmBuffer.length;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcmBuffer]);
}

function segmentSpeechConfig(speakers, voiceList) {
  const voices = voiceList && voiceList.length ? voiceList : ['Zephyr','Puck','Oriole','Breeze'];
  const speakerVoiceConfigs = speakers.map((spk, i) => ({
    speaker: spk,
    voiceConfig: { prebuiltVoiceConfig: { voiceName: voices[i % voices.length] } },
  }));

  if (speakerVoiceConfigs.length === 2) {
    return {
      config: {
        multiSpeakerVoiceConfig: { speakerVoiceConfigs }
      },
      voicesUsed: speakerVoiceConfigs.map(cfg => cfg.voiceConfig.prebuiltVoiceConfig.voiceName),
      multi: true,
    };
  }

  if (speakerVoiceConfigs.length > 2) {
    console.log('[TTS] More than two speakers detected; using single-voice output (API currently limited to 2 voices).');
  }

  const fallbackVoice = speakerVoiceConfigs.length === 1
    ? speakerVoiceConfigs[0].voiceConfig.prebuiltVoiceConfig.voiceName
    : voices[0];

  return {
    config: {
      voiceConfig: { prebuiltVoiceConfig: { voiceName: fallbackVoice || 'Zephyr' } }
    },
    voicesUsed: [fallbackVoice || 'Zephyr'],
    multi: false,
  };
}

async function synthSegment(ai, model, text, config) {
  const contents = [{ role: 'user', parts: [{ text: `Read aloud in a clear, engaging tone.\n${text}` }] }];
  const stream = await ai.models.generateContentStream({ model, config: {
    temperature: 1,
    responseModalities: ['audio'],
    speechConfig: config,
  }, contents });
  const chunks = [];
  let mimeType = '';
  let blockedForSafety = false;
  for await (const chunk of stream) {
    const cand = chunk?.candidates?.[0];
    const part = cand?.content?.parts?.[0];
    const inline = part?.inlineData;
    if (inline?.data) {
      if (!mimeType) mimeType = inline.mimeType || '';
      chunks.push(Buffer.from(inline.data, 'base64'));
    }
    if (cand?.finishReason === 'SAFETY') {
      blockedForSafety = true;
      break;
    }
  }
  if (!chunks.length) {
    if (blockedForSafety) {
      throw new Error('TTS safety system blocked this segment. Consider editing the narration text.');
    }
    throw new Error('No audio data returned by TTS for segment');
  }
  return { buffer: Buffer.concat(chunks), mimeType: mimeType || 'audio/L16;rate=24000' };
}

async function synthToWav(dir, segments, outPath, model, voiceList, meta, options = {}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');
  const ai = new GoogleGenAI({ apiKey });

  const speakerInfo = collectSpeakers(segments);
  let workingSegments = segments.slice();
  const cliSpeakers = Array.isArray(options.speakers) ? options.speakers.filter(Boolean) : [];
  const detectedSet = new Set(speakerInfo.map(name => name.trim()));
  let selectedSpeakers = cliSpeakers.filter(name => detectedSet.has(name)).slice(0, 2);
  let rewriteRequested = !!options.rewrite;
  const rewriteModel = options.rewriteModel || DEFAULT_REWRITE_MODEL;
  let rewriteInfo = null;

  const canPrompt = process.stdin.isTTY && process.stdout.isTTY;
  if (!selectedSpeakers.length && speakerInfo.length && canPrompt) {
    console.log(`[TTS] Detected speakers in script: ${speakerInfo.join(', ')}`);
    const narrationChoice = await select({
      message: 'Choose narration style for TTS:',
      choices: [
        { name: 'Single narrator voice (original dialogue)', value: 'single' },
        { name: 'Single narrator voice (rewrite into prose)', value: 'single-rewrite' },
        { name: 'Assign voices to specific speakers', value: 'multi' },
      ],
      default: 'single'
    });

    if (narrationChoice === 'multi') {
      const selected = await checkbox({
        message: 'Select up to two speakers to voice distinctly:',
        choices: speakerInfo.map(name => ({ name, value: name })),
        validate: (input) => {
          if (input.length === 0) return 'Select at least one speaker or choose single narrator.';
          if (input.length > 2) return 'Select no more than two speakers.';
          return true;
        }
      });
      selectedSpeakers = selected.slice(0, 2);
      rewriteRequested = false;
    } else if (narrationChoice === 'single-rewrite') {
      rewriteRequested = true;
    } else {
      rewriteRequested = false;
    }
  }

  if (selectedSpeakers.length && rewriteRequested) {
    console.warn('[TTS] Rewrite is only available for single-voice narration. Skipping rewrite because multiple speakers were selected.');
    rewriteRequested = false;
  }

  if (selectedSpeakers.length) {
    console.log(`[TTS] Using multi-voice narration for: ${selectedSpeakers.join(', ')}`);
  } else if (speakerInfo.length) {
    if (rewriteRequested) {
      console.log(`[TTS] Using single narrator voice with rewrite (${rewriteModel}).`);
    } else {
      console.log('[TTS] Using single narrator voice.');
    }
  }

  if (rewriteRequested && selectedSpeakers.length === 0) {
    try {
      console.log(`[TTS] Rewriting narration with ${rewriteModel}...`);
      const rewritten = await rewriteSegmentsWithNarration(ai, workingSegments, { model: rewriteModel, meta });
      if (Array.isArray(rewritten)) {
        const review = await reviewSingleVoiceNarration(dir, rewritten, meta, { model: rewriteModel });
        if (review?.accepted) {
          workingSegments = review.segments;
          rewriteInfo = { model: rewriteModel };
        }
      }
    } catch (err) {
      console.warn('[TTS] Narration rewrite failed; falling back to original dialogue:', err?.message || err);
    }
  }

  const { config: speechConfig, voicesUsed } = segmentSpeechConfig(selectedSpeakers, voiceList);

  const pcmBuffers = [];
  const durations = [];
  let firstMime = null;
  for (let i = 0; i < workingSegments.length; i++) {
    let seg = workingSegments[i];
    if (!seg.trim()) {
      durations.push(0);
      continue;
    }

    while (true) {
      try {
        console.log(`[TTS] Synthesizing segment ${i + 1}/${workingSegments.length}...`);
        const { buffer, mimeType } = await synthSegment(ai, model, seg, speechConfig);
        pcmBuffers.push(buffer);
        if (!firstMime) firstMime = mimeType;
        const { bitsPerSample, sampleRate } = parseAudioMime(mimeType);
        const bytesPerSample = Math.max(1, bitsPerSample / 8);
        const duration = buffer.length / (sampleRate * bytesPerSample);
        durations.push(duration);
        workingSegments[i] = seg; // persist any edits
        break;
      } catch (err) {
        if (!canPrompt) throw err;
        console.warn(`[TTS] Segment ${i + 1} failed: ${err?.message || err}`);
        const choice = await select({
          message: `Segment ${i + 1}: How would you like to proceed?`,
          choices: [
            { name: 'Edit text and retry', value: 'edit' },
            { name: 'Skip this segment (silence)', value: 'skip' },
            { name: 'Abort TTS generation', value: 'cancel' }
          ],
          default: 'edit'
        });

        if (choice === 'cancel') {
          throw new Error('TTS generation cancelled by user after segment failure.');
        }

        if (choice === 'skip') {
          durations.push(0);
          seg = '';
          workingSegments[i] = seg;
          break;
        }

        if (choice === 'edit') {
          const edited = await editor({
            message: `Edit narration for segment ${i + 1}:`,
            default: seg,
            validate: (input) => input.trim().length > 0 || 'Segment text cannot be empty.'
          });
          seg = edited.trim();
          continue;
        }
      }
    }
  }

  if (!pcmBuffers.length) throw new Error('No audio data was generated.');

  const pcm = Buffer.concat(pcmBuffers);
  const wav = toWav(pcm, firstMime || 'audio/L16;rate=24000');
  fs.writeFileSync(outPath, wav);

  // Persist metadata similar to Python helper
  const metadata = {
    source: 'narration',
    model,
    segments: workingSegments.length,
    voices: voicesUsed,
    sampleRate: parseAudioMime(firstMime || undefined).sampleRate,
    bitsPerSample: parseAudioMime(firstMime || undefined).bitsPerSample,
    generatedAt: new Date().toISOString(),
  };
  if (selectedSpeakers.length) metadata.speakers = selectedSpeakers;
  if (rewriteInfo?.model) metadata.singleVoiceRewriteModel = rewriteInfo.model;
  try {
    fs.writeFileSync(path.join(dir, 'narration.meta.json'), JSON.stringify(metadata, null, 2));
    console.log('[TTS] Wrote narration.meta.json');
  } catch (err) {
    console.warn('[TTS] Failed to write narration.meta.json:', err?.message || err);
  }

  try {
    const payload = {
      durations,
      totalDuration: durations.reduce((a, b) => a + b, 0),
      sampleRate: metadata.sampleRate,
      bitsPerSample: metadata.bitsPerSample,
    };
    fs.writeFileSync(path.join(dir, 'narration_durations.json'), JSON.stringify(payload, null, 2));
    console.log('[TTS] Wrote narration_durations.json');
  } catch (err) {
    console.warn('[TTS] Failed to write narration_durations.json:', err?.message || err);
  }

  try {
    const metaPath = path.join(dir, 'metadata.json');
    let panelCount = null;
    if (fs.existsSync(metaPath)) {
      const metaData = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      if (typeof metaData.panelCount === 'number') panelCount = metaData.panelCount;
    }
    const panelsDir = path.join(dir, 'panels');
    let panelFiles = [];
    if (fs.existsSync(panelsDir)) {
      panelFiles = fs.readdirSync(panelsDir).filter(name => /^panel-\d+\.png$/i.test(name)).sort();
      if (panelCount === null) panelCount = panelFiles.length;
    }
    if (panelCount && panelFiles.length && panelCount === durations.length) {
      const lines = [];
      for (let i = 0; i < panelFiles.length; i++) {
        const dur = Math.max(0.01, durations[i] || 0);
        lines.push(`file '${panelFiles[i]}'`);
        lines.push(`duration ${dur.toFixed(6)}`);
      }
      lines.push(`file '${panelFiles[panelFiles.length - 1]}'`);
      fs.writeFileSync(path.join(panelsDir, 'list.txt'), lines.join('\n'), 'utf8');
      console.log('[TTS] Wrote panels/list.txt with speech-aligned durations');
    }
  } catch (err) {
    console.warn('[TTS] Failed to update panels/list.txt:', err?.message || err);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.inputDir) {
    printHelp();
    process.exit(args.help ? 0 : 1);
  }
  const dir = path.resolve(args.inputDir);
  const outFile = args.outFile ? path.resolve(args.outFile) : path.join(dir, 'narration.wav');
  const voices = (args.voices || '').split(',').map(s => s.trim()).filter(Boolean);
  const { segments, meta } = readNarration(dir);
  await synthToWav(dir, segments, outFile, args.model, voices, meta, {
    speakers: args.speakers,
    rewrite: args.rewrite,
    rewriteModel: args.rewriteModel,
  });
  console.log('[TTS] Saved:', outFile);
}

main().catch(err => { console.error('[TTS] Error:', err?.message || err); process.exit(2); });
