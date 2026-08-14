// Tests for multi-line cell values (issue #29) — a line break inside a quoted
// field. Three things have to hold, and each of them is what breaks first if
// something in the chain regresses:
//   1. The value survives the round trip. parseCsv must keep the break, toCsv
//      must quote the cell again, and re-parsing must yield the same matrix —
//      otherwise saving a file the grid opened would rewrite it into a
//      different one.
//   2. The break is visible without wrapping. splitControlChars(v, true) marks
//      it, so a cell drawn on one fixed-height line still reads as multi-line.
//      Called WITHOUT the flag it must behave exactly as before, since that is
//      what the chip renderer relies on for wrap mode.
//   3. Auto-fit sizes a wrapped column by the longest line, not by every line
//      laid end to end.
//
// Run after `npm run compile` (or `tsc -p ./`):  node test/multiline-cells.test.cjs

const assert = require('assert');
const { parseCsv, toCsv, longestLine } = require('../out/webview/utils/csv.js');
const { splitControlChars, hasControlChars } = require('../out/webview/utils/control-chars.js');

let failures = 0;
function test(name, fn) {
    try { fn(); console.log('  ✓ ' + name); }
    catch (e) { failures++; console.error('  ✗ ' + name + '\n      ' + e.message); }
}

console.log('multi-line cells');

// ── parse ────────────────────────────────────────────────────────────────────

test('a quoted LF stays inside the cell', () => {
    const rows = parseCsv('id,note\n1,"line1\nline2"\n2,plain\n', ',');
    assert.deepStrictEqual(rows, [['id', 'note'], ['1', 'line1\nline2'], ['2', 'plain']]);
});

test('a quoted CRLF keeps both characters', () => {
    const rows = parseCsv('id,note\r\n1,"line1\r\nline2"\r\n', ',');
    assert.deepStrictEqual(rows, [['id', 'note'], ['1', 'line1\r\nline2']]);
});

test('an unquoted newline still ends the row', () => {
    const rows = parseCsv('a,b\nc,d\n', ',');
    assert.deepStrictEqual(rows, [['a', 'b'], ['c', 'd']]);
});

test('a multi-line cell may also hold the delimiter and quotes', () => {
    const rows = parseCsv('x\n"a,b\n""c"""\n', ',');
    assert.deepStrictEqual(rows, [['x'], ['a,b\n"c"']]);
});

// ── write ────────────────────────────────────────────────────────────────────

test('toCsv quotes a cell that contains a line break', () => {
    assert.strictEqual(toCsv([['note'], ['a\nb']], ','), 'note\n"a\nb"');
});

test('parse → write → parse is stable', () => {
    const src  = 'id,note,tail\n1,"first\nsecond",x\n2,"cr\r\nlf",y\n';
    const once = parseCsv(src, ',');
    const twice = parseCsv(toCsv(once, ','), ',');
    assert.deepStrictEqual(twice, once);
});

test('a cell edited into a multi-line value round-trips', () => {
    // What the grid does after an edit: mutate the matrix, hand it to toCsv.
    const rows = parseCsv('a,b\n1,2\n', ',');
    rows[1][1] = 'two\nlines';
    assert.deepStrictEqual(parseCsv(toCsv(rows, ','), ','), [['a', 'b'], ['1', 'two\nlines']]);
});

// ── display ──────────────────────────────────────────────────────────────────

test('without the flag a line break is not marked (wrap mode)', () => {
    assert.strictEqual(hasControlChars('a\nb'), false);
    assert.deepStrictEqual(splitControlChars('a\nb'), [{ type: 'text', text: 'a\nb' }]);
});

test('with the flag a line break becomes its own segment', () => {
    assert.strictEqual(hasControlChars('a\nb', true), true);
    assert.deepStrictEqual(splitControlChars('a\nb', true), [
        { type: 'text', text: 'a' },
        { type: 'control', abbr: '↵', label: 'U+000A LINE FEED', newline: true },
        { type: 'text', text: 'b' },
    ]);
});

test('CRLF is one segment, not two', () => {
    const segs = splitControlChars('a\r\nb', true);
    assert.strictEqual(segs.filter(s => s.type === 'control').length, 1);
    assert.strictEqual(segs[1].label, 'U+000D U+000A CARRIAGE RETURN + LINE FEED');
});

test('a lone CR is marked on its own', () => {
    const segs = splitControlChars('a\rb', true);
    assert.deepStrictEqual(segs[1], { type: 'control', abbr: '↵', label: 'U+000D CARRIAGE RETURN', newline: true });
});

test('line breaks and real control characters coexist', () => {
    const segs = splitControlChars('a\n' + String.fromCharCode(0x1d) + 'b', true);
    assert.deepStrictEqual(segs.map(s => s.type === 'text' ? s.text : s.abbr), ['a', '↵', 'GS', 'b']);
});

test('the split stays lossless — text runs plus breaks rebuild the value', () => {
    const value = 'a\r\nb\nc';
    const rebuilt = splitControlChars(value, true)
        .map(s => s.type === 'text' ? s.text : (s.label.indexOf('U+000D U+000A') === 0 ? '\r\n' : '\n'))
        .join('');
    assert.strictEqual(rebuilt, value);
});

// ── auto-fit width ───────────────────────────────────────────────────────────

test('longestLine returns the widest line of a multi-line value', () => {
    assert.strictEqual(longestLine('short\nmuch longer line\nmid'), 'much longer line');
    assert.strictEqual(longestLine('a\r\nbbbb\rcc'), 'bbbb');
});

test('longestLine leaves a single-line value untouched', () => {
    assert.strictEqual(longestLine('just one line'), 'just one line');
    assert.strictEqual(longestLine(''), '');
});

console.log(failures === 0 ? '\nall multi-line cell tests passed' : `\n${failures} test(s) failed`);
process.exit(failures === 0 ? 0 : 1);
