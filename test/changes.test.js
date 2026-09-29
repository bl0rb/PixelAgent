import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState, apply, sameTarget, findChange, serialize, deserialize } from '../src/overlay/changes.js';

const loc = (selector, url = 'http://localhost:8787/admin#auth-admin') => ({ selector, tag: 'button', url });

// --- createState / add ---

test('createState defaults to an empty state with nextId 1', () => {
  const state = createState();
  assert.deepEqual(state.changes, []);
  assert.equal(state.nextId, 1);
  assert.deepEqual(state.past, []);
  assert.deepEqual(state.future, []);
});

test('add assigns increasing ids', () => {
  let state = createState();
  state = apply(state, { type: 'add', change: { type: 'comment', target: loc('#a'), note: 'eins' } });
  state = apply(state, { type: 'add', change: { type: 'comment', target: loc('#b'), note: 'zwei' } });
  assert.deepEqual(state.changes.map((c) => c.id), [1, 2]);
  assert.equal(state.nextId, 3);
});

// --- merge rules ---

test('text merge keeps the original before and updates after', () => {
  let state = createState();
  state = apply(state, { type: 'add', change: { type: 'text', target: loc('#save'), before: 'Speichern', after: 'A' } });
  state = apply(state, { type: 'add', change: { type: 'text', target: loc('#save'), before: 'A', after: 'B' } });
  assert.equal(state.changes.length, 1);
  assert.equal(state.changes[0].before, 'Speichern');
  assert.equal(state.changes[0].after, 'B');
  assert.equal(state.changes[0].id, 1);
});

test('text merge drops the change when after equals the original before', () => {
  let state = createState();
  state = apply(state, { type: 'add', change: { type: 'text', target: loc('#save'), before: 'Speichern', after: 'A' } });
  state = apply(state, { type: 'add', change: { type: 'text', target: loc('#save'), before: 'A', after: 'Speichern' } });
  assert.equal(state.changes.length, 0);
});

test('a brand new text change with after === before is a no-op', () => {
  const state = createState();
  const next = apply(state, { type: 'add', change: { type: 'text', target: loc('#save'), before: 'X', after: 'X' } });
  assert.equal(next, state);
});

test('attr merge keeps original before, tracked per attr name', () => {
  let state = createState();
  state = apply(state, { type: 'add', change: { type: 'attr', target: loc('#f'), attr: 'placeholder', before: '', after: 'a' } });
  state = apply(state, { type: 'add', change: { type: 'attr', target: loc('#f'), attr: 'title', before: '', after: 'b' } });
  state = apply(state, { type: 'add', change: { type: 'attr', target: loc('#f'), attr: 'placeholder', before: 'a', after: 'c' } });
  assert.equal(state.changes.length, 2);
  const ph = state.changes.find((c) => c.attr === 'placeholder');
  assert.equal(ph.before, '');
  assert.equal(ph.after, 'c');
  const title = state.changes.find((c) => c.attr === 'title');
  assert.equal(title.after, 'b');
});

test('attr merge drops when after equals the original before', () => {
  let state = createState();
  state = apply(state, { type: 'add', change: { type: 'attr', target: loc('#f'), attr: 'placeholder', before: 'x', after: 'y' } });
  state = apply(state, { type: 'add', change: { type: 'attr', target: loc('#f'), attr: 'placeholder', before: 'y', after: 'x' } });
  assert.equal(state.changes.length, 0);
});

test('comment merge replaces the note', () => {
  let state = createState();
  state = apply(state, { type: 'add', change: { type: 'comment', target: loc('#t'), note: 'erste' } });
  state = apply(state, { type: 'add', change: { type: 'comment', target: loc('#t'), note: 'zweite' } });
  assert.equal(state.changes.length, 1);
  assert.equal(state.changes[0].note, 'zweite');
  assert.equal(state.changes[0].id, 1);
});

test('comment merge drops the change when the new note is empty/whitespace', () => {
  let state = createState();
  state = apply(state, { type: 'add', change: { type: 'comment', target: loc('#t'), note: 'erste' } });
  state = apply(state, { type: 'add', change: { type: 'comment', target: loc('#t'), note: '   ' } });
  assert.equal(state.changes.length, 0);
});

test('a brand new comment with an empty note is a no-op', () => {
  const state = createState();
  const next = apply(state, { type: 'add', change: { type: 'comment', target: loc('#t'), note: '' } });
  assert.equal(next, state);
});

test('move merge replaces anchor and position', () => {
  let state = createState();
  state = apply(state, { type: 'add', change: { type: 'move', target: loc('#m'), anchor: loc('#a1'), position: 'before' } });
  state = apply(state, { type: 'add', change: { type: 'move', target: loc('#m'), anchor: loc('#a2'), position: 'after' } });
  assert.equal(state.changes.length, 1);
  assert.equal(state.changes[0].anchor.selector, '#a2');
  assert.equal(state.changes[0].position, 'after');
  assert.equal(state.changes[0].id, 1);
});

test('remove is a no-op if already present', () => {
  let state = createState();
  state = apply(state, { type: 'add', change: { type: 'remove', target: loc('#r') } });
  const after1 = state;
  state = apply(state, { type: 'add', change: { type: 'remove', target: loc('#r') } });
  assert.equal(state, after1);
  assert.equal(state.changes.length, 1);
});

test('insert never merges, even for the same anchor/template', () => {
  let state = createState();
  const change = { type: 'insert', template: loc('#tpl'), anchor: loc('#anchor'), position: 'after', text: 'CSV' };
  state = apply(state, { type: 'add', change });
  state = apply(state, { type: 'add', change });
  assert.equal(state.changes.length, 2);
  assert.deepEqual(state.changes.map((c) => c.id), [1, 2]);
});

// --- sameTarget ---

test('sameTarget ignores the hash', () => {
  const a = loc('#x', 'http://localhost:8787/admin#auth-admin');
  const b = loc('#x', 'http://localhost:8787/admin#usage-admin');
  assert.equal(sameTarget(a, b), true);
});

test('sameTarget respects the pathname', () => {
  const a = loc('#x', 'http://localhost:8787/admin#auth-admin');
  const b = loc('#x', 'http://localhost:8787/other#auth-admin');
  assert.equal(sameTarget(a, b), false);
});

test('sameTarget requires an equal selector', () => {
  const a = loc('#x');
  const b = loc('#y');
  assert.equal(sameTarget(a, b), false);
});

test('sameTarget falls back to selector-only comparison without a url', () => {
  const a = { selector: '#x' };
  const b = { selector: '#x', url: 'http://localhost:8787/admin' };
  assert.equal(sameTarget(a, b), true);
});

// --- findChange ---

test('findChange finds a matching change by type/target/attr', () => {
  let state = createState();
  state = apply(state, { type: 'add', change: { type: 'attr', target: loc('#f'), attr: 'placeholder', before: '', after: 'a' } });
  const found = findChange(state, 'attr', loc('#f'), 'placeholder');
  assert.ok(found);
  assert.equal(found.attr, 'placeholder');
  assert.equal(findChange(state, 'attr', loc('#f'), 'title'), undefined);
});

// --- update / delete / clear ---

test('update patches a change by id', () => {
  let state = createState();
  state = apply(state, { type: 'add', change: { type: 'comment', target: loc('#t'), note: 'eins' } });
  state = apply(state, { type: 'update', id: 1, patch: { note: 'geändert' } });
  assert.equal(state.changes[0].note, 'geändert');
  assert.equal(state.changes[0].id, 1);
});

test('update with an unknown id is a no-op', () => {
  const state = createState();
  const next = apply(state, { type: 'update', id: 99, patch: { note: 'x' } });
  assert.equal(next, state);
});

test('delete removes a change by id', () => {
  let state = createState();
  state = apply(state, { type: 'add', change: { type: 'comment', target: loc('#t'), note: 'eins' } });
  state = apply(state, { type: 'delete', id: 1 });
  assert.deepEqual(state.changes, []);
});

test('delete with an unknown id is a no-op', () => {
  const state = createState();
  const next = apply(state, { type: 'delete', id: 99 });
  assert.equal(next, state);
});

test('clear empties the list, no-op when already empty', () => {
  let state = createState();
  state = apply(state, { type: 'add', change: { type: 'comment', target: loc('#t'), note: 'eins' } });
  state = apply(state, { type: 'clear' });
  assert.deepEqual(state.changes, []);
  const cleared = state;
  state = apply(state, { type: 'clear' });
  assert.equal(state, cleared);
});

// --- undo / redo ---

test('undo/redo sequence, redo cleared after a new action', () => {
  let state = createState();
  state = apply(state, { type: 'add', change: { type: 'comment', target: loc('#a'), note: '1' } });
  state = apply(state, { type: 'add', change: { type: 'comment', target: loc('#b'), note: '2' } });
  assert.equal(state.changes.length, 2);

  state = apply(state, { type: 'undo' });
  assert.equal(state.changes.length, 1);
  assert.equal(state.changes[0].note, '1');

  state = apply(state, { type: 'undo' });
  assert.equal(state.changes.length, 0);

  const emptyUndo = apply(state, { type: 'undo' });
  assert.equal(emptyUndo, state); // no-op, nothing left to undo

  state = apply(state, { type: 'redo' });
  assert.equal(state.changes.length, 1);
  state = apply(state, { type: 'redo' });
  assert.equal(state.changes.length, 2);

  const emptyRedo = apply(state, { type: 'redo' });
  assert.equal(emptyRedo, state); // no-op, nothing left to redo

  // undo, then a new action should clear the redo stack
  state = apply(state, { type: 'undo' });
  assert.equal(state.future.length, 1);
  state = apply(state, { type: 'add', change: { type: 'comment', target: loc('#c'), note: '3' } });
  assert.deepEqual(state.future, []);
  assert.equal(state.changes.length, 2);
  assert.equal(state.changes[1].note, '3');
});

// --- nextId never decreases ---

test('nextId never decreases across undo or load', () => {
  let state = createState();
  state = apply(state, { type: 'add', change: { type: 'comment', target: loc('#a'), note: '1' } });
  state = apply(state, { type: 'add', change: { type: 'comment', target: loc('#b'), note: '2' } });
  assert.equal(state.nextId, 3);
  state = apply(state, { type: 'undo' });
  assert.equal(state.nextId, 3);
  state = apply(state, { type: 'load', changes: [], nextId: 1 });
  assert.equal(state.nextId, 3);
});

// --- import ---

test('import replace swaps in the imported list, renumbered 1…n, nextId = max(nextId, n+1)', () => {
  let state = createState();
  state = apply(state, { type: 'add', change: { type: 'comment', target: loc('#a'), note: 'existing' } });
  const imported = [
    { id: 99, type: 'comment', target: loc('#x'), note: 'one' },
    { id: 5, type: 'comment', target: loc('#y'), note: 'two' },
  ];
  state = apply(state, { type: 'import', changes: imported, mode: 'replace' });
  assert.deepEqual(state.changes.map((c) => c.id), [1, 2]);
  assert.equal(state.changes[0].note, 'one');
  assert.equal(state.changes[1].note, 'two');
  assert.equal(state.nextId, 3);
});

test('import replace keeps nextId at its previous value when it is already higher than n+1', () => {
  let state = createState();
  state = apply(state, { type: 'add', change: { type: 'comment', target: loc('#a'), note: '1' } });
  state = apply(state, { type: 'add', change: { type: 'comment', target: loc('#b'), note: '2' } });
  state = apply(state, { type: 'add', change: { type: 'comment', target: loc('#c'), note: '3' } });
  assert.equal(state.nextId, 4);
  state = apply(state, { type: 'import', changes: [{ id: 1, type: 'comment', target: loc('#z'), note: 'imported' }], mode: 'replace' });
  assert.equal(state.nextId, 4);
  assert.equal(state.changes.length, 1);
});

test('import append runs each change through the add-merge logic with fresh ids', () => {
  let state = createState();
  state = apply(state, { type: 'add', change: { type: 'text', target: loc('#save'), before: 'Speichern', after: 'A' } });
  const imported = [
    { id: 1, type: 'text', target: loc('#save'), before: 'A', after: 'B' }, // merges into the existing text change
    { id: 2, type: 'comment', target: loc('#new'), note: 'hi' }, // brand new, fresh id
  ];
  state = apply(state, { type: 'import', changes: imported, mode: 'append' });
  assert.equal(state.changes.length, 2);
  const textChange = state.changes.find((c) => c.type === 'text');
  assert.equal(textChange.before, 'Speichern');
  assert.equal(textChange.after, 'B');
  const commentChange = state.changes.find((c) => c.type === 'comment');
  assert.equal(commentChange.id, 2);
});

test('import is a single undoable action (one undo restores the pre-import state), and clears future', () => {
  let state = createState();
  state = apply(state, { type: 'add', change: { type: 'comment', target: loc('#a'), note: 'existing' } });
  const before = state;
  state = apply(state, { type: 'import', changes: [{ id: 1, type: 'comment', target: loc('#x'), note: 'one' }, { id: 2, type: 'comment', target: loc('#y'), note: 'two' }], mode: 'append' });
  assert.equal(state.changes.length, 3);
  state = apply(state, { type: 'undo' });
  assert.deepEqual(state.changes, before.changes);
  state = apply(state, { type: 'redo' });
  assert.equal(state.changes.length, 3);

  state = apply(state, { type: 'undo' });
  assert.equal(state.future.length, 1);
  state = apply(state, { type: 'add', change: { type: 'comment', target: loc('#z'), note: 'new' } });
  assert.deepEqual(state.future, []);
});

test('import with an empty changes list is a no-op for both modes', () => {
  let state = createState();
  state = apply(state, { type: 'add', change: { type: 'comment', target: loc('#a'), note: 'existing' } });
  const replaced = apply(state, { type: 'import', changes: [], mode: 'replace' });
  assert.equal(replaced, state);
  const appended = apply(state, { type: 'import', changes: [], mode: 'append' });
  assert.equal(appended, state);
});

// --- immutability ---

test('apply never mutates the input state', () => {
  const state = createState();
  const changesRef = state.changes;
  const frozenState = JSON.parse(JSON.stringify(state));
  apply(state, { type: 'add', change: { type: 'comment', target: loc('#a'), note: '1' } });
  assert.deepEqual(state, frozenState);
  assert.equal(state.changes, changesRef);
});

test('apply does not mutate an existing change object when merging', () => {
  let state = createState();
  state = apply(state, { type: 'add', change: { type: 'text', target: loc('#a'), before: 'X', after: 'Y' } });
  const firstChange = state.changes[0];
  const snapshot = JSON.parse(JSON.stringify(firstChange));
  apply(state, { type: 'add', change: { type: 'text', target: loc('#a'), before: 'Y', after: 'Z' } });
  assert.deepEqual(firstChange, snapshot);
});

// --- serialize / deserialize ---

test('serialize/deserialize round trip', () => {
  let state = createState();
  state = apply(state, { type: 'add', change: { type: 'comment', target: loc('#a'), note: '1' } });
  state = apply(state, { type: 'add', change: { type: 'text', target: loc('#b'), before: 'X', after: 'Y' } });
  const json = serialize(state);
  const restored = deserialize(json);
  assert.deepEqual(restored.changes, state.changes);
  assert.equal(restored.nextId, state.nextId);
  assert.deepEqual(restored.past, []);
  assert.deepEqual(restored.future, []);
});

test('deserialize is tolerant of invalid input', () => {
  const restored = deserialize('not json');
  assert.deepEqual(restored.changes, []);
  assert.equal(restored.nextId, 1);

  const restored2 = deserialize('{"foo":"bar"}');
  assert.deepEqual(restored2.changes, []);
  assert.equal(restored2.nextId, 1);

  const restored3 = deserialize('null');
  assert.deepEqual(restored3.changes, []);
});
