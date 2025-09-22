import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';
import { GoogleGenAI } from '@google/genai';

import { ensureDir, probeDurationSeconds } from '../media-utils.js';

const DEFAULT_STATUS_INTERVAL_MS = 10000;
const PROGRESS_KEYS = [
  'progressPercentage',
  'progressPercent',
  'progress',
  'percentComplete',
];
const COMPLETION_KEYS = [
  ['progressUnitsCompleted', 'progressUnitsTotal'],
  ['stepsComplete', 'stepsTotal'],
  ['completedSteps', 'totalSteps'],
  ['currentStep', 'totalStepCount'],
];

function sanitizeLabel(label) {
  if (!label) return 'veo3';
  return label
    .toString()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'veo3';
}

function toFiniteNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const numeric = Number(value.replace(/[^0-9.]/g, ''));
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }
  return null;
}

function extractProgressPercentage(metadata) {
  if (!metadata || typeof metadata !== 'object') {
    return null;
  }
  for (const key of PROGRESS_KEYS) {
    const value = toFiniteNumber(metadata[key]);
    if (value !== null) {
      return Math.max(0, Math.min(100, value));
    }
  }
  for (const [doneKey, totalKey] of COMPLETION_KEYS) {
    const completed = toFiniteNumber(metadata[doneKey]);
    const total = toFiniteNumber(metadata[totalKey]);
    if (completed !== null && total) {
      if (total <= 0) continue;
      const percent = (completed / total) * 100;
      if (Number.isFinite(percent)) {
        return Math.max(0, Math.min(100, percent));
      }
    }
  }
  return null;
}

function logOperationProgress({ prefix, operation, tracker, startTime, pollIntervalMs, logger }) {
  if (!operation) {
    return;
  }
  const now = Date.now();
  const metadata = operation.metadata && typeof operation.metadata === 'object'
    ? operation.metadata
    : {};
  const state = metadata.state || metadata.status || metadata.phase || metadata.stage || null;
  const progress = extractProgressPercentage(metadata);
  const detail = metadata.message || metadata.progressMessage || metadata.detail || null;
  const interval = Math.max(pollIntervalMs || 0, DEFAULT_STATUS_INTERVAL_MS);
  const shouldLog =
    state !== tracker.lastState ||
    progress !== tracker.lastProgress ||
    now - tracker.lastLogTime >= interval;

  if (!shouldLog) {
    return;
  }

  const parts = [];
  if (state) parts.push(String(state));
  if (progress !== null) parts.push(`${Math.round(progress)}%`);
  parts.push(`${Math.round((now - startTime) / 1000)}s elapsed`);
  if (detail) parts.push(String(detail));

  const jobSuffix = operation.name ? ` ${operation.name}` : '';
  logger.log(chalk.gray(`[${prefix}] Status${jobSuffix} -> ${parts.join(' | ')}`));

  tracker.lastState = state;
  tracker.lastProgress = progress;
  tracker.lastLogTime = now;
}

async function writeOperationDiagnostics({ clipDir, label, operation, request, logger }) {
  if (!clipDir || !operation) return null;
  try {
    const dir = path.join(clipDir, 'diagnostics');
    await ensureDir(dir);
    const safeLabel = sanitizeLabel(label || operation.name || 'veo3');
    const filePath = path.join(dir, `${safeLabel}-${Date.now()}.json`);
    const payload = {
      savedAt: new Date().toISOString(),
      label,
      model: request?.model || null,
      config: request?.config || null,
      operationName: operation.name || null,
      metadata: operation.metadata || null,
      responseSummary: {
        blockingReasons: operation.response?.blockingReasons || null,
        errorReports: operation.response?.errorReports || null,
        safetyJudgments: operation.response?.safetyJudgments || null,
      },
      rawOperation: operation,
    };
    await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');
    if (logger && typeof logger.log === 'function') {
      logger.log(chalk.gray(`[veo3] Saved diagnostics to ${filePath}`));
    }
    return filePath;
  } catch (error) {
    if (logger && typeof logger.warn === 'function') {
      logger.warn(chalk.yellow(`[veo3] Failed to write diagnostics: ${error.message}`));
    }
    return null;
  }
}

function buildPrompt({ narrationSegment, fallbackText, index }) {
  const prefix = narrationSegment?.text
    ? narrationSegment.text.trim()
    : fallbackText?.trim() || `Panel ${index + 1}`;
  return `${prefix}`;
}

function deriveAspectRatio(metaSize) {
  if (!metaSize) return '9:16';
  const match = /^(\d+)x(\d+)$/i.exec(metaSize.trim());
  if (!match) return '9:16';
  const w = parseInt(match[1], 10);
  const h = parseInt(match[2], 10);
  if (!w || !h) return '9:16';
  const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));
  const divisor = gcd(w, h);
  return `${w / divisor}:${h / divisor}`;
}

function buildConfig({ durationSec, aspectRatio, providerConfig }) {
  const cfg = {};
  const numberOfVideos = providerConfig?.numberOfVideos ?? 1;
  if (numberOfVideos) cfg.numberOfVideos = numberOfVideos;
  if (aspectRatio) cfg.aspectRatio = aspectRatio;
  if (providerConfig?.resolution) cfg.resolution = providerConfig.resolution;
  if (providerConfig?.negativePrompt) cfg.negativePrompt = providerConfig.negativePrompt;
  if (providerConfig?.generateAudio !== undefined) cfg.generateAudio = providerConfig.generateAudio;
  if (providerConfig?.personGeneration) cfg.personGeneration = providerConfig.personGeneration;
  if (providerConfig?.compressionQuality) cfg.compressionQuality = providerConfig.compressionQuality;
  if (providerConfig?.enhancePrompt !== undefined) cfg.enhancePrompt = providerConfig.enhancePrompt;
  if (providerConfig?.seed !== undefined) cfg.seed = providerConfig.seed;
  if (providerConfig?.fps) cfg.fps = providerConfig.fps;
  if (providerConfig?.outputGcsUri) cfg.outputGcsUri = providerConfig.outputGcsUri;
  if (providerConfig?.allowDurationSeconds) {
    cfg.durationSeconds = durationSec;
  }
  return cfg;
}

export async function generateVeo3Clip({
  panel,
  context,
  durationSec,
  clipDir,
  providerConfig = {},
  narrationSegment,
  logger = console,
  dryRun = false,
}) {
  const apiKeyEnv = providerConfig.apiKeyEnv || 'VEO3_API_KEY';
  const apiKey = process.env[apiKeyEnv];
  if (!apiKey) {
    throw new Error(`Missing ${apiKeyEnv} environment variable`);
  }
  const model = providerConfig.model || 'veo-3-preview';
  const pollIntervalMs = providerConfig.pollIntervalMs ?? 5000;
  const timeoutMs = providerConfig.timeoutMs ?? 300000;

  const jobPrompt = buildPrompt({
    narrationSegment,
    fallbackText: context.metadata?.summary,
    index: panel.index,
  });

  if (dryRun) {
    logger.log(chalk.gray(`[veo3] Dry run -> would request ${model} for ${panel.id} with prompt: ${jobPrompt}`));
    return {
      status: 'dry-run',
      videoPath: path.join(clipDir, `${panel.id}-veo3.mp4`),
      durationSec,
      prompt: jobPrompt,
    };
  }

  const ai = new GoogleGenAI({ apiKey });
  const imageBuffer = await fs.readFile(panel.file);
  const aspectRatio = providerConfig.aspectRatio ?? deriveAspectRatio(context.metadata?.size);
  const request = {
    model,
    prompt: jobPrompt,
    config: buildConfig({ durationSec, aspectRatio, providerConfig }),
  };

  if (providerConfig?.includeImage !== false) {
    request.image = {
      imageBytes: imageBuffer.toString('base64'),
      mimeType: 'image/png',
    };
  }

  logger.log(chalk.gray(`[veo3] Submitting job for ${panel.id}`));

  let operation;
  try {
    operation = await ai.models.generateVideos(request);
  } catch (error) {
    throw new Error(`VEO3 request failed: ${error?.message || error}`);
  }

  const startTime = Date.now();
  const progressTracker = { lastState: null, lastProgress: null, lastLogTime: 0 };

  const deadline = Date.now() + timeoutMs;
  while (!operation.done && Date.now() < deadline) {
    logOperationProgress({
      prefix: 'veo3',
      operation,
      tracker: progressTracker,
      startTime,
      pollIntervalMs,
      logger,
    });
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    operation = await ai.operations.getVideosOperation({ operation });
  }
  logOperationProgress({
    prefix: 'veo3',
    operation,
    tracker: progressTracker,
    startTime,
    pollIntervalMs,
    logger,
  });

  if (!operation.done) {
    throw new Error('Timed out waiting for VEO3 job to complete');
  }
  if (operation.error) {
    throw new Error(`VEO3 job failed: ${JSON.stringify(operation.error)}`);
  }

  const videos = operation.response?.generatedVideos;
  if (!Array.isArray(videos) || !videos.length) {
    await writeOperationDiagnostics({
      clipDir,
      label: panel?.id || panel?.providerId || 'veo3-clip',
      operation,
      request,
      logger,
    });
    throw new Error('VEO3 response did not include any videos');
  }

  await ensureDir(clipDir);
  const outputPath = path.join(clipDir, `${panel.id}-veo3.mp4`);
  try {
    await ai.files.download({ file: videos[0], downloadPath: outputPath });
  } catch (error) {
    throw new Error(`Failed to download VEO3 video: ${error?.message || error}`);
  }

  const actualDuration = await probeDurationSeconds(outputPath).catch(() => durationSec);

  return {
    status: 'ready',
    videoPath: outputPath,
    audioPath: outputPath,
    durationSec: actualDuration ?? durationSec,
    provider: 'veo3',
    prompt: jobPrompt,
    operationName: operation.name,
  };
}

export async function generateVeo3TextVideo({
  prompt,
  clipDir,
  outFile,
  durationSec = 6,
  resolution = null,
  providerConfig = {},
  logger = console,
  diagnosticLabel = null,
}) {
  if (!prompt || !prompt.trim()) {
    throw new Error('Prompt is required for text-based generation');
  }

  const apiKeyEnv = providerConfig.apiKeyEnv || 'VEO3_API_KEY';
  const apiKey = process.env[apiKeyEnv];
  if (!apiKey) {
    throw new Error(`Missing ${apiKeyEnv} environment variable`);
  }
  const model = providerConfig.model || 'veo-3-preview';
  const pollIntervalMs = providerConfig.pollIntervalMs ?? 5000;
  const timeoutMs = providerConfig.timeoutMs ?? 300000;
  const aspectRatio = providerConfig.aspectRatio ?? null;

  const ai = new GoogleGenAI({ apiKey });
  const effectiveConfig = { ...providerConfig };
  if (resolution) effectiveConfig.resolution = resolution;
  const videoConfig = buildConfig({ durationSec, aspectRatio, providerConfig: effectiveConfig });

  const request = {
    model,
    prompt,
    config: videoConfig,
  };

  logger.log(chalk.gray('[veo3-text] Submitting prompt-based job'));

  let operation;
  try {
    operation = await ai.models.generateVideos(request);
  } catch (error) {
    throw new Error(`VEO3 request failed: ${error?.message || error}`);
  }

  const startTime = Date.now();
  const progressTracker = { lastState: null, lastProgress: null, lastLogTime: 0 };

  const deadline = Date.now() + timeoutMs;
  while (!operation.done && Date.now() < deadline) {
    logOperationProgress({
      prefix: 'veo3-text',
      operation,
      tracker: progressTracker,
      startTime,
      pollIntervalMs,
      logger,
    });
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    operation = await ai.operations.getVideosOperation({ operation });
  }
  logOperationProgress({
    prefix: 'veo3-text',
    operation,
    tracker: progressTracker,
    startTime,
    pollIntervalMs,
    logger,
  });

  if (!operation.done) {
    throw new Error('Timed out waiting for VEO3 job to complete');
  }
  if (operation.error) {
    throw new Error(`VEO3 job failed: ${JSON.stringify(operation.error)}`);
  }

  const videos = operation.response?.generatedVideos;
  if (!Array.isArray(videos) || !videos.length) {
    await writeOperationDiagnostics({
      clipDir,
      label: diagnosticLabel || path.basename(outFile, path.extname(outFile)),
      operation,
      request,
      logger,
    });
    throw new Error('VEO3 response did not include any videos');
  }

  await ensureDir(path.dirname(outFile));
  await ai.files.download({ file: videos[0], downloadPath: outFile });
  const actualDuration = await probeDurationSeconds(outFile).catch(() => durationSec);

  return {
    status: 'ready',
    videoPath: outFile,
    durationSec: actualDuration,
    provider: 'veo3-text',
    prompt,
    operationName: operation.name,
  };
}
