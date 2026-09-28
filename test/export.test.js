process.env.TZ = 'UTC';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDocument, formatDate, toMarkdown } from '../src/overlay/export.js';

const INSTRUCTION_DE = `> **Anweisung an den Coding-Agenten:** Setze die folgenden Änderungen im Quellcode
> um. Finde Elemente über Text, Selektor und HTML-Ausschnitt. Neue Elemente sind
> Kopien der genannten Vorlage: gleiche Komponente, gleiche Klassen, gleiche
> Struktur. Texte exakt übernehmen; gibt es ein i18n-System, Keys anlegen bzw.
> anpassen statt Text hart einzutragen. Nur diese Änderungen umsetzen. Bei
> Mehrdeutigkeit nachfragen.`;

const INSTRUCTION_EN = `> **Instructions for the coding agent:** Implement the following changes in the
> source code. Locate elements via text, selector and HTML snippet. New elements
> are copies of the named template: same component, same classes, same
> structure. Use texts exactly as given; if there is an i18n system, add or
> update keys instead of hard-coding text. Implement only these changes. Ask if
> anything is ambiguous.`;

// --- formatDate ---

test('formatDate formats as DD.MM.YYYY HH:MM in local (UTC) time (de)', () => {
  assert.equal(formatDate('2026-09-28T14:12:00.000Z', 'de'), '28.09.2026 14:12');
});

test('formatDate pads single digits (de)', () => {
  assert.equal(formatDate('2026-01-05T03:04:00.000Z', 'de'), '05.01.2026 03:04');
});

test('formatDate formats as YYYY-MM-DD HH:MM in local (UTC) time (en, default)', () => {
  assert.equal(formatDate('2026-09-28T14:12:00.000Z'), '2026-09-28 14:12');
});

test('formatDate pads single digits (en)', () => {
  assert.equal(formatDate('2026-01-05T03:04:00.000Z', 'en'), '2026-01-05 03:04');
});

// --- buildDocument ---

test('buildDocument assembles the plain doc shape', () => {
  const changes = [];
  const source = { url: 'http://localhost:8787/admin', title: 'Admin', viewport: '1440×900', createdAt: '2026-09-28T14:12:00.000Z' };
  assert.deepEqual(buildDocument(changes, source), { version: 1, source, changes });
});

// --- toMarkdown: one change of every type (snapshot, de) ---

test('toMarkdown formats one change of every type (de)', () => {
  const source = {
    url: 'http://localhost:8787/admin',
    title: 'Admin',
    viewport: '1440×900',
    createdAt: '2026-09-28T14:12:00.000Z',
  };

  const changes = [
    {
      id: 1,
      type: 'text',
      target: {
        selector: '#auth-admin form > button.primary',
        tag: 'button',
        name: 'Speichern',
        html: '<button class="primary" type="submit">',
        breadcrumb: 'Anmeldung › Speichern und Personen freischalten',
        url: 'http://localhost:8787/admin#auth-admin',
      },
      before: 'Speichern',
      after: 'Anmeldung speichern',
    },
    {
      id: 2,
      type: 'attr',
      target: {
        selector: '#login-url-input',
        tag: 'input',
        url: 'http://localhost:8787/admin#auth-admin',
      },
      attr: 'placeholder',
      before: '',
      after: 'z. B. https://login.firma.de',
    },
    {
      id: 3,
      type: 'move',
      target: {
        selector: '#usage-admin table',
        tag: 'table',
        breadcrumb: 'Nutzung › Dashboards',
        url: 'http://localhost:8787/admin#usage-admin',
      },
      anchor: { selector: '#usage-admin', tag: 'section', name: 'Dashboards' },
      position: 'after',
    },
    {
      id: 4,
      type: 'insert',
      template: {
        selector: '#metrics-admin button.primary',
        tag: 'button',
        name: 'Kennzahl anlegen',
        html: '<button class="primary">',
      },
      anchor: { selector: '#users-admin h3', tag: 'h3', name: 'Personen', breadcrumb: 'Benutzer & Zugriff' },
      position: 'after',
      text: 'CSV exportieren',
    },
    {
      id: 5,
      type: 'remove',
      target: {
        selector: '#usage-admin table',
        tag: 'table',
        breadcrumb: 'Nutzung › Dashboards',
      },
    },
    {
      id: 6,
      type: 'comment',
      target: {
        selector: '#usage-admin table',
        tag: 'table',
        breadcrumb: 'Nutzung › Dashboards',
        url: 'http://localhost:8787/admin#usage-admin',
      },
      note: 'Spalte „Kosten“ ergänzen\nUnd nach Datum sortierbar machen',
    },
  ];

  const doc = buildDocument(changes, source);

  const block1 = [
    '## 1. Text ändern — button „Speichern“',
    '- Ort: Anmeldung › Speichern und Personen freischalten (`/admin#auth-admin`)',
    '- Selektor: `#auth-admin form > button.primary`',
    '- HTML: `<button class="primary" type="submit">`',
    '- Vorher: „Speichern“',
    '- Nachher: „Anmeldung speichern“',
  ].join('\n');

  const block2 = [
    '## 2. Beschreibung ändern — input',
    '- Ort: `/admin#auth-admin`',
    '- Selektor: `#login-url-input`',
    '- Attribut: `placeholder`',
    '- Vorher: (leer)',
    '- Nachher: „z. B. https://login.firma.de“',
  ].join('\n');

  const block3 = [
    '## 3. Verschieben — table in Dashboards',
    '- Ort: Nutzung › Dashboards (`/admin#usage-admin`)',
    '- Selektor: `#usage-admin table`',
    '- Neue Position: **nach** section „Dashboards“ (`#usage-admin`)',
  ].join('\n');

  const block4 = [
    '## 4. Neues Element — Kopie von button „Kennzahl anlegen“',
    '- Ort: Benutzer & Zugriff, **nach** h3 „Personen“',
    '- Anker: `#users-admin h3`',
    '- Vorlage: `#metrics-admin button.primary` · `<button class="primary">`',
    '- Text: „CSV exportieren“',
  ].join('\n');

  const block5 = [
    '## 5. Entfernen — table in Dashboards',
    '- Ort: Nutzung › Dashboards',
    '- Selektor: `#usage-admin table`',
  ].join('\n');

  const block6 = [
    '## 6. Kommentar — table in Dashboards',
    '- Ort: Nutzung › Dashboards (`/admin#usage-admin`)',
    '- Selektor: `#usage-admin table`',
    '- Hinweis: Spalte „Kosten“ ergänzen',
    '  Und nach Datum sortierbar machen',
  ].join('\n');

  const header = `# UI-Änderungen\n\nQuelle: ${source.url} · 28.09.2026 14:12 · Viewport ${source.viewport}\n\n${INSTRUCTION_DE}`;
  const body = [block1, block2, block3, block4, block5, block6].join('\n\n');
  const jsonBlock = '<details><summary>JSON</summary>\n\n```json\n' + JSON.stringify(doc, null, 2) + '\n```\n</details>';
  const expected = `${header}\n\n${body}\n\n${jsonBlock}`;

  assert.equal(toMarkdown(doc, 'de'), expected);
});

// --- toMarkdown: one change of every type (snapshot, en) ---

test('toMarkdown formats one change of every type (en, default lang)', () => {
  const source = {
    url: 'http://localhost:8787/admin',
    title: 'Admin',
    viewport: '1440×900',
    createdAt: '2026-09-28T14:12:00.000Z',
  };

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
        url: 'http://localhost:8787/admin#auth-admin',
      },
      before: 'Save',
      after: 'Save login',
    },
    {
      id: 2,
      type: 'attr',
      target: {
        selector: '#login-url-input',
        tag: 'input',
        url: 'http://localhost:8787/admin#auth-admin',
      },
      attr: 'placeholder',
      before: '',
      after: 'e.g. https://login.company.com',
    },
    {
      id: 3,
      type: 'move',
      target: {
        selector: '#usage-admin table',
        tag: 'table',
        breadcrumb: 'Usage › Dashboards',
        url: 'http://localhost:8787/admin#usage-admin',
      },
      anchor: { selector: '#usage-admin', tag: 'section', name: 'Dashboards' },
      position: 'after',
    },
    {
      id: 4,
      type: 'insert',
      template: {
        selector: '#metrics-admin button.primary',
        tag: 'button',
        name: 'Create metric',
        html: '<button class="primary">',
      },
      anchor: { selector: '#users-admin h3', tag: 'h3', name: 'People', breadcrumb: 'Users & access' },
      position: 'after',
      text: 'Export CSV',
    },
    {
      id: 5,
      type: 'remove',
      target: {
        selector: '#usage-admin table',
        tag: 'table',
        breadcrumb: 'Usage › Dashboards',
      },
    },
    {
      id: 6,
      type: 'comment',
      target: {
        selector: '#usage-admin table',
        tag: 'table',
        breadcrumb: 'Usage › Dashboards',
        url: 'http://localhost:8787/admin#usage-admin',
      },
      note: 'Add a "cost" column\nAnd make it sortable by date',
    },
  ];

  const doc = buildDocument(changes, source);

  const block1 = [
    '## 1. Change text — button "Save"',
    '- Location: Login › Save and unlock people (`/admin#auth-admin`)',
    '- Selector: `#auth-admin form > button.primary`',
    '- HTML: `<button class="primary" type="submit">`',
    '- Before: "Save"',
    '- After: "Save login"',
  ].join('\n');

  const block2 = [
    '## 2. Change description — input',
    '- Location: `/admin#auth-admin`',
    '- Selector: `#login-url-input`',
    '- Attribute: `placeholder`',
    '- Before: (empty)',
    '- After: "e.g. https://login.company.com"',
  ].join('\n');

  const block3 = [
    '## 3. Move — table in Dashboards',
    '- Location: Usage › Dashboards (`/admin#usage-admin`)',
    '- Selector: `#usage-admin table`',
    '- New position: **after** section "Dashboards" (`#usage-admin`)',
  ].join('\n');

  const block4 = [
    '## 4. New element — copy of button "Create metric"',
    '- Location: Users & access, **after** h3 "People"',
    '- Anchor: `#users-admin h3`',
    '- Template: `#metrics-admin button.primary` · `<button class="primary">`',
    '- Text: "Export CSV"',
  ].join('\n');

  const block5 = [
    '## 5. Remove — table in Dashboards',
    '- Location: Usage › Dashboards',
    '- Selector: `#usage-admin table`',
  ].join('\n');

  const block6 = [
    '## 6. Comment — table in Dashboards',
    '- Location: Usage › Dashboards (`/admin#usage-admin`)',
    '- Selector: `#usage-admin table`',
    '- Note: Add a "cost" column',
    '  And make it sortable by date',
  ].join('\n');

  const header = `# UI changes\n\nSource: ${source.url} · 2026-09-28 14:12 · Viewport ${source.viewport}\n\n${INSTRUCTION_EN}`;
  const body = [block1, block2, block3, block4, block5, block6].join('\n\n');
  const jsonBlock = '<details><summary>JSON</summary>\n\n```json\n' + JSON.stringify(doc, null, 2) + '\n```\n</details>';
  const expected = `${header}\n\n${body}\n\n${jsonBlock}`;

  // no lang arg: 'en' is the default
  assert.equal(toMarkdown(doc), expected);
  assert.equal(toMarkdown(doc, 'en'), expected);
});

// --- empty list ---

test('toMarkdown shows "Keine Änderungen" for an empty list (de)', () => {
  const source = { url: 'http://localhost:8787/admin', title: 'Admin', viewport: '1440×900', createdAt: '2026-09-28T14:12:00.000Z' };
  const doc = buildDocument([], source);
  const md = toMarkdown(doc, 'de');
  assert.ok(md.includes('_Keine Änderungen._'));
  assert.ok(!md.includes('## 1.'));
});

test('toMarkdown shows "No changes" for an empty list (en, default)', () => {
  const source = { url: 'http://localhost:8787/admin', title: 'Admin', viewport: '1440×900', createdAt: '2026-09-28T14:12:00.000Z' };
  const doc = buildDocument([], source);
  const md = toMarkdown(doc);
  assert.ok(md.includes('_No changes._'));
  assert.ok(!md.includes('## 1.'));
});

// --- omitted empty fields ---

test('toMarkdown omits Location and HTML lines when both are empty (de)', () => {
  const source = { url: 'http://localhost:8787/admin', title: 'Admin', viewport: '1440×900', createdAt: '2026-09-28T14:12:00.000Z' };
  const doc = buildDocument(
    [{ id: 1, type: 'remove', target: { selector: '#x', tag: 'div' } }],
    source
  );
  const md = toMarkdown(doc, 'de');
  const section = md.split('<details>')[0];
  assert.ok(!section.includes('- Ort:'));
  assert.ok(!section.includes('- HTML:'));
  assert.ok(section.includes('- Selektor: `#x`'));
});

test('toMarkdown omits Location and HTML lines when both are empty (en)', () => {
  const source = { url: 'http://localhost:8787/admin', title: 'Admin', viewport: '1440×900', createdAt: '2026-09-28T14:12:00.000Z' };
  const doc = buildDocument(
    [{ id: 1, type: 'remove', target: { selector: '#x', tag: 'div' } }],
    source
  );
  const md = toMarkdown(doc, 'en');
  const section = md.split('<details>')[0];
  assert.ok(!section.includes('- Location:'));
  assert.ok(!section.includes('- HTML:'));
  assert.ok(section.includes('- Selector: `#x`'));
});

// --- backtick in selector ---

test('toMarkdown escapes a backtick in inline code with double backticks (de)', () => {
  const source = { url: 'http://localhost:8787/admin', title: 'Admin', viewport: '1440×900', createdAt: '2026-09-28T14:12:00.000Z' };
  const doc = buildDocument(
    [{ id: 1, type: 'remove', target: { selector: '#weird`sel', tag: 'div' } }],
    source
  );
  const md = toMarkdown(doc, 'de');
  assert.ok(md.includes('- Selektor: `` #weird`sel ``'));
});

test('toMarkdown escapes a backtick in inline code with double backticks (en)', () => {
  const source = { url: 'http://localhost:8787/admin', title: 'Admin', viewport: '1440×900', createdAt: '2026-09-28T14:12:00.000Z' };
  const doc = buildDocument(
    [{ id: 1, type: 'remove', target: { selector: '#weird`sel', tag: 'div' } }],
    source
  );
  const md = toMarkdown(doc, 'en');
  assert.ok(md.includes('- Selector: `` #weird`sel ``'));
});
