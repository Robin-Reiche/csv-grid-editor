// Tests for a file without a header row ("First row is the header" off).
//
// The grid treats state.data[0] as the column names and everything under it as
// the rows. A file without a header keeps that shape: a row of column letters
// (A, B, C) stands in for the names. That row never reaches the file. So every
// place that builds the grid, counts rows or maps an edit to a row keeps
// working unchanged. The one place that writes the file leaves the letters
// out. These pin the pieces that make that true: the letters go on and come off
// without a byte of the file changing, row inserts and deletes hit the right
// file line, the letters follow the columns and undo steps move with the
// switch instead of being thrown away.
//
// Run after `tsc -p ./`:  node test/header-row.test.cjs

const assert = require('assert');
const {
    state, letterRow, withVirtualHeader, fileRows, relabelVirtualHeader, snapshotInHeaderMode,
} = require('../out/webview/state.js');
const { parseCsv, toCsv, detectLineFormat } = require('../out/webview/utils/csv.js');
const { deleteRowsFromData, insertRowsIntoData, insertColumnsIntoData } = require('../out/webview/grid/mutations.js');

let failures = 0;
function test(name, fn) {
    try { fn(); console.log('  ✓ ' + name); }
    catch (e) { failures++; console.error('  ✗ ' + name + '\n      ' + e.message); }
}

const FILE = '1,alice,true\n2,bob,false\n3,"c, d",true';
const read = (text) => withVirtualHeader(parseCsv(text, ',', false, true), true);
const write = (data, format) => toCsv(fileRows(data, true), ',', format);

// Runs relabelVirtualHeader on `data` as the grid's table and hands back the
// letter row it leaves on top.
function relabel(data, firstRowIsHeader = false) {
    state.firstRowIsHeader = firstRowIsHeader;
    state.data = data;
    relabelVirtualHeader();
    state.firstRowIsHeader = true;
    return state.data[0];
}

console.log('a file without a header row');

test('the letters stand in for the header', () => {
    const data = read(FILE);
    assert.deepStrictEqual(data[0], ['A', 'B', 'C']);
    assert.deepStrictEqual(data[1], ['1', 'alice', 'true']);
    assert.strictEqual(data.length, 4);
});

test('the file comes back byte for byte, letters left out', () => {
    assert.strictEqual(write(read(FILE)), FILE);
});

test('line endings and the final newline come back too', () => {
    const crlf = FILE.replace(/\n/g, '\r\n') + '\r\n';
    assert.strictEqual(write(read(crlf), detectLineFormat(crlf, ',')), crlf);
});

test('with a header the rows are taken as they are', () => {
    const rows = parseCsv(FILE, ',', false, true);
    assert.strictEqual(withVirtualHeader(rows, false), rows);
    assert.strictEqual(fileRows(rows, false), rows);
});

test('an empty file stays empty', () => {
    const data = read('');
    assert.deepStrictEqual(data, [[]]);
    assert.strictEqual(write(data), '');
});

test('past Z the letters go on as a spreadsheet names them', () => {
    const row = letterRow(28);
    assert.deepStrictEqual(row.slice(0, 2), ['A', 'B']);
    assert.deepStrictEqual(row.slice(25), ['Z', 'AA', 'AB']);
});

test('deleting row 1 deletes the first line of the file', () => {
    const data = deleteRowsFromData(read(FILE), [1]);
    assert.deepStrictEqual(data[0], ['A', 'B', 'C']);
    assert.strictEqual(write(data), '2,bob,false\n3,"c, d",true');
});

test('inserting above row 1 puts the new line first in the file', () => {
    const data = insertRowsIntoData(read(FILE), 1, 1, 3);
    assert.strictEqual(write(data), ',,\n' + FILE);
});

test('an inserted column gets its letter and the rest move along', () => {
    // The insert gives the letter row a blank cell like every other row. Left
    // that way the headers would read A, (blank), B, C.
    const data = insertColumnsIntoData(read(FILE), 1, 1);
    assert.deepStrictEqual(data[0], ['A', '', 'B', 'C']);
    assert.deepStrictEqual(relabel(data), ['A', 'B', 'C', 'D']);
    assert.strictEqual(write(data), '1,,alice,true\n2,,bob,false\n3,,"c, d",true');
});

test('deleting the only wide row takes its column along', () => {
    // As with a header, where the column past the header goes with the row.
    const data = deleteRowsFromData(read('1,2\n3,4,5'), [2]);
    assert.deepStrictEqual(relabel(data), ['A', 'B']);
});

test('a table without rows keeps its columns', () => {
    // Once the last row is deleted or a first column is added to an empty
    // file, the letters are all there is to count the columns by.
    assert.deepStrictEqual(relabel([['A', 'B']]), ['A', 'B']);
    assert.deepStrictEqual(relabel([['']]), ['A']);
    assert.deepStrictEqual(relabel([[]]), []);
});

test('with a header the header row is left alone', () => {
    assert.deepStrictEqual(relabel([['name', ''], ['x', 'y', 'z']], true), ['name', '']);
});

test('an undo step moves to the other mode and back unchanged', () => {
    // A step also holds the delimiter and the line format its rows were read
    // with. The switch leaves both as they are.
    const snap = {
        data: [['h1', 'h2'], ['1', '2']], frozenRowIdx: [1], pinnedCols: [0],
        delimiter: ';', lineFormat: { eol: '\r\n', finalNewline: true },
    };
    const off = snapshotInHeaderMode(snap, true);
    assert.deepStrictEqual(off.data, [['A', 'B'], ['h1', 'h2'], ['1', '2']]);
    assert.deepStrictEqual(off.frozenRowIdx, [2]);
    assert.deepStrictEqual(off.pinnedCols, [0]);
    assert.strictEqual(off.delimiter, ';');
    assert.deepStrictEqual(off.lineFormat, { eol: '\r\n', finalNewline: true });
    assert.deepStrictEqual(snapshotInHeaderMode(off, false), snap);
});

test('a frozen row that becomes the header is no longer frozen', () => {
    const snap = { data: [['A', 'B'], ['h1', 'h2'], ['1', '2']], frozenRowIdx: [1, 2], pinnedCols: [] };
    const on = snapshotInHeaderMode(snap, false);
    assert.deepStrictEqual(on.data, [['h1', 'h2'], ['1', '2']]);
    assert.deepStrictEqual(on.frozenRowIdx, [1]);
});

if (failures) { console.error(`\n${failures} test(s) failed`); process.exit(1); }
console.log('\nAll header row tests passed.');
