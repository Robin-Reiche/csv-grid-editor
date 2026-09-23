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
        'a,b\r1,2\r3,4\r',
        'a,b\r1,2',
        'a,b\r"x\ny",2\r',
        'a,b\r\r\n1,2\r\r\n',
        'a,b\n"x\ry",2\n',
        'a,b\r\n1,"x\r"\r\n',
        'a\n"\r"',
    ];
    for (const text of texts) {
        const rows = parseCsv(text, ',', false, true);
        assert.strictEqual(toCsv(rows, ',', detectLineFormat(text, ',')), text, JSON.stringify(text));
    }
});

// ── a CR on its own ──────────────────────────────────────────────────────────
// The parser used to drop every CR outside quotes. A classic Mac file, whose
// rows end with a lone CR, opened as one row. Rows ending with CR CR LF, the
// way Python's csv module writes them on Windows, lost a CR per line on the
// first edit. A stray CR inside a value was lost from a row nobody touched.

test('a file whose rows end with a lone CR reads as rows', () => {
    assert.deepStrictEqual(parseCsv('a,b\r1,2\r3,4\r', ',', false, true), [['a', 'b'], ['1', '2'], ['3', '4']]);
    assert.deepStrictEqual(detectLineFormat('a,b\r1,2\r3,4\r', ','), { eol: '\r', finalNewline: true });
    // Mac Excel puts an LF inside a quoted value of such a file. It stays in
    // the value.
    const mac = 'a,b\r"x\ny",2\r3,4';
    assert.deepStrictEqual(parseCsv(mac, ',', false, true), [['a', 'b'], ['x\ny', '2'], ['3', '4']]);
    assert.deepStrictEqual(detectLineFormat(mac, ','), { eol: '\r', finalNewline: false });
});

test('rows ending with CR CR LF keep that ending', () => {
    const text = 'a,b\r\r\n1,2\r\r\n3,4\r\r\n';
    assert.deepStrictEqual(parseCsv(text, ',', false, true), [['a', 'b'], ['1', '2'], ['3', '4']]);
    assert.deepStrictEqual(detectLineFormat(text, ','), { eol: '\r\r\n', finalNewline: true });
});

test('a CR inside an unquoted value is part of the value', () => {
    assert.deepStrictEqual(parseCsv('a,b\n1,x\ry\n3,4\n', ',', false, true), [['a', 'b'], ['1', 'x\ry'], ['3', '4']]);
    assert.deepStrictEqual(parseCsv('a,b\r\n1,x\ry\r\n', ',', false, true), [['a', 'b'], ['1', 'x\ry']]);
    // One at the very end of the file has no LF after it either.
    assert.deepStrictEqual(parseCsv('a,b\n1,2\n3,4\r', ',', false, true), [['a', 'b'], ['1', '2'], ['3', '4\r']]);
});

test('a CR outside quotes is written back in quotes and read back the same', () => {
    // Written back bare, other programs read the CR as a line break and split
    // the row there. So the value gains quotes on the first edit. From
    // then on the file keeps its bytes.
    const cases = [
        ['a,b\n1,x\ry\n3,4\n', 'a,b\n1,"x\ry"\n3,4\n'],
        ['a,b\r\n1,x\ry\r\n3,4\r\n', 'a,b\r\n1,"x\ry"\r\n3,4\r\n'],
        ['a,b\n1,2\n3,4\r', 'a,b\n1,2\n3,"4\r"'],
        ['a\n\r', 'a\n"\r"'],
    ];
    for (const [text, want] of cases) {
        const rows = parseCsv(text, ',', false, true);
        const written = toCsv(rows, ',', detectLineFormat(text, ','));
        assert.strictEqual(written, want, JSON.stringify(text));
        assert.deepStrictEqual(parseCsv(written, ',', false, true), rows, JSON.stringify(written));
        assert.deepStrictEqual(detectLineFormat(written, ','), detectLineFormat(text, ','), JSON.stringify(written));
    }
});

test('an edit changes only the edited cell whatever ends the rows', () => {
    const cases = [
        ['a,b\r1,2\r3,4\r', 'a,b\r1,2\r3,X\r'],
        ['a,b\r\r\n1,2\r\r\n3,4\r\r\n', 'a,b\r\r\n1,2\r\r\n3,X\r\r\n'],
        ['a,b\r"x\ny",2\r3,4\r', 'a,b\r"x\ny",2\r3,X\r'],
    ];
    for (const [text, want] of cases) {
        const rows = parseCsv(text, ',', false, true);
        rows[2][1] = 'X';
        assert.strictEqual(toCsv(rows, ',', detectLineFormat(text, ',')), want, JSON.stringify(text));
    }
    // A stray CR outside quotes is the one thing an edit elsewhere changes:
    // left bare, other programs split its row there. It gains quotes and
    // keeps every byte of the value.
    const stray = [
        ['a,b\n1,x\ry\n3,4\n', 'a,b\n1,"x\ry"\n3,X\n'],
        ['a,b\r\n1,x\ry\r\n3,4\r\n', 'a,b\r\n1,"x\ry"\r\n3,X\r\n'],
    ];
    for (const [text, want] of stray) {
        const rows = parseCsv(text, ',', false, true);
        rows[2][1] = 'X';
        assert.strictEqual(toCsv(rows, ',', detectLineFormat(text, ',')), want, JSON.stringify(text));
    }
    const tail = parseCsv('a,b\n1,2\n3,4\r', ',', false, true);
    tail[1][1] = 'X';
    assert.strictEqual(toCsv(tail, ',', detectLineFormat('a,b\n1,2\n3,4\r', ',')), 'a,b\n1,X\n3,"4\r"');
});

test('a quoted value with a lone CR keeps its quotes through an edit elsewhere', () => {
    // Python's csv module and every RFC 4180 writer put such a value in
    // quotes. Written back bare, a row nobody touched changed on the first
    // edit. Other readers then split it into two rows.
    const cases = [
        ['a,b\n"x\ry",2\n3,4\n', 'a,b\n"x\ry",2\n3,X\n'],
        ['a,b\r\n"x\ry",2\r\n3,4\r\n', 'a,b\r\n"x\ry",2\r\n3,X\r\n'],
        ['a,b\n1,"x\r"\n3,4\n', 'a,b\n1,"x\r"\n3,X\n'],
        ['a,b\n"x\r",2\n3,4', 'a,b\n"x\r",2\n3,X'],
    ];
    for (const [text, want] of cases) {
        const rows = parseCsv(text, ',', false, true);
        rows[2][1] = 'X';
        assert.strictEqual(toCsv(rows, ',', detectLineFormat(text, ',')), want, JSON.stringify(text));
    }
    const note = 'id,note\n1,"line1\rline2"';
    const rows = parseCsv(note, ',', false, true);
    rows[0][0] = 'ID';
    assert.strictEqual(toCsv(rows, ',', detectLineFormat(note, ',')), 'ID,note\n1,"line1\rline2"');
});

test('a CR that would be read as part of a row break is quoted', () => {
    // A value ending in CR in front of the break.
    const rows = [['n'], ['x\r'], ['y']];
    for (const eol of ['\n', '\r\n', '\r\r\n']) {
        const text = toCsv(rows, ',', { eol, finalNewline: true });
        assert.deepStrictEqual(parseCsv(text, ',', false, true), rows, JSON.stringify(text));
    }
    // A file of one line has no LF to tell its rows by, so a CR there would
    // be read as the break of a Mac file.
    assert.strictEqual(toCsv([['x\ry']], ',', { eol: '\n', finalNewline: false }), '"x\ry"');
    // In a Mac file every CR in a value is.
    assert.strictEqual(toCsv([['a'], ['x\ry']], ',', { eol: '\r', finalNewline: true }), 'a\r"x\ry"\r');
    // The clipboard quotes a CR wherever it is, as it always did.
    assert.strictEqual(toCsv([['a'], ['x\ry']], ','), 'a\n"x\ry"');
});

test('text with no row break keeps the line ending it had before', () => {
    // A CRLF file trimmed to its header line has no break left to count. Read
    // again after a delimiter switch or an outside change, it used to fall back
    // to LF, and the next added row was written with LF into a CRLF file.
    const before = { eol: '\r\n', finalNewline: true };
    assert.deepStrictEqual(detectLineFormat('a,b', ',', before), { eol: '\r\n', finalNewline: false });
    assert.deepStrictEqual(detectLineFormat('', ',', before), { eol: '\r\n', finalNewline: false });
    // Text that does have breaks decides for itself.
    assert.deepStrictEqual(detectLineFormat('a\nb', ',', before), { eol: '\n', finalNewline: false });
    // Without an earlier format there is nothing to keep.
    assert.deepStrictEqual(detectLineFormat('a,b', ','), { eol: '\n', finalNewline: false });
});

console.log(failures === 0 ? '\nAll line ending tests passed.' : `\n${failures} test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
