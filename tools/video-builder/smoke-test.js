#!/usr/bin/env node
import 'dotenv/config';
import path from 'path';
import chalk from 'chalk';

import { loadVideoBuilderConfig } from './lib/config-loader.js';
import { loadProjectContext } from './lib/context-loader.js';
import { ACTIONS, executeAction } from './lib/actions.js';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    switch (token) {
      case '-o':
      case '--output':
        args.outputDir = argv[++i];
        break;
      case '--panel':
      case '--panels':
        args.panels = argv[++i];
        break;
      case '-h':
      case '--help':
        args.help = true;
        break;
      default:
        args.help = true;
        break;
    }
  }
  return args;
}

function printHelp() {
  console.log(`Usage: node tools/video-builder/smoke-test.js -o outputs/<run> [--panel list]\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.outputDir) {
    printHelp();
    process.exit(args.help ? 0 : 1);
  }

  const outputDir = path.resolve(args.outputDir);
  const config = await loadVideoBuilderConfig();
  const context = await loadProjectContext(outputDir);

  console.log(chalk.cyan('[smoke] Inspecting context'));
  await executeAction(ACTIONS.INSPECT, context, config, { cliArgs: { panels: args.panels, dryRun: true } });

  console.log(chalk.cyan('[smoke] Dry-run zoom generation'));
  await executeAction(ACTIONS.GENERATE_ZOOM, context, config, { cliArgs: { panels: args.panels, dryRun: true, force: true } });

  console.log(chalk.green('[smoke] Completed successfully'));
}

main().catch((error) => {
  console.error(chalk.red(`[smoke] Failed: ${error.message}`));
  process.exit(1);
});

