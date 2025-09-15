#!/usr/bin/env node
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { GoogleGenAI } from '@google/genai';

function printHelp() {
  console.log(`
Usage: node scripts/tts-from-narration-node.js -i <outputs_dir> [--out <file>] [--voices <csv>] [--model <id>]

Reads narration.json (preferred) or narration.txt from the given outputs directory,
uses Gemini TTS via @google/genai to synthesize audio, and writes a WAV file.

Options:
  -i, --input   Path to outputs/<run> directory
      --out     Output audio file (default: <dir>/narration.wav)
      --voices  Comma list of prebuilt voice names to cycle per speaker (default: Zephyr,Puck,Oriole,Breeze)
      --model   TTS model id (default: gemini-2.5-pro-preview-tts)

Environment:
  Requires GEMINI_API_KEY in .env or environment variables.
`);
}

function parseArgs(argv) {
  const args = { inputDir: null, outFile: null, voices: '', model: 'gemini-2.5-pro-preview-tts' };
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
    const lines = segs.map(s => String(s.text || '').trim()).filter(Boolean);
    return lines.join('\n');
  }
  if (fs.existsSync(txtPath)) {
    return fs.readFileSync(txtPath, 'utf8');
  }
  throw new Error('Could not find narration.json or narration.txt in ' + dir);
}

function collectSpeakers(text) {
  const speakers = new Set();
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^\s*([^:]{1,60}):\s+/.exec(line);
    if (m) speakers.add(m[1].trim());
  }
  return Array.from(speakers);
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

async function synthToWav(text, outPath, model, voiceList) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');
  const ai = new GoogleGenAI({ apiKey });

  const speakers = collectSpeakers(text);
  const voices = voiceList && voiceList.length ? voiceList : ['Zephyr','Puck','Oriole','Breeze'];
  const speakerVoiceConfigs = speakers.map((spk, i) => ({
    speaker: spk,
    voiceConfig: { prebuiltVoiceConfig: { voiceName: voices[i % voices.length] } },
  }));

  const config = {
    temperature: 1,
    responseModalities: ['audio'],
    speechConfig: speakerVoiceConfigs.length ? { multiSpeakerVoiceConfig: { speakerVoiceConfigs } } : undefined,
  };
  const contents = [{ role: 'user', parts: [{ text: `Read aloud in a clear, engaging tone.\n${text}` }] }];

  const stream = await ai.models.generateContentStream({ model, config, contents });
  const chunks = [];
  let mimeType = '';
  for await (const chunk of stream) {
    const cand = chunk?.candidates?.[0];
    const part = cand?.content?.parts?.[0];
    const inline = part?.inlineData;
    if (inline?.data) {
      if (!mimeType) mimeType = inline.mimeType || '';
      chunks.push(Buffer.from(inline.data, 'base64'));
    }
  }
  if (!chunks.length) throw new Error('No audio data returned by TTS');
  const pcm = Buffer.concat(chunks);
  const wav = toWav(pcm, mimeType || 'audio/L16;rate=24000');
  fs.writeFileSync(outPath, wav);
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
  const text = readNarration(dir);
  await synthToWav(text, outFile, args.model, voices);
  console.log('[TTS] Saved:', outFile);
}

main().catch(err => { console.error('[TTS] Error:', err?.message || err); process.exit(2); });

