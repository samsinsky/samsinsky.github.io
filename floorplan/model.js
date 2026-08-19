// Document state, undo, persistence, and image intake.

import { dist, polygonArea, bounds, rectCorners } from './geometry.js';

export const STORAGE_KEY = 'floorplan-planner-v1';
const UNDO_LIMIT = 50;
const MAX_IMAGE_EDGE = 2000;
const JPEG_QUALITY = 0.85;

// Muted, distinguishable, and legible at 45% opacity over a grey floorplan.
const PALETTE = [
  '#2f6f9f', '#b4643c', '#4f7a4a', '#8a5a9c',
  '#b08a2e', '#3f7d7d', '#a04a5e', '#5c6b8a',
];

export const PRESETS = [
  { name: 'Twin bed', w: 39, d: 75 },
  { name: 'Full bed', w: 54, d: 75 },
  { name: 'Queen bed', w: 60, d: 80 },
  { name: 'King bed', w: 76, d: 80 },
  { name: 'Cal king bed', w: 72, d: 84 },
  { name: 'Sofa (3-seat)', w: 84, d: 36 },
  { name: 'Loveseat', w: 60, d: 36 },
  { name: 'Armchair', w: 35, d: 35 },
  { name: 'Coffee table', w: 48, d: 24 },
  { name: 'Side table', w: 22, d: 22 },
  { name: 'Nightstand', w: 24, d: 18 },
  { name: 'Dresser (6-drawer)', w: 60, d: 20 },
  { name: 'Dresser (3-drawer)', w: 36, d: 18 },
  { name: 'Desk', w: 60, d: 30 },
  { name: 'Office chair', w: 26, d: 26 },
  { name: 'Dining table (4)', w: 48, d: 30 },
  { name: 'Dining table (6)', w: 72, d: 36 },
  { name: 'Dining chair', w: 18, d: 18 },
  { name: 'TV stand', w: 60, d: 16 },
  { name: 'Bookcase', w: 32, d: 12 },
  { name: 'Washer/dryer', w: 27, d: 30 },
  { name: 'Refrigerator', w: 36, d: 32 },
  { name: 'Rug (5x8)', w: 60, d: 96 },
  { name: 'Rug (8x10)', w: 96, d: 120 },
];

let idCounter = 0;
export function newId(prefix) {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter}`;
}

export function emptyDoc() {
  return {
    version: 1,
    image: null,
    calibration: null,
    rooms: [],
    doors: [],
    furniture: [],
    settings: { gridOn: false, gridSize: 6, snapOn: true },
  };
}

// ── Derived values ──────────────────────────────────────────────────────────

// Before calibration the world is simply image pixels, so the factor is 1 and
// nothing needs rescaling at the moment calibration is first set.
export function inchesPerPixel(doc) {
  const c = doc.calibration;
  if (!c) return 1;
  const pixels = dist(c.p1, c.p2);
  if (!pixels || !Number.isFinite(c.realInches) || c.realInches <= 0) return 1;
  return c.realInches / pixels;
}

export function imageSizeInches(doc) {
  if (!doc.image) return null;
  const ipp = inchesPerPixel(doc);
  return {
    width: doc.image.naturalWidth * ipp,
    height: doc.image.naturalHeight * ipp,
  };
}

export function isCalibrated(doc) {
  return Boolean(doc.image && doc.calibration);
}

export function roomArea(room) {
  return polygonArea(room.points);
}

// Everything the document occupies, in world inches. Used for fit-to-view and
// for PNG export, which must not depend on where the viewport happens to be.
export function docBounds(doc) {
  const pts = [];
  const img = imageSizeInches(doc);
  if (img) pts.push({ x: 0, y: 0 }, { x: img.width, y: img.height });

  for (const room of doc.rooms) pts.push(...room.points);
  for (const door of doc.doors) pts.push(door.p1, door.p2);
  for (const f of doc.furniture) pts.push(...rectCorners(f));

  return bounds(pts) || { minX: 0, minY: 0, maxX: 1000, maxY: 1000, width: 1000, height: 1000 };
}

// Re-calibrating pins existing content to the same features of the image:
// positions scale, but a piece of furniture keeps its real size.
export function rescaleDoc(doc, factor) {
  if (!Number.isFinite(factor) || factor === 1) return;

  const scalePoint = (p) => {
    p.x *= factor;
    p.y *= factor;
  };

  for (const room of doc.rooms) room.points.forEach(scalePoint);
  for (const door of doc.doors) {
    scalePoint(door.p1);
    scalePoint(door.p2);
  }
  for (const f of doc.furniture) {
    f.x *= factor;
    f.y *= factor;
  }
}

export function nextColor(doc) {
  return PALETTE[doc.furniture.length % PALETTE.length];
}

// ── Image intake ────────────────────────────────────────────────────────────

// Downscaled and re-encoded so a typical plan lands well under the ~5MB
// localStorage quota.
export function readImageFile(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) {
      reject(new Error('That file is not an image.'));
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Could not decode that image.'));
      img.onload = () => {
        const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(img.width, img.height));
        const width = Math.round(img.width * scale);
        const height = Math.round(img.height * scale);

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        resolve({
          dataUrl: canvas.toDataURL('image/jpeg', JPEG_QUALITY),
          naturalWidth: width,
          naturalHeight: height,
        });
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// ── Store ───────────────────────────────────────────────────────────────────

export class Store {
  constructor() {
    this.doc = emptyDoc();
    this.ui = {
      mode: 'select',
      selection: null,      // { kind: 'furniture'|'room'|'door', id }
      view: null,           // viewBox in world inches
      draft: null,          // in-progress trace / door / measurement
      measurement: null,    // { p1, p2 } in image pixels, calibrate mode
      status: '',
    };
    this.listeners = new Set();
    this.undoStack = [];
    this.redoStack = [];
    this.saveTimer = null;
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    for (const fn of this.listeners) fn(this);
  }

  // A document mutation. Pass undoable:false for the intermediate frames of a
  // drag, so the whole drag collapses into one undo entry.
  update(mutate, { undoable = true } = {}) {
    if (undoable) this.pushUndo();
    mutate(this.doc);
    this.scheduleSave();
    this.emit();
  }

  updateUi(mutate) {
    mutate(this.ui);
    this.emit();
  }

  setStatus(message) {
    this.ui.status = message;
    this.emit();
  }

  // ── Undo ──
  // The image is excluded from snapshots: it is large, and it never changes as
  // a result of an undoable action.
  snapshot() {
    const { image, ...rest } = this.doc;
    return JSON.parse(JSON.stringify(rest));
  }

  restore(snapshot) {
    this.doc = { ...snapshot, image: this.doc.image };
  }

  pushUndo() {
    this.undoStack.push(this.snapshot());
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  undo() {
    const prev = this.undoStack.pop();
    if (!prev) return false;
    this.redoStack.push(this.snapshot());
    this.restore(prev);
    this.scheduleSave();
    this.emit();
    return true;
  }

  redo() {
    const next = this.redoStack.pop();
    if (!next) return false;
    this.undoStack.push(this.snapshot());
    this.restore(next);
    this.scheduleSave();
    this.emit();
    return true;
  }

  // ── Persistence ──
  scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), 500);
  }

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.doc));
    } catch (err) {
      this.ui.status = 'Could not autosave — browser storage is full. Export to JSON to keep this layout.';
      this.emit();
    }
  }

  load() {
    let raw;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch {
      return false;
    }
    if (!raw) return false;

    try {
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== 1) return false;
      this.doc = { ...emptyDoc(), ...parsed };
      return true;
    } catch {
      return false;
    }
  }

  reset() {
    this.doc = emptyDoc();
    this.ui.selection = null;
    this.ui.mode = 'select';
    this.ui.view = null;
    this.ui.draft = null;
    this.ui.measurement = null;
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch { /* nothing to clean up */ }
    this.emit();
  }

  // ── Import / export ──
  toJSON() {
    return JSON.stringify(this.doc, null, 2);
  }

  fromJSON(text) {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || parsed.version !== 1) {
      throw new Error('That file is not a floorplan layout.');
    }
    this.doc = { ...emptyDoc(), ...parsed };
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.ui.selection = null;
    this.ui.view = null;
    this.scheduleSave();
    this.emit();
  }
}
