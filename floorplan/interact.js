// Pointer, touch and keyboard handling, plus the mode state machine.
// Modes: select | calibrate | trace-room | place-door

import {
  pieceCorners,
  segments,
  findFlushTranslation,
  snapToGrid,
  snapToAxis,
  closestPointOnSegment,
  dist,
  normalizeAngle,
} from './geometry.js';
import { inchesPerPixel, newId } from './model.js';
import { fitView } from './render.js';

const MIN_VIEW = 12;        // inches across — about a foot
const MAX_VIEW = 40000;     // inches across — comfortably past any apartment
const DOOR_SNAP = 18;       // inches
const CLOSE_LOOP = 14;      // screen px within which a trace click closes
const ROTATE_SNAP = 15;     // degrees

function toWorld(svg, clientX, clientY) {
  const pt = svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const m = svg.getScreenCTM();
  if (!m) return { x: 0, y: 0 };
  const p = pt.matrixTransform(m.inverse());
  return { x: p.x, y: p.y };
}

function wallSegments(doc) {
  const out = [];
  for (const room of doc.rooms) {
    if (room.points.length >= 3) out.push(...segments(room.points, true));
  }
  return out;
}

function furnitureEdges(doc, excludeId) {
  const out = [];
  for (const piece of doc.furniture) {
    if (piece.id === excludeId) continue;
    out.push(...segments(pieceCorners(piece), true));
  }
  return out;
}

// Wall snapping wins over piece-to-piece, which wins over the grid. Holding
// Option suspends all of it.
function applySnapping(doc, piece, candidate, { suspend = false } = {}) {
  if (suspend || !doc.settings.snapOn) return candidate;

  const edgesAt = (at) => segments(pieceCorners({ ...piece, x: at.x, y: at.y }), true);
  const walls = wallSegments(doc);
  const others = furnitureEdges(doc, piece.id);

  // Two passes, so a piece dropped into a corner settles against both walls
  // rather than only the nearer one.
  const settle = (targets) => {
    const first = findFlushTranslation(edgesAt(candidate), targets);
    if (!first) return null;

    let at = { x: candidate.x + first.dx, y: candidate.y + first.dy };
    const second = findFlushTranslation(edgesAt(at), targets, { perpendicularTo: first });
    if (second) at = { x: at.x + second.dx, y: at.y + second.dy };
    return at;
  };

  const toWall = settle(walls);
  if (toWall) return toWall;

  const toPiece = settle(others);
  if (toPiece) return toPiece;

  if (doc.settings.gridOn) {
    return {
      x: snapToGrid(candidate.x, doc.settings.gridSize),
      y: snapToGrid(candidate.y, doc.settings.gridSize),
    };
  }
  return candidate;
}

function snapToWall(doc, point, tolerance = DOOR_SNAP) {
  let best = null;
  for (const [a, b] of wallSegments(doc)) {
    const c = closestPointOnSegment(point, a, b);
    const d = dist(point, c);
    if (d <= tolerance && (!best || d < best.d)) best = { d, point: c };
  }
  return best ? best.point : point;
}

export function attachInteractions(store, refs) {
  const svg = refs.svg;
  const pointers = new Map();
  let drag = null;
  let pinch = null;
  let spaceHeld = false;

  const wpp = () => {
    const view = store.ui.view;
    const width = svg.clientWidth || 1;
    return view ? view.w / width : 1;
  };

  // ── Zoom and pan ──

  function zoomAt(clientX, clientY, factor) {
    const view = store.ui.view;
    if (!view) return;

    const before = toWorld(svg, clientX, clientY);
    let w = view.w * factor;
    w = Math.max(MIN_VIEW, Math.min(MAX_VIEW, w));
    const applied = w / view.w;

    view.w = w;
    view.h = view.h * applied;
    // Keep the world point under the cursor pinned there.
    view.x = before.x - (before.x - view.x) * applied;
    view.y = before.y - (before.y - view.y) * applied;
    store.emit();
  }

  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    // Trackpad pinch arrives as ctrlKey+wheel; treat both as zoom.
    zoomAt(e.clientX, e.clientY, Math.exp(e.deltaY * 0.0015));
  }, { passive: false });

  // ── Pointer down ──

  svg.addEventListener('pointerdown', (e) => {
    // Capture keeps a drag alive when the pointer leaves the SVG. It throws on
    // pointer ids the browser is not tracking, which is not worth aborting for.
    try {
      svg.setPointerCapture(e.pointerId);
    } catch { /* drag still works, it just stops at the edge */ }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = {
        distance: Math.hypot(a.x - b.x, a.y - b.y),
        centre: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      };
      drag = null;
      return;
    }
    if (pointers.size > 2) return;

    const world = toWorld(svg, e.clientX, e.clientY);
    const mode = store.ui.mode;

    if (mode === 'calibrate') {
      const ipp = inchesPerPixel(store.doc);
      const px = { x: world.x / ipp, y: world.y / ipp };
      drag = { kind: 'measure', from: px };
      store.updateUi((ui) => {
        ui.measurement = { p1: px, p2: px };
      });
      return;
    }

    if (mode === 'trace-room' || mode === 'place-door') {
      // Placement happens on click, not drag; a drag still pans.
      drag = { kind: 'maybe-pan', start: { x: e.clientX, y: e.clientY }, origin: { ...store.ui.view }, moved: false };
      return;
    }

    // Select mode.
    const handle = e.target.closest('[data-handle="rotate"]');
    if (handle) {
      const id = handle.closest('[data-id]')?.dataset.id;
      const piece = store.doc.furniture.find((f) => f.id === id);
      if (piece) {
        store.pushUndo();
        drag = { kind: 'rotate', piece };
        return;
      }
    }

    const target = e.target.closest('[data-kind]');
    if (target) {
      const { kind, id } = target.dataset;
      store.updateUi((ui) => {
        ui.selection = { kind, id };
      });

      if (kind === 'furniture') {
        const piece = store.doc.furniture.find((f) => f.id === id);
        if (piece) {
          store.pushUndo();
          drag = {
            kind: 'move',
            piece,
            grab: { x: world.x - piece.x, y: world.y - piece.y },
          };
          return;
        }
      }
      // Rooms and doors select but do not drag.
      drag = null;
      return;
    }

    // Empty canvas: deselect and pan.
    store.updateUi((ui) => {
      ui.selection = null;
    });
    drag = {
      kind: 'pan',
      start: { x: e.clientX, y: e.clientY },
      origin: { ...store.ui.view },
    };
  });

  // ── Pointer move ──

  svg.addEventListener('pointermove', (e) => {
    if (pointers.has(e.pointerId)) {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const centre = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };

      if (pinch.distance > 0) zoomAt(centre.x, centre.y, pinch.distance / distance);

      const view = store.ui.view;
      const scale = wpp();
      view.x -= (centre.x - pinch.centre.x) * scale;
      view.y -= (centre.y - pinch.centre.y) * scale;

      pinch = { distance, centre };
      store.emit();
      return;
    }

    const world = toWorld(svg, e.clientX, e.clientY);

    // Live cursor feedback while tracing.
    if (!drag && (store.ui.mode === 'trace-room' || store.ui.mode === 'place-door')) {
      if (store.ui.draft) {
        let cursor = world;
        if (store.ui.mode === 'trace-room' && store.ui.draft.points?.length) {
          const last = store.ui.draft.points[store.ui.draft.points.length - 1];
          cursor = snapToAxis(last, world);
        }
        store.updateUi((ui) => {
          ui.draft.cursor = cursor;
        });
      }
      return;
    }

    if (!drag) return;

    if (drag.kind === 'maybe-pan') {
      const dx = e.clientX - drag.start.x;
      const dy = e.clientY - drag.start.y;
      if (!drag.moved && Math.hypot(dx, dy) < 4) return;
      drag.moved = true;
      drag.kind = 'pan';
      drag.origin = drag.origin || { ...store.ui.view };
    }

    if (drag.kind === 'pan') {
      const scale = wpp();
      store.ui.view.x = drag.origin.x - (e.clientX - drag.start.x) * scale;
      store.ui.view.y = drag.origin.y - (e.clientY - drag.start.y) * scale;
      store.emit();
      return;
    }

    if (drag.kind === 'measure') {
      const ipp = inchesPerPixel(store.doc);
      store.updateUi((ui) => {
        ui.measurement = { p1: drag.from, p2: { x: world.x / ipp, y: world.y / ipp } };
      });
      return;
    }

    if (drag.kind === 'move') {
      const candidate = { x: world.x - drag.grab.x, y: world.y - drag.grab.y };
      const snapped = applySnapping(store.doc, drag.piece, candidate, { suspend: e.altKey });
      store.update((doc) => {
        const piece = doc.furniture.find((f) => f.id === drag.piece.id);
        if (piece) {
          piece.x = snapped.x;
          piece.y = snapped.y;
        }
      }, { undoable: false });
      return;
    }

    if (drag.kind === 'rotate') {
      const piece = drag.piece;
      // The handle sits above the piece, so straight up is zero rotation.
      let deg = (Math.atan2(world.y - piece.y, world.x - piece.x) * 180) / Math.PI + 90;
      if (!e.shiftKey) deg = Math.round(deg / ROTATE_SNAP) * ROTATE_SNAP;
      store.update((doc) => {
        const target = doc.furniture.find((f) => f.id === piece.id);
        if (target) target.rot = normalizeAngle(deg);
      }, { undoable: false });
    }
  });

  // ── Pointer up ──

  function endPointer(e) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;

    const wasDrag = drag;
    drag = null;
    if (!wasDrag) return;

    if (wasDrag.kind === 'measure') {
      const m = store.ui.measurement;
      if (m && dist(m.p1, m.p2) < 4) {
        // A stray click, not a measurement.
        store.updateUi((ui) => {
          ui.measurement = null;
        });
      } else {
        refs.onMeasurement?.();
      }
    }
  }

  svg.addEventListener('pointerup', endPointer);
  svg.addEventListener('pointercancel', endPointer);

  // ── Click placement for tracing and doors ──

  svg.addEventListener('click', (e) => {
    const mode = store.ui.mode;
    if (mode !== 'trace-room' && mode !== 'place-door') return;

    const world = toWorld(svg, e.clientX, e.clientY);

    if (mode === 'trace-room') {
      store.updateUi((ui) => {
        if (!ui.draft || ui.draft.kind !== 'room') ui.draft = { kind: 'room', points: [] };
      });

      const draft = store.ui.draft;
      let point = world;

      if (draft.points.length) {
        const last = draft.points[draft.points.length - 1];
        point = snapToAxis(last, world);

        // Clicking near the first point closes the loop.
        if (draft.points.length >= 3 && dist(world, draft.points[0]) / wpp() < CLOSE_LOOP) {
          finishRoom(store);
          return;
        }
      }

      store.updateUi((ui) => {
        ui.draft.points.push(point);
        ui.draft.cursor = null;
      });
      return;
    }

    // place-door
    const point = snapToWall(store.doc, world);
    if (!store.ui.draft || store.ui.draft.kind !== 'door') {
      store.updateUi((ui) => {
        ui.draft = { kind: 'door', p1: point };
      });
      store.setStatus('Click the other side of the doorway.');
      return;
    }

    const p1 = store.ui.draft.p1;
    if (dist(p1, point) < 4) return;

    const id = newId('door');
    store.update((doc) => {
      doc.doors.push({ id, p1, p2: point, hinge: 'p1', swing: 'cw' });
    });
    store.updateUi((ui) => {
      ui.draft = null;
      ui.mode = 'select';
      ui.selection = { kind: 'door', id };
    });
    store.setStatus('Door placed. Use the panel to flip the hinge or swing.');
  });

  // ── Keyboard ──

  window.addEventListener('keydown', (e) => {
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      if (e.key === 'Escape') document.activeElement.blur();
      return;
    }

    if (e.code === 'Space') spaceHeld = true;

    const meta = e.metaKey || e.ctrlKey;

    if (meta && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) store.redo();
      else store.undo();
      return;
    }

    if (meta && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      duplicateSelected(store);
      return;
    }

    if (e.key === 'Escape') {
      store.updateUi((ui) => {
        ui.mode = 'select';
        ui.draft = null;
        ui.measurement = null;
        ui.selection = null;
      });
      store.setStatus('');
      return;
    }

    if (e.key === 'Enter' && store.ui.draft?.kind === 'room') {
      e.preventDefault();
      finishRoom(store);
      return;
    }

    const selection = store.ui.selection;

    if ((e.key === 'Delete' || e.key === 'Backspace') && selection) {
      e.preventDefault();
      deleteSelected(store);
      return;
    }

    if (!selection || selection.kind !== 'furniture') return;
    const piece = store.doc.furniture.find((f) => f.id === selection.id);
    if (!piece) return;

    if (e.key.toLowerCase() === 'r') {
      e.preventDefault();
      const delta = e.shiftKey ? -90 : 90;
      store.update((doc) => {
        const target = doc.furniture.find((f) => f.id === piece.id);
        if (target) target.rot = normalizeAngle(target.rot + delta);
      });
      return;
    }

    const step = e.shiftKey ? 6 : 1;
    const nudges = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    if (nudges[e.key]) {
      e.preventDefault();
      const [dx, dy] = nudges[e.key];
      store.update((doc) => {
        const target = doc.furniture.find((f) => f.id === piece.id);
        if (target) {
          target.x += dx;
          target.y += dy;
        }
      });
    }
  });

  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') spaceHeld = false;
  });

  return {
    fit: () => {
      fitView(store, svg);
      store.emit();
    },
    zoomAt,
  };
}

// ── Actions shared with the sidebar ─────────────────────────────────────────

export function finishRoom(store) {
  const draft = store.ui.draft;
  if (!draft || draft.kind !== 'room' || draft.points.length < 3) {
    store.setStatus('A room needs at least three corners.');
    return;
  }

  const id = newId('room');
  const points = draft.points.map((p) => ({ x: p.x, y: p.y }));
  store.update((doc) => {
    doc.rooms.push({ id, name: `Room ${doc.rooms.length + 1}`, points });
  });
  store.updateUi((ui) => {
    ui.draft = null;
    ui.mode = 'select';
    ui.selection = { kind: 'room', id };
  });
  store.setStatus('Room traced. Rename it in the panel.');
}

export function deleteSelected(store) {
  const selection = store.ui.selection;
  if (!selection) return;

  store.update((doc) => {
    if (selection.kind === 'furniture') {
      doc.furniture = doc.furniture.filter((f) => f.id !== selection.id);
    } else if (selection.kind === 'room') {
      doc.rooms = doc.rooms.filter((r) => r.id !== selection.id);
    } else if (selection.kind === 'door') {
      doc.doors = doc.doors.filter((d) => d.id !== selection.id);
    }
  });
  store.updateUi((ui) => {
    ui.selection = null;
  });
}

export function duplicateSelected(store) {
  const selection = store.ui.selection;
  if (selection?.kind !== 'furniture') return;

  const piece = store.doc.furniture.find((f) => f.id === selection.id);
  if (!piece) return;

  const id = newId('furn');
  store.update((doc) => {
    doc.furniture.push({ ...piece, id, x: piece.x + 6, y: piece.y + 6 });
  });
  store.updateUi((ui) => {
    ui.selection = { kind: 'furniture', id };
  });
}
