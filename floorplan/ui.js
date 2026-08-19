// Panels, forms, lists, file handling — and the bootstrap that wires
// everything together.

import {
  parseInches,
  parseDimensionPair,
  formatInches,
  formatArea,
  dist,
  lShapeLocal,
  lArmCentres,
} from './geometry.js';
import {
  Store,
  PRESETS,
  newId,
  readImageFile,
  inchesPerPixel,
  imageSizeInches,
  isCalibrated,
  rescaleDoc,
  nextColor,
  roomArea,
  docBounds,
} from './model.js';
import { render, fitView } from './render.js';
import { attachInteractions, finishRoom, deleteSelected, duplicateSelected } from './interact.js';

const $ = (id) => document.getElementById(id);

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs = {}, text = null) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  if (text !== null) node.textContent = text;
  return node;
}

const refs = {
  svg: $('canvas'),
  defs: $('defs'),
  planImage: $('plan-image'),
  grid: $('layer-grid'),
  rooms: $('layer-rooms'),
  doors: $('layer-doors'),
  furniture: $('layer-furniture'),
  overlay: $('layer-overlay'),
};

const store = new Store();
let lastSelectionKey = null;
let draftCorner = 'ne';   // elbow chosen in the add-furniture form

// ── Helpers ─────────────────────────────────────────────────────────────────

function viewCentre() {
  const v = store.ui.view;
  return v ? { x: v.x + v.w / 2, y: v.y + v.h / 2 } : { x: 0, y: 0 };
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function setFieldError(id, message) {
  const el = $(id);
  el.textContent = message || '';
  el.hidden = !message;
}

function setMode(mode, { toggle = false } = {}) {
  store.updateUi((ui) => {
    ui.mode = toggle && ui.mode === mode ? 'select' : mode;
    ui.draft = null;
    if (ui.mode !== 'calibrate') ui.measurement = null;
  });

  const messages = {
    calibrate: 'Drag a line across a wall whose real length you know.',
    'trace-room': 'Click each corner. Click the first corner again, or press Enter, to close.',
    'place-door': 'Click one side of the doorway, then the other.',
  };
  store.setStatus(messages[store.ui.mode] || '');
}

// ── Panel rendering ─────────────────────────────────────────────────────────

function renderScaleReadout() {
  const { doc } = store;
  const out = $('scale-readout');

  if (!doc.image) {
    out.textContent = 'No image yet';
    return;
  }
  if (!doc.calibration) {
    out.textContent = 'Scale not set';
    return;
  }
  const size = imageSizeInches(doc);
  out.textContent = `Plan is ${formatInches(size.width)} across`;
}

function renderGating() {
  const hasImage = Boolean(store.doc.image);
  const calibrated = isCalibrated(store.doc);

  $('card-image').dataset.done = String(hasImage);
  $('card-scale').dataset.locked = String(!hasImage);
  $('card-scale').dataset.done = String(calibrated);
  $('card-furniture').dataset.locked = String(!calibrated);
  $('card-rooms').dataset.locked = String(!calibrated);
  $('card-furniture').dataset.done = String(store.doc.furniture.length > 0);
  $('card-rooms').dataset.done = String(store.doc.rooms.length > 0);

  $('empty-state').hidden = hasImage;
  refs.svg.dataset.mode = store.ui.mode;

  const label = $('mode-label');
  const names = {
    select: 'Select',
    calibrate: 'Set scale',
    'trace-room': 'Trace room',
    'place-door': 'Place door',
  };
  label.textContent = names[store.ui.mode];
  label.dataset.active = String(store.ui.mode !== 'select');

  $('btn-calibrate').setAttribute('aria-pressed', String(store.ui.mode === 'calibrate'));
  $('btn-trace').setAttribute('aria-pressed', String(store.ui.mode === 'trace-room'));
  $('btn-door').setAttribute('aria-pressed', String(store.ui.mode === 'place-door'));

  $('status').textContent = store.ui.status;

  const saved = $('saved-indicator');
  saved.dataset.failed = String(Boolean(store.ui.saveFailed));
  if (store.ui.saveFailed) {
    saved.textContent = 'Not saved — export JSON';
  } else if (store.ui.savedAt) {
    const at = new Date(store.ui.savedAt);
    saved.textContent = `Saved ${at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  } else {
    saved.textContent = '';
  }
}

function renderFurnitureList() {
  const list = $('furniture-list');
  list.textContent = '';

  for (const piece of store.doc.furniture) {
    const li = document.createElement('li');
    li.setAttribute('aria-selected', String(
      store.ui.selection?.kind === 'furniture' && store.ui.selection.id === piece.id,
    ));

    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.background = piece.color;

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = piece.name;

    const dims = document.createElement('span');
    dims.className = 'dims';
    dims.textContent = `${formatInches(piece.w)} × ${formatInches(piece.d)}`;

    const remove = document.createElement('button');
    remove.className = 'icon-button';
    remove.type = 'button';
    remove.textContent = '×';
    remove.title = `Delete ${piece.name}`;
    remove.addEventListener('click', (e) => {
      e.stopPropagation();
      store.update((doc) => {
        doc.furniture = doc.furniture.filter((f) => f.id !== piece.id);
      });
    });

    li.append(swatch, name, dims, remove);
    li.addEventListener('click', () => {
      store.updateUi((ui) => {
        ui.selection = { kind: 'furniture', id: piece.id };
      });
    });
    list.appendChild(li);
  }
}

function renderRoomList() {
  const list = $('room-list');
  list.textContent = '';

  for (const room of store.doc.rooms) {
    const li = document.createElement('li');
    li.setAttribute('aria-selected', String(
      store.ui.selection?.kind === 'room' && store.ui.selection.id === room.id,
    ));

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = room.name;

    const area = document.createElement('span');
    area.className = 'dims';
    area.textContent = formatArea(roomArea(room));

    const remove = document.createElement('button');
    remove.className = 'icon-button';
    remove.type = 'button';
    remove.textContent = '×';
    remove.title = `Delete ${room.name}`;
    remove.addEventListener('click', (e) => {
      e.stopPropagation();
      store.update((doc) => {
        doc.rooms = doc.rooms.filter((r) => r.id !== room.id);
      });
    });

    li.append(name, area, remove);
    li.addEventListener('click', () => {
      store.updateUi((ui) => {
        ui.selection = { kind: 'room', id: room.id };
      });
    });
    list.appendChild(li);
  }

  for (const door of store.doc.doors) {
    const li = document.createElement('li');
    li.setAttribute('aria-selected', String(
      store.ui.selection?.kind === 'door' && store.ui.selection.id === door.id,
    ));

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = 'Door';

    const width = document.createElement('span');
    width.className = 'dims';
    width.textContent = formatInches(dist(door.p1, door.p2));

    const remove = document.createElement('button');
    remove.className = 'icon-button';
    remove.type = 'button';
    remove.textContent = '×';
    remove.addEventListener('click', (e) => {
      e.stopPropagation();
      store.update((doc) => {
        doc.doors = doc.doors.filter((d) => d.id !== door.id);
      });
    });

    li.append(name, width, remove);
    li.addEventListener('click', () => {
      store.updateUi((ui) => {
        ui.selection = { kind: 'door', id: door.id };
      });
    });
    list.appendChild(li);
  }
}

function field(labelText, value, onCommit, placeholder = '') {
  const wrap = document.createElement('div');
  const label = document.createElement('label');
  label.textContent = labelText;
  const input = document.createElement('input');
  input.type = 'text';
  input.value = value;
  input.placeholder = placeholder;
  input.autocomplete = 'off';

  const commit = () => onCommit(input.value, input);
  input.addEventListener('change', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
      input.blur();
    }
  });

  wrap.append(label, input);
  return wrap;
}

// Rebuilt only when the selection identity changes, so typing in these fields
// survives the re-render that every drag frame triggers.
function renderSelection() {
  const selection = store.ui.selection;
  const key = selection ? `${selection.kind}:${selection.id}` : null;
  const card = $('card-selection');

  if (key === lastSelectionKey) return;
  lastSelectionKey = key;

  const body = $('selection-body');
  body.textContent = '';
  card.hidden = !selection;
  if (!selection) return;

  if (selection.kind === 'furniture') {
    const piece = store.doc.furniture.find((f) => f.id === selection.id);
    if (!piece) return;

    body.appendChild(field('Name', piece.name, (value) => {
      const name = value.trim();
      if (!name) return;
      store.update((doc) => {
        const t = doc.furniture.find((f) => f.id === piece.id);
        if (t) t.name = name;
      });
    }));

    const isL = piece.shape === 'L';

    if (!isL) {
      body.appendChild(field(
        'Width × depth',
        `${formatInches(piece.w)} × ${formatInches(piece.d)}`,
        (value, input) => {
          const parsed = parseDimensionPair(value);
          if (!parsed) {
            store.setStatus(`Could not read “${value}”. Try 84 x 36 or 7' x 3'.`);
            input.value = `${formatInches(piece.w)} × ${formatInches(piece.d)}`;
            return;
          }
          store.update((doc) => {
            const t = doc.furniture.find((f) => f.id === piece.id);
            if (t) {
              t.w = parsed.w;
              t.d = parsed.d;
            }
          });
          store.setStatus('');
        },
      ));
    }

    if (isL) {
      body.appendChild(field(
        'Total width × depth',
        `${formatInches(piece.w)} × ${formatInches(piece.d)}`,
        (value, input) => {
          const parsed = parseDimensionPair(value);
          if (!parsed) {
            store.setStatus(`Could not read “${value}”. Try 106 x 84.`);
            input.value = `${formatInches(piece.w)} × ${formatInches(piece.d)}`;
            return;
          }
          store.update((doc) => {
            const t = doc.furniture.find((f) => f.id === piece.id);
            if (!t) return;
            t.w = parsed.w;
            t.d = parsed.d;
            // Keep the arms inside the new footprint rather than collapsing.
            t.armDepth = Math.min(t.armDepth, t.d - 1);
            t.legWidth = Math.min(t.legWidth, t.w - 1);
          });
          store.setStatus('');
        },
      ));

      const thickness = (label, key, limitKey) => field(
        label,
        formatInches(piece[key]),
        (value, input) => {
          const inches = parseInches(value);
          const limit = store.doc.furniture.find((f) => f.id === piece.id)?.[limitKey];
          if (inches === null || inches <= 0 || inches >= limit) {
            store.setStatus(`Must be between 0 and ${formatInches(limit)}.`);
            input.value = formatInches(piece[key]);
            return;
          }
          store.update((doc) => {
            const t = doc.furniture.find((f) => f.id === piece.id);
            if (t) t[key] = inches;
          });
          store.setStatus('');
        },
      );

      body.appendChild(thickness('Seat depth', 'armDepth', 'd'));
      body.appendChild(thickness('Chaise width', 'legWidth', 'w'));

      const cornerLabel = document.createElement('label');
      cornerLabel.textContent = 'Which side is the chaise on?';
      body.appendChild(cornerLabel);

      const picker = document.createElement('div');
      picker.className = 'corner-picker';
      body.appendChild(cornerPicker(
        picker,
        piece.corner,
        (corner) => {
          store.update((doc) => {
            const t = doc.furniture.find((f) => f.id === piece.id);
            if (t) t.corner = corner;
          });
          // The selection key is unchanged, so redraw the picker by hand.
          lastSelectionKey = null;
          renderSelection();
        },
        { w: piece.w, d: piece.d, arm: piece.armDepth, leg: piece.legWidth },
      ));
    }

    body.appendChild(field('Rotation °', String(Math.round(piece.rot)), (value) => {
      const deg = parseFloat(value);
      if (!Number.isFinite(deg)) return;
      store.update((doc) => {
        const t = doc.furniture.find((f) => f.id === piece.id);
        if (t) t.rot = ((deg % 360) + 360) % 360;
      });
    }));

    const row = document.createElement('div');
    row.className = 'row';
    row.append(
      button('Duplicate', () => duplicateSelected(store)),
      button('Delete', () => deleteSelected(store), 'danger'),
    );
    body.appendChild(row);
    return;
  }

  if (selection.kind === 'room') {
    const room = store.doc.rooms.find((r) => r.id === selection.id);
    if (!room) return;

    body.appendChild(field('Name', room.name, (value) => {
      const name = value.trim();
      if (!name) return;
      store.update((doc) => {
        const t = doc.rooms.find((r) => r.id === room.id);
        if (t) t.name = name;
      });
    }));

    const area = document.createElement('p');
    area.className = 'hint';
    area.textContent = `${formatArea(roomArea(room))} · ${room.points.length} corners`;
    body.appendChild(area);

    const row = document.createElement('div');
    row.className = 'row';
    row.appendChild(button('Delete', () => deleteSelected(store), 'danger'));
    body.appendChild(row);
    return;
  }

  if (selection.kind === 'door') {
    const door = store.doc.doors.find((d) => d.id === selection.id);
    if (!door) return;

    const width = document.createElement('p');
    width.className = 'hint';
    width.textContent = `${formatInches(dist(door.p1, door.p2))} wide`;
    body.appendChild(width);

    const row = document.createElement('div');
    row.className = 'row';
    row.append(
      button('Flip hinge', () => {
        store.update((doc) => {
          const t = doc.doors.find((d) => d.id === door.id);
          if (t) t.hinge = t.hinge === 'p1' ? 'p2' : 'p1';
        });
      }),
      button('Flip swing', () => {
        store.update((doc) => {
          const t = doc.doors.find((d) => d.id === door.id);
          if (t) t.swing = t.swing === 'cw' ? 'ccw' : 'cw';
        });
      }),
    );
    body.appendChild(row);

    const row2 = document.createElement('div');
    row2.className = 'row';
    row2.appendChild(button('Delete', () => deleteSelected(store), 'danger'));
    body.appendChild(row2);
  }
}

// Only two of the four corners are distinct pieces. Rotation reaches the other
// two -- 'sw' is 'ne' turned 180 degrees, 'se' is 'nw' turned 180 degrees --
// but no rotation mirrors a shape, so a left-facing sectional never becomes a
// right-facing one. Handedness is the only thing worth asking about.
const FACINGS = [
  { corner: 'nw', label: 'Chaise left' },
  { corner: 'ne', label: 'Chaise right' },
];

// Documents saved before the picker was reduced may hold the rotated variants.
function facingOf(corner) {
  return corner === 'nw' || corner === 'sw' ? 'nw' : 'ne';
}

const FALLBACK_SHAPE = { w: 106, d: 84, arm: 36, leg: 36 };

function cornerThumb(corner, { w, d, arm, leg }) {
  const pad = Math.max(w, d) * 0.09;
  const svg = svgEl('svg', {
    viewBox: `${-w / 2 - pad} ${-d / 2 - pad} ${w + pad * 2} ${d + pad * 2}`,
    preserveAspectRatio: 'xMidYMid meet',
  });
  svg.appendChild(svgEl('polygon', {
    points: lShapeLocal(w, d, arm, leg, corner).map((p) => `${p.x},${p.y}`).join(' '),
    fill: 'currentColor',
    'fill-opacity': 0.22,
    stroke: 'currentColor',
    'stroke-width': 1.5,
    'stroke-linejoin': 'round',
    'vector-effect': 'non-scaling-stroke',
  }));
  return svg;
}

function cornerPicker(container, current, onPick, dims) {
  const shape = dims && dims.w > 0 && dims.d > 0 && dims.arm > 0 && dims.leg > 0
    && dims.arm < dims.d && dims.leg < dims.w
    ? dims
    : FALLBACK_SHAPE;

  container.textContent = '';
  for (const { corner, label } of FACINGS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.title = label;
    b.setAttribute('aria-label', label);
    b.setAttribute('aria-pressed', String(facingOf(current) === corner));
    b.appendChild(cornerThumb(corner, shape));

    const caption = document.createElement('span');
    caption.textContent = label;
    b.appendChild(caption);

    b.addEventListener('click', () => onPick(corner));
    container.appendChild(b);
  }
  return container;
}

// A sectional's spec sheet gives an overall width, an overall depth and a seat
// depth, so that is exactly what the form asks for. Both arms share the seat
// depth unless the user says the chaise differs, which is rare.
function readArms() {
  const overall = parseDimensionPair($('furn-ldims').value);
  if (!overall) return null;

  const seat = parseInches($('furn-seat').value);
  if (seat === null || seat <= 0) return null;

  const chaise = $('furn-split').checked ? parseInches($('furn-chaise').value) : seat;
  if (chaise === null || chaise <= 0) return null;

  return {
    shape: 'L',
    w: overall.w,
    d: overall.d,
    armDepth: seat,     // thickness of the run along the width
    legWidth: chaise,   // thickness of the run along the depth
  };
}

// Reads the add-furniture form into a piece shape, or an error to show.
function readShapeForm() {
  if ($('furn-shape').value !== 'L') {
    const parsed = parseDimensionPair($('furn-dims').value);
    if (!parsed) {
      return { error: 'Enter dimensions as width × depth — 84 x 36, or 7\' x 3\'.' };
    }
    return { shape: 'rect', w: parsed.w, d: parsed.d };
  }

  const arms = readArms();
  if (!arms) {
    return { error: 'Give a total width × depth and a seat depth — for a sectional, something like 106 x 84 and 36.' };
  }
  if (arms.armDepth >= arms.d) {
    return { error: `A seat depth of ${formatInches(arms.armDepth)} fills the whole ${formatInches(arms.d)} depth, leaving a plain rectangle.` };
  }
  if (arms.legWidth >= arms.w) {
    return { error: `A chaise width of ${formatInches(arms.legWidth)} fills the whole ${formatInches(arms.w)} width, leaving a plain rectangle.` };
  }
  return { ...arms, corner: draftCorner };
}


// A live diagram of what the four numbers actually build. No label survives
// being misread as reliably as a picture does.
function renderLPreview() {
  refreshCornerPicker();

  const svg = $('l-preview');
  while (svg.firstChild) svg.removeChild(svg.firstChild);

  const arms = readArms();
  if (!arms) {
    $('l-footprint').textContent = '';
    svg.setAttribute('viewBox', '0 0 200 70');
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.appendChild(svgEl('text', {
      x: 100, y: 38, 'text-anchor': 'middle', 'font-size': 11,
      fill: 'oklch(62% 0.015 240)', 'font-family': 'system-ui, sans-serif',
    }, 'Enter a size and seat depth'));
    return;
  }

  const { w, d, armDepth: arm, legWidth: leg } = arms;
  const degenerate = arm >= d || leg >= w;
  $('l-footprint').textContent = degenerate ? '' : 'This is the footprint you will get';

  const pad = Math.max(w, d) * 0.22;
  svg.setAttribute('viewBox', `${-w / 2 - pad} ${-d / 2 - pad} ${w + pad * 2} ${d + pad * 2}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

  const fs = Math.max(w, d) / 15;
  const ink = 'oklch(40% 0.02 240)';
  const accent = degenerate ? 'oklch(52% 0.15 25)' : 'oklch(48% 0.09 245)';

  svg.appendChild(svgEl('polygon', {
    points: lShapeLocal(w, d, arm, leg, draftCorner).map((p) => `${p.x},${p.y}`).join(' '),
    fill: accent,
    'fill-opacity': 0.18,
    stroke: accent,
    'stroke-width': 1.5,
    'stroke-dasharray': degenerate ? '4 3' : 'none',
    'stroke-linejoin': 'round',
    'vector-effect': 'non-scaling-stroke',
  }));

  const label = (x, y, text, extra = {}) => svg.appendChild(svgEl('text', {
    x, y, 'text-anchor': 'middle', 'dominant-baseline': 'middle',
    'font-size': fs, fill: ink, 'font-family': 'system-ui, sans-serif',
    ...extra,
  }, text));

  label(0, d / 2 + pad * 0.62, formatInches(w));
  label(w / 2 + pad * 0.62, 0, formatInches(d), {
    transform: `rotate(-90 ${w / 2 + pad * 0.62} 0)`,
  });

  if (degenerate) {
    label(0, -d / 2 - pad * 0.62, 'seat depth fills the whole footprint', { fill: accent, 'font-size': fs * 0.8 });
    return;
  }

  const centres = lArmCentres(w, d, arm, leg, draftCorner);
  label(centres.long.x, centres.long.y, formatInches(arm));
  label(centres.short.x, centres.short.y, formatInches(leg), {
    transform: `rotate(-90 ${centres.short.x} ${centres.short.y})`,
  });
}

function refreshCornerPicker() {
  const arms = readArms();
  cornerPicker(
    $('furn-corner'),
    draftCorner,
    (corner) => {
      draftCorner = corner;
      renderLPreview();
    },
    arms && { w: arms.w, d: arms.d, arm: arms.armDepth, leg: arms.legWidth },
  );
}

function syncShapeForm() {
  const isL = $('furn-shape').value === 'L';
  $('l-fields').hidden = !isL;
  $('rect-fields').hidden = isL;
  $('chaise-field').hidden = !$('furn-split').checked;
  if (isL) renderLPreview();
}

function button(text, onClick, extraClass = '') {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `button ${extraClass}`.trim();
  b.textContent = text;
  b.addEventListener('click', onClick);
  return b;
}

function renderCalibrateForm() {
  const form = $('calibrate-form');
  const active = store.ui.mode === 'calibrate' && Boolean(store.ui.measurement);
  form.hidden = !active;
  if (!active) return;

  const m = store.ui.measurement;
  const hint = $('calibrate-hint');

  if (store.doc.calibration) {
    const ipp = inchesPerPixel(store.doc);
    hint.textContent = `Currently reads ${formatInches(dist(m.p1, m.p2) * ipp)}. Applying a different value re-scales the whole plan.`;
  } else {
    hint.textContent = 'Everything else is measured from this line, so pick a long wall with a clearly printed dimension.';
  }
}

function renderPanel() {
  renderScaleReadout();
  renderGating();
  renderFurnitureList();
  renderRoomList();
  renderSelection();
  renderCalibrateForm();
}

// ── Actions ─────────────────────────────────────────────────────────────────

async function handleImageFile(file) {
  try {
    const image = await readImageFile(file);
    store.update((doc) => {
      doc.image = image;
    });
    store.ui.view = null;
    fitView(store, refs.svg);
    store.setStatus('Now set the scale: drag a line across a wall you know the length of.');
    setMode('calibrate');
  } catch (err) {
    store.setStatus(err.message);
  }
}

function applyScale() {
  const inches = parseInches($('real-length').value);
  const m = store.ui.measurement;

  if (!m) return;
  if (inches === null || inches <= 0) {
    const message = 'Could not read that length. Try 14\'5, 173, or 14\' 5".';
    setFieldError('scale-error', message);
    store.setStatus(message);
    return;
  }
  setFieldError('scale-error', '');

  const previous = inchesPerPixel(store.doc);
  store.update((doc) => {
    doc.calibration = { p1: { ...m.p1 }, p2: { ...m.p2 }, realInches: inches };
    rescaleDoc(doc, inchesPerPixel(doc) / previous);
  });

  store.updateUi((ui) => {
    ui.measurement = null;
    ui.mode = 'select';
  });
  $('real-length').value = '';
  fitView(store, refs.svg);
  store.setStatus(`Scale set. Plan is ${formatInches(imageSizeInches(store.doc).width)} across.`);
}

function addFurniture() {
  const shape = readShapeForm();
  if (shape.error) {
    setFieldError('furniture-error', shape.error);
    store.setStatus(shape.error);
    return;
  }
  setFieldError('furniture-error', '');

  const name = $('furn-name').value.trim() || 'Furniture';
  const centre = viewCentre();
  const id = newId('furn');

  store.update((doc) => {
    doc.furniture.push({
      id,
      name,
      ...shape,
      x: centre.x,
      y: centre.y,
      rot: 0,
      color: nextColor(doc),
    });
  });
  store.updateUi((ui) => {
    ui.selection = { kind: 'furniture', id };
  });

  $('furn-name').value = '';
  $('furn-dims').value = '';
  $('furn-ldims').value = '';
  $('furn-seat').value = '';
  $('furn-chaise').value = '';
  $('furn-split').checked = false;
  $('chaise-field').hidden = true;
  $('preset').value = '';
  renderLPreview();
  store.setStatus(`Added ${name}. Drag it into place.`);
}

function exportPng() {
  const savedView = store.ui.view;
  fitView(store, refs.svg, 0.02);
  render(store, refs);

  const rect = refs.svg.getBoundingClientRect();
  const width = Math.round(rect.width * 2);
  const height = Math.round(rect.height * 2);

  const clone = refs.svg.cloneNode(true);
  clone.querySelector('#layer-overlay')?.remove();
  clone.setAttribute('width', width);
  clone.setAttribute('height', height);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

  const xml = new XMLSerializer().serializeToString(clone);
  const svgUrl = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }));

  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0);
    canvas.toBlob((blob) => {
      if (blob) download(blob, 'floorplan.png');
      URL.revokeObjectURL(svgUrl);
    }, 'image/png');

    store.ui.view = savedView;
    render(store, refs);
  };
  img.onerror = () => {
    URL.revokeObjectURL(svgUrl);
    store.ui.view = savedView;
    render(store, refs);
    store.setStatus('Could not build the PNG.');
  };
  img.src = svgUrl;
}

// ── Wiring ──────────────────────────────────────────────────────────────────

function wire() {
  const presetSelect = $('preset');
  for (const preset of PRESETS) {
    const option = document.createElement('option');
    option.value = preset.name;
    option.textContent = `${preset.name} — ${formatInches(preset.w)} × ${formatInches(preset.d)}`;
    presetSelect.appendChild(option);
  }

  presetSelect.addEventListener('change', () => {
    const preset = PRESETS.find((p) => p.name === presetSelect.value);
    if (!preset) return;
    $('furn-name').value = preset.name;
    $('furn-dims').value = `${preset.w} x ${preset.d}`;
    $('furn-shape').value = preset.shape === 'L' ? 'L' : 'rect';
    if (preset.shape === 'L') {
      $('furn-ldims').value = `${preset.w} x ${preset.d}`;
      $('furn-seat').value = String(preset.armDepth);
      $('furn-split').checked = preset.legWidth !== preset.armDepth;
      $('furn-chaise').value = String(preset.legWidth);
      if (preset.corner) draftCorner = preset.corner;
    } else {
      $('furn-ldims').value = '';
      $('furn-seat').value = '';
      $('furn-split').checked = false;
      $('furn-chaise').value = '';
    }
    syncShapeForm();
  });

  $('furn-shape').addEventListener('change', syncShapeForm);

  // Both arms of a sectional are almost always the same seat depth, so mirror
  // the first into the second until the user says otherwise.
  for (const id of ['furn-ldims', 'furn-seat', 'furn-chaise']) {
    $(id).addEventListener('input', renderLPreview);
  }
  $('furn-split').addEventListener('change', () => {
    $('chaise-field').hidden = !$('furn-split').checked;
    if ($('furn-split').checked && !$('furn-chaise').value) {
      $('furn-chaise').value = $('furn-seat').value;
    }
    renderLPreview();
  });

  syncShapeForm();

  $('file-input').addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) handleImageFile(file);
    e.target.value = '';
  });

  const wrap = $('canvas-wrap');
  wrap.addEventListener('dragover', (e) => {
    e.preventDefault();
    wrap.dataset.dragover = 'true';
  });
  wrap.addEventListener('dragleave', () => {
    wrap.dataset.dragover = 'false';
  });
  wrap.addEventListener('drop', (e) => {
    e.preventDefault();
    wrap.dataset.dragover = 'false';
    const file = e.dataTransfer?.files?.[0];
    if (file) handleImageFile(file);
  });

  $('btn-calibrate').addEventListener('click', () => setMode('calibrate', { toggle: true }));
  $('btn-trace').addEventListener('click', () => setMode('trace-room', { toggle: true }));
  $('btn-door').addEventListener('click', () => setMode('place-door', { toggle: true }));

  $('btn-apply-scale').addEventListener('click', applyScale);
  $('real-length').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      applyScale();
    }
  });
  $('btn-cancel-scale').addEventListener('click', () => {
    store.updateUi((ui) => {
      ui.measurement = null;
    });
  });

  $('btn-add-furniture').addEventListener('click', addFurniture);
  for (const id of ['furn-dims', 'furn-ldims', 'furn-seat', 'furn-chaise']) {
    $(id).addEventListener('input', () => setFieldError('furniture-error', ''));
  }
  $('real-length').addEventListener('input', () => setFieldError('scale-error', ''));
  $('furn-dims').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addFurniture();
    }
  });

  $('chk-snap').addEventListener('change', (e) => {
    store.update((doc) => {
      doc.settings.snapOn = e.target.checked;
    }, { undoable: false });
  });
  $('chk-grid').addEventListener('change', (e) => {
    store.update((doc) => {
      doc.settings.gridOn = e.target.checked;
    }, { undoable: false });
  });
  $('grid-size').addEventListener('change', (e) => {
    const size = parseInches(e.target.value);
    if (size === null || size <= 0) {
      e.target.value = String(store.doc.settings.gridSize);
      return;
    }
    store.update((doc) => {
      doc.settings.gridSize = size;
    }, { undoable: false });
  });

  $('btn-export-json').addEventListener('click', () => {
    download(new Blob([store.toJSON()], { type: 'application/json' }), 'floorplan-layout.json');
  });

  $('import-input').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      store.fromJSON(await file.text());
      fitView(store, refs.svg);
      store.setStatus('Layout imported.');
    } catch (err) {
      store.setStatus(err.message || 'Could not read that layout file.');
    }
  });

  $('btn-export-png').addEventListener('click', exportPng);

  let resetArmed = false;
  let resetTimer = null;
  const disarmReset = () => {
    resetArmed = false;
    clearTimeout(resetTimer);
    $('btn-reset').textContent = 'Start over';
    $('btn-reset').classList.remove('primary');
  };

  $('btn-reset').addEventListener('click', () => {
    const { doc } = store;
    if (!doc.image && !doc.furniture.length && !doc.rooms.length) return;

    if (!resetArmed) {
      resetArmed = true;
      $('btn-reset').textContent = 'Erase everything?';
      $('btn-reset').classList.add('primary');
      store.setStatus('Click again to erase this layout. Export JSON first if you want to keep it.');
      resetTimer = setTimeout(disarmReset, 5000);
      return;
    }

    disarmReset();
    store.reset();
    store.setStatus('Cleared.');
  });

  const controls = attachInteractions(store, refs);
  $('btn-fit').addEventListener('click', controls.fit);

  // Shown by the calibrate panel once a measurement line is drawn.
  refs.onMeasurement = () => {
    renderCalibrateForm();
    $('real-length').focus();
  };

  window.addEventListener('resize', () => {
    store.emit();
  });
}

// ── Boot ────────────────────────────────────────────────────────────────────

store.subscribe(() => {
  render(store, refs);
  renderPanel();
});

wire();

if (store.load()) {
  $('chk-snap').checked = store.doc.settings.snapOn;
  $('chk-grid').checked = store.doc.settings.gridOn;
  $('grid-size').value = String(store.doc.settings.gridSize);
  store.setStatus('Picked up where you left off.');
} else {
  store.emit();
}

fitView(store, refs.svg);
store.emit();
