import test from 'node:test';
import assert from 'node:assert/strict';

import { extractLabels } from '../ocr.js';

// Shaped like Tesseract's output. The text values below are verbatim from real
// runs against a floorplan, including the failures.
const line = (text, x, y, confidence = 90) => ({
  text,
  confidence,
  bbox: { x0: x, y0: y, x1: x + 100, y1: y + 20 },
});

test('reads a well-formed dimension pair', () => {
  const found = extractLabels([line("16'3 x 13'8", 560, 210)], 1);
  assert.equal(found.length, 1);
  assert.equal(found[0].w, 195);
  assert.equal(found[0].d, 164);
});

test('rejects readings that lost their foot mark', () => {
  // The characteristic failure: 9'1 x 7'10 comes back as "91x 710", and
  // 8'1 x 5'3 as "81x53". Both parse as numbers. Neither may be offered.
  for (const text of ['91x 710', '81x53', '145 x 109', '163 x 138']) {
    assert.deepEqual(extractLabels([line(text, 0, 0)], 1), [], `must reject ${text}`);
  }
});

test('rejects implausible measurements even when marked', () => {
  // Observed at high upscale: 5'3 read as 95'3, apostrophe intact.
  assert.deepEqual(extractLabels([line("8'1x95'3", 0, 0)], 1), []);
  assert.deepEqual(extractLabels([line(`2" x 3"`, 0, 0)], 1), [], 'under a foot');
});

test('ignores the annotations that are not measurements', () => {
  // The blue numbers on Sam's plan: window or line numbers, not dimensions.
  const lines = [line('390', 900, 250), line('480', 500, 415), line('330', 560, 430)];
  assert.deepEqual(extractLabels(lines, 1), []);
});

test('attaches the nearest room name', () => {
  const found = extractLabels([
    line('BEDROOM', 650, 560),
    line("14'5 x 10'9", 655, 585),
    line('KITCHEN', 130, 170),
    line("9'1 x 7'10\"", 135, 195),
  ], 1);

  const byName = Object.fromEntries(found.map((f) => [f.name, `${f.w}x${f.d}`]));
  assert.equal(byName.BEDROOM, '173x129');
  assert.equal(byName.KITCHEN, '109x94');
});

test('prefers a name above the measurement over one below', () => {
  const found = extractLabels([
    line('LIVING / DINING', 560, 190),
    line("16'3 x 13'8", 565, 215),
    line('BEDROOM', 565, 260),
  ], 1);
  assert.equal(found[0].name, 'LIVING / DINING');
});

test('leaves the name null when nothing is close', () => {
  const found = extractLabels([
    line('KITCHEN', 0, 0),
    line("16'3 x 13'8", 800, 700),
  ], 1);
  assert.equal(found[0].name, null);
});

test('maps coordinates back through the upscale factor', () => {
  const found = extractLabels([line("16'3 x 13'8", 400, 600)], 2);
  assert.equal(found[0].centre.x, 225);   // (400 + 500) / 2 / 2
  assert.equal(found[0].centre.y, 305);   // (600 + 620) / 2 / 2
});

test('sorts by confidence so the best reading is offered first', () => {
  const found = extractLabels([
    line("16'3 x 13'8", 0, 0, 48),
    line("14'5 x 10'9", 0, 400, 89),
  ], 1);
  assert.equal(found[0].confidence, 89);
});

test('handles inch-only and typographic marks', () => {
  const found = extractLabels([line('84" × 36"', 0, 0)], 1);
  assert.equal(found.length, 1);
  assert.equal(found[0].w, 84);
  assert.equal(found[0].d, 36);
});

test('survives empty and junk input', () => {
  assert.deepEqual(extractLabels([], 1), []);
  assert.deepEqual(extractLabels([line('', 0, 0), line('W/D', 0, 0), line('CL', 0, 0)], 1), []);
});
