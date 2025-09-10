#!/usr/bin/env node
import { exportVideoFromPanels, buildExportOptionsFromArgs, printHelp } from '../src/lib/video-exporter.js';

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('-h') || argv.includes('--help') || argv.length === 0) {
    printHelp();
    process.exit(0);
  }
  const opts = buildExportOptionsFromArgs(argv);
  if (!opts.inputDir) {
    printHelp();
    process.exit(1);
  }
  try {
    console.log(`[VIDEO] Starting export with options:`, opts);
    const out = await exportVideoFromPanels(opts);
    console.log(`[VIDEO] Export complete: ${out}`);
  } catch (err) {
    console.error('[VIDEO] Export failed:', err?.message || err);
    process.exit(2);
  }
}

main();

