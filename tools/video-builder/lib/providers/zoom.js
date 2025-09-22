import path from 'path';
import chalk from 'chalk';

import { ensureDir, runFfmpeg, probeDurationSeconds } from '../media-utils.js';

const DEFAULT_FPS = 30;
const DEFAULT_ZOOM = 1.06;
const DEFAULT_FADE = 0.4;

function parseSize(sizeStr, fallback = { w: 1080, h: 1920 }) {
  if (!sizeStr) return { ...fallback };
  const m = /^(\d+)x(\d+)$/i.exec(String(sizeStr).trim());
  if (m) {
    return { w: parseInt(m[1], 10), h: parseInt(m[2], 10) };
  }
  return { ...fallback };
}

function buildZoompan({ durationSec, fps, zoomStyle, zoomTo, targetW, targetH }) {
  const frames = Math.max(1, Math.round(durationSec * fps));
  const denom = Math.max(1, frames - 1);
  const targetZoom = Math.max(1, zoomTo);
  let expr = `zoompan=z='1':d=${frames}:s=${targetW}x${targetH}:fps=${fps}`;
  if (zoomStyle === 'in') {
    const delta = (targetZoom - 1).toFixed(6);
    const z = `1+(${delta}*(on/${denom}))`;
    expr = `zoompan=z='${z}':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':d=${frames}:s=${targetW}x${targetH}:fps=${fps}`;
  } else if (zoomStyle === 'out') {
    const delta = (targetZoom - 1).toFixed(6);
    const z = `${targetZoom.toFixed(6)}-(${delta}*(on/${denom}))`;
    expr = `zoompan=z='${z}':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':d=${frames}:s=${targetW}x${targetH}:fps=${fps}`;
  }
  return expr;
}

function buildFilterChain({ durationSec, fps, zoomStyle, zoomTo, targetW, targetH, fadeDuration }) {
  const zoom = buildZoompan({ durationSec, fps, zoomStyle, zoomTo, targetW, targetH });
  const fade = Math.min(fadeDuration, Math.max(0, durationSec / 2));
  const fadeOutStart = Math.max(0, durationSec - fade);
  const fadeFilter = fade > 0
    ? `,fade=t=in:st=0:d=${fade.toFixed(3)},fade=t=out:st=${fadeOutStart.toFixed(3)}:d=${fade.toFixed(3)}`
    : '';
  return `${zoom}${fadeFilter}`;
}

export async function generateZoomClip({
  panel,
  context,
  durationSec,
  clipDir,
  providerConfig = {},
  logger = console,
  dryRun = false,
}) {
  const { metadata } = context;
  const size = parseSize(metadata?.size, { w: 1080, h: 1920 });
  const fps = providerConfig.fps ?? DEFAULT_FPS;
  const zoomStyle = providerConfig.kenburns ?? 'in';
  const zoomTo = providerConfig.zoomTo ?? DEFAULT_ZOOM;
  const fadeDuration = providerConfig.fadeDuration ?? DEFAULT_FADE;
  const crf = providerConfig.crf ?? 18;
  const preset = providerConfig.preset ?? 'medium';

  await ensureDir(clipDir);
  const outputPath = path.join(clipDir, `${panel.id}-zoom.mp4`);
  const filter = buildFilterChain({ durationSec, fps, zoomStyle, zoomTo, targetW: size.w, targetH: size.h, fadeDuration });
  const durationFixed = durationSec.toFixed(3);

  const args = [
    '-y',
    '-loop', '1',
    '-i', panel.file,
    '-f', 'lavfi',
    '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
    '-t', durationFixed,
    '-vf', filter,
    '-c:v', 'libx264',
    '-preset', preset,
    '-crf', String(crf),
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-shortest',
    '-map', '0:v:0',
    '-map', '1:a:0',
    '-movflags', '+faststart',
    outputPath,
  ];

  if (dryRun) {
    logger.log(chalk.gray(`[zoom] Dry run -> ffmpeg ${args.join(' ')}`));
    return {
      status: 'dry-run',
      videoPath: outputPath,
      durationSec,
    };
  }

  logger.log(chalk.gray(`[zoom] Generating clip for ${panel.id} (${durationFixed}s)`));
  await runFfmpeg(args);
  const actualDuration = await probeDurationSeconds(outputPath).catch(() => durationSec);

  return {
    status: 'ready',
    videoPath: outputPath,
    audioPath: outputPath,
    durationSec: actualDuration ?? durationSec,
    provider: 'zoom',
  };
}

