// Tests for the empty-table entry points (issue #40).
//
// A new, empty CSV could not be filled in, and one with only a header could not
// get its first row: every way of adding was anchored to a row or a cell that
// did not exist. The grid now asks emptyTableKind() what the table is missing and
// offers exactly that, "Add column" or "Add row". So the decision is the part
// worth pinning down: which files count as which, straight from what the parser
// makes of them, and that the first column and first row leave a table the
// editor can work with.
//
// Run after `npm run compile` (or `tsc -p ./`):  node test/empty-table.test.cjs

const assert = require('assert');
const { emptyTableKind } = require('../out/webview/state.js');
const { parseCsv, toCsv } = require('../out/webview/utils/csv.js');
const { insertRowsIntoData, insertColumnsIntoData } = require('../out/webview/grid/mutations.js');

let failures = 0;
function test(name, fn) {
    try { fn(); console.log('  ✓ ' + name); }
    catch (e) { failures++; console.error('  ✗ ' + name + '\n      ' + e.message); }
}

console.log('empty table');

// ── what the grid offers ─────────────────────────────────────────────────────

test('a 0-byte file has no columns, so the grid offers Add column', () => {
    assert.strictEqual(emptyTableKind(parseCsv('', ',')), 'no-columns');
});

test('a header with nothing under it has no rows, so the grid offers Add row', () => {
    assert.strictEqual(emptyTableKind(parseCsv('Name,Email,City\n', ',')), 'no-rows');
    assert.strictEqual(emptyTableKind(parseCsv('Name,Email,City', ',')), 'no-rows');
});

test('a file holding only a line break is one blank column with no rows', () => {
    // parseCsv reads the break as a header with one empty cell, so this is the
    // header-only case, not the empty one, and Add row is what it needs.
    assert.strictEqual(emptyTableKind(parseCsv('\n', ',')), 'no-rows');
});

test('rows left behind after every column was deleted count as no columns', () => {
    // Deleting the last column is allowed and leaves each row with zero cells.
    // There is nothing to type into, so this is the Add column case too.
    assert.strictEqual(emptyTableKind([[], [], []]), 'no-columns');
});

test('a table with a header and a row is not empty', () => {
    assert.strictEqual(emptyTableKind(parseCsv('a,b\n1,2\n', ',')), null);
});

// ── what the two buttons produce ─────────────────────────────────────────────

test('the first column of an empty file needs a header row made for it', () => {
    // insertColumnsIntoData adds a cell to every EXISTING row, and an empty file
    // has none, so on its own it would add nothing. That is why addFirstColumn
    // builds the header row itself for this case.
    assert.deepStrictEqual(insertColumnsIntoData([], 0, 1), []);
    assert.strictEqual(emptyTableKind([['']]), 'no-rows');
});

test('the first column of a table with rows gives every row its cell', () => {
    const out = insertColumnsIntoData([[], [], []], 0, 1);
    assert.deepStrictEqual(out, [[''], [''], ['']]);
    assert.strictEqual(emptyTableKind(out), null);
});

test('the first row matches the header width and ends the empty state', () => {
    const header = [['Name', 'Email', 'City']];
    const out = insertRowsIntoData(header, 1, 1, 3);
    assert.deepStrictEqual(out, [['Name', 'Email', 'City'], ['', '', '']]);
    assert.strictEqual(emptyTableKind(out), null);
});

test('a header of blank column names reopens with its columns', () => {
    // Add column five times and save: the file holds ",,,,". That is five
    // unnamed columns, and it used to read back as no table at all, because the
    // parser drops a last line with nothing in it as a trailing blank line.
    const blank = [['', '', '', '', '']];
    assert.strictEqual(toCsv(blank, ','), ',,,,');
    assert.deepStrictEqual(parseCsv(',,,,', ','), blank);
    assert.strictEqual(emptyTableKind(parseCsv(',,,,', ',')), 'no-rows');
    assert.deepStrictEqual(parseCsv(';;', ';'), [['', '', '']]);
});

test('a trailing blank line after real rows is still dropped', () => {
    // The rule the fix above must not break: a file ending in an empty or
    // delimiter-only line does not grow a phantom row on every open.
    assert.deepStrictEqual(parseCsv('a,b\n1,2\n', ','), [['a', 'b'], ['1', '2']]);
    assert.deepStrictEqual(parseCsv('a,b\n1,2\n,', ','), [['a', 'b'], ['1', '2']]);
    assert.deepStrictEqual(parseCsv('', ','), []);
});

// The grid adds a row of empty values when asked to. The rule above took it
// for a trailing blank line on the next read. A file without a line break at
// its end lost the row that way, quoted or not. A break after that row keeps
// it. Nothing else in the file changes.
test('an empty last row keeps its row in a file without a final line break', () => {
    const noBreak = { eol: '\n', finalNewline: false };
    const added = [['a', 'b'], ['', '']];
    assert.strictEqual(toCsv(added, ',', noBreak), 'a,b\n,\n');
    assert.deepStrictEqual(parseCsv(toCsv(added, ',', noBreak), ',', false, true), added);
    const cleared = [['h'], ['v1'], ['']];
    assert.strictEqual(toCsv(cleared, ',', noBreak), 'h\nv1\n\n');
    assert.deepStrictEqual(parseCsv(toCsv(cleared, ',', noBreak), ',', false, true), cleared);
    const crlf = { eol: '\r\n', finalNewline: false };
    assert.strictEqual(toCsv([['a', 'b'], ['1', '2'], ['', '']], ',', crlf), 'a,b\r\n1,2\r\n,\r\n');
    // Without a header the file's only line can be such a row.
    assert.deepStrictEqual(parseCsv(toCsv([['']], ',', noBreak), ',', false, true), [['']]);
    // A file that ends with a break already has one, a row with a value needs
    // none and the clipboard gets the rows as they are.
    assert.strictEqual(toCsv(added, ',', { eol: '\n', finalNewline: true }), 'a,b\n,\n');
    assert.strictEqual(toCsv([['a', 'b'], ['', 'x']], ',', noBreak), 'a,b\n,x');
    assert.strictEqual(toCsv(added, ','), 'a,b\n,');
    // A single line of unnamed columns is kept as a header anyway. An empty
    // table or rows left with no cells at all are not rows to keep.
    assert.strictEqual(toCsv([['', '', '']], ',', noBreak), ',,');
    assert.strictEqual(toCsv([], ',', noBreak), '');
    assert.strictEqual(toCsv([[], []], ',', noBreak), '\n');
});

test('a table started from nothing saves and reopens as what was typed', () => {
    // Add column, rename it, Add row, type a value: what reaches the file has to
    // come back as the same table.
    const typed = [['Name'], ['Anna']];
    assert.deepStrictEqual(parseCsv(toCsv(typed, ','), ','), typed);
});

console.log(failures === 0 ? '\nAll empty table tests passed.' : `\n${failures} test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
