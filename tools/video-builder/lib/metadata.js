import fs from 'fs/promises';
import path from 'path';

const MANIFEST_FILENAME = 'video-clips.json';

function ensurePlanRoot(manifest) {
  if (!manifest.plan || typeof manifest.plan !== 'object') {
    manifest.plan = {};
  }
  return manifest.plan;
}

function ensurePanel(manifest, panelId) {
  if (!manifest.clips[panelId]) {
    manifest.clips[panelId] = {};
  }
  return manifest.clips[panelId];
}

function toRelative(outputDir, filePath) {
  if (!filePath) return null;
  return path.relative(outputDir, filePath).replace(/\\/g, '/');
}

export async function loadManifest(outputDir) {
  const file = path.join(outputDir, MANIFEST_FILENAME);
  try {
    const raw = await fs.readFile(file, 'utf8');
    const parsed = JSON.parse(raw);
    parsed.file = file;
    if (!parsed.clips || typeof parsed.clips !== 'object') {
      parsed.clips = {};
    }
    ensurePlanRoot(parsed);
    return parsed;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return {
        version: 1,
        updatedAt: null,
        clips: {},
        file,
      };
    }
    throw new Error(`Failed to load manifest at ${file}: ${error.message}`);
  }
}

export async function saveManifest(outputDir, manifest) {
  ensurePlanRoot(manifest);
  const file = manifest.file || path.join(outputDir, MANIFEST_FILENAME);
  const payload = {
    version: manifest.version ?? 1,
    updatedAt: new Date().toISOString(),
    clips: manifest.clips,
    plan: manifest.plan,
  };
  await fs.writeFile(file, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  manifest.file = file;
  manifest.updatedAt = payload.updatedAt;
  return manifest;
}

export function getClip(manifest, panelId, providerId) {
  return manifest?.clips?.[panelId]?.[providerId] || null;
}

export function setClip(manifest, outputDir, panelId, providerId, data) {
  const panelEntry = ensurePanel(manifest, panelId);
  panelEntry[providerId] = {
    ...panelEntry[providerId],
    ...data,
    videoPath: toRelative(outputDir, data.videoPath) || panelEntry[providerId]?.videoPath || null,
    audioPath: toRelative(outputDir, data.audioPath) || panelEntry[providerId]?.audioPath || null,
    providerId,
    panelId,
    updatedAt: new Date().toISOString(),
  };
  return panelEntry[providerId];
}

export function markClipFailure(manifest, panelId, providerId, error) {
  const panelEntry = ensurePanel(manifest, panelId);
  panelEntry[providerId] = {
    ...panelEntry[providerId],
    status: 'failed',
    error: error ? { message: error.message || String(error) } : { message: 'Unknown error' },
    updatedAt: new Date().toISOString(),
  };
  return panelEntry[providerId];
}

export function listReadyClips(manifest, providerId) {
  const results = [];
  for (const [panelId, perProvider] of Object.entries(manifest.clips)) {
    const entry = perProvider[providerId];
    if (entry?.status === 'ready' && entry.videoPath) {
      results.push(entry);
    }
  }
  return results;
}

export function resolveClipPath(outputDir, entry) {
  if (!entry || !entry.videoPath) return null;
  const relative = entry.videoPath.replace(/\\/g, '/');
  return path.resolve(outputDir, relative);
}

export function ensurePlan(manifest) {
  return ensurePlanRoot(manifest);
}

