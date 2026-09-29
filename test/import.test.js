// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseImport } from '../src/overlay/import.js';
import { buildDocument, toMarkdown } from '../src/overlay/export.js';

const SOURCE = { url: 'http://localhost:8787/admin', title: 'Admin', viewport: '1440×900', createdAt: '2026-09-28T14:12:00.000Z' };

/** @param {string} selector */
const loc = (selector) => ({ selector, tag: 'button' });

// --- format (a): exported ui-changes.md ---

test('parseImport reads the JSON block from an exported ui-changes.md', () => {
  const changes = [{ id: 1, type: 'remove', target: loc('#x') }];
  const doc = buildDocument(changes, SOURCE);
  const md = toMarkdown(doc);

  const result = parseImport(md);
  assert.deepEqual(result.changes, doc.changes);
  assert.deepEqual(result.source, SOURCE);
  assert.equal(result.skipped, 0);
});

// --- format (b): raw JSON document ---

test('parseImport accepts a raw JSON document {version:1, source, changes}', () => {
  const doc = { version: 1, source: SOURCE, changes: [{ id: 1, type: 'comment', target: loc('#a'), note: 'hi' }] };
  const result = parseImport(JSON.stringify(doc));
  assert.deepEqual(result.changes, doc.changes);
  assert.deepEqual(result.source, SOURCE);
  assert.equal(result.skipped, 0);
});

// --- format (c): bare changes array ---

test('parseImport accepts a bare changes array', () => {
  const changes = [{ id: 1, type: 'comment', target: loc('#a'), note: 'hi' }];
  const result = parseImport(JSON.stringify(changes));
  assert.deepEqual(result.changes, changes);
  assert.equal(result.source, undefined);
  assert.equal(result.skipped, 0);
});

// --- errors ---

test('parseImport throws a clear error for unparsable input', () => {
  assert.throws(() => parseImport('this is not json'), /not valid JSON/i);
});

test('parseImport throws for an empty file', () => {
  assert.throws(() => parseImport(''), /nothing to import/i);
});

test('parseImport throws when version is not 1', () => {
  const doc = { version: 2, source: SOURCE, changes: [] };
  assert.throws(() => parseImport(JSON.stringify(doc)), /version/i);
});

test('parseImport throws when version is missing on an object document', () => {
  const doc = { source: SOURCE, changes: [] };
  assert.throws(() => parseImport(JSON.stringify(doc)), /version/i);
});

// --- validation: invalid changes are dropped and counted ---

test('parseImport drops invalid changes and counts them in skipped', () => {
  const changes = [
    { id: 1, type: 'comment', target: loc('#a'), note: 'ok' },
    { id: 2, type: 'bogus-type', target: loc('#b') },
    { id: 3, type: 'text', target: loc('#c') }, // missing before/after
    { id: 4, type: 'move', target: loc('#d'), anchor: loc('#e'), position: 'sideways' }, // bad position
    { id: 5, type: 'remove' }, // missing target
    'not-an-object',
  ];
  const result = parseImport(JSON.stringify(changes));
  assert.equal(result.changes.length, 1);
  assert.equal(result.changes[0].id, 1);
  assert.equal(result.skipped, 5);
});

test('parseImport requires a selector string on target/anchor/template locators', () => {
  const changes = [
    { id: 1, type: 'remove', target: { tag: 'div' } }, // no selector
    { id: 2, type: 'move', target: loc('#a'), anchor: { tag: 'div' }, position: 'before' }, // anchor has no selector
    {
      id: 3,
      type: 'insert',
      template: { tag: 'button' },
      anchor: loc('#a'),
      position: 'after',
      text: 'x',
    }, // template has no selector
  ];
  const result = parseImport(JSON.stringify(changes));
  assert.equal(result.changes.length, 0);
  assert.equal(result.skipped, 3);
});

// --- round trip ---

test('round trip: buildDocument + toMarkdown -> parseImport gives back the same changes', () => {
  const changes = [
    { id: 1, type: 'text', target: { selector: '#save', tag: 'button', name: 'Save' }, before: 'Save', after: 'Save login' },
    { id: 2, type: 'attr', target: { selector: '.input', tag: 'input' }, attr: 'placeholder', before: '', after: 'x' },
    { id: 3, type: 'move', target: { selector: '#m', tag: 'table' }, anchor: { selector: '#a', tag: 'section' }, position: 'after' },
    {
      id: 4,
      type: 'insert',
      template: { selector: '#tpl', tag: 'button' },
      anchor: { selector: '#anchor', tag: 'h3' },
      position: 'after',
      text: 'CSV',
    },
    { id: 5, type: 'remove', target: { selector: '.dash', tag: 'table' } },
    { id: 6, type: 'comment', target: { selector: '#c', tag: 'table' }, note: 'Add a column\nAnd sort it' },
  ];
  const doc = buildDocument(changes, SOURCE);
  const md = toMarkdown(doc);

  const result = parseImport(md);
  assert.deepEqual(result.changes, doc.changes);
  assert.deepEqual(result.source, SOURCE);
  assert.equal(result.skipped, 0);
});
