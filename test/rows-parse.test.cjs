// Tests for how parseCsv splits a file into rows.
//
// Two rules are pinned down here. A double quote only opens a quoted field when
// it is the first character of that field. Anywhere else it is an ordinary
// character, the way Excel and Python's csv read it, so an inch mark such as
// 5" disk no longer swallows the rest of the file. And a last line of nothing
// but spaces or tabs is the trailing blank line it looks like, not a row.
//
// The grid reads files and pastes with trimming off, so every check below
// passes false for trimFields, the way the grid calls it.
//
// Run after `npm run compile` (or `tsc -p ./`):  node test/rows-parse.test.cjs

const assert = require('assert');
const { parseCsv, toCsv } = require('../out/webview/utils/csv.js');

let failures = 0;
function test(name, fn) {
    try { fn(); console.log('  ✓ ' + name); }
    catch (e) { failures++; console.error('  ✗ ' + name + '\n      ' + e.message); }
}

console.log('rows parse');

// ── a quote inside an unquoted value ─────────────────────────────────────────

test('an inch mark in a value is kept and every line stays its own row', () => {
    const text = 'size,n\n5" disk,1\n7" disk,2\n9" disk,3';
    assert.deepStrictEqual(parseCsv(text, ',', false), [
        ['size', 'n'], ['5" disk', '1'], ['7" disk', '2'], ['9" disk', '3'],
    ]);
});

test('a pasted line with quotes in the middle keeps them', () => {
    assert.deepStrictEqual(parseCsv('He said "hi" there', '\t', false), [['He said "hi" there']]);
    assert.deepStrictEqual(parseCsv('12" pipe\n7" pipe\n3" pipe', '\t', false),
        [['12" pipe'], ['7" pipe'], ['3" pipe']]);
});

test('a value with an inch mark survives a save and a reopen', () => {
    const rows = parseCsv('size,n\n5" disk,1\n7" disk,2', ',', false);
    assert.strictEqual(rows.length, 3);
    assert.deepStrictEqual(parseCsv(toCsv(rows, ','), ',', false), rows);
});

test('a quote at the start of a field still opens a quoted field', () => {
    assert.deepStrictEqual(parseCsv('"a""b",c', ',', false), [['a"b', 'c']]);
    assert.deepStrictEqual(parseCsv('x,"1,5"\ny,"line1\nline2"', ',', false),
        [['x', '1,5'], ['y', 'line1\nline2']]);
    assert.deepStrictEqual(parseCsv('a\t"b\tc"', '\t', false), [['a', 'b\tc']]);
    assert.deepStrictEqual(parseCsv('"",x', ',', false), [['', 'x']]);
});

test('a quoted field after a space behind the delimiter is still one field', () => {
    // Hand-written files put a space after the comma. Only the space is kept,
    // the quotes still hold the comma inside the value, as they always did.
    assert.deepStrictEqual(parseCsv('a, "b,c"', ',', false), [['a', ' b,c']]);
    assert.deepStrictEqual(parseCsv('name, "Smith, John", 5', ',', false), [['name', ' Smith, John', ' 5']]);
    assert.deepStrictEqual(parseCsv('a,\t"x\ny"', ',', false), [['a', '\tx\ny']]);
    assert.deepStrictEqual(parseCsv('a, "b,c"', ','), [['a', 'b,c']]);
});

// ── a last line of only spaces ───────────────────────────────────────────────

test('a last line of only spaces or tabs is not a row', () => {
    assert.deepStrictEqual(parseCsv('a,b\n1,2\n   ', ',', false), [['a', 'b'], ['1', '2']]);
    assert.deepStrictEqual(parseCsv('a,b\n1,2\n \t ', ',', false), [['a', 'b'], ['1', '2']]);
});

test('spaces in a real last row and in a blank line between rows are kept', () => {
    assert.deepStrictEqual(parseCsv('a,b\n1,2\n 3 ,', ',', false), [['a', 'b'], ['1', '2'], [' 3 ', '']]);
    assert.deepStrictEqual(parseCsv('a\n  \nb', ',', false), [['a'], ['  '], ['b']]);
});

test('a last line of spaces written in quotes is a value and keeps its row', () => {
    assert.deepStrictEqual(parseCsv('a\n"   "', ',', false), [['a'], ['   ']]);
    assert.deepStrictEqual(parseCsv('a,b\n"  ",""', ',', false), [['a', 'b'], ['  ', '']]);
    // An empty quoted value alone is still a blank line, as it always was.
    assert.deepStrictEqual(parseCsv('a\n""', ',', false), [['a']]);
});

test('a header of blank column names is still read as one', () => {
    assert.deepStrictEqual(parseCsv(',,,,', ',', false), [['', '', '', '', '']]);
});

console.log(failures === 0 ? '\nAll rows parse tests passed.' : `\n${failures} test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
