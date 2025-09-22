#!/usr/bin/env node
import 'dotenv/config';
import path from 'path';
import fs from 'fs/promises';
import chalk from 'chalk';
import { select, confirm, input } from '@inquirer/prompts';

import { loadVideoBuilderConfig, getRepoRoot } from './lib/config-loader.js';
import { loadProjectContext } from './lib/context-loader.js';
import { ACTIONS, executeAction } from './lib/actions.js';


const MAIN_MENU_CHOICES = {
  PLAN: 'planner',
  PROMPT_VIDEO: 'prompt-video',
  IMAGE_VIDEO: 'image-video',
  ASSEMBLE: 'assemble',
  INSPECT: 'inspect',
  SWITCH_OUTPUT: 'switch-output',
  EXIT: 'exit',
};

function buildBaseCliArgs(args = {}) {
  const clone = { ...args };
  delete clone._;
  delete clone.action;
  delete clone.outputDir;
  delete clone.configPath;
  delete clone.help;
  return clone;
}

function formatToggle(flag) {
  return flag ? 'on' : 'off';
}

function createMenuState(baseCliArgs) {
  return {
    plan: { ...baseCliArgs },
    prompt: { ...baseCliArgs },
    image: { ...baseCliArgs },
    assemble: { ...baseCliArgs },
  };
}

async function refreshSessionContext(session) {
  const refreshed = await loadProjectContext(session.outputDir);
  session.context = refreshed;
}

async function executeWithSession(session, action, cliArgs, { reload = true } = {}) {
  try {
    await executeAction(action, session.context, session.config, { cliArgs });
  } catch (error) {
    console.error(chalk.red(`[${action}] ${error?.message || error}`));
    return;
  }
  if (!reload) {
    return;
  }
  try {
    await refreshSessionContext(session);
  } catch (error) {
    console.error(chalk.red(`[reload] ${error?.message || error}`));
  }
}

async function runPlanMenu(session, planArgs) {
  while (true) {
    const summary = [
      `chunk=${planArgs.chunk || 'auto'}`,
      `max=${planArgs.maxDuration || 'default'}`,
      `dry-run=${formatToggle(Boolean(planArgs.dryRun))}`,
    ].join(', ');
    const choices = [
      { name: 'Open planner with current settings', value: 'run' },
      { name: 'Set chunk filter', value: 'set-chunk' },
    ];
    if (planArgs.chunk) {
      choices.push({ name: 'Clear chunk filter', value: 'clear-chunk' });
    }
    choices.push({ name: 'Set max duration cap', value: 'set-max' });
    if (planArgs.maxDuration) {
      choices.push({ name: 'Clear max duration cap', value: 'clear-max' });
    }
    choices.push({ name: planArgs.dryRun ? 'Disable dry run' : 'Enable dry run', value: 'toggle-dry-run' });
    choices.push({ name: 'Back to main menu', value: 'back' });

    const choice = await select({
      message: `[Planner] ${summary}`,
      choices,
    }).catch((error) => {
      if (error?.name === 'AbortError') return 'back';
      throw error;
    });

    if (!choice || choice === 'back') {
      return;
    }

    if (choice === 'run') {
      await executeWithSession(session, ACTIONS.PLAN_VEO3_TEXT, planArgs);
      continue;
    }

    if (choice === 'set-chunk') {
      const answer = await input({
        message: 'Chunk id (e.g., chunk-03)',
        default: planArgs.chunk || '',
      }).catch(() => null);
      if (answer === null) continue;
      const trimmed = answer.trim();
      if (!trimmed) {
        console.log(chalk.gray('[planner] Chunk filter unchanged.'));
        continue;
      }
      planArgs.chunk = trimmed;
      continue;
    }

    if (choice === 'clear-chunk') {
      delete planArgs.chunk;
      console.log(chalk.gray('[planner] Chunk filter cleared.'));
      continue;
    }

    if (choice === 'set-max') {
      const answer = await input({
        message: 'Maximum seconds per clip (>= 3)',
        default: planArgs.maxDuration ? String(planArgs.maxDuration) : '',
      }).catch(() => null);
      if (answer === null) continue;
      const trimmed = answer.trim();
      if (!trimmed) {
        console.log(chalk.gray('[planner] Max duration unchanged.'));
        continue;
      }
      const numeric = Number(trimmed);
      if (!Number.isFinite(numeric) || numeric < 3) {
        console.log(chalk.red('[planner] Enter a number greater than or equal to 3.'));
        continue;
      }
      planArgs.maxDuration = String(numeric);
      continue;
    }

    if (choice === 'clear-max') {
      delete planArgs.maxDuration;
      console.log(chalk.gray('[planner] Max duration cap cleared.'));
      continue;
    }

    if (choice === 'toggle-dry-run') {
      if (planArgs.dryRun) {
        delete planArgs.dryRun;
        console.log(chalk.gray('[planner] Dry run disabled.'));
      } else {
        planArgs.dryRun = true;
        console.log(chalk.gray('[planner] Dry run enabled.'));
      }
      continue;
    }
  }
}

async function runPromptVideoMenu(session, promptArgs) {
  while (true) {
    const summary = [
      `prompt=${promptArgs.prompt ? 'custom' : 'auto'}`,
      `duration=${promptArgs.duration || 'default'}`,
      `resolution=${promptArgs.resolution || 'default'}`,
      `aspect=${promptArgs.aspect || 'default'}`,
      `dry-run=${formatToggle(Boolean(promptArgs.dryRun))}`,
    ].join(', ');
    const choices = [
      { name: 'Generate video now', value: 'run' },
      { name: 'Set prompt override', value: 'set-prompt' },
    ];
    if (promptArgs.prompt) {
      choices.push({ name: 'Clear prompt override', value: 'clear-prompt' });
    }
    choices.push({ name: 'Set duration override', value: 'set-duration' });
    if (promptArgs.duration) {
      choices.push({ name: 'Clear duration override', value: 'clear-duration' });
    }
    choices.push({ name: 'Set resolution override', value: 'set-resolution' });
    if (promptArgs.resolution) {
      choices.push({ name: 'Clear resolution override', value: 'clear-resolution' });
    }
    choices.push({ name: 'Set aspect ratio override', value: 'set-aspect' });
    if (promptArgs.aspect) {
      choices.push({ name: 'Clear aspect ratio override', value: 'clear-aspect' });
    }
    choices.push({ name: promptArgs.dryRun ? 'Disable dry run' : 'Enable dry run', value: 'toggle-dry-run' });
    choices.push({ name: 'Back to main menu', value: 'back' });

    const choice = await select({
      message: `[Prompt video] ${summary}`,
      choices,
    }).catch((error) => {
      if (error?.name === 'AbortError') return 'back';
      throw error;
    });

    if (!choice || choice === 'back') {
      return;
    }

    if (choice === 'run') {
      await executeWithSession(session, ACTIONS.GENERATE_VEO3_TEXT, promptArgs);
      continue;
    }

    if (choice === 'set-prompt') {
      const answer = await input({
        message: 'Prompt override',
        default: promptArgs.prompt || '',
      }).catch(() => null);
      if (answer === null) continue;
      const trimmed = answer.trim();
      if (!trimmed) {
        console.log(chalk.gray('[prompt] Prompt unchanged.'));
        continue;
      }
      promptArgs.prompt = trimmed;
      continue;
    }

    if (choice === 'clear-prompt') {
      delete promptArgs.prompt;
      console.log(chalk.gray('[prompt] Prompt override cleared.'));
      continue;
    }

    if (choice === 'set-duration') {
      const answer = await input({
        message: 'Duration in seconds (> 0)',
        default: promptArgs.duration ? String(promptArgs.duration) : '',
      }).catch(() => null);
      if (answer === null) continue;
      const trimmed = answer.trim();
      if (!trimmed) {
        console.log(chalk.gray('[prompt] Duration unchanged.'));
        continue;
      }
      const numeric = Number(trimmed);
      if (!Number.isFinite(numeric) || numeric <= 0) {
        console.log(chalk.red('[prompt] Enter a positive number.'));
        continue;
      }
      promptArgs.duration = String(numeric);
      continue;
    }

    if (choice === 'clear-duration') {
      delete promptArgs.duration;
      console.log(chalk.gray('[prompt] Duration override cleared.'));
      continue;
    }

    if (choice === 'set-resolution') {
      const answer = await input({
        message: 'Resolution override (e.g., 1080p)',
        default: promptArgs.resolution || '',
      }).catch(() => null);
      if (answer === null) continue;
      const trimmed = answer.trim();
      if (!trimmed) {
        console.log(chalk.gray('[prompt] Resolution unchanged.'));
        continue;
      }
      promptArgs.resolution = trimmed;
      continue;
    }

    if (choice === 'clear-resolution') {
      delete promptArgs.resolution;
      console.log(chalk.gray('[prompt] Resolution override cleared.'));
      continue;
    }

    if (choice === 'set-aspect') {
      const answer = await input({
        message: 'Aspect ratio override (e.g., 9:16)',
        default: promptArgs.aspect || '',
      }).catch(() => null);
      if (answer === null) continue;
      const trimmed = answer.trim();
      if (!trimmed) {
        console.log(chalk.gray('[prompt] Aspect ratio unchanged.'));
        continue;
      }
      promptArgs.aspect = trimmed;
      continue;
    }

    if (choice === 'clear-aspect') {
      delete promptArgs.aspect;
      console.log(chalk.gray('[prompt] Aspect ratio override cleared.'));
      continue;
    }

    if (choice === 'toggle-dry-run') {
      if (promptArgs.dryRun) {
        delete promptArgs.dryRun;
        console.log(chalk.gray('[prompt] Dry run disabled.'));
      } else {
        promptArgs.dryRun = true;
        console.log(chalk.gray('[prompt] Dry run enabled.'));
      }
      continue;
    }
  }
}

async function runImageClipMenu(session, clipArgs) {
  while (true) {
    const summary = [
      `panels=${clipArgs.panels || 'all'}`,
      `force=${formatToggle(Boolean(clipArgs.force))}`,
      `dry-run=${formatToggle(Boolean(clipArgs.dryRun))}`,
    ].join(', ');
    const choices = [
      { name: 'Generate clips now', value: 'run' },
      { name: 'Set panel filter (comma separated)', value: 'set-panels' },
    ];
    if (clipArgs.panels) {
      choices.push({ name: 'Clear panel filter', value: 'clear-panels' });
    }
    choices.push({ name: clipArgs.force ? 'Disable force regeneration' : 'Enable force regeneration', value: 'toggle-force' });
    choices.push({ name: clipArgs.dryRun ? 'Disable dry run' : 'Enable dry run', value: 'toggle-dry-run' });
    choices.push({ name: 'Back to main menu', value: 'back' });

    const choice = await select({
      message: `[Image clips] ${summary}`,
      choices,
    }).catch((error) => {
      if (error?.name === 'AbortError') return 'back';
      throw error;
    });

    if (!choice || choice === 'back') {
      return;
    }

    if (choice === 'run') {
      await executeWithSession(session, ACTIONS.GENERATE_VEO3, clipArgs);
      continue;
    }

    if (choice === 'set-panels') {
      const answer = await input({
        message: 'Panel list (e.g., 1,3,5 or panel-02)',
        default: clipArgs.panels || '',
      }).catch(() => null);
      if (answer === null) continue;
      const trimmed = answer.trim();
      if (!trimmed) {
        console.log(chalk.gray('[clips] Panel filter unchanged.'));
        continue;
      }
      clipArgs.panels = trimmed;
      continue;
    }

    if (choice === 'clear-panels') {
      delete clipArgs.panels;
      console.log(chalk.gray('[clips] Panel filter cleared.'));
      continue;
    }

    if (choice === 'toggle-force') {
      if (clipArgs.force) {
        delete clipArgs.force;
        console.log(chalk.gray('[clips] Force regeneration disabled.'));
      } else {
        clipArgs.force = true;
        console.log(chalk.gray('[clips] Force regeneration enabled.'));
      }
      continue;
    }

    if (choice === 'toggle-dry-run') {
      if (clipArgs.dryRun) {
        delete clipArgs.dryRun;
        console.log(chalk.gray('[clips] Dry run disabled.'));
      } else {
        clipArgs.dryRun = true;
        console.log(chalk.gray('[clips] Dry run enabled.'));
      }
      continue;
    }
  }
}

async function runAssembleMenu(session, assembleArgs) {
  while (true) {
    const summary = [
      `outFile=${assembleArgs.outFile || 'auto'}`,
      `dry-run=${formatToggle(Boolean(assembleArgs.dryRun))}`,
    ].join(', ');
    const choices = [
      { name: 'Assemble video now', value: 'run' },
      { name: 'Set output filename', value: 'set-out' },
    ];
    if (assembleArgs.outFile) {
      choices.push({ name: 'Clear output filename', value: 'clear-out' });
    }
    choices.push({ name: assembleArgs.dryRun ? 'Disable dry run' : 'Enable dry run', value: 'toggle-dry-run' });
    choices.push({ name: 'Back to main menu', value: 'back' });

    const choice = await select({
      message: `[Assemble] ${summary}`,
      choices,
    }).catch((error) => {
      if (error?.name === 'AbortError') return 'back';
      throw error;
    });

    if (!choice || choice === 'back') {
      return;
    }

    if (choice === 'run') {
      await executeWithSession(session, ACTIONS.ASSEMBLE, assembleArgs);
      continue;
    }

    if (choice === 'set-out') {
      const answer = await input({
        message: 'Output filename',
        default: assembleArgs.outFile ? path.relative(session.outputDir, assembleArgs.outFile) : '',
      }).catch(() => null);
      if (answer === null) continue;
      const trimmed = answer.trim();
      if (!trimmed) {
        console.log(chalk.gray('[assemble] Output filename unchanged.'));
        continue;
      }
      assembleArgs.outFile = path.isAbsolute(trimmed)
        ? trimmed
        : path.resolve(session.outputDir, trimmed);
      continue;
    }

    if (choice === 'clear-out') {
      delete assembleArgs.outFile;
      console.log(chalk.gray('[assemble] Output filename cleared.'));
      continue;
    }

    if (choice === 'toggle-dry-run') {
      if (assembleArgs.dryRun) {
        delete assembleArgs.dryRun;
        console.log(chalk.gray('[assemble] Dry run disabled.'));
      } else {
        assembleArgs.dryRun = true;
        console.log(chalk.gray('[assemble] Dry run enabled.'));
      }
      continue;
    }
  }
}

async function runInspectMenu(session, baseCliArgs) {
  await executeWithSession(session, ACTIONS.INSPECT, baseCliArgs, { reload: false });
}

async function switchOutputDirectory(session) {
  let next;
  try {
    next = await resolveOutputDir();
  } catch (error) {
    console.error(chalk.red(`[menu] ${error?.message || error}`));
    return false;
  }
  try {
    const context = await loadProjectContext(next);
    session.outputDir = next;
    session.context = context;
    console.log(chalk.cyan(`[menu] Switched to ${path.basename(next)}`));
    return true;
  } catch (error) {
    console.error(chalk.red(`[menu] ${error?.message || error}`));
    return false;
  }
}

async function runInteractiveSession({ config, initialOutputDir, initialContext, args }) {
  const session = {
    config,
    outputDir: initialOutputDir,
    context: initialContext,
  };
  const baseCliArgs = buildBaseCliArgs(args);
  let memo = createMenuState(baseCliArgs);

  while (true) {
    const choice = await select({
      message: `Video Builder (${path.basename(session.outputDir)})`,
      choices: [
        { name: 'Clip planner', value: MAIN_MENU_CHOICES.PLAN },
        { name: 'Prompt-based video generator', value: MAIN_MENU_CHOICES.PROMPT_VIDEO },
        { name: 'Image-based clip generator', value: MAIN_MENU_CHOICES.IMAGE_VIDEO },
        { name: 'Assemble final video', value: MAIN_MENU_CHOICES.ASSEMBLE },
        { name: 'Inspect project context', value: MAIN_MENU_CHOICES.INSPECT },
        { name: 'Switch output directory', value: MAIN_MENU_CHOICES.SWITCH_OUTPUT },
        { name: 'Exit', value: MAIN_MENU_CHOICES.EXIT },
      ],
    }).catch((error) => {
      if (error?.name === 'AbortError') return MAIN_MENU_CHOICES.EXIT;
      throw error;
    });

    switch (choice) {
      case MAIN_MENU_CHOICES.PLAN:
        await runPlanMenu(session, memo.plan);
        break;
      case MAIN_MENU_CHOICES.PROMPT_VIDEO:
        await runPromptVideoMenu(session, memo.prompt);
        break;
      case MAIN_MENU_CHOICES.IMAGE_VIDEO:
        await runImageClipMenu(session, memo.image);
        break;
      case MAIN_MENU_CHOICES.ASSEMBLE:
        await runAssembleMenu(session, memo.assemble);
        break;
      case MAIN_MENU_CHOICES.INSPECT:
        await runInspectMenu(session, baseCliArgs);
        break;
      case MAIN_MENU_CHOICES.SWITCH_OUTPUT: {
        const switched = await switchOutputDirectory(session);
        if (switched) {
          memo = createMenuState(baseCliArgs);
        }
        break;
      }
      case MAIN_MENU_CHOICES.EXIT:
      default: {
        const confirmed = await confirm({
          message: 'Exit video builder?',
          default: true,
        }).catch(() => true);
        if (confirmed) {
          return;
        }
        break;
      }
    }
  }
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('-')) {
      args._.push(token);
      continue;
    }
    switch (token) {
      case '--help':
      case '-h':
        args.help = true;
        break;
      case '--config':
      case '-c':
        args.configPath = argv[i + 1];
        i += 1;
        break;
      case '--output':
      case '-o':
        args.outputDir = argv[i + 1];
        i += 1;
        break;
      case '--action':
      case '-a':
        args.action = argv[i + 1];
        i += 1;
        break;
      case '--out-file':
        args.outFile = argv[i + 1];
        i += 1;
        break;
      case '--chunk':
        args.chunk = argv[i + 1];
        i += 1;
        break;
      case '--max-duration':
        args.maxDuration = argv[i + 1];
        i += 1;
        break;
      case '--panel':
      case '--panels':
        args.panels = argv[i + 1];
        i += 1;
        break;
      case '--dry-run':
        args.dryRun = true;
        break;
      case '--force':
        args.force = true;
        break;
      case '--prompt':
        args.prompt = argv[i + 1];
        i += 1;
        break;
      case '--prompt-file':
        args.promptFile = argv[i + 1];
        i += 1;
        break;
      case '--duration':
        args.duration = argv[i + 1];
        i += 1;
        break;
      case '--resolution':
        args.resolution = argv[i + 1];
        i += 1;
        break;
      case '--aspect':
        args.aspect = argv[i + 1];
        i += 1;
        break;
      default:
        console.warn(chalk.yellow(`Unknown flag ignored: ${token}`));
        break;
    }
  }
  return args;
}

function printHelp() {
  console.log(`Usage: node tools/video-builder/index.js [options]\n\n` +
    `Options:\n` +
    `  -h, --help              Show this help message\n` +
    `  -c, --config PATH       Path to video builder config\n` +
    `  -o, --output PATH       Path to outputs/<run> directory\n` +
    `  -a, --action NAME       Action (inspect | generate-veo3 | generate-veo3-text | plan-veo3-text | generate-zoom | assemble-video)\n` +
    `      --panel LIST        Limit to specific panels (e.g., 1,3,5 or panel-02)\n` +
    `      --out-file PATH     Override output file for assemble-video\n` +
    `      --chunk ID         Planner: jump directly to a chunk id\n` +
    `      --max-duration SEC Planner: override max seconds per clip\n` +
    `      --dry-run           Run without network/ffmpeg writes where supported\n` +
    `      --force             Re-run generation even if clips already exist\n` +
    `      --prompt TEXT       Prompt to use for prompt-based generation\n` +
    `      --prompt-file FILE  Load prompt text from file\n` +
    `      --duration SEC      Override duration (seconds) for prompt-based mode\n` +
    `      --resolution QUAL   Override resolution (e.g., 1080p) for prompt-based mode\n` +
    `      --aspect RATIO      Override aspect ratio (e.g., 9:16) for prompt-based mode\n`);
}

async function listOutputDirectories() {
  const outputsRoot = path.join(getRepoRoot(), 'outputs');
  try {
    const entries = await fs.readdir(outputsRoot, { withFileTypes: true });
    const dirs = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const candidate = path.join(outputsRoot, entry.name);
      const metadataPath = path.join(candidate, 'metadata.json');
      const panelsDir = path.join(candidate, 'panels');
      try {
        await fs.access(metadataPath);
        await fs.access(panelsDir);
        const stats = await fs.stat(candidate);
        dirs.push({
          name: entry.name,
          path: candidate,
          mtimeMs: stats.mtimeMs,
        });
      } catch (error) {
        if (error?.code !== 'ENOENT') {
          console.warn(chalk.yellow(`Skipping ${candidate}: ${error.message}`));
        }
      }
    }
    dirs.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return dirs;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

async function resolveOutputDir(argPath) {
  if (argPath) {
    return path.resolve(argPath);
  }
  const candidates = await listOutputDirectories();
  if (!candidates.length) {
    throw new Error('No outputs found. Generate a project first.');
  }
  const choice = await select({
    message: 'Select an output directory:',
    choices: candidates.map((dir) => ({ name: dir.name, value: dir.path })),
  });
  return choice;
}

async function resolveAction(argAction) {
  if (argAction) {
    const normalized = String(argAction).toLowerCase();
    if (normalized === 'inspect' || normalized === ACTIONS.INSPECT) return ACTIONS.INSPECT;
    if (normalized === 'generate-veo3') return ACTIONS.GENERATE_VEO3;
    if (normalized === 'generate-veo3-text' || normalized === 'generate-veo3-prompt') return ACTIONS.GENERATE_VEO3_TEXT;
    if (normalized === 'plan-veo3-text') return ACTIONS.PLAN_VEO3_TEXT;
    if (normalized === 'generate-zoom') return ACTIONS.GENERATE_ZOOM;
    if (normalized === 'assemble-video' || normalized === 'assemble') return ACTIONS.ASSEMBLE;
    if (normalized === 'exit') return 'exit';
    throw new Error(`Unknown action: ${argAction}`);
  }
  const choice = await select({
    message: 'Select an action to run:',
    choices: [
      { name: 'Inspect project context', value: ACTIONS.INSPECT },
      { name: 'Generate VEO3 clips (image-based)', value: ACTIONS.GENERATE_VEO3 },
      { name: 'Generate VEO3 video from prompt', value: ACTIONS.GENERATE_VEO3_TEXT },
      { name: 'Plan prompt-based VEO3 clips (8s chunks)', value: ACTIONS.PLAN_VEO3_TEXT },
      { name: 'Generate local zoom/fade clips', value: ACTIONS.GENERATE_ZOOM },
      { name: 'Assemble final video', value: ACTIONS.ASSEMBLE },
      { name: 'Exit', value: 'exit' },
    ],
  });
  return choice;
}


async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  let config;
  try {
    config = await loadVideoBuilderConfig({ configPath: args.configPath });
  } catch (error) {
    console.error(chalk.red(`[Config] ${error.message}`));
    process.exit(1);
  }

  let outputDir;
  try {
    outputDir = await resolveOutputDir(args.outputDir);
  } catch (error) {
    console.error(chalk.red(`[Output] ${error.message}`));
    process.exit(1);
  }

  let context;
  try {
    context = await loadProjectContext(outputDir);
  } catch (error) {
    console.error(chalk.red(`[Context] ${error.message}`));
    process.exit(1);
  }

  if (!args.action) {
    await runInteractiveSession({
      config,
      initialOutputDir: outputDir,
      initialContext: context,
      args,
    });
    return;
  }

  let action;
  try {
    action = await resolveAction(args.action);
  } catch (error) {
    console.error(chalk.red(`[Action] ${error.message}`));
    process.exit(1);
  }

  if (action === 'exit') {
    const confirmed = await confirm({
      message: 'Exit video builder?',
      default: true,
    }).catch(() => true);
    if (confirmed) return;
    return;
  }

  const cliArgs = buildBaseCliArgs(args);

  try {
    await executeAction(action, context, config, { cliArgs });
  } catch (error) {
    console.error(chalk.red(`[Action] ${error.message}`));
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(chalk.red(`[Fatal] ${error?.message || error}`));
  process.exit(1);
});
