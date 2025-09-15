import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

// Simple arg parser for internal helpers
function toNumber(val, def) {
  const n = Number(val);
  return Number.isFinite(n) ? n : def;
}

function parseSize(sizeStr, defW = 1080, defH = 1920) {
  if (!sizeStr) return { w: defW, h: defH };
  const m = /^(\d+)x(\d+)$/i.exec(String(sizeStr).trim());
  if (m) return { w: parseInt(m[1], 10), h: parseInt(m[2], 10) };
  return { w: defW, h: defH };
}

function parseCommaList(val) {
  if (!val) return null;
  if (Array.isArray(val)) return val;
  return String(val).split(',').map(s => s.trim()).filter(Boolean);
}

function readJSON(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function readConcatList(file) {
  // Supports ffmpeg concat demuxer style list with optional duration lines
  // Example lines: file 'panel-01.png' \n duration 2.5
  if (!fs.existsSync(file)) return null;
  const txt = fs.readFileSync(file, 'utf8');
  const lines = txt.split(/\r?\n/);
  const items = [];
  let last = null;
  for (const line of lines) {
    const mFile = /^\s*file\s+'([^']+)'\s*$/i.exec(line);
    if (mFile) {
      last = { file: mFile[1], duration: null };
      items.push(last);
      continue;
    }
    const mDur = /^\s*duration\s+([0-9]+(?:\.[0-9]+)?)\s*$/i.exec(line);
    if (mDur && last) {
      last.duration = parseFloat(mDur[1]);
    }
  }
  return items.length ? items : null;
}

function ensureArrayLen(arr, len, fill) {
  const out = Array.isArray(arr) ? arr.slice(0, len) : [];
  while (out.length < len) out.push(fill);
  return out;
}

function buildZoompanExpr(style, durationSec, fps, zoomTo = 1.06, targetW = null, targetH = null) {
  // Returns { filter, needsFpsInFilter }
  // style: 'none' | 'in' | 'out'
  const frames = Math.max(1, Math.round(durationSec * fps));
  if (!style || style === 'none') {
    return { filter: `fps=${fps}`, frames };
  }
  const target = Math.max(1.0, zoomTo);
  if (style === 'in') {
    // z from 1.0 -> target linearly over frames (use 'on' output frame index, avoid referencing 'd' variable)
    const denom = Math.max(1, frames - 1);
    const z = `1+(${(target - 1).toFixed(6)}*(on/${denom}))`;
    const x = `(iw-iw/zoom)/2`;
    const y = `(ih-ih/zoom)/2`;
    const s = (targetW && targetH) ? `:s=${targetW}x${targetH}` : '';
    return { filter: `zoompan=z='${z}':x='${x}':y='${y}':d=${frames}${s}:fps=${fps}`, frames };
  } else if (style === 'out') {
    // z from target -> 1.0 linearly over frames
    const denom = Math.max(1, frames - 1);
    const z = `${target.toFixed(6)}-((${(target - 1).toFixed(6)})*(on/${denom}))`;
    const x = `(iw-iw/zoom)/2`;
    const y = `(ih-ih/zoom)/2`;
    const s = (targetW && targetH) ? `:s=${targetW}x${targetH}` : '';
    return { filter: `zoompan=z='${z}':x='${x}':y='${y}':d=${frames}${s}:fps=${fps}`, frames };
  }
  return { filter: `fps=${fps}`, frames };
}

function mapTransitionName(name) {
  if (!name) return 'fade';
  const n = String(name).toLowerCase();
  // Map some human hints to xfade transitions
  if (n.includes('cut') || n === 'none' || n === 'hardcut') return 'none';
  if (n.includes('push') || n.includes('slide')) return 'slideleft';
  if (n.includes('wipe')) return 'wipeleft';
  if (n.includes('zoom')) return 'fadeblack'; // safe fallback
  // Otherwise assume it's a valid xfade name (fade, fadeblack, slideleft, circleopen, pixelize, etc.)
  return n;
}

export async function exportVideoFromPanels(options = {}) {
  const {
    inputDir, // outputs/... directory that contains metadata.json and panels/
    outFile, // output mp4 path
    size = null,
    fps = 30,
    defaultDuration = 2.0,
    transition = 'fade', // global default
    transitionDuration = 0.5,
    durations, // array or csv string
    transitions, // array or csv string per gap
    kenburns = 'none', // 'none' | 'in' | 'out' or csv per panel
    zoomTo = 1.06, // zoom target for kenburns in/out
    qualityCRF = 20,
    preset = 'medium',
    __flags = {}, // internal: which options were explicitly provided
    dryRun = false,
    strict = true,
    audio = null, // optional path to narration audio to mux
  } = options;

  if (!inputDir) throw new Error('inputDir is required');
  const panelsDir = path.join(inputDir, 'panels');
  const metaPath = path.join(inputDir, 'metadata.json');
  const listPath = path.join(panelsDir, 'list.txt');

  const meta = readJSON(metaPath) || {};
  function makeEven(n) { const x = Math.max(2, parseInt(n, 10) || 0); return (x % 2 === 0) ? x : x + 1; }
  const sizeFromMeta = parseSize(meta.size);
  const chosenSize = size || (meta.size || '');
  let { w: targetW, h: targetH } = chosenSize
    ? parseSize(chosenSize, 1080, 1920)
    : { w: (sizeFromMeta.w || 1080), h: (sizeFromMeta.h || 1920) };
  // Enforce even dimensions for yuv420p and better encoder compatibility
  const preW = targetW, preH = targetH;
  targetW = makeEven(targetW);
  targetH = makeEven(targetH);
  if ((preW !== targetW || preH !== targetH) && !dryRun) {
    console.log(`[VIDEO] Adjusted output size to even dimensions: ${preW}x${preH} -> ${targetW}x${targetH}`);
  }

  // Determine panel files and durations
  let panelFiles = [];
  if (Array.isArray(meta.panelFiles) && meta.panelFiles.length) {
    panelFiles = meta.panelFiles.map(p => path.resolve(inputDir, p.replace(/\\/g, '/')));
  } else if (fs.existsSync(panelsDir)) {
    // Fallback: read panels/*.png sorted
    panelFiles = fs.readdirSync(panelsDir)
      .filter(f => /panel-\d+\.png$/i.test(f))
      .sort()
      .map(f => path.join(panelsDir, f));
  }
  if (!panelFiles.length) throw new Error('No panel images found');

  // Try to read durations from list.txt if exists
  let durationsSec = [];
  const listItems = readConcatList(listPath);
  if (__flags.durationsProvided && durations) {
    const arr = parseCommaList(durations)?.map(v => toNumber(v, defaultDuration)) || [];
    durationsSec = ensureArrayLen(arr, panelFiles.length, defaultDuration);
  } else if (listItems && listItems.length) {
    const mapDur = new Map();
    for (const it of listItems) if (it.duration) mapDur.set(it.file.replace(/\\/g, '/'), it.duration);
    durationsSec = panelFiles.map(p => {
      const base = path.basename(p);
      return mapDur.get(base) ?? defaultDuration;
    });
  } else {
    durationsSec = Array(panelFiles.length).fill(defaultDuration);
  }

  // Attempt to derive transitions/kenburns from metadata panelDetails when not provided
  function deriveFromMetadata() {
    const details = Array.isArray(meta.panelDetails) ? meta.panelDetails : [];
    const gaps = Math.max(0, panelFiles.length - 1);
    const derivedTrans = Array(gaps).fill(null);
    const derivedKB = Array(panelFiles.length).fill(null);

    function parseHint(str) {
      if (!str) return { t: null, kb: null };
      const s = String(str).toLowerCase();
      // Ken Burns indicators
      if (/(push\s*-?in|zoom\s*-?in|punch\s*-?in)/.test(s)) return { t: null, kb: 'in' };
      if (/(push\s*-?out|zoom\s*-?out|pull\s*-?out)/.test(s)) return { t: null, kb: 'out' };
      if (/hard\s*cut|cut\b|match\s*cut/.test(s)) return { t: 'none', kb: null };
      if (/(dissolve|cross\s*fade|crossfade)/.test(s)) return { t: 'fade', kb: null };
      if (/fade\s*to\s*black|fadeblack/.test(s)) return { t: 'fadeblack', kb: null };
      if (/slide\s*left/.test(s)) return { t: 'slideleft', kb: null };
      if (/slide\s*right/.test(s)) return { t: 'slideright', kb: null };
      if (/slide\s*up/.test(s)) return { t: 'slideup', kb: null };
      if (/slide\s*down/.test(s)) return { t: 'slidedown', kb: null };
      if (/wipe\s*left/.test(s)) return { t: 'wipeleft', kb: null };
      if (/wipe\s*right/.test(s)) return { t: 'wiperight', kb: null };
      if (/wipe\s*up/.test(s)) return { t: 'wipeup', kb: null };
      if (/wipe\s*down/.test(s)) return { t: 'wipedown', kb: null };
      if (/circle\s*open/.test(s)) return { t: 'circleopen', kb: null };
      if (/circle\s*close/.test(s)) return { t: 'circleclose', kb: null };
      return { t: null, kb: null };
    }

    function extractTransitionFromPrompt(prompt) {
      if (!prompt) return null;
      const p = String(prompt);
      // Try to find a line like "Visual transition into next panel: ..."
      const m = p.match(/visual\s+transition[^:]*:\s*([^\n\r]+)/i);
      if (m) return m[1].trim();
      // Fallback: look for common keywords
      const kw = p.match(/(hard\s*cut|match\s*cut|push-?in|push-?out|zoom-?in|zoom-?out|fade to black|fade|dissolve|cross\s*fade|slide (?:left|right|up|down)|wipe (?:left|right|up|down)|circle (?:open|close))/i);
      return kw ? kw[0] : null;
    }

    for (let i = 0; i < details.length; i++) {
      const d = details[i] || {};
      const hint = d.transition || extractTransitionFromPrompt(d.prompt) || null;
      const { t, kb } = parseHint(hint);
      if (kb) derivedKB[i] = kb; // apply to current panel
      if (t && i < gaps) derivedTrans[i] = t; // transition to next
    }
    return { derivedTrans, derivedKB };
  }

  const fromMeta = deriveFromMetadata();

  // Transitions per gap (N-1 entries)
  const transDefault = mapTransitionName(transition);
  let transPerGap = [];
  if (transitions) {
    transPerGap = ensureArrayLen(parseCommaList(transitions)?.map(mapTransitionName), Math.max(0, panelFiles.length - 1), transDefault);
  } else if (!__flags.transitionProvided && !__flags.transitionsProvided && fromMeta.derivedTrans.some(Boolean)) {
    // fill from metadata where present, falling back to default
    const gaps = Math.max(0, panelFiles.length - 1);
    transPerGap = Array(gaps).fill(transDefault).map((d, i) => mapTransitionName(fromMeta.derivedTrans[i] || d));
  } else {
    transPerGap = Array(Math.max(0, panelFiles.length - 1)).fill(transDefault);
  }

  // Ken Burns per panel
  let kbPerPanel;
  if (kenburns) {
    const kbList = parseCommaList(kenburns) || [kenburns];
    // If a single value provided (no commas), apply to all panels
    if (typeof kenburns === 'string' && !kenburns.includes(',')) {
      kbPerPanel = Array(panelFiles.length).fill(kbList[0] || 'none');
    } else {
      kbPerPanel = ensureArrayLen(kbList, panelFiles.length, 'none');
    }
  }
  if (!__flags.kenburnsProvided && fromMeta.derivedKB.some(Boolean)) {
    // Overlay derived KB where provided
    if (!kbPerPanel) kbPerPanel = Array(panelFiles.length).fill('none');
    kbPerPanel = kbPerPanel.map((v, i) => (fromMeta.derivedKB[i] || v || 'none'));
  }
  if (!kbPerPanel) {
    kbPerPanel = Array(panelFiles.length).fill('none');
  }

  const outPath = outFile || path.join(inputDir, `video-${Date.now()}.mp4`);

  // Construct ffmpeg arguments
  const args = ['-y'];
  // Inputs: one per panel, loop each for its duration
  panelFiles.forEach((file, i) => {
    args.push('-loop', '1', '-t', String(durationsSec[i].toFixed(3)), '-i', file);
  });
  const audioInputIndex = panelFiles.length;
  if (audio) {
    args.push('-i', audio);
  }

  // Build filter_complex
  const vlabels = [];
  const filterParts = [];
  for (let i = 0; i < panelFiles.length; i++) {
    const labelIn = `${i}:v`;
    const labelOut = `v${i}`;
    vlabels.push(labelOut);
    const scalePad = `scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease,pad=${targetW}:${targetH}:(ow-iw)/2:(oh-ih)/2`;
    const kbMode = String(kbPerPanel[i]).toLowerCase();
    const dur = durationsSec[i];
    const chain = [`[${labelIn}]${scalePad}`, 'format=rgba'];
    if (kbMode && kbMode !== 'none') {
      const { filter: kbFilter } = buildZoompanExpr(kbMode, dur, fps, zoomTo, targetW, targetH);
      chain.push(kbFilter);
    } else {
      chain.push(`fps=${fps}`);
    }
    // Clamp duration and normalize timestamps explicitly to prevent timeline drift
    chain.push(`trim=duration=${dur.toFixed(6)}`, 'setpts=PTS-STARTPTS', 'setsar=1', 'format=rgba');
    filterParts.push(chain.join(',') + `[${labelOut}]`);
  }

  let lastLabel = vlabels[0];
  let cumulative = durationsSec[0];
  for (let i = 1; i < vlabels.length; i++) {
    const next = vlabels[i];
    const trans = transPerGap[i - 1];
    if (trans === 'none') {
      // Hard cut via concat filter
      const outLbl = `x${i}`;
      filterParts.push(`[${lastLabel}][${next}]concat=n=2:v=1:a=0[${outLbl}]`);
      lastLabel = outLbl;
      cumulative += durationsSec[i];
    } else {
      const outLbl = `x${i}`;
      const off = Math.max(0, cumulative - transitionDuration);
      filterParts.push(`[${lastLabel}][${next}]xfade=transition=${trans}:duration=${transitionDuration}:offset=${off.toFixed(3)}[${outLbl}]`);
      // combined duration becomes cumulative + d_i - td
      cumulative = cumulative + durationsSec[i] - transitionDuration;
      lastLabel = outLbl;
    }
  }

  // Strict mode validations and normalization
  if (strict) {
    const allowed = new Set(['fade','fadeblack','fadewhite','radial','smoothleft','smoothright','smoothup','smoothdown','circleopen','circleclose','vertopen','vertclose','horzopen','horzclose','dissolve','pixelize','diagtl','diagtr','diagbl','diagbr','hlslice','hrslice','vuslice','vdslice','hblur','slideleft','slideright','slideup','slidedown','wipeleft','wiperight','wipeup','wipedown']);
    for (let i = 0; i < transPerGap.length; i++) {
      const t = transPerGap[i];
      if (t !== 'none' && !allowed.has(t)) {
        console.warn(`[VIDEO] Unknown transition '${t}' at gap ${i}. Falling back to 'fade'.`);
        transPerGap[i] = 'fade';
      }
    }
    if (!Number.isFinite(targetW) || !Number.isFinite(targetH) || targetW <= 0 || targetH <= 0) {
      throw new Error(`Invalid target size ${targetW}x${targetH}`);
    }
    if (!Number.isFinite(fps) || fps <= 0) {
      throw new Error(`Invalid fps: ${fps}`);
    }
    if (durationsSec.some(d => !Number.isFinite(d) || d <= 0)) {
      throw new Error('All durations must be positive numbers.');
    }
  }

  const filterComplex = filterParts.join(';');
  args.push('-filter_complex', filterComplex);
  args.push('-map', `[${lastLabel}]`);
  if (audio) {
    args.push('-map', `${audioInputIndex}:a:0?`);
  }
  args.push('-r', String(fps));
  args.push('-c:v', 'libx264', '-crf', String(qualityCRF), '-preset', preset, '-pix_fmt', 'yuv420p');
  if (audio) {
    args.push('-c:a', 'aac', '-b:a', '192k', '-shortest');
  }
  args.push(outPath);

  if (dryRun) {
    console.log('[VIDEO dry-run] ffmpeg', args.map(a => (a.startsWith('-filter_complex') ? '-filter_complex <omitted>' : a)).join(' '));
    console.log('[VIDEO dry-run] filter_complex =', filterComplex);
    return outPath;
  }

  await new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { stdio: 'inherit' });
    proc.on('error', reject);
    proc.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}`));
    });
  });

  return outPath;
}

export function buildExportOptionsFromArgs(argv) {
  const opts = { __flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    const eat = () => { i++; return next; };
    switch (a) {
      case '--input':
      case '-i': opts.inputDir = eat(); break;
      case '--out':
      case '-o': opts.outFile = eat(); break;
      case '--size': opts.size = eat(); break;
      case '--fps': opts.fps = toNumber(eat(), 30); break;
      case '--duration': opts.defaultDuration = toNumber(eat(), 2.0); break;
      case '--durations': opts.durations = eat(); opts.__flags.durationsProvided = true; break;
      case '--transition': opts.transition = eat(); opts.__flags.transitionProvided = true; break;
      case '--transitions': opts.transitions = eat(); opts.__flags.transitionsProvided = true; break;
      case '--trans-duration': opts.transitionDuration = toNumber(eat(), 0.5); break;
      case '--kenburns': opts.kenburns = eat(); opts.__flags.kenburnsProvided = true; break;
      case '--zoom-to': opts.zoomTo = Number(eat()); break;
      case '--crf': opts.qualityCRF = toNumber(eat(), 20); break;
      case '--preset': opts.preset = eat(); break;
      case '--dry-run': opts.dryRun = true; break;
      case '--strict': opts.strict = true; break;
      case '--no-strict': opts.strict = false; break;
      case '--audio': opts.audio = eat(); break;
    }
  }
  return opts;
}

export function printHelp() {
  const help = `
Usage: node scripts/export-video.js --input <output_dir> [options]

Required:
  -i, --input <dir>         Path to outputs/... directory with metadata.json and panels/

Output:
  -o, --out <file>          Output mp4 path (default: <dir>/video-<ts>.mp4)
      --size <WxH>          Output size (default: 1080x1920 or metadata.size)
      --fps <n>             Frames per second (default: 30)
      --crf <n>             x264 CRF quality 0-51 lower=better (default: 20)
      --preset <p>          x264 preset (ultrafast..veryslow) (default: medium)
      --audio <file>        Optional narration audio to mux (AAC encoded)
      --strict / --no-strict  Enable or disable strict validation (default: strict on)

Timing and transitions:
      --duration <sec>      Default duration per panel (default: 2.0)
      --durations <csv>     Per-panel durations, e.g. 2.4,1.8,1.8,1.8,1.8,2.2
  -t,  --transition <name>  Default transition (fade, fadeblack, slideleft, wipeleft, none)
      --transitions <csv>   Per-gap transitions, e.g. fade,slideleft,fade
      --trans-duration <s>  Transition duration in seconds (default: 0.5)

Ken Burns effect:
      --kenburns <mode>     Global or csv per-panel: none | in | out (default: none)
      --zoom-to <factor>    Target zoom factor for in/out (default: 1.06)

Examples:
  node scripts/export-video.js -i outputs/comic-... \
    --size 1080x1920 --fps 30 --duration 2.0 \
    --transition slideleft --trans-duration 0.5 \
    --kenburns in --zoom-to 1.08

  node scripts/export-video.js -i outputs/comic-... \
    --durations 2.4,1.8,1.8,1.8,1.8,2.2 \
    --transitions fade,slideleft,fade,fade,fade \
    --kenburns none,in,in,out,out,none

Dry run (print ffmpeg command without writing):
  node scripts/export-video.js -i outputs/comic-... --dry-run
`;
  console.log(help);
}
