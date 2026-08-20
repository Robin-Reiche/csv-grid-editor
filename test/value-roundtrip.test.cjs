// Regression guard for issue #31 (a saved cell value comes back changed). Two
// ways the grid used to hand back something other than what it was given, both
// only visible once a value carries a line break:
//   1. Trimming a field on load stripped leading and trailing line breaks,
//      because a break is whitespace too. A value typed with a trailing empty
//      line was written to the file correctly and came back a line shorter, so
//      the next save wrote the loss into the file.
//   2. The cell editor is a <textarea>, and reading .value from one normalises
//      every line break to LF per the HTML spec. A value that arrived as CRLF
//      came back as LF once the cell had been edited, even when the edit never
//      touched the break.
// Trimming horizontal whitespace is what people want from a CSV reader and is
// unchanged, which is the other half of what these tests pin down.
//
// Run after `tsc -p ./`:  node test/value-roundtrip.test.cjs

const assert = require('assert');
const { parseCsv, toCsv } = require('../out/webview/utils/csv.js');
const { restoreLineBreaks } = require('../out/webview/grid/multiline-cell-editor.js');

let failures = 0;
function test(name, fn) {
    try { fn(); console.log('  ✓ ' + name); }
    catch (e) { failures++; console.error('  ✗ ' + name + '\n      ' + e.message); }
}

const cell = (value) => parseCsv(toCsv([['note'], [value]], ','), ',')[1][0];

console.log('a saved cell value comes back unchanged (issue #31)');

// ── line breaks survive the trim ─────────────────────────────────────────────

test('trailing line breaks survive the round trip', () => {
    assert.strictEqual(cell('500 Redmond Way\nUSA\n\n'), '500 Redmond Way\nUSA\n\n');
});

test('a leading line break survives', () => {
    assert.strictEqual(cell('\nzweite Zeile'), '\nzweite Zeile');
});

test('a value that is nothing but a line break keeps it', () => {
    assert.strictEqual(cell('\n'), '\n');
});

test('CRLF at the end survives', () => {
    assert.strictEqual(cell('a\r\nb\r\n'), 'a\r\nb\r\n');
});

// ── horizontal whitespace still goes ─────────────────────────────────────────

test('spaces and tabs are still trimmed off both ends', () => {
    const rows = parseCsv('a,b,c\n  42  ,"  mit Leerzeichen  ",\tmit Tab\t\n', ',');
    assert.deepStrictEqual(rows[1], ['42', 'mit Leerzeichen', 'mit Tab']);
});

test('a value of nothing but spaces is still empty', () => {
    assert.strictEqual(parseCsv('a\n"   "\n', ',')[1][0], '');
});

test('spaces around a line break inside the value are left alone', () => {
    assert.strictEqual(cell('zeile eins \n zeile zwei'), 'zeile eins \n zeile zwei');
});

test('the untrimmed path (paste) is unchanged', () => {
    assert.deepStrictEqual(parseCsv('  a  \t  b  \n', '\t', false)[0], ['  a  ', '  b  ']);
});

// ── the editor hands back the line break style it was given ──────────────────

test('a CRLF value edited in the textarea comes back as CRLF', () => {
    assert.strictEqual(restoreLineBreaks('a\r\nb', 'a\nb geändert'), 'a\r\nb geändert');
});

test('an LF value stays LF', () => {
    assert.strictEqual(restoreLineBreaks('a\nb', 'a\nb geändert'), 'a\nb geändert');
});

test('a value without any break is untouched', () => {
    assert.strictEqual(restoreLineBreaks('einzeilig', 'einzeilig plus'), 'einzeilig plus');
});

test('a new break typed into a cell that arrived as CRLF follows the file', () => {
    assert.strictEqual(restoreLineBreaks('a\r\nb', 'a\nb\nc'), 'a\r\nb\r\nc');
});

test('an edited CRLF cell round-trips through the file unchanged', () => {
    const fromFile = parseCsv('note\n"a\r\nb"\n', ',')[1][0];
    const committed = restoreLineBreaks(fromFile, 'a\nb');          // what the textarea returns
    assert.strictEqual(committed, fromFile, 'an edit that changed nothing changed the value');
    assert.strictEqual(parseCsv(toCsv([['note'], [committed]], ','), ',')[1][0], fromFile);
});

console.log('');
if (failures) {
    console.error(failures + ' value round-trip test(s) failed');
    process.exit(1);
}
console.log('All tests passed');
