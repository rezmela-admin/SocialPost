import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';
import { select, input, confirm, editor } from '@inquirer/prompts';

import { loadManifest, saveManifest, setClip, markClipFailure, getClip, resolveClipPath } from './metadata.js';
import { generateVeo3Clip, generateVeo3TextVideo } from './providers/veo3.js';
import { generateZoomClip } from './providers/zoom.js';
import { assembleClips } from './assembler.js';
import { PROVIDER_IDS } from './providers/index.js';
import {
  ensureTextPlan,
  getTextPlan,
  getTextPlanChunks,
  findTextPlanChunk,
  updateTextPlanChunk,
  markChunkStatus,
  recordChunkRender,
  regenerateChunkPrompt,
  recomputePlanTimeline,
} from './planner.js';

export const ACTIONS = {
  GENERATE_VEO3: 'generate-veo3',
  GENERATE_ZOOM: 'generate-zoom',
  GENERATE_VEO3_TEXT: 'generate-veo3-text',
  PLAN_VEO3_TEXT: 'plan-veo3-text',
  ASSEMBLE: 'assemble-video',
  INSPECT: 'inspect-context',
};

function parsePanelFilter(panelArg, context) {
  if (!panelArg) return context.panels;
  const tokens = String(panelArg)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!tokens.length) return context.panels;
  const wanted = new Set();
  for (const token of tokens) {
    if (/^panel-\d+$/i.test(token)) {
      wanted.add(token.toLowerCase());
    } else if (/^\d+$/.test(token)) {
      const num = parseInt(token, 10);
      const id = `panel-${String(num).padStart(2, '0')}`;
      wanted.add(id.toLowerCase());
    }
  }
  const subset = context.panels.filter((panel) => wanted.has(panel.id.toLowerCase()));
  if (!subset.length) {
    throw new Error(`Panel filter did not match any panels: ${panelArg}`);
  }
  return subset;
}

function getNarrationSegment(context, panel) {
  const segments = context.narration?.json?.segments;
  if (!Array.isArray(segments)) return null;
  const found = segments.find((seg) => Number(seg.index) === panel.index + 1);
  return found || null;
}

function buildClipDir(context, config, providerId) {
  const outputSubdir = config?.videoGeneration?.outputSubdir || 'clips';
  return path.join(context.outputDir, outputSubdir, providerId);
}

async function ensureFileExists(file, description) {
  try {
    await fs.access(file);
  } catch (error) {
    throw new Error(`${description} missing at ${file}`);
  }
}

async function handleGenerate({ providerId, context, config, options }) {
  const manifest = await loadManifest(context.outputDir);
  const panels = parsePanelFilter(options.cliArgs?.panels, context);
  const providerConfig = config?.videoGeneration?.providers?.[providerId] || {};
  if (providerConfig.enabled === false) {
    throw new Error(`${providerId} provider is disabled in configuration`);
  }
  const clipDir = buildClipDir(context, config, providerId);
  const dryRun = !!options.cliArgs?.dryRun;
  const force = !!options.cliArgs?.force;

  let completed = 0;
  let skipped = 0;
  let failures = 0;

  for (const panel of panels) {
    const existing = getClip(manifest, panel.id, providerId);
    if (existing?.status === 'ready' && !force) {
      console.log(chalk.gray(`[${providerId}] Skipping ${panel.id} (already ready)`));
      skipped += 1;
      continue;
    }
    const durationSec = context.durations?.values?.[panel.index] ?? context.durations?.values?.[0] ?? 2;
    const narrationSegment = getNarrationSegment(context, panel);
    try {
      const generate = providerId === PROVIDER_IDS.VEO3 ? generateVeo3Clip : generateZoomClip;
      const result = await generate({
        panel,
        context,
        durationSec,
        clipDir,
        providerConfig,
        narrationSegment,
        dryRun,
        logger: console,
      });

      if (result.status === 'dry-run') {
        console.log(chalk.gray(`[${providerId}] Dry-run placeholder for ${panel.id}`));
        skipped += 1;
        continue;
      }

      setClip(manifest, context.outputDir, panel.id, providerId, {
        status: 'ready',
        videoPath: result.videoPath,
        audioPath: result.audioPath || null,
        durationSec: result.durationSec,
        providerId,
        prompt: result.prompt,
        operationName: result.operationName,
      });
      await saveManifest(context.outputDir, manifest);
      console.log(chalk.green(`[${providerId}] Ready -> ${panel.id}`));
      completed += 1;
    } catch (error) {
      markClipFailure(manifest, panel.id, providerId, error);
      await saveManifest(context.outputDir, manifest);
      console.log(chalk.red(`[${providerId}] Failed ${panel.id}: ${error.message}`));
      failures += 1;
      if (providerConfig.stopOnError) {
        break;
      }
    }
  }

  console.log(chalk.cyan(`[${providerId}] Summary -> completed: ${completed}, skipped: ${skipped}, failed: ${failures}`));
}

async function handleAssemble(context, config, options) {
  const manifest = await loadManifest(context.outputDir);
  const panels = parsePanelFilter(options.cliArgs?.panels, context);
  const clips = [];

  for (const panel of panels) {
    let chosen = getClip(manifest, panel.id, PROVIDER_IDS.VEO3);
    if (!chosen || chosen.status !== 'ready') {
      chosen = getClip(manifest, panel.id, PROVIDER_IDS.ZOOM);
    }
    if (!chosen || chosen.status !== 'ready') {
      throw new Error(`No ready clip found for ${panel.id}. Generate clips first.`);
    }
    const absolutePath = resolveClipPath(context.outputDir, chosen);
    await ensureFileExists(absolutePath, `Clip for ${panel.id}`);
    clips.push({
      panelId: panel.id,
      providerId: chosen.providerId || PROVIDER_IDS.VEO3,
      absolutePath,
    });
  }

  const outFile = options.cliArgs?.outFile
    ? path.resolve(options.cliArgs.outFile)
    : path.join(context.outputDir, `video-veo3-${Date.now()}.mp4`);

  await assembleClips({
    clips,
    outputPath: outFile,
    reencode: true,
    logger: console,
    dryRun: !!options.cliArgs?.dryRun,
  });

  if (!options.cliArgs?.dryRun) {
    const byProvider = clips.reduce((acc, clip) => {
      acc[clip.providerId] = (acc[clip.providerId] || 0) + 1;
      return acc;
    }, {});
    console.log(chalk.cyan('[assemble] Clip sources:'));
    for (const [providerId, count] of Object.entries(byProvider)) {
      console.log(`  - ${providerId}: ${count}`);
    }
    console.log(chalk.green(`[assemble] Video ready -> ${outFile}`));
  }
}

async function resolvePrompt(options, context) {
  if (options.cliArgs?.prompt) {
    return options.cliArgs.prompt;
  }
  if (options.cliArgs?.promptFile) {
    try {
      const filePath = path.resolve(options.cliArgs.promptFile);
      return await fs.readFile(filePath, 'utf8');
    } catch (error) {
      throw new Error(`Failed to read prompt file: ${error.message}`);
    }
  }
  const meta = context.metadata || {};
  const parts = [];
  if (meta.summary) parts.push(meta.summary);
  if (meta.topic) parts.push(meta.topic);
  if (Array.isArray(meta.panelDetails) && meta.panelDetails.length) {
    const firstPrompt = meta.panelDetails[0]?.prompt;
    if (firstPrompt) parts.push(firstPrompt);
  }
  const prompt = parts.join('\n\n').trim();
  if (!prompt) {
    throw new Error('No prompt available. Provide --prompt or --prompt-file.');
  }
  return prompt;
}

async function handleGenerateVeo3Text(context, config, options) {
  const providerConfig =
    config?.videoGeneration?.providers?.veo3Text ||
    config?.videoGeneration?.providers?.veo3 ||
    {};
  if (providerConfig.enabled === false) {
    throw new Error('veo3 provider is disabled in configuration');
  }
  const prompt = await resolvePrompt(options, context);
  const clipDir = buildClipDir(context, config, PROVIDER_IDS.VEO3_TEXT);
  const durationProvided = options.cliArgs?.duration;
  const durationSec = durationProvided ? Number(options.cliArgs.duration) : 6;
  if (Number.isNaN(durationSec) || durationSec <= 0) {
    throw new Error('Invalid duration specified for prompt-based generation');
  }
  const resolution =
    options.cliArgs?.resolution || providerConfig.resolution || null;
  const aspectOverride = options.cliArgs?.aspect || null;
  const outFile = options.cliArgs?.outFile
    ? path.resolve(options.cliArgs.outFile)
    : path.join(clipDir, `veo3-text-${Date.now()}.mp4`);

  if (options.cliArgs?.dryRun) {
    console.log(chalk.gray('[veo3-text] Dry run -> would generate video with prompt:'));
    console.log(chalk.gray(prompt));
    console.log(chalk.gray(`[veo3-text] Target file: ${outFile}`));
    return;
  }

  try {
    const effectiveConfig = {
      ...providerConfig,
      ...(aspectOverride ? { aspectRatio: aspectOverride } : {}),
    };
    if (!aspectOverride) delete effectiveConfig.aspectRatio;
    const result = await generateVeo3TextVideo({
      prompt,
      clipDir,
      outFile,
      durationSec,
      resolution,
      providerConfig: {
        ...effectiveConfig,
      },
      logger: console,
      diagnosticLabel: 'prompt-video',
    });
    console.log(chalk.green(`[veo3-text] Video ready -> ${result.videoPath}`));
  } catch (error) {
    throw new Error(`Prompt-based generation failed: ${error.message}`);
  }
}

const PLAN_EXIT = '__plan-exit__';

function truncateLabel(text, limit = 80) {
  if (!text) return '';
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= limit) return clean;
  return `${clean.slice(0, Math.max(0, limit - 3))}...`;
}

function formatChunkStatusLabel(status) {
  const normalized = status || 'pending';
  switch (normalized) {
    case 'approved':
      return chalk.green('approved');
    case 'rendered':
      return chalk.cyan('rendered');
    case 'failed':
      return chalk.red('failed');
    default:
      return chalk.yellow(normalized);
  }
}

function formatChunkChoice(chunk) {
  const statusLabel = formatChunkStatusLabel(chunk.status);
  const summary = truncateLabel(chunk.narrationText, 70);
  return `${chunk.id} [${statusLabel}] ${summary}`;
}

function printChunkDetails(chunk, plan) {
  console.log('');
  console.log(chalk.cyan(`Chunk ${chunk.id}`));
  console.log(`  Status      : ${formatChunkStatusLabel(chunk.status)}`);
  if (chunk.durationSec) {
    const max = plan?.meta?.maxDurationSec || 8;
    console.log(`  Duration    : ${chunk.durationSec}s (max ${max}s)`);
  }
  if (chunk.source) {
    const { segmentId, part, totalParts } = chunk.source;
    const label = totalParts > 1 ? `${segmentId} part ${part}/${totalParts}` : segmentId;
    console.log(`  Source      : ${label}`);
  }
  if (chunk.lastRender?.videoPath) {
    console.log(`  Last render : ${chunk.lastRender.videoPath}`);
  }
  if (chunk.narrationText) {
    console.log(`  Narration   : ${truncateLabel(chunk.narrationText, 140)}`);
  }
  console.log('');
  if (chunk.prompt) {
    console.log(chalk.gray('Current prompt:'));
    console.log(chalk.gray(chunk.prompt));
    console.log('');
  }
}

function printChunkHistory(chunk) {
  if (!Array.isArray(chunk.history) || !chunk.history.length) {
    console.log(chalk.gray('[plan] No renders recorded yet.'));
    return;
  }
  console.log(chalk.cyan(`[plan] Render history for ${chunk.id}:`));
  const recent = chunk.history.slice(-5).reverse();
  for (const entry of recent) {
    const parts = [];
    if (entry.at) parts.push(entry.at);
    if (entry.durationSec) parts.push(`${entry.durationSec}s`);
    if (entry.videoPath) parts.push(entry.videoPath);
    if (entry.operationName) parts.push(entry.operationName);
    console.log(`  • ${parts.join(' | ')}`);
  }
}

async function openPromptEditor(message, initial) {
  if (typeof editor === 'function') {
    const result = await editor({ message, default: initial });
    if (typeof result === 'string') {
      return result;
    }
  }
  return input({ message, default: initial });
}

async function renderPlannerChunk({ chunkId, manifest, context, providerConfig, clipDir, cliArgs }) {
  const plan = getTextPlan(manifest);
  const chunk = findTextPlanChunk(plan, chunkId);
  if (!chunk) {
    console.log(chalk.red(`[plan] Chunk ${chunkId} not found.`));
    return;
  }
  const prompt = chunk.prompt?.trim();
  if (!prompt) {
    console.log(chalk.red(`[plan] Chunk ${chunkId} has an empty prompt.`));
    return;
  }
  const durationSec = Number(chunk.durationSec);
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    console.log(chalk.red(`[plan] Chunk ${chunkId} has an invalid duration.`));
    return;
  }
  if (cliArgs?.dryRun) {
    console.log(chalk.gray(`[plan] Dry run -> would render ${chunk.id} (${durationSec}s)`));
    console.log(chalk.gray(prompt));
    return;
  }
  const aspectOverride = cliArgs?.aspect || null;
  const resolution = cliArgs?.resolution || providerConfig.resolution || null;
  const outFile = path.join(clipDir, `${chunk.id}-${Date.now()}.mp4`);
  const effectiveConfig = {
    ...providerConfig,
    ...(aspectOverride ? { aspectRatio: aspectOverride } : {}),
  };
  if (!aspectOverride) delete effectiveConfig.aspectRatio;
  const result = await generateVeo3TextVideo({
    prompt,
    clipDir,
    outFile,
    durationSec,
    resolution,
    providerConfig: {
      ...effectiveConfig,
    },
    logger: console,
    diagnosticLabel: chunk.id,
  });
  setClip(manifest, context.outputDir, chunk.id, PROVIDER_IDS.VEO3_TEXT, {
    status: 'ready',
    videoPath: result.videoPath,
    audioPath: result.audioPath || null,
    durationSec: result.durationSec,
    providerId: PROVIDER_IDS.VEO3_TEXT,
    prompt,
    operationName: result.operationName,
  });
  recordChunkRender(manifest, chunk.id, {
    outputDir: context.outputDir,
    videoPath: result.videoPath,
    durationSec: result.durationSec,
    prompt,
    operationName: result.operationName,
  });
  await saveManifest(context.outputDir, manifest);
  console.log(chalk.green(`[plan] Clip ready -> ${result.videoPath}`));
}

async function editPlannerPrompt({ chunkId, manifest, context }) {
  const plan = getTextPlan(manifest);
  const chunk = findTextPlanChunk(plan, chunkId);
  if (!chunk) {
    console.log(chalk.red(`[plan] Chunk ${chunkId} not found.`));
    return;
  }
  const nextPrompt = await openPromptEditor(`Edit prompt for ${chunk.id}`, chunk.prompt || '').catch(() => null);
  if (typeof nextPrompt !== 'string') {
    console.log(chalk.gray('[plan] Prompt unchanged.'));
    return;
  }
  const trimmed = nextPrompt.trim();
  if (!trimmed) {
    console.log(chalk.yellow('[plan] Prompt cannot be empty. Keeping previous value.'));
    return;
  }
  if (trimmed === (chunk.prompt || '').trim()) {
    console.log(chalk.gray('[plan] Prompt unchanged.'));
    return;
  }
  updateTextPlanChunk(plan, chunkId, (entry) => {
    entry.prompt = trimmed;
    entry.promptSource = 'manual';
  });
  markChunkStatus(plan, chunkId, 'pending');
  await saveManifest(context.outputDir, manifest);
  console.log(chalk.cyan(`[plan] Updated prompt for ${chunkId} and marked pending.`));
}

async function regeneratePlannerPrompt({ chunkId, manifest, context }) {
  const plan = getTextPlan(manifest);
  const chunk = findTextPlanChunk(plan, chunkId);
  if (!chunk) {
    console.log(chalk.red(`[plan] Chunk ${chunkId} not found.`));
    return;
  }
  const confirmed = await confirm({
    message: `Regenerate prompt for ${chunk.id} from narration?`,
    default: false,
  }).catch(() => false);
  if (!confirmed) return;
  regenerateChunkPrompt(context, plan, chunkId);
  markChunkStatus(plan, chunkId, 'pending');
  await saveManifest(context.outputDir, manifest);
  console.log(chalk.cyan(`[plan] Regenerated prompt for ${chunkId} and marked pending.`));
}

async function adjustPlannerDuration({ chunkId, manifest, context }) {
  const plan = getTextPlan(manifest);
  const chunk = findTextPlanChunk(plan, chunkId);
  if (!chunk) {
    console.log(chalk.red(`[plan] Chunk ${chunkId} not found.`));
    return;
  }
  const maxDuration = plan.meta?.maxDurationSec || 8;
  const answer = await input({
    message: `New duration for ${chunk.id} (seconds, ≤ ${maxDuration})`,
    default: String(chunk.durationSec || maxDuration),
  }).catch(() => null);
  if (typeof answer !== 'string') {
    console.log(chalk.gray('[plan] Duration unchanged.'));
    return;
  }
  const parsed = Number(answer);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.log(chalk.red('[plan] Invalid duration value.'));
    return;
  }
  const capped = Math.min(parsed, maxDuration);
  updateTextPlanChunk(plan, chunkId, (entry) => {
    entry.durationSec = Number(capped.toFixed(2));
  });
  recomputePlanTimeline(plan);
  await saveManifest(context.outputDir, manifest);
  console.log(chalk.cyan(`[plan] Updated duration for ${chunkId} to ${capped.toFixed(2)}s.`));
}

async function togglePlannerApproval({ chunkId, manifest, context }) {
  const plan = getTextPlan(manifest);
  const chunk = findTextPlanChunk(plan, chunkId);
  if (!chunk) {
    console.log(chalk.red(`[plan] Chunk ${chunkId} not found.`));
    return;
  }
  if (chunk.status === 'approved') {
    const fallback = chunk.lastRender ? 'rendered' : 'pending';
    markChunkStatus(plan, chunkId, fallback);
    await saveManifest(context.outputDir, manifest);
    console.log(chalk.gray(`[plan] ${chunkId} marked as ${fallback}.`));
    return;
  }
  markChunkStatus(plan, chunkId, 'approved');
  await saveManifest(context.outputDir, manifest);
  console.log(chalk.green(`[plan] ${chunkId} approved.`));
}

async function runChunkEditor({ chunkId, manifest, context, providerConfig, clipDir, cliArgs }) {
  let stay = true;
  while (stay) {
    const plan = getTextPlan(manifest);
    const chunk = findTextPlanChunk(plan, chunkId);
    if (!chunk) {
      console.log(chalk.red(`[plan] Chunk ${chunkId} no longer exists.`));
      return;
    }
    printChunkDetails(chunk, plan);
    const action = await select({
      message: `Next action for ${chunk.id}`,
      choices: [
        { name: 'Render clip', value: 'render' },
        { name: 'Edit prompt', value: 'edit' },
        { name: 'Regenerate prompt from narration', value: 'regen' },
        { name: 'Adjust duration target', value: 'duration' },
        { name: chunk.status === 'approved' ? 'Unapprove clip' : 'Mark as approved', value: 'toggle' },
        { name: 'View render history', value: 'history' },
        { name: 'Back to chunk list', value: 'back' },
      ],
    }).catch((error) => {
      if (error?.name === 'AbortError') return 'back';
      throw error;
    });

    switch (action) {
      case 'render':
        await renderPlannerChunk({ chunkId, manifest, context, providerConfig, clipDir, cliArgs });
        break;
      case 'edit':
        await editPlannerPrompt({ chunkId, manifest, context });
        break;
      case 'regen':
        await regeneratePlannerPrompt({ chunkId, manifest, context });
        break;
      case 'duration':
        await adjustPlannerDuration({ chunkId, manifest, context });
        break;
      case 'toggle':
        await togglePlannerApproval({ chunkId, manifest, context });
        break;
      case 'history':
        printChunkHistory(chunk);
        break;
      case 'back':
      default:
        stay = false;
        break;
    }
  }
}

async function handlePlanVeo3Text(context, config, options) {
  const manifest = await loadManifest(context.outputDir);
  const providerConfig =
    config?.videoGeneration?.providers?.veo3Text ||
    config?.videoGeneration?.providers?.veo3 ||
    {};
  const maxDurationArg = Number(options.cliArgs?.maxDuration);
  ensureTextPlan(manifest, context, {
    maxDurationSec: Number.isFinite(maxDurationArg) && maxDurationArg > 0 ? maxDurationArg : undefined,
    providerConfig,
  });
  await saveManifest(context.outputDir, manifest);

  const clipDir = buildClipDir(context, config, PROVIDER_IDS.VEO3_TEXT);
  let nextChunkId = options.cliArgs?.chunk || null;
  let exitPlanner = false;

  while (!exitPlanner) {
    const plan = getTextPlan(manifest);
    const chunks = getTextPlanChunks(plan);
    if (!chunks.length) {
      console.log(chalk.yellow('[plan] No narration chunks available to plan.'));
      break;
    }
    const choices = chunks.map((chunk) => ({
      name: formatChunkChoice(chunk),
      value: chunk.id,
    }));
    choices.push({ name: 'Exit planner', value: PLAN_EXIT });

    const selection = nextChunkId || await select({
      message: 'Select narration chunk',
      choices,
    }).catch((error) => {
      if (error?.name === 'AbortError') {
        return PLAN_EXIT;
      }
      throw error;
    });
    nextChunkId = null;

    if (!selection || selection === PLAN_EXIT) {
      exitPlanner = true;
      break;
    }

    await runChunkEditor({
      chunkId: selection,
      manifest,
      context,
      providerConfig,
      clipDir,
      cliArgs: options.cliArgs || {},
    });
    await saveManifest(context.outputDir, manifest);
  }

  await saveManifest(context.outputDir, manifest);
}

async function inspectContext(context, config) {
  console.log(chalk.cyan('\n[Context] Project overview:'));
  console.log(`  Output Dir : ${context.outputDir}`);
  console.log(`  Panels     : ${context.panels.length}`);
  console.log(`  Duration src: ${context.durations.source}`);
  console.log(`  Narration  : ${context.narration.audioPath ? 'audio (wav) present' : 'no audio file'}`);
  if (config?.videoGeneration?.providers) {
    console.log('  Providers  :');
    for (const [id, provider] of Object.entries(config.videoGeneration.providers)) {
      console.log(`    - ${id}: ${provider.enabled === false ? 'disabled' : 'enabled'}`);
    }
  }
  console.log('');
}

export async function executeAction(action, context, config, options = {}) {
  switch (action) {
    case ACTIONS.INSPECT:
      return inspectContext(context, config);
    case ACTIONS.GENERATE_VEO3:
      return handleGenerate({ providerId: PROVIDER_IDS.VEO3, context, config, options });
    case ACTIONS.GENERATE_ZOOM:
      return handleGenerate({ providerId: PROVIDER_IDS.ZOOM, context, config, options });
    case ACTIONS.GENERATE_VEO3_TEXT:
      return handleGenerateVeo3Text(context, config, options);
    case ACTIONS.PLAN_VEO3_TEXT:
      return handlePlanVeo3Text(context, config, options);
    case ACTIONS.ASSEMBLE:
      return handleAssemble(context, config, options);
    default:
      throw new Error(`Unknown action: ${action}`);
  }
}
