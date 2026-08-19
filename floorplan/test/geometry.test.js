import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseInches,
  parseDimensionPair,
  formatInches,
  formatArea,
  polygonArea,
  rectCorners,
  snapToGrid,
  snapToAxis,
  lineAngleDiff,
  distToSegment,
  findFlushTranslation,
  bounds,
  segments,
} from '../geometry.js';

test('parseInches accepts every documented format', () => {
  assert.equal(parseInches('84'), 84);
  assert.equal(parseInches('84"'), 84);
  assert.equal(parseInches("7'"), 84);
  assert.equal(parseInches("7' 6\""), 90);
  assert.equal(parseInches("7'6"), 90);
  assert.equal(parseInches("7'6\""), 90);
  assert.equal(parseInches("6.5'"), 78);
  assert.equal(parseInches('10 in'), 10);
  assert.equal(parseInches('3 feet'), 36);
});

test('parseInches reads the label styles found on real floorplans', () => {
  // The example plan writes "9'1"; printed plans often use "12'-6"".
  assert.equal(parseInches("9'1"), 109);
  assert.equal(parseInches('12\'-6"'), 150);
  assert.equal(parseInches("16'3"), 195);
  assert.equal(parseInches("14'5"), 173);
});

test('parseInches normalises typographic quote characters', () => {
  assert.equal(parseInches('7’ 6”'), 90);
  assert.equal(parseInches('84″'), 84);
});

test('parseInches rejects what it cannot read', () => {
  assert.equal(parseInches(''), null);
  assert.equal(parseInches('   '), null);
  assert.equal(parseInches('sofa'), null);
  assert.equal(parseInches('7 6'), null, 'ambiguous, no unit markers');
  assert.equal(parseInches('12 x 4'), null, 'a pair is not a single value');
  assert.equal(parseInches(null), null);
  assert.equal(parseInches(undefined), null);
  assert.equal(parseInches(NaN), null);
});

test('parseDimensionPair handles both separators and any spacing', () => {
  assert.deepEqual(parseDimensionPair('84x36'), { w: 84, d: 36 });
  assert.deepEqual(parseDimensionPair('84 x 36'), { w: 84, d: 36 });
  assert.deepEqual(parseDimensionPair('84 × 36'), { w: 84, d: 36 });
  assert.deepEqual(parseDimensionPair("7' x 3'"), { w: 84, d: 36 });
  assert.deepEqual(parseDimensionPair('7\'6" x 2\'10"'), { w: 90, d: 34 });
  assert.deepEqual(parseDimensionPair("16'3 X 13'8"), { w: 195, d: 164 });
});

test('parseDimensionPair rejects bad input', () => {
  assert.equal(parseDimensionPair('84'), null, 'needs two values');
  assert.equal(parseDimensionPair('84 x 36 x 30'), null, 'depth is not a third axis');
  assert.equal(parseDimensionPair('84 x sofa'), null);
  assert.equal(parseDimensionPair('0 x 36'), null, 'zero is not a size');
  assert.equal(parseDimensionPair(null), null);
});

test('formatInches renders the documented shapes', () => {
  assert.equal(formatInches(90), '7\' 6"');
  assert.equal(formatInches(84), "7'");
  assert.equal(formatInches(10), '10"');
  assert.equal(formatInches(0), '0"');
  assert.equal(formatInches(-12), "-1'");
});

test('formatInches carries rounding up instead of emitting 12 inches', () => {
  assert.equal(formatInches(83.99), "7'");
  assert.equal(formatInches(95.98), "8'");
});

test('parse and format round-trip', () => {
  for (const inches of [12, 36, 90, 173, 195, 109]) {
    assert.equal(parseInches(formatInches(inches)), inches);
  }
});

test('formatArea converts square inches to square feet', () => {
  assert.equal(formatArea(144), '1.0 sq ft');
  // Bedroom from the example plan: 14'5 x 10'9.
  assert.equal(formatArea(173 * 129), '155.0 sq ft');
});

test('polygonArea uses the shoelace formula regardless of winding', () => {
  const square = [
    { x: 0, y: 0 },
    { x: 120, y: 0 },
    { x: 120, y: 120 },
    { x: 0, y: 120 },
  ];
  assert.equal(polygonArea(square), 14400);
  assert.equal(polygonArea([...square].reverse()), 14400);
  assert.equal(polygonArea([{ x: 0, y: 0 }, { x: 1, y: 1 }]), 0, 'degenerate');
  assert.equal(polygonArea([]), 0);
});

test('polygonArea handles an L-shaped room', () => {
  // Like the example plan's living/dining: a rectangle with a bite taken out.
  const l = [
    { x: 0, y: 0 },
    { x: 120, y: 0 },
    { x: 120, y: 60 },
    { x: 60, y: 60 },
    { x: 60, y: 120 },
    { x: 0, y: 120 },
  ];
  assert.equal(polygonArea(l), 120 * 60 + 60 * 60);
});

test('rectCorners places an unrotated piece around its centre', () => {
  const corners = rectCorners({ x: 100, y: 100, w: 80, d: 40, rot: 0 });
  assert.deepEqual(corners, [
    { x: 60, y: 80 },
    { x: 140, y: 80 },
    { x: 140, y: 120 },
    { x: 60, y: 120 },
  ]);
});

test('rectCorners swaps the footprint when rotated 90 degrees', () => {
  const corners = rectCorners({ x: 0, y: 0, w: 80, d: 40, rot: 90 });
  const b = bounds(corners);
  assert.ok(Math.abs(b.width - 40) < 1e-9);
  assert.ok(Math.abs(b.height - 80) < 1e-9);
});

test('rectCorners preserves area under arbitrary rotation', () => {
  const corners = rectCorners({ x: 12, y: -5, w: 84, d: 36, rot: 37 });
  assert.ok(Math.abs(polygonArea(corners) - 84 * 36) < 1e-6);
});

test('snapToGrid rounds to the nearest multiple', () => {
  assert.equal(snapToGrid(14, 6), 12);
  assert.equal(snapToGrid(15, 6), 18);
  assert.equal(snapToGrid(-14, 6), -12);
  assert.equal(snapToGrid(14, 0), 14, 'a zero grid is a disabled grid');
});

test('snapToAxis straightens near-axis segments and leaves diagonals alone', () => {
  const from = { x: 0, y: 0 };
  assert.deepEqual(snapToAxis(from, { x: 100, y: 5 }), { x: 100, y: 0 });
  assert.deepEqual(snapToAxis(from, { x: 5, y: 100 }), { x: 0, y: 100 });
  assert.deepEqual(snapToAxis(from, { x: -100, y: 4 }), { x: -100, y: 0 });
  assert.deepEqual(
    snapToAxis(from, { x: 100, y: 100 }),
    { x: 100, y: 100 },
    '45 degrees is a real diagonal, not a wobbly wall',
  );
});

test('lineAngleDiff is direction-agnostic', () => {
  assert.equal(lineAngleDiff(0, 180), 0, 'a wall drawn backwards is the same wall');
  assert.equal(lineAngleDiff(0, 90), 90);
  assert.equal(lineAngleDiff(10, 355), 15);
});

test('distToSegment clamps to the segment endpoints', () => {
  const a = { x: 0, y: 0 };
  const b = { x: 100, y: 0 };
  assert.equal(distToSegment({ x: 50, y: 10 }, a, b), 10);
  assert.equal(distToSegment({ x: -30, y: 0 }, a, b), 30, 'past the start');
  assert.equal(distToSegment({ x: 130, y: 0 }, a, b), 30, 'past the end');
});

test('segments closes the loop only when asked', () => {
  const pts = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }];
  assert.equal(segments(pts, true).length, 3);
  assert.equal(segments(pts, false).length, 2);
});

test('findFlushTranslation pushes a piece onto a nearby parallel wall', () => {
  const wall = [[{ x: 0, y: 0 }, { x: 200, y: 0 }]];
  const piece = segments(rectCorners({ x: 100, y: 23, w: 84, d: 40 }), true);

  const t = findFlushTranslation(piece, wall);
  assert.ok(t, 'top edge sits 3" off the wall, inside the 4" threshold');
  assert.ok(Math.abs(t.dx) < 1e-9);
  assert.ok(Math.abs(t.dy - -3) < 1e-9, 'moves up by exactly the gap');
});

test('findFlushTranslation ignores walls that are too far away', () => {
  const wall = [[{ x: 0, y: 0 }, { x: 200, y: 0 }]];
  const piece = segments(rectCorners({ x: 100, y: 60, w: 84, d: 40 }), true);
  assert.equal(findFlushTranslation(piece, wall), null);
});

test('findFlushTranslation ignores walls the piece is skew to', () => {
  const wall = [[{ x: 0, y: 0 }, { x: 200, y: 0 }]];
  const piece = segments(rectCorners({ x: 100, y: 22, w: 84, d: 40, rot: 30 }), true);
  assert.equal(findFlushTranslation(piece, wall), null, 'never rotate for the user');
});

test('bounds covers all points', () => {
  const b = bounds([{ x: -5, y: 2 }, { x: 10, y: -3 }, { x: 4, y: 7 }]);
  assert.deepEqual(b, { minX: -5, minY: -3, maxX: 10, maxY: 7, width: 15, height: 10 });
  assert.equal(bounds([]), null);
});

test('findFlushTranslation ignores a wall it is already flush against', () => {
  const wall = [[{ x: 0, y: 0 }, { x: 200, y: 0 }]];
  const piece = segments(rectCorners({ x: 100, y: 20, w: 84, d: 40 }), true);
  assert.equal(findFlushTranslation(piece, wall), null, 'no zero-length nudge');
});

test('a perpendicular second pass settles a piece into a corner', () => {
  // Walls meeting at the origin, like the corner of a traced room.
  const walls = [
    [{ x: 0, y: 0 }, { x: 300, y: 0 }],
    [{ x: 0, y: 0 }, { x: 0, y: 300 }],
  ];
  // Dropped 3" below the top wall and 2" right of the left wall.
  const candidate = { x: 44, y: 23 };
  const at = (p) => segments(rectCorners({ x: p.x, y: p.y, w: 84, d: 40 }), true);

  const first = findFlushTranslation(at(candidate), walls);
  assert.ok(first, 'finds the nearer wall first');
  const afterFirst = { x: candidate.x + first.dx, y: candidate.y + first.dy };

  const second = findFlushTranslation(at(afterFirst), walls, { perpendicularTo: first });
  assert.ok(second, 'then finds the perpendicular wall');
  const afterSecond = { x: afterFirst.x + second.dx, y: afterFirst.y + second.dy };

  assert.ok(Math.abs(afterSecond.x - 42) < 1e-9, 'flush to the left wall');
  assert.ok(Math.abs(afterSecond.y - 20) < 1e-9, 'flush to the top wall');
});

test('the second pass cannot undo the first in a narrow gap', () => {
  // A closet barely wider than the piece: both walls are within snapping
  // range, but they are parallel, so the second pass must decline.
  // Rotated 90 degrees, the piece is 40" across — and the closet is 44".
  const walls = [
    [{ x: 0, y: 0 }, { x: 0, y: 300 }],
    [{ x: 44, y: 0 }, { x: 44, y: 300 }],
  ];
  const at = (p) => segments(rectCorners({ x: p.x, y: p.y, w: 84, d: 40, rot: 90 }), true);

  const candidate = { x: 23, y: 150 };
  const first = findFlushTranslation(at(candidate), walls);
  assert.ok(first);
  const afterFirst = { x: candidate.x + first.dx, y: candidate.y + first.dy };

  const second = findFlushTranslation(at(afterFirst), walls, { perpendicularTo: first });
  assert.equal(second, null, 'the opposite wall is parallel, not perpendicular');
});
