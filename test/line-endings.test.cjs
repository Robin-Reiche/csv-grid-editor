// Tests for keeping a file's line endings and its final newline.
//
// The grid writes the whole table back as the file's text on every edit. It
// joined the rows with LF and wrote nothing after the last one, so the first
// edit turned a CRLF file into an LF file and took away the line break at the
// end of the file. Git then showed every line as changed. The grid now reads
// both from the text it is given and writes them back the same way. Line
// breaks inside a quoted value belong to the value and are never counted or
// rewritten (issue #31).
//
// Run after `tsc -p ./`:  node test/line-endings.test.cjs

const assert = require('assert');
const { parseCsv, toCsv, detectLineFormat } = require('../out/webview/utils/csv.js');

let failures = 0;
function test(name, fn) {
    try { fn(); console.log('  ✓ ' + name); }
    catch (e) { failures++; console.error('  ✗ ' + name + '\n      ' + e.message); }
}

const CRLF_END = { eol: '\r\n', finalNewline: true };

console.log('line endings');

// ── reading the style ────────────────────────────────────────────────────────

test('a CRLF file with a line break at the end', () => {
    assert.deepStrictEqual(detectLineFormat('a,b\r\n1,2\r\n', ','), CRLF_END);
});

test('an LF file without one', () => {
    assert.deepStrictEqual(detectLineFormat('a,b\n1,2', ','), { eol: '\n', finalNewline: false });
});

test('a line break inside quotes is part of the value and does not count', () => {
    assert.deepStrictEqual(detectLineFormat('n\n"x\r\ny"\n', ','), { eol: '\n', finalNewline: true });
    // More breaks inside the value than between the rows: counting them would
    // turn this CRLF file into an LF file.
    assert.deepStrictEqual(detectLineFormat('n\r\n"x\ny\nz"', ','), { eol: '\r\n', finalNewline: false });
});

test('mixed line endings go with the majority, a tie with LF', () => {
    assert.strictEqual(detectLineFormat('a\r\nb\r\nc\n', ',').eol, '\r\n');
    assert.strictEqual(detectLineFormat('a\r\nb\nc', ',').eol, '\n');
});

test('an empty file or a single line has nothing to keep', () => {
    assert.deepStrictEqual(detectLineFormat('', ','), { eol: '\n', finalNewline: false });
    assert.deepStrictEqual(detectLineFormat('a,b', ','), { eol: '\n', finalNewline: false });
});

test('a line break inside a quote that never closes does not end the file', () => {
    assert.strictEqual(detectLineFormat('a\n"b\n', ',').finalNewline, false);
});

test('a quote inside a value does not open a quoted field', () => {
    // parseCsv reads 5" as part of the value. Taken for an opening quote here it
    // would hide the line break at the end of the file.
    assert.deepStrictEqual(detectLineFormat('size\n5" disk\n', ','), { eol: '\n', finalNewline: true });
});

test('quotes are read with the delimiter the rows are split with', () => {
    // With a semicolon the quote opens the field and the two LF are inside the
    // value. With a comma it sits in the middle of "a;" and parseCsv ends the
    // row at each of those LF, so they count.
    const text = 'k;v\r\na;"x\ny\nz"\r\n';
    assert.deepStrictEqual(detectLineFormat(text, ';'), CRLF_END);
    assert.strictEqual(detectLineFormat(text, ',').eol, '\n');
});

// ── writing it back ──────────────────────────────────────────────────────────

test('without a style toCsv writes what it always wrote', () => {
    // The clipboard and every older caller rely on it.
    assert.strictEqual(toCsv([['note'], ['a\nb']], ','), 'note\n"a\nb"');
});

test('rows are joined with the file\'s line ending and one follows the last', () => {
    assert.strictEqual(toCsv([['a', 'b'], ['1', '2']], ',', CRLF_END), 'a,b\r\n1,2\r\n');
});

test('line breaks inside a value stay as they are', () => {
    const rows = [['n'], ['x\r\ny'], ['p\nq']];
    assert.strictEqual(toCsv(rows, ',', { eol: '\r\n', finalNewline: false }), 'n\r\n"x\r\ny"\r\n"p\nq"');
});

test('an empty table writes nothing, not a lone line break', () => {
    // A lone break would read back as one blank row.
    assert.strictEqual(toCsv([], ',', CRLF_END), '');
});

test('a file read and written unchanged comes back byte for byte', () => {
    const texts = [
        'h\r\na\r\n',
        'h\r\n"x\r\ny"\r\n',
        'h\r\n"x\ny"\r\n',
        'h\na\n\n',
        'h\na',
        'a,b\r\n,\r\n',
        '\r\n',
        '',
    ];
    for (const text of texts) {
        const rows = parseCsv(text, ',', false, true);
        assert.strictEqual(toCsv(rows, ',', detectLineFormat(text, ',')), text, JSON.stringify(text));
    }
});

console.log(failures === 0 ? '\nAll line ending tests passed.' : `\n${failures} test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
