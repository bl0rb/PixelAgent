// @ts-check
// Pure reducer over the change list. No DOM access, fully testable.

/** @typedef {import('./locator.js').Locator} Locator */
/** @typedef {'before'|'after'|'inside-start'|'inside-end'} Position */

/**
 * @typedef {
 *   {id:number, type:'text', target:Locator, before:string, after:string} |
 *   {id:number, type:'attr', target:Locator, attr:string, before:string, after:string} |
 *   {id:number, type:'move', target:Locator, anchor:Locator, position:Position} |
 *   {id:number, type:'insert', template:Locator, anchor:Locator, position:Position, text:string} |
 *   {id:number, type:'remove', target:Locator} |
 *   {id:number, type:'comment', target:Locator, note:string}
 * } Change
 */

/** @typedef {{changes:Change[], nextId:number, past:Change[][], future:Change[][]}} State */

/**
 * @param {Change[]} [changes]
 * @param {number} [nextId]
 * @returns {State}
 */
export function createState(changes = [], nextId) {
  const list = Array.isArray(changes) ? changes.slice() : [];
  let computedNext = nextId;
  if (typeof computedNext !== 'number' || !Number.isFinite(computedNext)) {
    let maxId = 0;
    for (const c of list) if (c && typeof c.id === 'number' && c.id > maxId) maxId = c.id;
    computedNext = maxId + 1;
  }
  return { changes: list, nextId: computedNext, past: [], future: [] };
}

/**
 * @param {Locator|undefined} a
 * @param {Locator|undefined} b
 * @returns {boolean}
 */
export function sameTarget(a, b) {
  if (!a || !b) return false;
  if (a.selector !== b.selector) return false;
  if (!a.url || !b.url) return true;
  try {
    return new URL(a.url).pathname === new URL(b.url).pathname;
  } catch {
    return a.url === b.url;
  }
}

/**
 * @param {State} state
 * @param {string} type
 * @param {Locator} target
 * @param {string} [attr]
 * @returns {Change|undefined}
 */
export function findChange(state, type, target, attr) {
  return state.changes.find(
    (c) =>
      c.type === type &&
      sameTarget(/** @type {any} */ (c).target, target) &&
      (attr === undefined || /** @type {any} */ (c).attr === attr)
  );
}

/**
 * @param {State} state
 * @param {Change[]} newChanges
 * @param {number} newNextId
 * @returns {State}
 */
function pushHistory(state, newChanges, newNextId) {
  return {
    changes: newChanges,
    nextId: Math.max(newNextId, state.nextId),
    past: [...state.past, state.changes],
    future: [],
  };
}

/**
 * @param {State} state
 * @param {any} input
 */
function applyAdd(state, input) {
  const type = input.type;

  if (type === 'insert') {
    const id = state.nextId;
    return pushHistory(state, [...state.changes, { ...input, id }], id + 1);
  }

  const target = input.target;
  const existingIndex = state.changes.findIndex(
    (c) => c.type === type && sameTarget(/** @type {any} */ (c).target, target) && (type !== 'attr' || /** @type {any} */ (c).attr === input.attr)
  );

  if (type === 'remove') {
    if (existingIndex !== -1) return state;
    const id = state.nextId;
    return pushHistory(state, [...state.changes, { ...input, id }], id + 1);
  }

  if (type === 'comment') {
    const note = input.note;
    const isEmpty = !note || !String(note).trim();
    if (existingIndex !== -1) {
      const next = state.changes.slice();
      if (isEmpty) {
        next.splice(existingIndex, 1);
      } else {
        next[existingIndex] = Object.assign({}, next[existingIndex], { note });
      }
      return pushHistory(state, next, state.nextId);
    }
    if (isEmpty) return state;
    const id = state.nextId;
    return pushHistory(state, [...state.changes, { id, type: 'comment', target, note }], id + 1);
  }

  if (type === 'move') {
    if (existingIndex !== -1) {
      const next = state.changes.slice();
      next[existingIndex] = Object.assign({}, next[existingIndex], { anchor: input.anchor, position: input.position });
      return pushHistory(state, next, state.nextId);
    }
    const id = state.nextId;
    return pushHistory(state, [...state.changes, { ...input, id }], id + 1);
  }

  if (type === 'text' || type === 'attr') {
    if (existingIndex !== -1) {
      const existing = /** @type {any} */ (state.changes[existingIndex]);
      const before = existing.before;
      const after = input.after;
      const next = state.changes.slice();
      if (after === before) {
        next.splice(existingIndex, 1);
      } else {
        next[existingIndex] = { ...existing, after };
      }
      return pushHistory(state, next, state.nextId);
    }
    if (input.after === input.before) return state;
    const id = state.nextId;
    return pushHistory(state, [...state.changes, { ...input, id }], id + 1);
  }

  const id = state.nextId;
  return pushHistory(state, [...state.changes, { ...input, id }], id + 1);
}

/**
 * @param {State} state
 * @param {number} id
 * @param {object} patch
 */
function applyUpdate(state, id, patch) {
  const idx = state.changes.findIndex((c) => c.id === id);
  if (idx === -1) return state;
  const next = state.changes.slice();
  next[idx] = { ...next[idx], ...patch, id: next[idx].id };
  return pushHistory(state, next, state.nextId);
}

/**
 * @param {State} state
 * @param {number} id
 */
function applyDelete(state, id) {
  const idx = state.changes.findIndex((c) => c.id === id);
  if (idx === -1) return state;
  const next = state.changes.slice();
  next.splice(idx, 1);
  return pushHistory(state, next, state.nextId);
}

/** @param {State} state */
function applyClear(state) {
  if (state.changes.length === 0) return state;
  return pushHistory(state, [], state.nextId);
}

/** @param {State} state */
function applyUndo(state) {
  if (state.past.length === 0) return state;
  const prevChanges = state.past[state.past.length - 1];
  return {
    changes: prevChanges,
    nextId: state.nextId,
    past: state.past.slice(0, -1),
    future: [state.changes, ...state.future],
  };
}

/** @param {State} state */
function applyRedo(state) {
  if (state.future.length === 0) return state;
  const nextChanges = state.future[0];
  return {
    changes: nextChanges,
    nextId: state.nextId,
    past: [...state.past, state.changes],
    future: state.future.slice(1),
  };
}

/**
 * @param {State} state
 * @param {Change[]} changes
 * @param {number} [nextId]
 */
function applyLoad(state, changes, nextId) {
  const fresh = createState(changes, nextId);
  return { ...fresh, nextId: Math.max(fresh.nextId, state.nextId) };
}

/**
 * @param {State} state
 * @param {{type:string, [key:string]: any}} action
 * @returns {State}
 */
export function apply(state, action) {
  switch (action.type) {
    case 'add':
      return applyAdd(state, action.change);
    case 'update':
      return applyUpdate(state, action.id, action.patch);
    case 'delete':
      return applyDelete(state, action.id);
    case 'clear':
      return applyClear(state);
    case 'undo':
      return applyUndo(state);
    case 'redo':
      return applyRedo(state);
    case 'load':
      return applyLoad(state, action.changes, action.nextId);
    default:
      return state;
  }
}

/**
 * @param {State} state
 * @returns {string}
 */
export function serialize(state) {
  return JSON.stringify({ version: 1, nextId: state.nextId, changes: state.changes });
}

/**
 * Tolerant: invalid input yields an empty state.
 * @param {string} str
 * @returns {State}
 */
export function deserialize(str) {
  try {
    const data = JSON.parse(str);
    if (!data || !Array.isArray(data.changes)) return createState();
    const nextId = typeof data.nextId === 'number' ? data.nextId : undefined;
    return createState(data.changes, nextId);
  } catch {
    return createState();
  }
}
