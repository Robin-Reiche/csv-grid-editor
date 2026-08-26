// What the row shortcuts claim, and what they must leave alone (issues #29 and
// #36). The meanings sit in two different files — the cell editor inserts the
// line break, the document handler moves rows around — and nothing but this test
// stops them from drifting into claiming the same key, which fails silently: the
// user gets whichever listener happens to run first.
//
// Run after `npm run compile` (or `tsc -p ./`):  node test/row-shortcuts.test.cjs

const assert = require('assert');
const { isLineBreakKey } = require('../out/webview/grid/multiline-cell-editor.js');
const {
    isInsertRowBelowKey,
    isInsertRowAboveKey,
    isDeleteRowKey,
    isUndoKey,
    isRedoKey,
} = require('../out/webview/keyboard.js');
const { clampRow } = require('../out/webview/grid/refresh.js');

let failures = 0;
function test(name, fn) {
    try { fn(); console.log('  ✓ ' + name); }
    catch (e) { failures++; console.error('  ✗ ' + name + '\n      ' + e.message); }
}

// A KeyboardEvent stand-in — every predicate reads nothing but these five fields.
function ev(key, mods) {
    return {
        key,
        altKey:   !!(mods && mods.alt),
        shiftKey: !!(mods && mods.shift),
        ctrlKey:  !!(mods && mods.ctrl),
        metaKey:  !!(mods && mods.meta),
    };
}

const ALL = [isLineBreakKey, isInsertRowBelowKey, isInsertRowAboveKey, isDeleteRowKey, isUndoKey, isRedoKey];
const claimedBy = e => ALL.filter(f => f(e)).length;

console.log('row shortcuts');

// ── line break (issue #29) ───────────────────────────────────────────────────

test('Alt+Enter inserts a line break — the one Excel uses', () => {
    assert.strictEqual(isLineBreakKey(ev('Enter', { alt: true })), true);
});

test('Shift+Enter inserts a line break', () => {
    assert.strictEqual(isLineBreakKey(ev('Enter', { shift: true })), true);
});

// ── row actions (issue #36) ──────────────────────────────────────────────────

test('Ctrl+Enter inserts a row below, not a line break', () => {
    assert.strictEqual(isInsertRowBelowKey(ev('Enter', { ctrl: true })), true);
    assert.strictEqual(isLineBreakKey(ev('Enter', { ctrl: true })), false);
});

test('Ctrl+Shift+Enter inserts a row above', () => {
    assert.strictEqual(isInsertRowAboveKey(ev('Enter', { ctrl: true, shift: true })), true);
    assert.strictEqual(isLineBreakKey(ev('Enter', { ctrl: true, shift: true })), false);
});

test('Ctrl+Shift+K deletes the row', () => {
    assert.strictEqual(isDeleteRowKey(ev('K', { ctrl: true, shift: true })), true);
});

test('the browser reporting a lower-case k still deletes', () => {
    assert.strictEqual(isDeleteRowKey(ev('k', { ctrl: true, shift: true })), true);
});

test('Cmd variants do the same on macOS', () => {
    assert.strictEqual(isInsertRowBelowKey(ev('Enter', { meta: true })), true);
    assert.strictEqual(isInsertRowAboveKey(ev('Enter', { meta: true, shift: true })), true);
    assert.strictEqual(isDeleteRowKey(ev('K', { meta: true, shift: true })), true);
});

// ── everything that must stay out of all four ────────────────────────────────

test('plain Enter is left to the grid, which commits the edit', () => {
    assert.strictEqual(claimedBy(ev('Enter')), 0);
});

test('a bare K types a K', () => {
    assert.strictEqual(claimedBy(ev('k')), 0);
    assert.strictEqual(claimedBy(ev('K', { shift: true })), 0);
});

test('Ctrl+K without Shift is not the delete key', () => {
    assert.strictEqual(isDeleteRowKey(ev('k', { ctrl: true })), false);
});

test('holding Alt as well claims nothing', () => {
    assert.strictEqual(isInsertRowBelowKey(ev('Enter', { ctrl: true, alt: true })), false);
    assert.strictEqual(isInsertRowAboveKey(ev('Enter', { ctrl: true, shift: true, alt: true })), false);
    assert.strictEqual(isDeleteRowKey(ev('K', { ctrl: true, shift: true, alt: true })), false);
});

test('other keys are claimed by nothing', () => {
    for (const key of ['a', 'Escape', 'Tab', 'ArrowDown']) {
        assert.strictEqual(claimedBy(ev(key, { ctrl: true })), 0, key);
        assert.strictEqual(claimedBy(ev(key, { ctrl: true, shift: true })), 0, key);
    }
});

// ── undo and redo ────────────────────────────────────────────────────────────
// Holding Shift makes the browser report the UPPER-case letter. Ctrl+Shift+Z was
// written as `key === 'z' && shiftKey`, which no keystroke can ever satisfy, so
// that redo never fired once.

test('Ctrl+Z undoes', () => {
    assert.strictEqual(isUndoKey(ev('z', { ctrl: true })), true);
    assert.strictEqual(isRedoKey(ev('z', { ctrl: true })), false);
});

test('Ctrl+Y redoes', () => {
    assert.strictEqual(isRedoKey(ev('y', { ctrl: true })), true);
});

test('Ctrl+Shift+Z redoes, and the browser reports an upper-case Z', () => {
    assert.strictEqual(isRedoKey(ev('Z', { ctrl: true, shift: true })), true);
    assert.strictEqual(isUndoKey(ev('Z', { ctrl: true, shift: true })), false);
});

test('a lower-case z with Shift still redoes, whatever the browser reports', () => {
    assert.strictEqual(isRedoKey(ev('z', { ctrl: true, shift: true })), true);
});

test('an upper-case Y without Shift still redoes', () => {
    assert.strictEqual(isRedoKey(ev('Y', { ctrl: true })), true);
});

test('a bare Z or Y types a letter', () => {
    assert.strictEqual(claimedBy(ev('z')), 0);
    assert.strictEqual(claimedBy(ev('y')), 0);
});

test('Ctrl+Shift+Y is not a redo', () => {
    assert.strictEqual(isRedoKey(ev('Y', { ctrl: true, shift: true })), false);
});

// ── where the focus lands afterwards ─────────────────────────────────────────
// A rowData swap drops the browser focus, so it is put back by hand. Getting the
// row wrong is what leaves the arrow keys dead after a delete.

test('deleting the last row lands on the row that is now last', () => {
    // Focus sat on row 9 of ten, that row is gone, nine are left.
    assert.strictEqual(clampRow(9, 9), 8);
});

test('deleting a row in the middle stays put, which is the row that moved up', () => {
    assert.strictEqual(clampRow(4, 9), 4);
});

test('deleting the only row leaves nothing to focus', () => {
    assert.strictEqual(clampRow(0, 0), null);
});

test('an untouched index is handed back unchanged', () => {
    assert.strictEqual(clampRow(3, 10), 3);
});

// ── the invariant ────────────────────────────────────────────────────────────

test('no key and modifier combination is claimed twice', () => {
    for (const key of ['Enter', 'k', 'K', 'z', 'Z', 'y', 'Y', 'a', 'Escape']) {
        for (let bits = 0; bits < 16; bits++) {
            const e = ev(key, {
                alt:   !!(bits & 1),
                shift: !!(bits & 2),
                ctrl:  !!(bits & 4),
                meta:  !!(bits & 8),
            });
            assert.ok(claimedBy(e) <= 1, 'claimed twice: ' + key + ' ' + bits);
        }
    }
});

process.exit(failures ? 1 : 0);
