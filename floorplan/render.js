// Draws the SVG scene from state. The SVG viewBox is in world inches, so
// nothing here converts units — it only decides what to draw.

import {
  rectCorners,
  formatInches,
  formatArea,
  dist,
  midpoint,
  bounds,
} from './geometry.js';
import { imageSizeInches, inchesPerPixel, roomArea, docBounds } from './model.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function el(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined) continue;
    node.setAttribute(k, String(v));
  }
  return node;
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function pointsAttr(points) {
  return points.map((p) => `${p.x},${p.y}`).join(' ');
}

// World inches per screen pixel — used to keep strokes, labels and handles a
// constant size on screen regardless of zoom.
export function worldPerPixel(store, svg) {
  const view = store.ui.view;
  const width = svg.clientWidth || svg.getBoundingClientRect().width || 1;
  if (!view || !view.w) return 1;
  return view.w / width;
}

export function fitView(store, svg, padding = 0.06) {
  const b = docBounds(store.doc);
  const rect = svg.getBoundingClientRect();
  const aspect = (rect.width || 1) / (rect.height || 1);

  let w = b.width * (1 + padding * 2);
  let h = b.height * (1 + padding * 2);
  if (w / h < aspect) w = h * aspect;
  else h = w / aspect;

  store.ui.view = {
    x: b.minX - (w - b.width) / 2,
    y: b.minY - (h - b.height) / 2,
    w,
    h,
  };
}

// ── Layer painters ──────────────────────────────────────────────────────────

function paintImage(store, refs) {
  const { doc } = store;
  const img = refs.planImage;

  if (!doc.image) {
    img.setAttribute('href', '');
    img.style.display = 'none';
    return;
  }

  const size = imageSizeInches(doc);
  img.style.display = '';
  if (img.getAttribute('href') !== doc.image.dataUrl) {
    img.setAttribute('href', doc.image.dataUrl);
  }
  img.setAttribute('x', 0);
  img.setAttribute('y', 0);
  img.setAttribute('width', size.width);
  img.setAttribute('height', size.height);
}

function paintGrid(store, refs) {
  const { doc } = store;
  clear(refs.defs);
  clear(refs.grid);
  if (!doc.settings.gridOn) return;

  const size = doc.settings.gridSize;
  if (!size || size <= 0) return;

  const pattern = el('pattern', {
    id: 'grid-pattern',
    width: size,
    height: size,
    patternUnits: 'userSpaceOnUse',
  });
  pattern.appendChild(
    el('path', {
      d: `M ${size} 0 L 0 0 0 ${size}`,
      fill: 'none',
      stroke: 'rgba(20,40,70,0.16)',
      'stroke-width': 1,
      'vector-effect': 'non-scaling-stroke',
    }),
  );
  refs.defs.appendChild(pattern);

  const b = docBounds(doc);
  refs.grid.appendChild(
    el('rect', {
      x: b.minX,
      y: b.minY,
      width: b.width,
      height: b.height,
      fill: 'url(#grid-pattern)',
    }),
  );
}

function paintRooms(store, refs, wpp) {
  clear(refs.rooms);
  const selection = store.ui.selection;

  for (const room of store.doc.rooms) {
    if (room.points.length < 3) continue;
    const selected = selection?.kind === 'room' && selection.id === room.id;

    const g = el('g', { 'data-kind': 'room', 'data-id': room.id });
    g.appendChild(
      el('polygon', {
        points: pointsAttr(room.points),
        fill: 'rgba(47,111,159,0.07)',
        stroke: selected ? '#2f6f9f' : 'rgba(30,60,90,0.55)',
        'stroke-width': selected ? 3 : 2,
        'vector-effect': 'non-scaling-stroke',
      }),
    );

    // Tucked into the room's top-left rather than its centre, where the
    // floorplan image almost always prints its own label.
    const box = bounds(room.points);
    const c = { x: box.minX + 10 * wpp, y: box.minY + 26 * wpp };
    const label = el('text', {
      x: c.x,
      y: c.y,
      'text-anchor': 'start',
      'font-size': 13 * wpp,
      fill: 'rgba(20,45,70,0.75)',
      'font-family': 'system-ui, sans-serif',
      'font-weight': 500,
      'pointer-events': 'none',
    });
    label.textContent = room.name;
    g.appendChild(label);

    const area = el('text', {
      x: c.x,
      y: c.y + 15 * wpp,
      'text-anchor': 'start',
      'font-size': 11 * wpp,
      fill: 'rgba(20,45,70,0.5)',
      'font-family': 'system-ui, sans-serif',
      'pointer-events': 'none',
    });
    area.textContent = formatArea(roomArea(room));
    g.appendChild(area);

    refs.rooms.appendChild(g);
  }
}

function paintDoors(store, refs) {
  clear(refs.doors);
  const selection = store.ui.selection;

  for (const door of store.doc.doors) {
    const selected = selection?.kind === 'door' && selection.id === door.id;
    const hinge = door.hinge === 'p2' ? door.p2 : door.p1;
    const free = door.hinge === 'p2' ? door.p1 : door.p2;

    const width = dist(hinge, free);
    if (width <= 0) continue;

    // Swing the leaf a quarter turn off the closed position.
    const ux = (free.x - hinge.x) / width;
    const uy = (free.y - hinge.y) / width;
    const sign = door.swing === 'ccw' ? -1 : 1;
    const tip = {
      x: hinge.x - sign * uy * width,
      y: hinge.y + sign * ux * width,
    };

    const g = el('g', { 'data-kind': 'door', 'data-id': door.id });
    const stroke = selected ? '#b4643c' : 'rgba(60,40,30,0.75)';

    g.appendChild(
      el('path', {
        d: `M ${hinge.x} ${hinge.y} L ${tip.x} ${tip.y} A ${width} ${width} 0 0 ${door.swing === 'ccw' ? 0 : 1} ${free.x} ${free.y}`,
        fill: 'none',
        stroke,
        'stroke-width': selected ? 3 : 2,
        'vector-effect': 'non-scaling-stroke',
      }),
    );
    // The opening itself, so the door reads against the wall it sits in.
    g.appendChild(
      el('line', {
        x1: hinge.x,
        y1: hinge.y,
        x2: free.x,
        y2: free.y,
        stroke,
        'stroke-width': 1,
        'stroke-dasharray': '4 4',
        'vector-effect': 'non-scaling-stroke',
        opacity: 0.5,
      }),
    );

    refs.doors.appendChild(g);
  }
}

function paintFurniture(store, refs, wpp) {
  clear(refs.furniture);
  const selection = store.ui.selection;

  for (const piece of store.doc.furniture) {
    const selected = selection?.kind === 'furniture' && selection.id === piece.id;

    const g = el('g', {
      'data-kind': 'furniture',
      'data-id': piece.id,
      transform: `translate(${piece.x} ${piece.y}) rotate(${piece.rot})`,
      class: 'piece',
    });

    // 45% fill is the entire overlap-detection mechanism: where two pieces
    // cross, the fills compound into a visibly darker region.
    g.appendChild(
      el('rect', {
        x: -piece.w / 2,
        y: -piece.d / 2,
        width: piece.w,
        height: piece.d,
        rx: Math.min(2, piece.w / 20),
        fill: piece.color,
        'fill-opacity': 0.45,
        stroke: piece.color,
        'stroke-width': selected ? 3 : 2,
        'vector-effect': 'non-scaling-stroke',
      }),
    );

    // Counter-rotate so a piece turned 180 degrees does not get upside-down
    // text.
    const labelGroup = el('g', { transform: `rotate(${-piece.rot})`, 'pointer-events': 'none' });
    const name = el('text', {
      x: 0,
      y: 0,
      'text-anchor': 'middle',
      'font-size': 12 * wpp,
      fill: '#1b2b3a',
      'font-family': 'system-ui, sans-serif',
      'font-weight': 500,
    });
    name.textContent = piece.name;
    labelGroup.appendChild(name);

    const dims = el('text', {
      x: 0,
      y: 14 * wpp,
      'text-anchor': 'middle',
      'font-size': 10 * wpp,
      fill: 'rgba(27,43,58,0.65)',
      'font-family': 'system-ui, sans-serif',
    });
    dims.textContent = `${formatInches(piece.w)} × ${formatInches(piece.d)}`;
    labelGroup.appendChild(dims);
    g.appendChild(labelGroup);

    if (selected) {
      const handleY = -piece.d / 2 - 26 * wpp;
      g.appendChild(
        el('line', {
          x1: 0,
          y1: -piece.d / 2,
          x2: 0,
          y2: handleY,
          stroke: '#1b2b3a',
          'stroke-width': 1,
          'vector-effect': 'non-scaling-stroke',
        }),
      );
      g.appendChild(
        el('circle', {
          cx: 0,
          cy: handleY,
          r: 7 * wpp,
          fill: '#ffffff',
          stroke: '#1b2b3a',
          'stroke-width': 2,
          'vector-effect': 'non-scaling-stroke',
          'data-handle': 'rotate',
          class: 'rotate-handle',
        }),
      );
    }

    refs.furniture.appendChild(g);
  }
}

function paintOverlay(store, refs, wpp) {
  clear(refs.overlay);
  const { ui, doc } = store;

  // In-progress room trace.
  if (ui.draft?.kind === 'room' && ui.draft.points.length) {
    const pts = ui.draft.cursor ? [...ui.draft.points, ui.draft.cursor] : ui.draft.points;
    refs.overlay.appendChild(
      el('polyline', {
        points: pointsAttr(pts),
        fill: 'rgba(47,111,159,0.08)',
        stroke: '#2f6f9f',
        'stroke-width': 2,
        'stroke-dasharray': '6 4',
        'vector-effect': 'non-scaling-stroke',
      }),
    );
    for (const p of ui.draft.points) {
      refs.overlay.appendChild(
        el('circle', { cx: p.x, cy: p.y, r: 4 * wpp, fill: '#2f6f9f' }),
      );
    }
  }

  // First click of a door, waiting for the second.
  if (ui.draft?.kind === 'door' && ui.draft.p1) {
    const to = ui.draft.cursor || ui.draft.p1;
    refs.overlay.appendChild(
      el('line', {
        x1: ui.draft.p1.x,
        y1: ui.draft.p1.y,
        x2: to.x,
        y2: to.y,
        stroke: '#b4643c',
        'stroke-width': 2,
        'stroke-dasharray': '6 4',
        'vector-effect': 'non-scaling-stroke',
      }),
    );
  }

  // Calibration / verification line. Stored in image pixels, drawn in world.
  if (ui.measurement) {
    const ipp = inchesPerPixel(doc);
    const a = { x: ui.measurement.p1.x * ipp, y: ui.measurement.p1.y * ipp };
    const b = { x: ui.measurement.p2.x * ipp, y: ui.measurement.p2.y * ipp };

    refs.overlay.appendChild(
      el('line', {
        x1: a.x, y1: a.y, x2: b.x, y2: b.y,
        stroke: '#c0392b',
        'stroke-width': 3,
        'vector-effect': 'non-scaling-stroke',
      }),
    );
    for (const p of [a, b]) {
      refs.overlay.appendChild(
        el('circle', {
          cx: p.x, cy: p.y, r: 5 * wpp,
          fill: '#ffffff', stroke: '#c0392b', 'stroke-width': 2,
          'vector-effect': 'non-scaling-stroke',
        }),
      );
    }

    const m = midpoint(a, b);
    const label = el('text', {
      x: m.x,
      y: m.y - 10 * wpp,
      'text-anchor': 'middle',
      'font-size': 13 * wpp,
      'font-family': 'system-ui, sans-serif',
      'font-weight': 600,
      fill: '#c0392b',
      stroke: '#ffffff',
      'stroke-width': 3 * wpp,
      'paint-order': 'stroke',
    });
    label.textContent = doc.calibration ? formatInches(dist(a, b)) : 'set length →';
    refs.overlay.appendChild(label);
  }
}

export function render(store, refs) {
  const svg = refs.svg;
  if (!store.ui.view) fitView(store, svg);

  const view = store.ui.view;
  svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`);

  const wpp = worldPerPixel(store, svg);

  paintImage(store, refs);
  paintGrid(store, refs);
  paintRooms(store, refs, wpp);
  paintDoors(store, refs);
  paintFurniture(store, refs, wpp);
  paintOverlay(store, refs, wpp);
}
