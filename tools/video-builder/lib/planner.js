import path from 'path';

import { ensurePlan } from './metadata.js';
import { PROVIDER_IDS } from './providers/index.js';

const DEFAULT_MAX_DURATION_SEC = 8;
const MIN_CLIP_DURATION_SEC = 3;
const WORDS_PER_SECOND = 2.6;
const REALISTIC_STYLE_NOTE = 'Adopt a cohesive, realistic live-action style with cinematic lighting, natural proportions, and consistent character likeness.';

const SPEAKER_TOKEN = /([A-Z][A-Za-z0-9 .'-]{0,39}):\s*/g;
const STAGE_PREFIX_RULES = [
  {
    pattern: /^(lesson|note|reminder)\b[:,-]*\s*/i,
    transform: (rest) => `I'm realizing ${rest}`,
  },
  {
    pattern: /^(aside|thought)\b[:,-]*\s*/i,
    transform: (rest) => `I'm thinking ${rest}`,
  },
  {
    pattern: /^(observation|insight)\b[:,-]*\s*/i,
    transform: (rest) => `Here's what I'm seeing: ${rest}`,
  },
  {
    pattern: /^(plan|strategy)\b[:,-]*\s*/i,
    transform: (rest) => `Here's my plan: ${rest}`,
  },
];

function normalizeWhitespace(text) {
  return typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
}

function capitalizeSentence(text) {
  if (!text) return '';
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function ensureEndingPunctuation(text) {
  if (!text) return '';
  const trimmed = text.trim();
  if (!trimmed) return '';
  if (/([.!?]|")$/.test(trimmed)) {
    return trimmed;
  }
  return `${trimmed}.`;
}

function formatDialogueLine(line) {
  const cleanLine = normalizeWhitespace(line);
  if (!cleanLine) return '';
  const colonIndex = cleanLine.indexOf(':');
  if (colonIndex > 0 && colonIndex < Math.min(cleanLine.length - 1, 40)) {
    const rawName = cleanLine.slice(0, colonIndex).trim();
    const speech = cleanLine.slice(colonIndex + 1).trim();
    if (rawName && speech) {
      const name = capitalizeSentence(rawName);
      const strippedSpeech = speech.replace(/^"+|"+$/g, '').trim();
      const formattedSpeech = ensureEndingPunctuation(capitalizeSentence(strippedSpeech));
      return `${name} says, "${formattedSpeech}"`;
    }
  }
  const sentence = ensureEndingPunctuation(capitalizeSentence(cleanLine));
  return sentence;
}

function rewriteNarrationForVoiceover(text) {
  if (!text) return '';
  const segments = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!segments.length) {
    return normalizeWhitespace(text);
  }
  const rewritten = segments
    .map((line) => formatDialogueLine(line))
    .filter(Boolean)
    .join(' ');
  return normalizeWhitespace(rewritten) || normalizeWhitespace(text);
}

function extractSpeakerTurns(text) {
  if (typeof text !== 'string') return [];
  const source = text.trim();
  if (!source) return [];
  SPEAKER_TOKEN.lastIndex = 0;
  const markers = [];
  let match;
  while ((match = SPEAKER_TOKEN.exec(source)) !== null) {
    const speaker = normalizeWhitespace(match[1]);
    if (!speaker) continue;
    markers.push({ speaker, matchIndex: match.index, contentStart: SPEAKER_TOKEN.lastIndex });
  }
  if (!markers.length) return [];
  const turns = [];
  for (let i = 0; i < markers.length; i += 1) {
    const current = markers[i];
    const next = markers[i + 1];
    const endIndex = next ? next.matchIndex : source.length;
    const content = source.slice(current.contentStart, endIndex).trim();
    if (content) {
      turns.push({ speaker: current.speaker, content });
    }
  }
  return turns;
}

function rewriteSpeakerUtterance(speaker, content) {
  const cleanSpeaker = capitalizeSentence(normalizeWhitespace(speaker));
  const cleanContent = normalizeWhitespace(content);
  if (!cleanContent) return '';
  let text = cleanContent
    .replace(/^['"“”]+/, '')
    .replace(/['"“”]+$/, '')
    .trim();

  for (const rule of STAGE_PREFIX_RULES) {
    if (rule.pattern.test(text)) {
      const rest = text.replace(rule.pattern, '').trim();
      if (!rest) break;
      text = rule.transform(rest);
      break;
    }
  }

  text = text.replace(/^[A-Z][A-Za-z0-9'\- ]{0,20}:\s*/, '').trim();
  text = text.replace(/;\s*/g, ', ');

  const hasFirstPerson = /\b(i|me|my|mine|we|our|let's|us)\b/i.test(text);
  if (!hasFirstPerson && !/[?!]$/.test(text)) {
    const lowered = text.charAt(0).toLowerCase() + text.slice(1);
    text = `I think ${lowered}`;
  }

  text = ensureEndingPunctuation(capitalizeSentence(text));
  if (cleanSpeaker) {
    return text;
  }
  return text;
}

function nowIso() {
  return new Date().toISOString();
}

function clampDuration(value, maxDurationSec) {
  const upper = Math.max(MIN_CLIP_DURATION_SEC, maxDurationSec);
  const raw = Number.isFinite(value) ? value : MIN_CLIP_DURATION_SEC;
  const clamped = Math.min(upper, Math.max(MIN_CLIP_DURATION_SEC, raw));
  return Number(clamped.toFixed(2));
}

function ensurePlanContainer(manifest) {
  const root = ensurePlan(manifest);
  if (!root[PROVIDER_IDS.VEO3_TEXT]) {
    root[PROVIDER_IDS.VEO3_TEXT] = {
      providerId: PROVIDER_IDS.VEO3_TEXT,
      chunks: [],
      meta: {},
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
  }
  const plan = root[PROVIDER_IDS.VEO3_TEXT];
  if (!Array.isArray(plan.chunks)) {
    plan.chunks = [];
  }
  if (!plan.meta || typeof plan.meta !== 'object') {
    plan.meta = {};
  }
  return plan;
}

function countWords(text) {
  if (!text) return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function splitLongSentence(sentence, maxDurationSec) {
  const words = sentence.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const maxWordsPerChunk = Math.max(1, Math.floor(maxDurationSec * WORDS_PER_SECOND));
  const segments = [];
  for (let offset = 0; offset < words.length; offset += maxWordsPerChunk) {
    const slice = words.slice(offset, offset + maxWordsPerChunk);
    const wordCount = slice.length;
    const duration = clampDuration(wordCount / WORDS_PER_SECOND, maxDurationSec);
    segments.push({
      text: slice.join(' '),
      wordCount,
      durationSec: duration,
    });
  }
  return segments;
}

function chunkNarrationText(text, maxDurationSec) {
  const clean = typeof text === 'string' ? text.trim() : '';
  if (!clean) return [];
  const sentences = clean.split(/(?<=[.!?])\s+/).filter(Boolean);
  const segments = [];
  let currentSentences = [];
  let currentWordCount = 0;

  const flushCurrent = () => {
    if (!currentSentences.length) return;
    const chunkText = currentSentences.join(' ').trim();
    if (!chunkText) {
      currentSentences = [];
      currentWordCount = 0;
      return;
    }
    const duration = clampDuration(currentWordCount / WORDS_PER_SECOND, maxDurationSec);
    segments.push({
      text: chunkText,
      wordCount: currentWordCount,
      durationSec: duration,
    });
    currentSentences = [];
    currentWordCount = 0;
  };

  for (const sentence of sentences) {
    const words = sentence.trim().split(/\s+/).filter(Boolean);
    if (!words.length) continue;
    const sentenceWordCount = words.length;
    const sentenceDuration = sentenceWordCount / WORDS_PER_SECOND;
    if (sentenceDuration > maxDurationSec) {
      flushCurrent();
      const overs = splitLongSentence(sentence, maxDurationSec);
      segments.push(...overs);
      continue;
    }
    const potentialWordCount = currentWordCount + sentenceWordCount;
    const potentialDuration = potentialWordCount / WORDS_PER_SECOND;
    if (potentialDuration > maxDurationSec && currentWordCount > 0) {
      flushCurrent();
    }
    currentSentences.push(sentence.trim());
    currentWordCount += sentenceWordCount;
  }

  flushCurrent();

  if (!segments.length) {
    const wordCount = countWords(clean);
    const duration = clampDuration(wordCount / WORDS_PER_SECOND, maxDurationSec);
    segments.push({
      text: clean,
      wordCount,
      durationSec: duration,
    });
  }

  return segments;
}

function deriveAspectRatio(sizeString) {
  if (!sizeString || typeof sizeString !== 'string') return '9:16';
  const match = /^(\d+)x(\d+)$/.exec(sizeString.trim());
  if (!match) return '9:16';
  const width = parseInt(match[1], 10);
  const height = parseInt(match[2], 10);
  if (!width || !height) return '9:16';
  const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));
  const divisor = gcd(width, height);
  return `${Math.round(width / divisor)}:${Math.round(height / divisor)}`;
}

function extractCharacterNotes(metadata) {
  if (!metadata || !Array.isArray(metadata.panelDetails)) {
    return '';
  }
  const notes = new Map();
  const pattern = /The character\s+([^:]+)\s+MUST be depicted as:\s*([^\.\n]+(?:\.[^.]*?)?)(?:\.|$)/gi;
  for (const panel of metadata.panelDetails) {
    if (!panel?.prompt) continue;
    let match;
    while ((match = pattern.exec(panel.prompt)) !== null) {
      const name = match[1].trim();
      const description = match[2]
        .split(/\bPlace a clear speech bubble[^.]+\.?/i)[0]
        .trim()
        .replace(/\s+/g, ' ');
      if (!notes.has(name)) {
        notes.set(name, description);
      }
    }
  }
  if (!notes.size) return '';
  return Array.from(notes.entries())
    .map(([name, description]) => {
      const clean = description.replace(/\bSpeech bubbles?:[^.]*\.?/gi, '').trim();
      return clean ? `- ${name}: ${clean}` : null;
    })
    .filter(Boolean)
    .join('\n');
}

function collectSourceSegments(context) {
  const narrationSegments = Array.isArray(context.narration?.json?.segments)
    ? context.narration.json.segments
    : [];
  if (narrationSegments.length) {
    return narrationSegments.map((segment, index) => ({
      id: segment?.index != null
        ? `segment-${String(segment.index).padStart(2, '0')}`
        : `segment-${String(index + 1).padStart(2, '0')}`,
      index,
      text: segment?.text || '',
    }));
  }
  const narrationText = context.narration?.text || '';
  const blocks = narrationText
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
  if (blocks.length) {
    return blocks.map((text, index) => ({
      id: `block-${String(index + 1).padStart(2, '0')}`,
      index,
      text,
    }));
  }
  const fallback = context.metadata?.summary || context.metadata?.topic || '';
  if (fallback) {
    return [{ id: 'summary', index: 0, text: fallback }];
  }
  return [{ id: 'placeholder', index: 0, text: 'Narration placeholder clip.' }];
}

function buildPlanMeta(context, maxDurationSec, providerConfig = {}) {
  const metadata = context.metadata || {};
  const boundedMax = Number.isFinite(maxDurationSec)
    ? Math.max(MIN_CLIP_DURATION_SEC, maxDurationSec)
    : DEFAULT_MAX_DURATION_SEC;
  const characterNotes = extractCharacterNotes(metadata);
  const styleNotes = [
    REALISTIC_STYLE_NOTE,
    metadata.profile ? `Keep visuals aligned with profile "${metadata.profile}".` : '',
  ]
    .filter(Boolean)
    .join(' ');
  const aspectRatio = providerConfig.aspectRatio || deriveAspectRatio(metadata.size);
  return {
    maxDurationSec: Number(boundedMax.toFixed(2)),
    characterNotes,
    styleNotes,
    aspectRatio,
    providerLabel: providerConfig.label || PROVIDER_IDS.VEO3_TEXT,
  };
}

function composeChunkPrompt(context, plan, chunkIndex, chunkData) {
  const meta = plan.meta || {};
  const maxDuration = meta.maxDurationSec || DEFAULT_MAX_DURATION_SEC;
  const parts = [];
  parts.push(`Create a ${meta.aspectRatio || '9:16'} aspect ratio video clip no longer than ${maxDuration} seconds.`);
  parts.push(`Voiceover narration to follow: ${chunkData.narrationText}`);
  if (chunkData.speaker) {
    parts.push(`Primary speaking character: ${chunkData.speaker}. Keep their lip-sync, expressions, and gestures aligned with this line while other characters react silently.`);
  } else {
    parts.push('Treat this narration as neutral off-screen voiceover. Stage characters so the visuals reinforce the narration without visible lip-sync.');
  }
  parts.push('Do not show speech bubbles, thought bubbles, captions, subtitles, closed captions, or any on-screen text.');
  parts.push('Do not add floating subtitles or stylized text near characters—rely solely on acting and staging.');
  parts.push(`Target duration: ${chunkData.durationSec}s (do not exceed ${maxDuration}s).`);
  if (meta.characterNotes) {
    parts.push(`Character continuity:
${meta.characterNotes}`);
  }
  if (meta.styleNotes) {
    parts.push(meta.styleNotes);
  }
  parts.push('Maintain consistent lighting, wardrobe, and setting with prior clips. Ensure the clip has a clear beginning and end beat that matches the narration.');
  return parts.join('\n\n').trim();
}

function buildChunksFromNarration(context, maxDurationSec, meta) {
  const segments = collectSourceSegments(context);
  const chunks = [];
  const draftPlan = { chunks, meta };
  let timelineCursor = 0;

  segments.forEach((segment) => {
    const pieces = chunkNarrationText(segment.text, maxDurationSec);
    const segmentChunks = [];
    pieces.forEach((piece) => {
      const speakerTurns = extractSpeakerTurns(piece.text);
      const subPieces = speakerTurns.length
        ? speakerTurns
          .map(({ speaker, content }) => ({
            narrationText: rewriteSpeakerUtterance(speaker, content),
            speaker: capitalizeSentence(normalizeWhitespace(speaker)),
          }))
          .filter((entry) => entry.narrationText)
        : (() => {
            const narrationText = rewriteNarrationForVoiceover(piece.text);
            return narrationText
              ? [{ narrationText, speaker: null }]
              : [];
          })();

      subPieces.forEach((subPiece) => {
        const narrationText = subPiece.narrationText;
        const wordCount = countWords(narrationText);
        const durationSec = wordCount > 0
          ? clampDuration(wordCount / WORDS_PER_SECOND, meta.maxDurationSec)
          : clampDuration(piece.durationSec || MIN_CLIP_DURATION_SEC, meta.maxDurationSec);
        const chunkIndex = chunks.length;
        const prompt = composeChunkPrompt(context, draftPlan, chunkIndex, {
          narrationText,
          durationSec,
          speaker: subPiece.speaker,
        });
        const createdAt = nowIso();
        const chunk = {
          id: `chunk-${String(chunkIndex + 1).padStart(2, '0')}`,
          index: chunkIndex,
          narrationText,
          durationSec,
          estimatedDurationSec: durationSec,
          wordCount,
          speaker: subPiece.speaker || null,
          startSec: Number(timelineCursor.toFixed(2)),
          endSec: Number((timelineCursor + durationSec).toFixed(2)),
          prompt,
          promptSource: 'auto',
          status: 'pending',
          history: [],
          createdAt,
          updatedAt: createdAt,
          source: {
            segmentId: segment.id,
            segmentIndex: segment.index,
            part: segmentChunks.length + 1,
            totalParts: 0,
          },
        };
        chunks.push(chunk);
        segmentChunks.push(chunk);
        timelineCursor += durationSec;
      });
    });

    const totalParts = segmentChunks.length || 1;
    segmentChunks.forEach((chunk, index) => {
      if (chunk?.source) {
        chunk.source.part = index + 1;
        chunk.source.totalParts = totalParts;
      }
    });
  });

  const totalDurationSec = Number(timelineCursor.toFixed(2));
  return { chunks, totalDurationSec };
}

function createTextPlan(context, maxDurationSec, providerConfig = {}) {
  const meta = buildPlanMeta(context, maxDurationSec, providerConfig);
  const { chunks, totalDurationSec } = buildChunksFromNarration(context, meta.maxDurationSec, meta);
  meta.totalDurationSec = totalDurationSec;
  return { chunks, meta };
}

function touchPlan(plan) {
  plan.updatedAt = nowIso();
}

function touchChunk(chunk) {
  chunk.updatedAt = nowIso();
}

export function ensureTextPlan(manifest, context, options = {}) {
  const {
    maxDurationSec = DEFAULT_MAX_DURATION_SEC,
    providerConfig = {},
  } = options;
  const plan = ensurePlanContainer(manifest);
  const resolvedMax = Number.isFinite(Number(maxDurationSec))
    ? Math.max(MIN_CLIP_DURATION_SEC, Number(maxDurationSec))
    : plan.meta.maxDurationSec || DEFAULT_MAX_DURATION_SEC;
  const refreshedMeta = buildPlanMeta(context, resolvedMax, providerConfig);

  if (!Array.isArray(plan.chunks) || !plan.chunks.length) {
    const { chunks, meta } = createTextPlan(context, resolvedMax, providerConfig);
    plan.chunks = chunks;
    plan.meta = meta;
    plan.createdAt = plan.createdAt || nowIso();
    touchPlan(plan);
  } else {
    const currentMeta = plan.meta || {};
    const shouldUpdateMeta =
      Math.abs((currentMeta.maxDurationSec || 0) - resolvedMax) > 1e-6 ||
      currentMeta.characterNotes !== refreshedMeta.characterNotes ||
      currentMeta.styleNotes !== refreshedMeta.styleNotes ||
      currentMeta.aspectRatio !== refreshedMeta.aspectRatio ||
      currentMeta.providerLabel !== refreshedMeta.providerLabel;

    if (shouldUpdateMeta) {
      plan.meta = {
        ...refreshedMeta,
      };
      touchPlan(plan);
    }

    let updatedAnyChunk = false;
    plan.chunks.forEach((chunk, index) => {
      if (!chunk || typeof chunk !== 'object') return;
      const prompt = chunk.prompt || '';
      if (
        typeof prompt === 'string' &&
        (prompt.includes('Story summary:') || prompt.includes('Continue smoothly after the previous beat'))
      ) {
        const nextPrompt = composeChunkPrompt(context, plan, index, {
          narrationText: chunk.narrationText,
          durationSec: chunk.durationSec,
          speaker: chunk.speaker,
        });
        chunk.prompt = nextPrompt;
        chunk.promptSource = 'auto';
        chunk.updatedAt = nowIso();
        updatedAnyChunk = true;
      }
    });

    if (updatedAnyChunk) {
      touchPlan(plan);
    }
  }

  return plan;
}

export function getTextPlan(manifest) {
  return ensurePlanContainer(manifest);
}

export function getTextPlanChunks(plan) {
  return Array.isArray(plan?.chunks) ? plan.chunks : [];
}

export function findTextPlanChunk(plan, chunkId) {
  return getTextPlanChunks(plan).find((chunk) => chunk.id === chunkId) || null;
}

export function updateTextPlanChunk(plan, chunkId, updater) {
  const chunk = findTextPlanChunk(plan, chunkId);
  if (!chunk) {
    throw new Error(`Chunk not found: ${chunkId}`);
  }
  const result = updater(chunk);
  if (result === false) {
    return chunk;
  }
  touchChunk(chunk);
  touchPlan(plan);
  return chunk;
}

export function markChunkStatus(plan, chunkId, status) {
  const chunk = findTextPlanChunk(plan, chunkId);
  if (!chunk) {
    throw new Error(`Chunk not found: ${chunkId}`);
  }
  chunk.status = status;
  if (status === 'approved') {
    chunk.approvedAt = nowIso();
  } else {
    chunk.approvedAt = null;
  }
  touchChunk(chunk);
  touchPlan(plan);
  return chunk;
}

export function recordChunkRender(manifest, chunkId, payload) {
  const plan = ensurePlanContainer(manifest);
  const chunk = findTextPlanChunk(plan, chunkId);
  if (!chunk) {
    throw new Error(`Chunk not found: ${chunkId}`);
  }
  const entry = {
    type: 'render',
    at: nowIso(),
    durationSec: payload.durationSec ?? chunk.durationSec,
    operationName: payload.operationName || null,
    prompt: payload.prompt || chunk.prompt,
  };
  if (payload.outputDir && payload.videoPath) {
    const relative = path.relative(payload.outputDir, payload.videoPath);
    entry.videoPath = relative.startsWith('..') ? payload.videoPath : relative;
  } else {
    entry.videoPath = payload.videoPath || null;
  }
  chunk.history = Array.isArray(chunk.history) ? chunk.history : [];
  chunk.history.push(entry);
  chunk.lastRender = {
    at: entry.at,
    durationSec: entry.durationSec,
    videoPath: entry.videoPath,
    operationName: entry.operationName,
    prompt: entry.prompt,
  };
  if (chunk.status !== 'approved') {
    chunk.status = 'rendered';
  }
  touchChunk(chunk);
  touchPlan(plan);
  return chunk;
}

export function regenerateChunkPrompt(context, plan, chunkId) {
  const chunks = getTextPlanChunks(plan);
  const index = chunks.findIndex((chunk) => chunk.id === chunkId);
  if (index === -1) {
    throw new Error(`Chunk not found: ${chunkId}`);
  }
  const chunk = chunks[index];
  const prompt = composeChunkPrompt(context, plan, index, {
    narrationText: chunk.narrationText,
    durationSec: chunk.durationSec,
  });
  chunk.prompt = prompt;
  chunk.promptSource = 'auto';
  touchChunk(chunk);
  touchPlan(plan);
  return chunk;
}

export function recomputePlanTimeline(plan) {
  if (!plan || !Array.isArray(plan.chunks)) return;
  let cursor = 0;
  for (const chunk of plan.chunks) {
    const nextStart = Number(cursor.toFixed(2));
    cursor += chunk.durationSec;
    const nextEnd = Number(cursor.toFixed(2));
    if (chunk.startSec !== nextStart || chunk.endSec !== nextEnd) {
      chunk.startSec = nextStart;
      chunk.endSec = nextEnd;
      touchChunk(chunk);
    }
  }
  plan.meta.totalDurationSec = Number(cursor.toFixed(2));
  touchPlan(plan);
}
