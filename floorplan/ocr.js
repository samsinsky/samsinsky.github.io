// Reads printed dimension labels off a floorplan image, entirely in the
// browser. No API key, no upload — Tesseract runs as WASM in a worker.
//
// The governing rule, unchanged from the design: the reader supplies numbers,
// the human supplies geometry. Nothing here is ever applied automatically.

import { parseInches } from './geometry.js';

const TESSERACT_SRC = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
const TESSERACT_SRI = 'sha384-GJqSu7vueQ9qN0E9yLPb3Wtpd7OrgK8KmYzC8T1IysG1bcvxvIO4qtYR/D3A991F';

// Sparse text. Floorplan labels are scattered across the page, and the default
// mode merges them into nonsense lines like "FOYER BEDROOM".
const PSM_SPARSE_TEXT = '11';

// Small label text reads badly at native size. Beyond roughly this width the
// accuracy stops improving and only the clock suffers.
const TARGET_LONG_EDGE = 1900;
const MAX_UPSCALE = 4;

let loader = null;

function loadTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (loader) return loader;

  loader = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = TESSERACT_SRC;
    script.integrity = TESSERACT_SRI;
    script.crossOrigin = 'anonymous';
    script.onload = () => resolve(window.Tesseract);
    script.onerror = () => {
      loader = null;
      reject(new Error('Could not load the text reader.'));
    };
    document.head.appendChild(script);
  });
  return loader;
}

function upscale(image, factor) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(image.width * factor);
  canvas.height = Math.round(image.height * factor);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode the floorplan image.'));
    img.src = dataUrl;
  });
}

// ── Reading the text ────────────────────────────────────────────────────────

// A measurement must carry an explicit foot or inch mark. This is the whole
// safety mechanism: the reader's characteristic failure is dropping the
// apostrophe, turning 10'9" into "109" — a plausible number that is wrong by a
// factor of ten and that nothing downstream could catch. Requiring the mark
// discards those silently-wrong reads instead of offering them.
const MEASURE = String.raw`\d{1,2}\s*['’]\s*\d{0,2}\s*(?:["”]|'')?|\d{1,3}\s*(?:["”])`;
const PAIR_RE = new RegExp(`(${MEASURE})\\s*[x×X]\\s*(${MEASURE})`, 'g');
const HAS_MARK = /['’"”]/;

// A garbled read can keep its apostrophe and still be nonsense — "5'3" came
// back once as "95'3". No room in an apartment is under a foot or over sixty.
const MIN_MEASURE = 12;
const MAX_MEASURE = 720;
const ROOM_NAME_RE = /^[A-Z][A-Z0-9 ./'-]{2,}$/;

function normalise(text) {
  return text.replace(/[’]/g, "'").replace(/[”]/g, '"').replace(/\s+/g, ' ').trim();
}

function centreOf(bbox, factor) {
  return {
    x: ((bbox.x0 + bbox.x1) / 2) / factor,
    y: ((bbox.y0 + bbox.y1) / 2) / factor,
  };
}

// Attach the nearest plausible room name, preferring one sitting above the
// measurement — which is how floorplans are laid out.
function nearestName(nameLines, at) {
  let best = null;
  for (const line of nameLines) {
    const dx = line.centre.x - at.x;
    const dy = line.centre.y - at.y;
    const penalty = dy > 0 ? 2 : 1;           // below the number is less likely
    const distance = Math.hypot(dx, dy * penalty);
    if (!best || distance < best.distance) best = { distance, text: line.text };
  }
  // Beyond this the "nearest" label belongs to another room entirely.
  return best && best.distance < 220 ? best.text : null;
}

export function extractLabels(lines, factor) {
  const nameLines = [];
  const measures = [];

  for (const line of lines) {
    const text = normalise(line.text);
    if (!text) continue;
    const centre = centreOf(line.bbox, factor);

    if (ROOM_NAME_RE.test(text) && !/\d\s*[x×X]\s*\d/.test(text)) {
      nameLines.push({ text, centre, confidence: line.confidence });
    }

    PAIR_RE.lastIndex = 0;
    let match;
    while ((match = PAIR_RE.exec(text)) !== null) {
      const [, rawW, rawD] = match;
      if (!HAS_MARK.test(rawW) || !HAS_MARK.test(rawD)) continue;

      const w = parseInches(normalise(rawW));
      const d = parseInches(normalise(rawD));
      if (w === null || d === null) continue;
      if (w < MIN_MEASURE || w > MAX_MEASURE) continue;
      if (d < MIN_MEASURE || d > MAX_MEASURE) continue;

      measures.push({
        w,
        d,
        wText: normalise(rawW),
        dText: normalise(rawD),
        centre,
        confidence: Math.round(line.confidence),
      });
    }
  }

  return measures
    .map((m) => ({ ...m, name: nearestName(nameLines, m.centre) }))
    .sort((a, b) => b.confidence - a.confidence);
}

// ── Entry point ─────────────────────────────────────────────────────────────

export async function readFloorplanLabels(dataUrl, onProgress = () => {}) {
  const Tesseract = await loadTesseract();
  onProgress('Preparing…');

  const image = await loadImage(dataUrl);
  const factor = Math.min(
    MAX_UPSCALE,
    Math.max(1, TARGET_LONG_EDGE / Math.max(image.width, image.height)),
  );
  const input = factor > 1.05 ? upscale(image, factor) : image;

  const worker = await Tesseract.createWorker('eng');
  try {
    await worker.setParameters({ tessedit_pageseg_mode: PSM_SPARSE_TEXT });
    onProgress('Reading…');
    const result = await worker.recognize(input, {}, { blocks: true });

    const lines = (result.data.blocks || [])
      .flatMap((b) => (b.paragraphs || []).flatMap((p) => p.lines || []))
      .filter((l) => l && l.text && l.bbox);

    return extractLabels(lines, factor);
  } finally {
    await worker.terminate();
  }
}
