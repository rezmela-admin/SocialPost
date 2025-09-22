import fs from 'fs/promises';
import path from 'path';

const DEFAULT_DURATION = 2.0;

async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function readJSON(file) {
  const raw = await fs.readFile(file, 'utf8');
  return JSON.parse(raw);
}

async function readOptionalJSON(file) {
  try {
    return await readJSON(file);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw new Error(`Failed to read JSON from ${file}: ${error.message}`);
  }
}

async function readOptionalText(file) {
  try {
    return await fs.readFile(file, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw new Error(`Failed to read text from ${file}: ${error.message}`);
  }
}

async function readDurations(listFile, panelFiles) {
  const fallbackCount = panelFiles.length;
  if (!(await pathExists(listFile))) {
    return { source: 'default', values: Array(fallbackCount).fill(DEFAULT_DURATION) };
  }

  const raw = await fs.readFile(listFile, 'utf8');
  const lines = raw.split(/\r?\n/);
  const entries = [];
  let current = null;
  for (const line of lines) {
    const trim = line.trim();
    if (!trim) continue;
    const fileMatch = /^file\s+'([^']+)'$/i.exec(trim);
    if (fileMatch) {
      current = { file: fileMatch[1], duration: DEFAULT_DURATION };
      entries.push(current);
      continue;
    }
    const durationMatch = /^duration\s+([0-9]+(?:\.[0-9]+)?)$/i.exec(trim);
    if (durationMatch && current) {
      current.duration = parseFloat(durationMatch[1]);
    }
  }

  if (!entries.length) {
    return { source: 'default', values: Array(fallbackCount).fill(DEFAULT_DURATION) };
  }

  const map = new Map();
  for (const entry of entries) {
    map.set(entry.file.replace(/\\/g, '/'), entry.duration);
  }

  const values = [];
  for (let i = 0; i < fallbackCount; i += 1) {
    const baseName = path.basename(panelFiles[i]).replace(/\\/g, '/');
    const duration = map.get(baseName);
    values.push(Number.isFinite(duration) ? duration : DEFAULT_DURATION);
  }

  return { source: 'list', values };
}

function normalisePanelPath(baseDir, candidate) {
  if (!candidate) return null;
  const safe = candidate.replace(/\\/g, '/');
  return path.isAbsolute(safe) ? safe : path.join(baseDir, safe);
}

export async function loadProjectContext(outputDir) {
  if (!outputDir) throw new Error('outputDir is required');
  const absoluteDir = path.resolve(outputDir);
  if (!(await pathExists(absoluteDir))) {
    throw new Error(`Output directory not found: ${absoluteDir}`);
  }

  const metadataPath = path.join(absoluteDir, 'metadata.json');
  const metadata = await readOptionalJSON(metadataPath);
  if (!metadata) {
    throw new Error(`metadata.json not found in ${absoluteDir}`);
  }

  const panelsDir = path.join(absoluteDir, 'panels');
  if (!(await pathExists(panelsDir))) {
    throw new Error(`panels directory not found in ${absoluteDir}`);
  }

  let panelFiles = [];
  if (Array.isArray(metadata.panelFiles) && metadata.panelFiles.length) {
    panelFiles = metadata.panelFiles.map((relative) => normalisePanelPath(absoluteDir, relative));
  } else {
    const entries = await fs.readdir(panelsDir);
    panelFiles = entries
      .filter((name) => /panel-\d+\.png$/i.test(name))
      .sort()
      .map((name) => path.join(panelsDir, name));
  }

  if (!panelFiles.length) {
    throw new Error(`No panels found in ${panelsDir}`);
  }

  const durationInfo = await readDurations(path.join(panelsDir, 'list.txt'), panelFiles);

  const narration = {
    text: await readOptionalText(path.join(absoluteDir, 'narration.txt')),
    json: await readOptionalJSON(path.join(absoluteDir, 'narration.json')),
    audioPath: (await pathExists(path.join(absoluteDir, 'narration.wav'))) ? path.join(absoluteDir, 'narration.wav') : null,
  };

  const panels = panelFiles.map((file, index) => {
    const id = `panel-${String(index + 1).padStart(2, '0')}`;
    const relative = path.relative(absoluteDir, file);
    return {
      id,
      index,
      file,
      relative,
      durationSec: durationInfo.values[index],
    };
  });

  return {
    outputDir: absoluteDir,
    metadata,
    panels,
    durations: durationInfo,
    narration,
    assets: {
      metadataPath,
      panelsDir,
      listPath: path.join(panelsDir, 'list.txt'),
    },
  };
}
