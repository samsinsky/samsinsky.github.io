// Pure geometry and unit helpers. No DOM access — everything here is testable
// with `node --test`.

const TAU = Math.PI * 2;

// ── Units ───────────────────────────────────────────────────────────────────
// The whole app works in inches. A bare number is inches; a feet marker makes
// the leading number feet. Accepts 84, 84", 7', 7' 6", 7'6, 7'-6", 6.5'.

const DIM_RE =
  /^(?:(\d+(?:\.\d+)?)\s*(?:'|ft|feet))?\s*-?\s*(?:(\d+(?:\.\d+)?)\s*(?:"|in|inch|inches)?)?$/i;

export function parseInches(input) {
  if (typeof input === 'number') return Number.isFinite(input) ? input : null;
  if (typeof input !== 'string') return null;

  const s = input.trim().replace(/[’‘]/g, "'").replace(/[”“″]/g, '"');
  if (!s) return null;

  const m = s.match(DIM_RE);
  if (!m) return null;

  const [, feetStr, inchStr] = m;
  if (feetStr === undefined && inchStr === undefined) return null;

  const feet = feetStr === undefined ? 0 : parseFloat(feetStr);
  const inches = inchStr === undefined ? 0 : parseFloat(inchStr);
  return feet * 12 + inches;
}

// "84x36", "7' x 3'", "7'6\" x 2'10\"" -> { w, d } in inches.
export function parseDimensionPair(input) {
  if (typeof input !== 'string') return null;
  const parts = input.split(/\s*[x×]\s*/i);
  if (parts.length !== 2) return null;

  const w = parseInches(parts[0]);
  const d = parseInches(parts[1]);
  if (w === null || d === null || w <= 0 || d <= 0) return null;
  return { w, d };
}

function trimZeros(n) {
  return String(Math.round(n * 100) / 100);
}

export function formatInches(inches) {
  if (!Number.isFinite(inches)) return '—';

  const negative = inches < 0;
  const total = Math.abs(inches);

  let feet = Math.floor(total / 12);
  let rem = Math.round((total - feet * 12) * 10) / 10;
  if (rem >= 12) {
    feet += 1;
    rem = 0;
  }

  let out;
  if (feet === 0) out = `${trimZeros(rem)}"`;
  else if (rem === 0) out = `${feet}'`;
  else out = `${feet}' ${trimZeros(rem)}"`;

  return negative ? `-${out}` : out;
}

export function formatArea(squareInches) {
  return `${(squareInches / 144).toFixed(1)} sq ft`;
}

// ── Points and segments ─────────────────────────────────────────────────────

export function dist(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function segments(points, closed = true) {
  const out = [];
  for (let i = 0; i < points.length - 1; i++) {
    out.push([points[i], points[i + 1]]);
  }
  if (closed && points.length > 2) {
    out.push([points[points.length - 1], points[0]]);
  }
  return out;
}

export function closestPointOnSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return { x: a.x, y: a.y };

  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return { x: a.x + t * dx, y: a.y + t * dy };
}

export function distToSegment(p, a, b) {
  return dist(p, closestPointOnSegment(p, a, b));
}

// Unit normal of the line through a→b.
export function segmentNormal(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return { x: 0, y: 0 };
  return { x: -dy / len, y: dx / len };
}

export function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

// ── Angles ──────────────────────────────────────────────────────────────────

export function segmentAngleDeg(a, b) {
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
}

// Smallest angle between two *lines* (direction-agnostic), 0..90.
export function lineAngleDiff(deg1, deg2) {
  let d = Math.abs(deg1 - deg2) % 180;
  if (d > 90) d = 180 - d;
  return d;
}

export function normalizeAngle(deg) {
  return ((deg % 360) + 360) % 360;
}

// ── Pieces ──────────────────────────────────────────────────────────────────
// A piece is a centre (x, y), a bounding size (w, d) and a clockwise rotation
// in degrees. Its footprint is a polygon in local coordinates centred on the
// origin, produced by the shape functions below.

function placeLocal(local, x, y, rot) {
  const r = (rot * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return local.map((p) => ({
    x: x + p.x * cos - p.y * sin,
    y: y + p.x * sin + p.y * cos,
  }));
}

export function rectLocal(w, d) {
  const hw = w / 2;
  const hd = d / 2;
  return [
    { x: -hw, y: -hd },
    { x: hw, y: -hd },
    { x: hw, y: hd },
    { x: -hw, y: hd },
  ];
}

// An L is the bounding box minus a notch. `corner` names the elbow — where the
// two arms meet — matching the ┌ ┐ └ ┘ glyphs in the UI. `armDepth` is the
// thickness of the arm running along w, `legWidth` the thickness of the arm
// running along d.
export function lShapeLocal(w, d, armDepth, legWidth, corner = 'ne') {
  const hw = w / 2;
  const hd = d / 2;

  // Degenerate parameters collapse to the bounding rectangle rather than
  // producing a self-crossing polygon.
  const arm = armDepth;
  const leg = legWidth;
  if (!(arm > 0) || !(leg > 0) || arm >= d || leg >= w) return rectLocal(w, d);

  // Built with the elbow at north-east, then mirrored into the other three.
  const base = [
    { x: -hw, y: -hd },
    { x: hw, y: -hd },
    { x: hw, y: hd },
    { x: hw - leg, y: hd },
    { x: hw - leg, y: -hd + arm },
    { x: -hw, y: -hd + arm },
  ];

  const flipX = corner === 'nw' || corner === 'sw';
  const flipY = corner === 'se' || corner === 'sw';
  return base.map((p) => ({ x: flipX ? -p.x : p.x, y: flipY ? -p.y : p.y }));
}

export function pieceLocal(piece) {
  if (piece.shape === 'L') {
    return lShapeLocal(piece.w, piece.d, piece.armDepth, piece.legWidth, piece.corner);
  }
  return rectLocal(piece.w, piece.d);
}

export function pieceCorners(piece) {
  return placeLocal(pieceLocal(piece), piece.x, piece.y, piece.rot || 0);
}

// Centres of an L's two arms — where to put a thickness annotation, and where
// a label is guaranteed to sit on solid footprint.
export function lArmCentres(w, d, armDepth, legWidth, corner = 'ne') {
  const flipX = corner === 'nw' || corner === 'sw';
  const flipY = corner === 'se' || corner === 'sw';
  const place = (p) => ({ x: flipX ? -p.x : p.x, y: flipY ? -p.y : p.y });

  return {
    long: place({ x: 0, y: -d / 2 + armDepth / 2 }),
    short: place({ x: w / 2 - legWidth / 2, y: 0 }),
  };
}

// A point guaranteed to sit on solid footprint, so a label never lands in the
// notch of an L.
export function pieceLabelAnchor(piece) {
  if (piece.shape !== 'L') return { x: 0, y: 0 };

  const { w, d, armDepth: arm, legWidth: leg } = piece;
  if (!(arm > 0) || !(leg > 0) || arm >= d || leg >= w) return { x: 0, y: 0 };

  return lArmCentres(w, d, arm, leg, piece.corner).long;
}

export function rectCorners({ x, y, w, d, rot = 0 }) {
  return placeLocal(rectLocal(w, d), x, y, rot);
}

export function polygonArea(points) {
  if (!points || points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

export function bounds(points) {
  if (!points || !points.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

// ── Snapping ────────────────────────────────────────────────────────────────

export function snapToGrid(value, size) {
  if (!size || size <= 0) return value;
  return Math.round(value / size) * size;
}

// Find the smallest translation that lands one of `movingEdges` flush against
// one of `targetEdges`. Only near-parallel edges are considered, so a piece is
// never nudged against a wall it is skew to. Returns null when nothing is in
// range. Never rotates — translation only.
export function findFlushTranslation(movingEdges, targetEdges, {
  maxDistance = 4,
  maxAngle = 8,
  perpendicularTo = null,
} = {}) {
  let best = null;

  // For the second pass of a corner snap: only consider walls whose normal is
  // perpendicular to the translation already applied, so settling against one
  // wall cannot be undone by the next.
  let constraint = null;
  if (perpendicularTo) {
    const len = Math.hypot(perpendicularTo.dx, perpendicularTo.dy);
    if (len > 1e-9) constraint = { x: perpendicularTo.dx / len, y: perpendicularTo.dy / len };
  }

  for (const [ma, mb] of movingEdges) {
    const movingAngle = segmentAngleDeg(ma, mb);
    const movingMid = midpoint(ma, mb);

    for (const [ta, tb] of targetEdges) {
      if (lineAngleDiff(movingAngle, segmentAngleDeg(ta, tb)) > maxAngle) continue;

      // Only snap to the stretch of wall the edge actually faces.
      if (distToSegment(movingMid, ta, tb) > maxDistance * 6) continue;

      const n = segmentNormal(ta, tb);
      const signed = (movingMid.x - ta.x) * n.x + (movingMid.y - ta.y) * n.y;
      if (Math.abs(signed) > maxDistance) continue;
      if (Math.abs(signed) < 1e-6) continue;   // already flush
      if (constraint && Math.abs(n.x * constraint.x + n.y * constraint.y) > 0.2) continue;

      if (!best || Math.abs(signed) < best.magnitude) {
        best = {
          magnitude: Math.abs(signed),
          dx: -signed * n.x,
          dy: -signed * n.y,
        };
      }
    }
  }

  return best;
}

// While tracing a room, pull a segment onto the horizontal or vertical axis
// when it is already close — rectangular rooms come out clean without
// precision clicking.
export function snapToAxis(from, to, toleranceDeg = 12) {
  const angle = normalizeAngle(segmentAngleDeg(from, to));
  const targets = [0, 90, 180, 270];

  for (const t of targets) {
    let diff = Math.abs(angle - t);
    if (diff > 180) diff = 360 - diff;
    if (diff > toleranceDeg) continue;

    return t === 0 || t === 180
      ? { x: to.x, y: from.y }
      : { x: from.x, y: to.y };
  }
  return to;
}

export { TAU };
