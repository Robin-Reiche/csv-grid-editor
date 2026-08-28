// Typing into the cell Tab just moved to.
//
// Tab commits the open cell and opens the next one for editing. AG Grid then
// restores the browser focus to that next CELL, one macrotask later. Its own
// editors are inline, so the focus lands inside the input. This extension's
// editor is a popup and lives outside the cell, so the focus landed on the bare
// cell div and nothing typed afterwards reached the grid at all: the cell looked
// open, the keyboard was dead.
//
// The editor takes the focus back whenever it ends up on the cell the editor is
// open over. The three things that rule has to get right are asserted here.
//
// Run after `npm run compile` (or `tsc -p ./`):  node test/editor-focus-reclaim.test.cjs

const assert = require('assert');
const { shouldReclaimFocus } = require('../out/webview/grid/multiline-cell-editor.js');

let failures = 0;
function test(name, fn) {
    try { fn(); console.log('  ✓ ' + name); }
    catch (e) { failures++; console.error('  ✗ ' + name + '\n      ' + e.message); }
}

console.log('cell editor focus reclaim');

const cell = { id: 'the cell this editor covers' };

test('focus parked on the open editor\'s own cell is taken back', () => {
    assert.strictEqual(shouldReclaimFocus(true, cell, cell), true);
});

test('a closed editor leaves the focus where it is', () => {
    // Enter, Escape and a click away all end on the cell — by then the editor is
    // out of the page and the cell is where the focus belongs.
    assert.strictEqual(shouldReclaimFocus(false, cell, cell), false);
});

test('focus somewhere else entirely is left alone', () => {
    // The find bar, the toolbar, another cell: none of them are this cell.
    assert.strictEqual(shouldReclaimFocus(true, { id: 'the find bar' }, cell), false);
    assert.strictEqual(shouldReclaimFocus(true, null, cell), false);
});

test('an editor with no cell to compare against never grabs the focus', () => {
    assert.strictEqual(shouldReclaimFocus(true, null, null), false);
    assert.strictEqual(shouldReclaimFocus(true, undefined, undefined), false);
});

process.exit(failures ? 1 : 0);
