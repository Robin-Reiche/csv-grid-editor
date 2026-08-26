// The undo history a cell editor keeps for its own text. While a cell is open for
// editing, Ctrl+Z and the toolbar's Undo button have to take back what is being
// typed in that cell and leave the editor open, rather than reaching past the
// unfinished edit to the last committed grid action.
//
// The browser's built-in textarea undo cannot carry this: assigning .value from
// code wipes its history, and the editor does exactly that to insert a line
// break, which is why Alt+Enter could not be taken back at all.
//
// Run after `npm run compile` (or `tsc -p ./`):  node test/cell-editor-undo.test.cjs

const assert = require('assert');
const {
    newHistory,
    recordHistory,
    stepHistory,
    startsNewUndoStep,
} = require('../out/webview/grid/multiline-cell-editor.js');

let failures = 0;
function test(name, fn) {
    try { fn(); console.log('  ✓ ' + name); }
    catch (e) { failures++; console.error('  ✗ ' + name + '\n      ' + e.message); }
}

// Types a string one character at a time, the way the input event arrives.
function type(h, from, text) {
    let v = from;
    for (const ch of text) {
        v += ch;
        recordHistory(h, v);
    }
    return v;
}

console.log('cell editor undo');

// ── step boundaries ──────────────────────────────────────────────────────────

test('typing inside a word extends the step it is in', () => {
    assert.strictEqual(startsNewUndoStep('ab', 'abc'), false);
});

test('the first letter after a space starts a new step', () => {
    assert.strictEqual(startsNewUndoStep('hallo ', 'hallo w'), true);
});

test('the space itself still belongs to the word in front of it', () => {
    assert.strictEqual(startsNewUndoStep('hallo', 'hallo '), false);
});

test('a line break starts its own step', () => {
    assert.strictEqual(startsNewUndoStep('ab', 'ab\n'), true);
    assert.strictEqual(startsNewUndoStep('a\nb', 'a\nb\n'), true);
});

test('a deletion starts its own step', () => {
    assert.strictEqual(startsNewUndoStep('abc', 'ab'), true);
});

test('a paste starts its own step', () => {
    assert.strictEqual(startsNewUndoStep('ab', 'ab and a whole lot more'), true);
});

// ── the history ──────────────────────────────────────────────────────────────

test('one word is one step, not one letter', () => {
    const h = newHistory('');
    type(h, '', 'hallo welt');
    assert.strictEqual(stepHistory(h, -1), 'hallo ', 'the second word goes in one go');
    assert.strictEqual(stepHistory(h, -1), '', 'and so does the first');
    assert.strictEqual(stepHistory(h, -1), null, 'nothing before the opening value');
});

test('Alt+Enter can be taken back on its own, the typing before it stays', () => {
    const h = newHistory('hello');
    recordHistory(h, 'hello\n');              // what insertNewline records
    assert.strictEqual(stepHistory(h, -1), 'hello');
});

test('ten line breaks in a row are ten steps, not one', () => {
    const h = newHistory('x');
    let v = 'x';
    for (let i = 0; i < 10; i++) { v += '\n'; recordHistory(h, v); }
    for (let i = 9; i >= 0; i--) {
        assert.strictEqual(stepHistory(h, -1), 'x' + '\n'.repeat(i));
    }
});

test('redo walks back forward', () => {
    const h = newHistory('hello');
    type(h, 'hello', 'x');
    assert.strictEqual(stepHistory(h, -1), 'hello');
    assert.strictEqual(stepHistory(h,  1), 'hellox');
    assert.strictEqual(stepHistory(h,  1), null, 'nothing past the newest step');
});

test('typing after an undo drops what was undone', () => {
    const h = newHistory('hello');
    type(h, 'hello', 'x');
    stepHistory(h, -1);                        // back at 'hello'
    type(h, 'hello', 'y');
    assert.strictEqual(stepHistory(h, 1), null, 'the old redo step is gone');
    assert.strictEqual(stepHistory(h, -1), 'hello');
});

test('the value the editor opened with is never overwritten', () => {
    const h = newHistory('start');
    recordHistory(h, 'start!');
    assert.strictEqual(h.entries[0], 'start');
});

test('recording the same value again changes nothing', () => {
    const h = newHistory('same');
    recordHistory(h, 'same');
    assert.strictEqual(h.entries.length, 1);
    assert.strictEqual(stepHistory(h, -1), null);
});

test('an untouched editor has nothing to undo', () => {
    const h = newHistory('untouched');
    assert.strictEqual(stepHistory(h, -1), null);
    assert.strictEqual(stepHistory(h,  1), null);
});

process.exit(failures ? 1 : 0);
