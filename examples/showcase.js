// @ts-check
// Deterministic demo states for marketing/documentation screenshots
// (scripts/make-screenshots.js). Loaded by demo.html only when the URL has
// `?showcase=<scene>` — see the small loader block near the end of
// demo.html. Has no effect otherwise, so the plain demo is unchanged.
//
// This file may load before or after the overlay itself: demo.html appends
// both as dynamically-created `<script type="module">` elements (the
// overlay's tag is injected by the proxy right before `</body>`), and a
// dynamically-inserted module script defaults to `async`, so relative
// execution order between the two is not guaranteed. Every scene therefore
// starts by polling for `window.__uceOverlay`.

const params = new URLSearchParams(location.search);
const scene = params.get('showcase');

if (scene) {
  // Force English regardless of the system/browser locale, so screenshots
  // are reproducible. The overlay only reads this once, at init time, so if
  // it wasn't already set this is a one-time reload (same URL, same scene).
  if (localStorage.getItem('uce-lang') !== 'en') {
    localStorage.setItem('uce-lang', 'en');
    location.reload();
  } else {
    main(scene);
  }
}

async function main(scene) {
  const ctx = await waitForOverlay();
  await runScene(scene, ctx);
  // Signal completion for anything that wants to poll instead of guessing a
  // fixed virtual-time-budget (not required by make-screenshots.js today,
  // kept cheap and harmless either way).
  document.documentElement.setAttribute('data-uce-showcase-ready', scene);
}

/** @returns {Promise<import('../src/overlay/index.js').OverlayContext>} */
function waitForOverlay() {
  return new Promise((resolve) => {
    (function poll() {
      const ctx = /** @type {any} */ (window).__uceOverlay;
      if (ctx) resolve(ctx);
      else setTimeout(poll, 20);
    })();
  });
}

/**
 * Sets `location.hash` and waits for the resulting `hashchange` (demo.html's
 * own view-switcher listens for it) before continuing, so the DOM has
 * settled before we query it. Resolves immediately if already on that hash.
 * @param {string} hash
 */
function setHash(hash) {
  return new Promise((resolve) => {
    if (location.hash === `#${hash}`) {
      resolve(undefined);
      return;
    }
    window.addEventListener(
      'hashchange',
      () => resolve(undefined),
      { once: true }
    );
    location.hash = hash;
  });
}

/** Real demo elements used to build the showcase changes. */
function cardsEls() {
  const cards = Array.from(document.querySelectorAll('#cards-view .item-card'));
  return {
    card1: cards[0],
    card3: cards[2],
    heading1: /** @type {HTMLElement} */ (cards[0].querySelector('h3')),
    button1: /** @type {HTMLElement} */ (cards[0].querySelector('button')),
    button2: /** @type {HTMLElement} */ (cards[1].querySelector('button')),
    button3: /** @type {HTMLElement} */ (cards[2].querySelector('button')),
  };
}

function formEls() {
  return {
    email: /** @type {HTMLInputElement} */ (document.getElementById('email')),
    submit: /** @type {HTMLElement} */ (document.querySelector('#demo-form button[type="submit"]')),
  };
}

/**
 * @param {import('../src/overlay/index.js').OverlayContext} ctx
 * @param {object} change
 */
function addChange(ctx, change) {
  ctx.dispatch({ type: 'add', change });
}

/**
 * Builds a realistic, deterministic set of changes spanning the Cards and
 * Form views (so the exported Markdown's view-grouping shows too): a text
 * change, an attribute change, a comment, a removal, a move and a duplicated
 * (inserted) element — one of each change type.
 * @param {import('../src/overlay/index.js').OverlayContext} ctx
 */
async function buildChanges(ctx) {
  ctx.dispatch({ type: 'clear' });

  await setHash('cards');
  const c = cardsEls();
  addChange(ctx, {
    type: 'text',
    target: ctx.createLocator(c.heading1),
    before: c.heading1.textContent.trim(),
    after: 'Starter Plan',
  });
  addChange(ctx, { type: 'remove', target: ctx.createLocator(c.button3) });
  addChange(ctx, {
    type: 'move',
    target: ctx.createLocator(c.card3),
    anchor: ctx.createLocator(c.card1),
    position: 'before',
  });
  const template = ctx.createLocator(c.button1);
  addChange(ctx, { type: 'insert', template, anchor: template, position: 'after', text: 'Compare' });

  await setHash('form');
  const f = formEls();
  addChange(ctx, {
    type: 'attr',
    target: ctx.createLocator(f.email),
    attr: 'placeholder',
    before: f.email.getAttribute('placeholder') || '',
    after: 'you@company.com',
  });
  addChange(ctx, {
    type: 'comment',
    target: ctx.createLocator(f.submit),
    note: 'Right-align next to Cancel and make it the primary action.',
  });
}

/** @param {Element} el */
function dispatchHoverMove(el) {
  const rect = el.getBoundingClientRect();
  el.dispatchEvent(
    new PointerEvent('pointermove', {
      bubbles: true,
      composed: true,
      cancelable: true,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
      pointerId: 1,
      pointerType: 'mouse',
    })
  );
}

/**
 * @param {string} scene
 * @param {import('../src/overlay/index.js').OverlayContext} ctx
 */
async function runScene(scene, ctx) {
  await buildChanges(ctx);

  if (scene === 'select') {
    await setHash('cards');
    const c = cardsEls();
    ctx.setMode('edit');
    // right-hand card (current order after the previewed move): free space below for the quick icons
    ctx.setSelection(c.button3);
    dispatchHoverMove(c.card1);
    return;
  }

  if (scene === 'panel') {
    await setHash('cards');
    ctx.setMode('edit');
    ctx.togglePanel();
    return;
  }

  if (scene === 'palette') {
    await setHash('cards');
    ctx.setMode('edit');
    ctx.openPalette();
    return;
  }

  if (scene === 'comment') {
    await setHash('form');
    const f = formEls();
    ctx.setMode('edit');
    const { openCommentPopover } = await import('/__uce/actions/comment.js');
    openCommentPopover(ctx, f.submit);
    // caret at the end instead of the whole note selected
    const textarea = /** @type {HTMLTextAreaElement | null} */ (ctx.shadow.querySelector('textarea'));
    if (textarea) textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    return;
  }
}
