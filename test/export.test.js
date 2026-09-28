process.env.TZ = 'UTC';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDocument, formatDate, toMarkdown } from '../src/overlay/export.js';

const INSTRUCTION = `> **Instructions for the coding agent:** Implement the changes below in the source code.
> Each change states *what* to do first, then *where*: locate the element via selector,
> HTML snippet, text and location. Comments are free-text requests (possibly in another
> language) — apply them to the named element and its immediate context. New elements are
> copies of the named template: same component, same classes, same structure. Use texts
> exactly as given; if there is an i18n system, add or update keys instead of hard-coding
> text. Implement only these changes, ask if anything is ambiguous, and report the status
> per change number (numbers match the JSON \`id\`s).`;

const SOURCE = { url: 'http://localhost:8787/admin', title: 'Admin', viewport: '1440×900', createdAt: '2026-09-28T14:12:00.000Z' };

/** @param {import('../src/overlay/export.js').Doc} doc */
function jsonBlockFor(doc) {
  return '<details><summary>JSON</summary>\n\n```json\n' + JSON.stringify(doc, null, 2) + '\n```\n</details>';
}

// --- formatDate ---

test('formatDate formats as YYYY-MM-DD HH:MM in local (UTC) time', () => {
  assert.equal(formatDate('2026-09-28T14:12:00.000Z'), '2026-09-28 14:12');
});

test('formatDate pads single digits', () => {
  assert.equal(formatDate('2026-01-05T03:04:00.000Z'), '2026-01-05 03:04');
});

// --- buildDocument: shape ---

test('buildDocument assembles the plain doc shape for an empty change list', () => {
  assert.deepEqual(buildDocument([], SOURCE), { version: 1, source: SOURCE, changes: [] });
});

// --- buildDocument: renumbering (issue #3) ---

test('buildDocument renumbers ids sequentially in export order, closing gaps (ids 1,2,3,5,9 -> 1..5)', () => {
  const changes = [1, 2, 3, 5, 9].map((id) => ({ id, type: 'remove', target: { selector: `el-${id}`, tag: 'div' } }));
  const doc = buildDocument(changes, SOURCE);

  assert.deepEqual(doc.changes.map((c) => c.id), [1, 2, 3, 4, 5]);
  // internal/persisted ids stay untouched (copies, not mutation)
  assert.deepEqual(changes.map((c) => c.id), [1, 2, 3, 5, 9]);

  // Markdown section n == JSON id n
  const md = toMarkdown(doc);
  for (let n = 1; n <= 5; n++) assert.ok(md.includes(`## ${n}. Remove`), `missing heading for id ${n}`);
});

// --- buildDocument: grouping by view (issue #3's "export order") ---

test('buildDocument groups changes by view, preserving order within a group, groups ordered by first appearance', () => {
  const a = { id: 1, type: 'remove', target: { selector: 'div-a', tag: 'div', url: 'http://x/admin#a' } };
  const b = { id: 2, type: 'remove', target: { selector: 'div-b', tag: 'div', url: 'http://x/admin#b' } };
  const c = { id: 3, type: 'remove', target: { selector: 'div-c', tag: 'div', url: 'http://x/admin#a' } };
  const doc = buildDocument([a, b, c], SOURCE);

  assert.deepEqual(doc.changes.map((ch) => ch.target.selector), ['div-a', 'div-c', 'div-b']);
  assert.deepEqual(doc.changes.map((ch) => ch.id), [1, 2, 3]);
});

// --- toMarkdown: single view, one change of every type (no group headings) ---

test('toMarkdown formats one change of every type, single view: no group headings, what before where', () => {
  const url = 'http://localhost:8787/admin#auth-admin';

  const changes = [
    {
      id: 1,
      type: 'text',
      target: {
        selector: '#auth-admin form > button.primary',
        tag: 'button',
        name: 'Save',
        html: '<button class="primary" type="submit">',
        breadcrumb: 'Login › Save and unlock people',
        url,
      },
      before: 'Save',
      after: 'Save login',
    },
    {
      id: 2,
      type: 'attr',
      target: { selector: '.login-url-input', tag: 'input', breadcrumb: 'Login', url },
      attr: 'placeholder',
      before: '',
      after: 'e.g. https://login.company.com',
    },
    {
      id: 3,
      type: 'move',
      target: { selector: '#usage-admin table', tag: 'table', breadcrumb: 'Usage › Dashboards', url },
      anchor: { selector: '#usage-admin', tag: 'section', name: 'Dashboards' },
      position: 'after',
    },
    {
      id: 4,
      type: 'insert',
      template: { selector: '#metrics-admin button.primary', tag: 'button', name: 'Create metric', html: '<button class="primary">' },
      anchor: { selector: '#users-admin h3', tag: 'h3', name: 'People', breadcrumb: 'Users & access', url },
      position: 'after',
      text: 'Export CSV',
    },
    {
      id: 5,
      type: 'remove',
      target: { selector: '.dash-table', tag: 'table', classes: ['dash-table', 'wide'], url },
    },
    {
      id: 6,
      type: 'comment',
      target: { selector: '#usage-admin table', tag: 'table', breadcrumb: 'Usage › Dashboards', url },
      note: 'Add a "cost" column\nAnd make it sortable by date',
    },
  ];

  const doc = buildDocument(changes, SOURCE);

  const block1 = [
    '## 1. Change text — button "Save"',
    '- Before: "Save"',
    '- After: "Save login"',
    '- Location: Login › Save and unlock people (`/admin#auth-admin`)',
    '- Selector: `#auth-admin form > button.primary`',
    '- HTML: `<button class="primary" type="submit">`',
  ].join('\n');

  const block2 = [
    '## 2. Change description — input in Login',
    '- Attribute: `placeholder`',
    '- Before: (empty)',
    '- After: "e.g. https://login.company.com"',
    '- Location: Login (`/admin#auth-admin`)',
    '- Selector: `.login-url-input`',
  ].join('\n');

  const block3 = [
    '## 3. Move — table in Dashboards',
    '- Move to: **after** section "Dashboards" (`#usage-admin`)',
    '- Location: Usage › Dashboards (`/admin#auth-admin`)',
    '- Selector: `#usage-admin table`',
  ].join('\n');

  const block4 = [
    '## 4. New element — copy of button "Create metric"',
    '- Text: "Export CSV"',
    '- Insert: **after** h3 "People" (`#users-admin h3`)',
    '- Template: `#metrics-admin button.primary` · `<button class="primary">`',
    '- Location: Users & access (`/admin#auth-admin`)',
    '- Selector: `#users-admin h3`',
  ].join('\n');

  const block5 = ['## 5. Remove — table.dash-table', '- Location: `/admin#auth-admin`', '- Selector: `.dash-table`'].join('\n');

  const block6 = [
    '## 6. Comment — table in Dashboards',
    '> Add a "cost" column',
    '> And make it sortable by date',
    '',
    '- Location: Usage › Dashboards (`/admin#auth-admin`)',
    '- Selector: `#usage-admin table`',
  ].join('\n');

  const sourceLine =
    `Source: ${SOURCE.url} · 2026-09-28 14:12 · Viewport ${SOURCE.viewport} · ` +
    '6 changes (1 text change, 1 description change, 1 move, 1 new element, 1 removal, 1 comment)';
  const header = `# UI changes\n\n${sourceLine}\n\n${INSTRUCTION}`;
  const body = [block1, block2, block3, block4, block5, block6].join('\n\n');
  const expected = `${header}\n\n${body}\n\n${jsonBlockFor(doc)}`;

  assert.equal(toMarkdown(doc), expected);
  // headings match the JSON ids one-to-one
  assert.deepEqual(doc.changes.map((c) => c.id), [1, 2, 3, 4, 5, 6]);
});

// --- toMarkdown: multiple views (group headings) ---

test('toMarkdown groups changes under view headings when the doc spans more than one view', () => {
  const c1 = { id: 10, type: 'remove', target: { selector: 'form div.item-a', tag: 'div', breadcrumb: 'Login › Something', url: 'http://x/admin#auth-admin' } };
  const c2 = { id: 20, type: 'remove', target: { selector: 'section div.item-b', tag: 'div', url: 'http://x/admin#usage-admin' } };
  const c3 = { id: 30, type: 'remove', target: { selector: 'span.item-c', tag: 'span', breadcrumb: 'Login › Other', url: 'http://x/admin#auth-admin' } };

  const doc = buildDocument([c1, c2, c3], SOURCE);

  const groupA = '## Login (`/admin#auth-admin`)';
  const block1 = ['### 1. Remove — div in Something', '- Location: Login › Something (`/admin#auth-admin`)', '- Selector: `form div.item-a`'].join('\n');
  const block2 = ['### 2. Remove — span in Other', '- Location: Login › Other (`/admin#auth-admin`)', '- Selector: `span.item-c`'].join('\n');
  const groupB = '## `/admin#usage-admin`';
  const block3 = ['### 3. Remove — div', '- Location: `/admin#usage-admin`', '- Selector: `section div.item-b`'].join('\n');

  const sourceLine = `Source: ${SOURCE.url} · 2026-09-28 14:12 · Viewport ${SOURCE.viewport} · 3 changes (3 removals)`;
  const header = `# UI changes\n\n${sourceLine}\n\n${INSTRUCTION}`;
  const body = [groupA, block1, block2, groupB, block3].join('\n\n');
  const expected = `${header}\n\n${body}\n\n${jsonBlockFor(doc)}`;

  assert.equal(toMarkdown(doc), expected);
});

// --- subject() fallback chain ---

test('subject falls back to tag.class for long text without a usable name (before breadcrumb)', () => {
  const doc = buildDocument(
    [
      {
        id: 1,
        type: 'remove',
        target: { selector: 'main div.card', tag: 'div', text: 'x'.repeat(50), classes: ['card', 'wide'], breadcrumb: 'Dashboard' },
      },
    ],
    SOURCE
  );
  assert.ok(toMarkdown(doc).includes('## 1. Remove — div.card'));
});

test('subject uses tag#id when the selector is exactly an id selector', () => {
  const doc = buildDocument([{ id: 1, type: 'remove', target: { selector: '#save-btn', tag: 'button' } }], SOURCE);
  assert.ok(toMarkdown(doc).includes('## 1. Remove — button#save-btn'));
});

test('subject falls back to the bare tag when nothing else is available', () => {
  const doc = buildDocument([{ id: 1, type: 'remove', target: { selector: 'main > div', tag: 'div' } }], SOURCE);
  assert.ok(toMarkdown(doc).includes('## 1. Remove — div'));
});

// --- counts line ---

test('toMarkdown shows a singular change/type count for a single change', () => {
  const doc = buildDocument([{ id: 1, type: 'comment', target: { selector: '#x', tag: 'div' }, note: 'Hi' }], SOURCE);
  assert.ok(toMarkdown(doc).includes('· 1 change (1 comment)'));
});

test('toMarkdown orders per-type counts by count descending, ties by canonical type order', () => {
  const changes = [
    { id: 1, type: 'comment', target: { selector: '#a', tag: 'div' }, note: 'a' },
    { id: 2, type: 'comment', target: { selector: '#b', tag: 'div' }, note: 'b' },
    { id: 3, type: 'comment', target: { selector: '#c', tag: 'div' }, note: 'c' },
    { id: 4, type: 'text', target: { selector: '#d', tag: 'div' }, before: 'x', after: 'y' },
  ];
  const doc = buildDocument(changes, SOURCE);
  assert.ok(toMarkdown(doc).includes('· 4 changes (3 comments, 1 text change)'));
});

// --- empty list ---

test('toMarkdown shows "_No changes._" and a bare (parenthesis-free) count for an empty list', () => {
  const doc = buildDocument([], SOURCE);
  const md = toMarkdown(doc);
  assert.ok(md.includes(`· 0 changes\n`));
  assert.ok(md.includes('_No changes._'));
  assert.ok(!md.includes('## 1.'));
});

// --- omitted empty fields ---

test('toMarkdown omits the Location line when there is no breadcrumb or url, and HTML when absent', () => {
  const doc = buildDocument([{ id: 1, type: 'remove', target: { selector: 'main > div', tag: 'div' } }], SOURCE);
  const section = toMarkdown(doc).split('<details>')[0];
  assert.ok(!section.includes('- Location:'));
  assert.ok(!section.includes('- HTML:'));
  assert.ok(section.includes('- Selector: `main > div`'));
});

// --- backtick in selector ---

test('toMarkdown escapes a backtick in inline code with double backticks', () => {
  const doc = buildDocument([{ id: 1, type: 'remove', target: { selector: 'weird`sel', tag: 'div' } }], SOURCE);
  assert.ok(toMarkdown(doc).includes('- Selector: `` weird`sel ``'));
});
