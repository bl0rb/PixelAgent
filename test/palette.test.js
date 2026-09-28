// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { scanPalette } from '../src/overlay/palette.js';

const FIXTURE = `<!DOCTYPE html>
<html>
<body>
  <button class="btn btn-primary" type="button">Speichern</button>
  <button class="btn btn-primary" type="button">Anlegen</button>
  <button class="btn btn-primary" type="button">Löschen</button>
  <button class="btn btn-primary" type="button">Exportieren</button>

  <a href="/one">Eins</a>

  <div class="card">
    <h3>Karte A</h3>
  </div>
  <div class="card">
    <h3>Karte B</h3>
  </div>

  <span class="icon"></span>
  <span class="icon"></span>
  <div></div>
  <div></div>

  <ul>
    <li>Erstens</li>
    <li>Zweitens</li>
  </ul>

  <div hidden>
    <button class="btn btn-primary" type="button">Versteckt</button>
  </div>
</body>
</html>`;

test('scanPalette groups simple tags and repeated class-bearing elements, skips one-off classless elements', () => {
  const dom = new JSDOM(FIXTURE, { url: 'http://localhost/demo.html' });
  const { document } = dom.window;

  const entries = scanPalette(document);
  const bySignature = new Map(entries.map((e) => [e.signature, e]));

  // Simple tag (button) with classes: counted correctly, hidden ones excluded.
  const buttons = bySignature.get('button.btn.btn-primary[type=button]');
  assert.ok(buttons, 'button.btn.btn-primary should be found');
  assert.equal(buttons.count, 4, 'the button inside [hidden] must not be counted');
  assert.equal(buttons.examples.length, 3, 'examples are capped at 3');
  assert.ok(buttons.label.includes('(4×)'));
  assert.ok(buttons.label.includes('…'), 'a 4th distinct example text should be indicated with an ellipsis');

  // Simple tag with count 1 is still included (a, h3, li).
  const link = bySignature.get('a');
  assert.ok(link, 'a plain <a> should be included even with count 1');
  assert.equal(link.count, 1);

  // Class-bearing, non-simple tag occurring >=2 times is included.
  const cards = bySignature.get('div.card');
  assert.ok(cards, 'div.card (>=2x) should be included');
  assert.equal(cards.count, 2);

  // Classless non-simple tags are never included, regardless of count.
  assert.equal(bySignature.get('div'), undefined, 'plain classless <div> must never appear');

  // template = first occurrence in document order.
  assert.equal(cards.template.textContent.trim(), 'Karte A');

  // Sorted by count, descending.
  for (let i = 1; i < entries.length; i++) {
    assert.ok(entries[i - 1].count >= entries[i].count, 'entries must be sorted by count desc');
  }
});

test('scanPalette requires >=2 occurrences for classed non-simple elements', () => {
  const dom = new JSDOM(
    `<!doctype html><html><body><div class="lonely-badge">X</div></body></html>`,
    { url: 'http://localhost/demo.html' }
  );
  const entries = scanPalette(dom.window.document);
  assert.equal(entries.find((e) => e.signature === 'div.lonely-badge'), undefined);
});
