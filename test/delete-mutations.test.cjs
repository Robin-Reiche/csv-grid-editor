// Regression test for multi-row / multi-column deletion (Issue #7).
//
// The whole point of deleting in a single pass is to avoid the index-shift trap:
// removing columns/rows one after another renumbers the survivors, so a naive
// sequential delete drops the WRONG ones. These tests pin the pure transforms
// (grid/mutations.ts) that delete-row-col.ts builds on.
//
// state.data[0] is the header; data rows live at index 1..N. Columns span the
// header and every body row, so a column delete must hit the header too.
//
// Run after `npm run compile` (or `tsc -p ./`):  node test/delete-mutations.test.cjs

const assert = require('assert');
const {
    deleteColumnsFromData,
    deleteRowsFromData,
    insertRowsIntoData,
    insertColumnsIntoData,
} = require('../out/webview/grid/mutations.js');

let failures = 0;
function test(name, fn) {
    try { fn(); console.log('  ✓ ' + name); }
    catch (e) { failures++; console.error('  ✗ ' + name + '\n      ' + e.message); }
}

function makeData() {
    return [
        ['a', 'b', 'c', 'd'],   // 0  header
        ['a1', 'b1', 'c1', 'd1'], // 1
        ['a2', 'b2', 'c2', 'd2'], // 2
        ['a3', 'b3', 'c3', 'd3'], // 3
    ];
}

console.log('delete-mutations (multi row/column delete)');

// ── columns ─────────────────────────────────────────────────────────────────

test('deleteColumnsFromData removes a single column from every row incl. header', () => {
    const out = deleteColumnsFromData(makeData(), [1]); // drop column 'b'
    assert.deepStrictEqual(out[0], ['a', 'c', 'd'], 'header lost column b');
    assert.deepStrictEqual(out[1], ['a1', 'c1', 'd1'], 'row 1 lost column b');
    assert.deepStrictEqual(out[3], ['a3', 'c3', 'd3'], 'row 3 lost column b');
});

test('deleteColumnsFromData removes NON-adjacent columns in one pass (no index shift)', () => {
    // Drop columns 0 and 2 ('a' and 'c'). A sequential delete would remove 'a',
    // shift 'c' to index 1, then wrongly delete 'b'. The Set-based pass must not.
    const out = deleteColumnsFromData(makeData(), [0, 2]);
    assert.deepStrictEqual(out[0], ['b', 'd'], 'header keeps exactly b and d');
    assert.deepStrictEqual(out[1], ['b1', 'd1'], 'row keeps exactly b and d');
});

test('deleteColumnsFromData is order-independent (indices given high-to-low)', () => {
    const out = deleteColumnsFromData(makeData(), [3, 1]); // drop 'd' and 'b'
    assert.deepStrictEqual(out[0], ['a', 'c'], 'header keeps a and c');
    assert.deepStrictEqual(out[2], ['a2', 'c2'], 'row keeps a2 and c2');
});

test('deleteColumnsFromData ignores duplicate and out-of-range indices', () => {
    const out = deleteColumnsFromData(makeData(), [1, 1, 99, -1]);
    assert.deepStrictEqual(out[0], ['a', 'c', 'd'], 'only column b removed once');
});

test('deleteColumnsFromData returns data unchanged for an empty index list', () => {
    const data = makeData();
    const out = deleteColumnsFromData(data, []);
    assert.strictEqual(out, data, 'same reference back when nothing to delete');
});

// ── rows ────────────────────────────────────────────────────────────────────

test('deleteRowsFromData removes the given rows and keeps the header', () => {
    const out = deleteRowsFromData(makeData(), [1, 3]); // drop rows 1 and 3
    assert.strictEqual(out.length, 2, 'header + 1 surviving row');
    assert.deepStrictEqual(out[0], ['a', 'b', 'c', 'd'], 'header survives');
    assert.deepStrictEqual(out[1], ['a2', 'b2', 'c2', 'd2'], 'only row 2 survives');
});

test('deleteRowsFromData never deletes the header even if index 0 is passed', () => {
    const out = deleteRowsFromData(makeData(), [0, 2]);
    assert.deepStrictEqual(out[0], ['a', 'b', 'c', 'd'], 'header still present');
    assert.strictEqual(out.length, 3, 'header + rows 1 and 3 (row 2 gone)');
    assert.deepStrictEqual(out[2], ['a3', 'b3', 'c3', 'd3'], 'row 3 shifted up after row 2 removed');
});

test('deleteRowsFromData ignores out-of-range indices', () => {
    const out = deleteRowsFromData(makeData(), [99, -5]);
    assert.strictEqual(out.length, 4, 'nothing deleted');
});

test('deleteRowsFromData returns data unchanged for an empty index list', () => {
    const data = makeData();
    const out = deleteRowsFromData(data, new Set());
    assert.strictEqual(out, data, 'same reference back when nothing to delete');
});

// ── insert rows (multi-insert, Issue #7 follow-up) ────────────────────────────

test('insertRowsIntoData inserts a single blank row at the given index', () => {
    const out = insertRowsIntoData(makeData(), 2, 1, 4); // before old row 2
    assert.strictEqual(out.length, 5, 'one row added');
    assert.deepStrictEqual(out[2], ['', '', '', ''], 'blank row, full width');
    assert.deepStrictEqual(out[1], ['a1', 'b1', 'c1', 'd1'], 'row above is unchanged');
    assert.deepStrictEqual(out[3], ['a2', 'b2', 'c2', 'd2'], 'old row 2 shifted down');
});

test('insertRowsIntoData adds exactly N rows of width numCols', () => {
    const out = insertRowsIntoData(makeData(), 1, 3, 4);
    assert.strictEqual(out.length, 7, 'header + 3 blanks + 3 body');
    for (let i = 1; i <= 3; i++) assert.deepStrictEqual(out[i], ['', '', '', ''], `blank row ${i}`);
    assert.deepStrictEqual(out[0], ['a', 'b', 'c', 'd'], 'header untouched');
    assert.deepStrictEqual(out[4], ['a1', 'b1', 'c1', 'd1'], 'first body row now after the blanks');
});

test('insertRowsIntoData keeps existing row-array references (frozen row / ids survive)', () => {
    const data = makeData();
    const row2ref = data[2];
    const out = insertRowsIntoData(data, 1, 2, 4);
    assert.ok(out.includes(row2ref), 'the original row array object is still present (not cloned)');
});

test('insertRowsIntoData returns data unchanged for count < 1', () => {
    const data = makeData();
    assert.strictEqual(insertRowsIntoData(data, 1, 0, 4), data, 'no-op for count 0');
});

// ── insert columns (multi-insert) ─────────────────────────────────────────────

test('insertColumnsIntoData inserts a single blank column into every row incl. header', () => {
    const out = insertColumnsIntoData(makeData(), 1, 1); // before column index 1
    assert.deepStrictEqual(out[0], ['a', '', 'b', 'c', 'd'], 'header got a blank at index 1');
    assert.deepStrictEqual(out[1], ['a1', '', 'b1', 'c1', 'd1'], 'body row got a blank at index 1');
});

test('insertColumnsIntoData inserts N blank columns in one pass', () => {
    const out = insertColumnsIntoData(makeData(), 0, 2); // 2 cols at the very left
    assert.deepStrictEqual(out[0], ['', '', 'a', 'b', 'c', 'd'], 'two leading blanks in header');
    assert.deepStrictEqual(out[2], ['', '', 'a2', 'b2', 'c2', 'd2'], 'two leading blanks in a body row');
});

test('insertColumnsIntoData appends N columns when index is past the end', () => {
    const out = insertColumnsIntoData(makeData(), 4, 2); // at the right edge
    assert.deepStrictEqual(out[0], ['a', 'b', 'c', 'd', '', ''], 'two trailing blanks');
});

test('insertColumnsIntoData returns data unchanged for count < 1', () => {
    const data = makeData();
    assert.strictEqual(insertColumnsIntoData(data, 1, 0), data, 'no-op for count 0');
});

if (failures) { console.error('\n' + failures + ' test(s) failed'); process.exit(1); }
console.log('\nAll tests passed');
