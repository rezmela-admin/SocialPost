import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TOOL_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(TOOL_ROOT, '..', '..');

async function readJSON(file) {
  try {
    const raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw new Error(`Failed to read JSON from ${file}: ${error.message}`);
  }
}

function mergeVideoConfig(base, overlay) {
  if (!overlay) return base;
  const merged = { ...base, ...overlay };
  const baseProviders = (base && base.providers) || {};
  const overlayProviders = (overlay && overlay.providers) || {};
  const providers = { ...baseProviders };
  for (const [key, value] of Object.entries(overlayProviders)) {
    providers[key] = { ...providers[key], ...value };
  }
  merged.providers = providers;
  return merged;
}

export async function loadVideoBuilderConfig(options = {}) {
  const explicitPath = options.configPath ? path.resolve(options.configPath) : null;
  const toolPath = path.join(TOOL_ROOT, 'config.json');
  const rootPath = path.join(REPO_ROOT, 'config.json');

  const configs = [];

  if (rootPath !== explicitPath) {
    const root = await readJSON(rootPath);
    if (root?.videoGeneration) {
      configs.push({ source: rootPath, video: root.videoGeneration });
    }
  }

  const toolConfig = await readJSON(toolPath);
  if (toolConfig?.videoGeneration) {
    configs.push({ source: toolPath, video: toolConfig.videoGeneration });
  }

  if (explicitPath) {
    const explicit = await readJSON(explicitPath);
    if (!explicit) {
      throw new Error(`Config file not found at ${explicitPath}`);
    }
    const payload = explicit.videoGeneration || explicit;
    configs.push({ source: explicitPath, video: payload });
  }

  if (!configs.length) {
    throw new Error('No videoGeneration configuration found. Add config.json to tools/video-builder or provide --config.');
  }

  const merged = configs.reduce((acc, entry) => mergeVideoConfig(acc, entry.video), {});
  const sources = configs.map(({ source }) => source);

  return {
    videoGeneration: merged,
    sources,
  };
}

export function getRepoRoot() {
  return REPO_ROOT;
}

export function getToolRoot() {
  return TOOL_ROOT;
}

