import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  cssEscape,
  buildSelector,
  getRole,
  getAccessibleName,
  getVisibleText,
  getOpeningTag,
  getBreadcrumb,
  createLocator,
  resolveLocator,
} from '../src/overlay/locator.js';

const FIXTURE = `<!DOCTYPE html>
<html>
<body>
  <h2>Anmeldung</h2>
  <section id="auth-admin">
    <h3>Speichern und Personen freischalten</h3>
    <form>
      <button class="primary" type="submit">Speichern</button>
    </form>
    <ul>
      <li class="badge">One</li>
      <li class="badge">Two</li>
      <li class="badge">Three</li>
    </ul>
  </section>

  <section aria-labelledby="metrics-title">
    <h4 id="metrics-title" hidden>Kennzahlenverwaltung</h4>
    <h3>Neue Kennzahl</h3>
    <button data-testid="add-metric" class="primary">Kennzahl anlegen</button>
  </section>

  <input name="email" type="email" />
  <button aria-label="Schließen">&times;</button>

  <div id="save-label">Änderungen speichern</div>
  <button id="save-button" aria-labelledby="save-label">&#128190;</button>

  <nav aria-label="Hauptnavigation"><a href="#a" id="nav-link-a">A</a></nav>
  <nav><a href="#b" id="nav-link-b">B</a></nav>

  <dialog aria-label="Bestätigung"><p id="confirm-p">Wirklich löschen?</p></dialog>

  <dialog id="plain-dialog">
    <div class="body"><p id="warn-p">Achtung</p></div>
    <h2>Warnung</h2>
  </dialog>

  <dialog id="empty-dialog"><p id="empty-dialog-p">Text</p></dialog>

  <section id="self-section" aria-labelledby="self-heading">
    <h3 id="self-heading">Selbstbezug</h3>
  </section>

  <h3>Ebene1</h3>
  <section id="deep-a">
    <h3>Ebene2</h3>
    <div id="deep-b">
      <h3>Ebene3</h3>
      <div id="deep-c">
        <h3>Ebene4</h3>
        <div id="deep-d">
          <h3>Ebene5</h3>
          <span id="deep-target">Ziel</span>
        </div>
      </div>
    </div>
  </section>

  <form id="labels-form">
    <label for="username-field">Benutzername</label>
    <input id="username-field" type="text" />
    <label id="pw-label">Passwort <input type="password" name="pw" id="pw-input" /></label>
    <input type="submit" value="Absenden" id="submit-input" />
  </form>
  <img id="logo-img" src="x.png" alt="Firmenlogo" />

  <p id="long-text-p">${'x'.repeat(120)}</p>
  <div id="long-attr-div" title='has "quotes" here' data-filler="${'y'.repeat(220)}"></div>

  <div id="a:b"></div>
  <div id="1abc"></div>

  <section id="roles-demo">
    <button id="role-button-explicit" role="switch">Explizit</button>
    <button id="role-button-implicit">Implizit</button>
    <a href="#x" id="role-link">Link</a>
    <a id="role-a-nohref">Kein Link</a>
    <input id="role-input-text" type="text" />
    <input id="role-input-checkbox" type="checkbox" />
    <input id="role-input-radio" type="radio" />
    <input id="role-input-range" type="range" />
    <input id="role-input-number" type="number" />
    <input id="role-input-search" type="search" />
    <select id="role-select"><option>A</option></select>
    <textarea id="role-textarea"></textarea>
    <h1 id="role-h1">H1</h1>
    <h4 id="role-h4">H4</h4>
    <nav id="role-nav"></nav>
    <main id="role-main"></main>
    <dialog id="role-dialog"></dialog>
    <table id="role-table"><tbody><tr id="role-tr"><th id="role-th">H</th><td id="role-td">D</td></tr></tbody></table>
    <ul id="role-ul"><li id="role-li">Item</li></ul>
    <img id="role-img" src="x.png" alt="Bild" />
    <img id="role-img-decorative" src="x.png" alt="" />
    <form id="role-form"></form>
    <section id="role-section-region" aria-label="Bereich"></section>
    <section id="role-section-plain"></section>
    <p id="role-p">Text</p>
    <div id="role-div-none">Nix</div>
  </section>
</body>
</html>`;

function makeDoc() {
  const dom = new JSDOM(FIXTURE, { url: 'http://localhost:8787/admin#auth-admin' });
  return dom.window.document;
}

const doc = makeDoc();
const $ = (sel) => doc.querySelector(sel);

// --- cssEscape ---

test('cssEscape escapes odd characters', () => {
  assert.equal(cssEscape('a:b'), 'a\\:b');
});

test('cssEscape escapes a leading digit', () => {
  assert.equal(cssEscape('1abc'), '\\31 abc');
});

test('cssEscape escapes a leading dash + digit', () => {
  assert.equal(cssEscape('-1abc'), '-\\31 abc');
});

// --- buildSelector priority ---

test('buildSelector prefers id', () => {
  assert.equal(buildSelector($('#save-label')), '#save-label');
});

test('buildSelector prefers data-testid over class path', () => {
  assert.equal(buildSelector($('[data-testid="add-metric"]')), '[data-testid="add-metric"]');
});

test('buildSelector prefers name', () => {
  assert.equal(buildSelector($('input[name="email"]')), 'input[name="email"]');
});

test('buildSelector prefers aria-label', () => {
  const el = doc.querySelector('button[aria-label="Schließen"]');
  assert.equal(buildSelector(el), 'button[aria-label="Schließen"]');
});

test('buildSelector builds a class path anchored at the nearest ancestor id', () => {
  const button = doc.querySelector('#auth-admin form > button.primary');
  assert.equal(buildSelector(button), '#auth-admin form > button.primary');
});

test('buildSelector adds :nth-of-type for identical siblings', () => {
  const items = doc.querySelectorAll('#auth-admin ul li.badge');
  assert.equal(buildSelector(items[0]), '#auth-admin ul > li.badge:nth-of-type(1)');
  assert.equal(buildSelector(items[1]), '#auth-admin ul > li.badge:nth-of-type(2)');
  assert.equal(buildSelector(items[2]), '#auth-admin ul > li.badge:nth-of-type(3)');
});

test('buildSelector escapes odd ids used as anchors', () => {
  const sel = buildSelector(doc.getElementById('a:b'));
  assert.equal(sel, '#a\\:b');
  assert.equal(doc.querySelectorAll(sel).length, 1);
});

test('buildSelector never includes uce-root', () => {
  const dom = new JSDOM(
    '<!DOCTYPE html><html><body><uce-root><div id="inside-root"><span id="root-child">x</span></div></uce-root></body></html>',
    { url: 'http://localhost:8787/admin' }
  );
  const d = dom.window.document;
  const sel = buildSelector(d.getElementById('root-child'));
  assert.ok(!sel.includes('uce-root'));
});

test('every generated selector matches exactly the source element (whole fixture)', () => {
  const all = doc.body.querySelectorAll('*');
  for (const el of all) {
    const sel = buildSelector(el);
    const matches = doc.querySelectorAll(sel);
    assert.equal(matches.length, 1, `selector "${sel}" for <${el.tagName}> should match exactly 1 element`);
    assert.equal(matches[0], el, `selector "${sel}" should match the source element`);
  }
});

// --- roles ---

test('getRole reads an explicit role attribute', () => {
  assert.equal(getRole($('#role-button-explicit')), 'switch');
});

test('getRole computes implicit roles', () => {
  assert.equal(getRole($('#role-button-implicit')), 'button');
  assert.equal(getRole($('#role-link')), 'link');
  assert.equal(getRole($('#role-a-nohref')), '');
  assert.equal(getRole($('#role-input-text')), 'textbox');
  assert.equal(getRole($('#role-input-checkbox')), 'checkbox');
  assert.equal(getRole($('#role-input-radio')), 'radio');
  assert.equal(getRole($('#role-input-range')), 'slider');
  assert.equal(getRole($('#role-input-number')), 'spinbutton');
  assert.equal(getRole($('#role-input-search')), 'searchbox');
  assert.equal(getRole($('#role-select')), 'combobox');
  assert.equal(getRole($('#role-textarea')), 'textbox');
  assert.equal(getRole($('#role-h1')), 'heading');
  assert.equal(getRole($('#role-h4')), 'heading');
  assert.equal(getRole($('#role-nav')), 'navigation');
  assert.equal(getRole($('#role-main')), 'main');
  assert.equal(getRole($('#role-dialog')), 'dialog');
  assert.equal(getRole($('#role-table')), 'table');
  assert.equal(getRole($('#role-tr')), 'row');
  assert.equal(getRole($('#role-th')), 'columnheader');
  assert.equal(getRole($('#role-td')), 'cell');
  assert.equal(getRole($('#role-ul')), 'list');
  assert.equal(getRole($('#role-li')), 'listitem');
  assert.equal(getRole($('#role-img')), 'img');
  assert.equal(getRole($('#role-img-decorative')), 'presentation');
  assert.equal(getRole($('#role-form')), 'form');
  assert.equal(getRole($('#role-section-region')), 'region');
  assert.equal(getRole($('#role-section-plain')), '');
  assert.equal(getRole($('#role-p')), 'paragraph');
  assert.equal(getRole($('#role-div-none')), '');
});

// --- accessible name ---

test('getAccessibleName uses aria-label', () => {
  assert.equal(getAccessibleName(doc.querySelector('button[aria-label="Schließen"]')), 'Schließen');
});

test('getAccessibleName uses aria-labelledby', () => {
  assert.equal(getAccessibleName($('#save-button')), 'Änderungen speichern');
});

test('getAccessibleName uses an associated label[for]', () => {
  assert.equal(getAccessibleName($('#username-field')), 'Benutzername');
});

test('getAccessibleName uses a wrapping label', () => {
  assert.equal(getAccessibleName($('#pw-input')), 'Passwort');
});

test('getAccessibleName uses alt on images', () => {
  assert.equal(getAccessibleName($('#logo-img')), 'Firmenlogo');
});

test('getAccessibleName uses value on submit inputs', () => {
  assert.equal(getAccessibleName($('#submit-input')), 'Absenden');
});

test('getAccessibleName falls back to visible text', () => {
  const button = doc.querySelector('#auth-admin form > button.primary');
  assert.equal(getAccessibleName(button), 'Speichern');
});

// --- visible text ---

test('getVisibleText trims and truncates to 80 chars', () => {
  const text = getVisibleText($('#long-text-p'));
  assert.equal(text.length, 80);
  assert.ok(text.endsWith('…'));
  assert.equal(text.slice(0, 79), 'x'.repeat(79));
});

test('getVisibleText collapses whitespace and excludes script/style', () => {
  const dom = new JSDOM(
    '<!DOCTYPE html><html><body><p id="p">  Hallo   <script>bad()</script> Welt  </p></body></html>'
  );
  const t = getVisibleText(dom.window.document.getElementById('p'));
  assert.equal(t, 'Hallo Welt');
});

// --- opening tag ---

test('getOpeningTag escapes quotes in attribute values', () => {
  const html = getOpeningTag($('#long-attr-div'));
  assert.ok(html.includes('&quot;quotes&quot;'));
});

test('getOpeningTag truncates to 200 chars', () => {
  const html = getOpeningTag($('#long-attr-div'));
  assert.equal(html.length, 200);
  assert.ok(html.endsWith('…'));
});

test('getOpeningTag skips contenteditable and data-uce-* attributes', () => {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="d" contenteditable="true" data-uce-id="1" title="t"></div></body></html>');
  const html = getOpeningTag(dom.window.document.getElementById('d'));
  assert.equal(html, '<div id="d" title="t">');
});

// --- breadcrumb ---

test('getBreadcrumb finds a preceding h2/h3 chain', () => {
  const button = doc.querySelector('#auth-admin form > button.primary');
  assert.equal(getBreadcrumb(button), 'Anmeldung › Speichern und Personen freischalten');
});

test('getBreadcrumb combines a preceding heading with a section[aria-labelledby] landmark', () => {
  const button = doc.querySelector('[data-testid="add-metric"]');
  assert.equal(getBreadcrumb(button), 'Kennzahlenverwaltung › Neue Kennzahl');
});

test('getBreadcrumb reads nav aria-label, defaults to "Navigation"', () => {
  assert.equal(getBreadcrumb($('#nav-link-a')), 'Hauptnavigation');
  assert.equal(getBreadcrumb($('#nav-link-b')), 'Navigation');
});

test('getBreadcrumb reads dialog aria-label', () => {
  assert.equal(getBreadcrumb($('#confirm-p')), 'Bestätigung');
});

test('getBreadcrumb falls back to the first heading inside a dialog', () => {
  assert.equal(getBreadcrumb($('#warn-p')), 'Warnung');
});

test('getBreadcrumb falls back to literal "Dialog"', () => {
  assert.equal(getBreadcrumb($('#empty-dialog-p')), 'Dialog');
});

test('getBreadcrumb never includes the element\'s own text when el is a heading', () => {
  assert.equal(getBreadcrumb($('#self-heading')), '');
});

test('getBreadcrumb keeps at most 4 entries, innermost first', () => {
  assert.equal(getBreadcrumb($('#deep-target')), 'Ebene2 › Ebene3 › Ebene4 › Ebene5');
});

// --- createLocator ---

test('createLocator omits empty fields and fills url from the document', () => {
  const button = doc.querySelector('#auth-admin form > button.primary');
  const loc = createLocator(button);
  assert.equal(loc.selector, '#auth-admin form > button.primary');
  assert.equal(loc.tag, 'button');
  assert.equal(loc.role, 'button');
  assert.equal(loc.name, 'Speichern');
  assert.equal(loc.text, 'Speichern');
  assert.deepEqual(loc.classes, ['primary']);
  assert.equal(loc.html, '<button class="primary" type="submit">');
  assert.equal(loc.breadcrumb, 'Anmeldung › Speichern und Personen freischalten');
  assert.equal(loc.url, 'http://localhost:8787/admin#auth-admin');
});

test('createLocator uses an explicit url when given', () => {
  const button = doc.querySelector('#auth-admin form > button.primary');
  const loc = createLocator(button, { url: 'http://localhost:8787/admin#other' });
  assert.equal(loc.url, 'http://localhost:8787/admin#other');
});

// --- resolveLocator ---

test('resolveLocator resolves via selector', () => {
  const button = doc.querySelector('#auth-admin form > button.primary');
  const loc = createLocator(button);
  assert.equal(resolveLocator(loc, doc), button);
});

test('resolveLocator falls back to tag + visible text when the selector is stale', () => {
  const button = doc.querySelector('#auth-admin form > button.primary');
  const loc = { selector: '#does-not-exist', tag: 'button', text: 'Speichern' };
  assert.equal(resolveLocator(loc, doc), button);
});

test('resolveLocator never throws on an invalid selector and returns null without a match', () => {
  const loc = { selector: '###invalid[', tag: 'zzz-nope', text: 'zzz' };
  assert.equal(resolveLocator(loc, doc), null);
});

test('resolveLocator survives an invalid selector by using the text fallback', () => {
  const button = doc.querySelector('#auth-admin form > button.primary');
  const loc = { selector: '###invalid[', tag: 'button', text: 'Speichern' };
  assert.equal(resolveLocator(loc, doc), button);
});

test('getBreadcrumb ignores headings inside sibling cards', () => {
  const { window } = new JSDOM(`<main><h2>Karten</h2><div class="cards">
    <article><h3>Eins</h3><button>Öffnen</button></article>
    <article><h3>Zwei</h3><p id="t">Text</p><button>Öffnen</button></article>
  </div></main>`);
  assert.equal(getBreadcrumb(window.document.getElementById('t')), 'Karten › Zwei');
});

test('accessible name of a wrapped control ignores tooltips and nested options', () => {
  const { window } = new JSDOM(`<label><span>Anmeldemodus</span><span role="tooltip">Hilfe</span>
    <select id="m"><option>Offen</option></select></label>`);
  assert.equal(getAccessibleName(window.document.getElementById('m')), 'Anmeldemodus');
});
