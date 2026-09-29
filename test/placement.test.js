import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeFloating } from '../src/overlay/dom-utils.js';

const viewport = { width: 1000, height: 800 };
const size = { width: 100, height: 36 };
const rect = (top, bottom, left = 200, right = 400) => ({ top, bottom, left, right });
const inside = ({ left, top }) =>
  left >= 8 && top >= 8 && left + size.width <= viewport.width - 8 && top + size.height <= viewport.height - 8;

test('placeFloating: below the anchor, right-aligned, when there is room', () => {
  assert.deepEqual(placeFloating(rect(100, 150), size, viewport), { left: 300, top: 156 });
});

test('placeFloating: above the anchor when there is no room below', () => {
  const pos = placeFloating(rect(600, 780), size, viewport, { gapAbove: 24 });
  assert.deepEqual(pos, { left: 300, top: 600 - 24 - 36 });
});

test('placeFloating: inside a large anchor that fills the viewport', () => {
  const pos = placeFloating(rect(-500, 2000, 0, 1000), size, viewport, { gapAbove: 24 });
  assert.ok(inside(pos), JSON.stringify(pos));
  assert.equal(pos.top, 800 - 8 - 36 - 6);
});

test('placeFloating: clamped horizontally at the window edges', () => {
  assert.equal(placeFloating(rect(100, 150, 950, 1200), size, viewport).left, 1000 - 100 - 8);
  assert.equal(placeFloating(rect(100, 150, -300, 50), size, viewport).left, 8);
  assert.equal(placeFloating(rect(100, 150, -300, 50), size, viewport, { align: 'left' }).left, 8);
});

test('placeFloating: anchor scrolled above the viewport stays reachable', () => {
  assert.ok(inside(placeFloating(rect(-400, -100), size, viewport)));
});

test('placeFloating: insideAlign applies only when placed inside the anchor', () => {
  const big = rect(-500, 2000, 0, 1000);
  assert.equal(placeFloating(big, size, viewport, { align: 'left', insideAlign: 'right' }).left, 1000 - 100 - 8);
  assert.equal(placeFloating(rect(100, 150), size, viewport, { align: 'left', insideAlign: 'right' }).left, 200);
});
