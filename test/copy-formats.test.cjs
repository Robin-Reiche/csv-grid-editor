// Tests for the clipboard serializer behind the range-copy context menu
// (webview/utils/csv.ts toClipboardBlock). Copy stays tab-separated so a block
// pastes into Excel and Google Sheets as columns; Copy as CSV is comma-separated
// for pasting into a real CSV. The risky part is quoting: each format has to
// quote the values that would otherwise break ITS separator - a comma is
// harmless in TSV and fatal in CSV, a tab the other way round - and both have to
// keep embedded quotes and line breaks intact so the block parses back to the
// cells it came from.
//
// Run after `npm run compile` (or `tsc -p ./`):  node test/copy-formats.test.cjs

const assert = require('assert');
const { toClipboardBlock, parseCsv } = require('../out/webview/utils/csv.js');

let failures = 0;
function test(name, fn) {
    try { fn(); console.log('  ✓ ' + name); }
    catch (e) { failures++; console.error('  ✗ ' + name + '\n      ' + e.message); }
}

console.log('clipboard copy formats');

// ── plain values ─────────────────────────────────────────────────────────────

test('tsv joins cells with tabs and rows with newlines', () => {
    assert.strictEqual(
        toClipboardBlock([['a', 'b'], ['c', 'd']], 'tsv'),
        'a\tb\nc\td'
    );
});

test('csv joins cells with commas and rows with newlines', () => {
    assert.strictEqual(
        toClipboardBlock([['a', 'b'], ['c', 'd']], 'csv'),
        'a,b\nc,d'
    );
});

test('plain values are never quoted in either format', () => {
    const rows = [['Month', 'Average'], ['Aug', '0.7']];
    assert.strictEqual(toClipboardBlock(rows, 'tsv'), 'Month\tAverage\nAug\t0.7');
    assert.strictEqual(toClipboardBlock(rows, 'csv'), 'Month,Average\nAug,0.7');
});

// ── quoting is per format ────────────────────────────────────────────────────

test('a comma is quoted in csv and left alone in tsv', () => {
    const rows = [['Hanoi, VN', 'x']];
    assert.strictEqual(toClipboardBlock(rows, 'csv'), '"Hanoi, VN",x');
    assert.strictEqual(toClipboardBlock(rows, 'tsv'), 'Hanoi, VN\tx');
});

test('a tab is quoted in tsv and left alone in csv', () => {
    const rows = [['a\tb', 'x']];
    assert.strictEqual(toClipboardBlock(rows, 'tsv'), '"a\tb"\tx');
    assert.strictEqual(toClipboardBlock(rows, 'csv'), 'a\tb,x');
});

test('embedded double quotes are doubled in both formats', () => {
    const rows = [['say "hi"']];
    assert.strictEqual(toClipboardBlock(rows, 'tsv'), '"say ""hi"""');
    assert.strictEqual(toClipboardBlock(rows, 'csv'), '"say ""hi"""');
});

test('a line break inside a cell is quoted in both formats', () => {
    const rows = [['line1\nline2', 'x']];
    assert.strictEqual(toClipboardBlock(rows, 'tsv'), '"line1\nline2"\tx');
    assert.strictEqual(toClipboardBlock(rows, 'csv'), '"line1\nline2",x');
});

test('empty cells stay empty rather than becoming quotes', () => {
    assert.strictEqual(toClipboardBlock([['a', '', 'c']], 'csv'), 'a,,c');
    assert.strictEqual(toClipboardBlock([['a', '', 'c']], 'tsv'), 'a\t\tc');
});

// ── round trip ───────────────────────────────────────────────────────────────
// What copy writes has to parse back to the exact cells it came from - that is
// what makes the block usable in another CSV file and in this grid's own paste.

test('a block with every awkward character round-trips through csv', () => {
    const rows = [
        ['name', 'note'],
        ['Hanoi, VN', 'say "hi"'],
        ['multi\nline', ''],
    ];
    assert.deepStrictEqual(parseCsv(toClipboardBlock(rows, 'csv'), ',', false), rows);
});

test('a block with every awkward character round-trips through tsv', () => {
    const rows = [
        ['name', 'note'],
        ['Hanoi, VN', 'a\tb'],
        ['multi\nline', 'say "hi"'],
    ];
    assert.deepStrictEqual(parseCsv(toClipboardBlock(rows, 'tsv'), '\t', false), rows);
});

// ── header row ───────────────────────────────────────────────────────────────
// "Copy with header" simply prepends the header row before serializing, so the
// header is quoted by the same rules as any other row.

test('a header carrying the separator is quoted like any other row', () => {
    const rows = [['first, last', 'age'], ['Lê Thị', '30']];
    assert.strictEqual(toClipboardBlock(rows, 'csv'), '"first, last",age\nLê Thị,30');
});

console.log(failures === 0 ? '\nAll copy format tests passed.' : `\n${failures} test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
