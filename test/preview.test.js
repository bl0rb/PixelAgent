import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { sync } from '../src/overlay/preview.js';

test('preview resolves all locators in the original DOM before applying moves', () => {
  const { window } = new JSDOM('<ul id="l"><li>A</li><li>B</li><li>C</li></ul>');
  const doc = window.document;
  const loc = (n) => ({ selector: `#l > li:nth-of-type(${n})`, tag: 'li' });
  const order = () => [...doc.querySelectorAll('#l > li')].map((li) => li.textContent).join('');
  // A after B, then B after A (both locators refer to the original order A,B,C)
  const changes = [
    { id: 1, type: 'move', target: loc(1), anchor: loc(2), position: 'after' },
    { id: 2, type: 'move', target: loc(2), anchor: loc(1), position: 'after' },
  ];
  sync(changes, doc);
  assert.equal(order(), 'ABC');
  sync(changes.slice(0, 1), doc);
  assert.equal(order(), 'BAC');
  sync([], doc);
  assert.equal(order(), 'ABC');
});
