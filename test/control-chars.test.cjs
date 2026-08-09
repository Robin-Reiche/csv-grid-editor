// Tests for the control-character splitter (webview/utils/control-chars.ts),
// which turns a cell value into text runs plus labelled control characters so
// the grid can draw a chip instead of an anonymous tofu box.
// The two things that must hold: the split is LOSSLESS (nothing is dropped or
// reordered — the cell still shows the whole value), and ordinary whitespace
// inside a quoted field (tab, LF, CR) is left alone so multi-line cells do not
// sprout a chip at every line break.
//
// Run after `npm run compile` (or `tsc -p ./`):  node test/control-chars.test.cjs

const assert = require('assert');
const {
    isMarkedControlChar,
    hasControlChars,
    splitControlChars,
} = require('../out/webview/utils/control-chars.js');

let failures = 0;
function test(name, fn) {
    try { fn(); console.log('  ✓ ' + name); }
    catch (e) { failures++; console.error('  ✗ ' + name + '\n      ' + e.message); }
}

const ch = c => String.fromCharCode(c);
const GS = ch(0x1d);

console.log('control characters');

// ── which characters are marked ──────────────────────────────────────────────

test('C0 control characters are marked', () => {
    assert.strictEqual(isMarkedControlChar(0x00), true);
    assert.strictEqual(isMarkedControlChar(0x1d), true);
    assert.strictEqual(isMarkedControlChar(0x1f), true);
});

test('DEL is marked', () => {
    assert.strictEqual(isMarkedControlChar(0x7f), true);
});

test('tab, LF and CR are left alone — they are whitespace in a quoted field', () => {
    assert.strictEqual(isMarkedControlChar(0x09), false);
    assert.strictEqual(isMarkedControlChar(0x0a), false);
    assert.strictEqual(isMarkedControlChar(0x0d), false);
});

test('printable characters are never marked', () => {
    assert.strictEqual(isMarkedControlChar(0x20), false);
    assert.strictEqual(isMarkedControlChar('A'.charCodeAt(0)), false);
    assert.strictEqual(isMarkedControlChar('é'.charCodeAt(0)), false);
});

// ── hasControlChars ──────────────────────────────────────────────────────────

test('hasControlChars spots a separator buried in a long value', () => {
    assert.strictEqual(hasControlChars('4901234567894ABC' + GS + '17250131LOT42'), true);
});

test('hasControlChars is false for ordinary values, including multi-line ones', () => {
    assert.strictEqual(hasControlChars('plain text'), false);
    assert.strictEqual(hasControlChars('line1\r\nline2\tpadded'), false);
    assert.strictEqual(hasControlChars(''), false);
});

// ── splitControlChars ────────────────────────────────────────────────────────

test('a value with no control characters stays one text segment', () => {
    assert.deepStrictEqual(splitControlChars('abc'), [{ type: 'text', text: 'abc' }]);
});

test('an empty value produces no segments', () => {
    assert.deepStrictEqual(splitControlChars(''), []);
});

test('a control character is split out and labelled with its ASCII name', () => {
    assert.deepStrictEqual(splitControlChars('a' + GS + 'b'), [
        { type: 'text', text: 'a' },
        { type: 'control', abbr: 'GS', label: 'U+001D GROUP SEPARATOR' },
        { type: 'text', text: 'b' },
    ]);
});

test('leading and trailing control characters do not emit empty text runs', () => {
    assert.deepStrictEqual(splitControlChars(GS + 'x' + GS), [
        { type: 'control', abbr: 'GS', label: 'U+001D GROUP SEPARATOR' },
        { type: 'text', text: 'x' },
        { type: 'control', abbr: 'GS', label: 'U+001D GROUP SEPARATOR' },
    ]);
});

test('adjacent control characters each get their own segment', () => {
    const segs = splitControlChars(ch(0x00) + ch(0x1f));
    assert.deepStrictEqual(segs, [
        { type: 'control', abbr: 'NUL', label: 'U+0000 NULL' },
        { type: 'control', abbr: 'US',  label: 'U+001F UNIT SEPARATOR' },
    ]);
});

test('the split is lossless — text runs plus one char per control segment rebuild the value', () => {
    const raw = 'ab' + GS + 'cd' + ch(0x07) + '\tef\n' + ch(0x7f);
    const rebuilt = splitControlChars(raw)
        .map(s => s.type === 'text' ? s.text : '?')
        .join('');
    assert.strictEqual(rebuilt.length, raw.length, 'one placeholder per control char, text kept verbatim');
    assert.strictEqual(rebuilt, 'ab?cd?\tef\n?');
});

test('every marked C0 character has a real abbreviation, not a hex fallback', () => {
    for (let code = 0; code < 0x20; code++) {
        if (!isMarkedControlChar(code)) continue;
        const seg = splitControlChars(ch(code))[0];
        assert.ok(/^[A-Z]{2,3}[0-9]?$/.test(seg.abbr), 'code ' + code + ' has abbr ' + seg.abbr);
        assert.ok(seg.label.indexOf(' ') > 0, 'code ' + code + ' has a name in its label');
    }
});

if (failures) { console.error('\n' + failures + ' test(s) failed'); process.exit(1); }
console.log('\nAll tests passed');
