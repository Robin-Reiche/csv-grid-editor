// Tests for the checkbox rendering of true/false columns (issue #41).
//
// The rule the whole feature rests on: a CSV has no boolean type, only words,
// and the words in the file are the file's own. Showing a box must not turn
// "yes" into "true", "N" into "false" or a padded " true " into a trimmed one,
// and a value the box cannot express must keep its text rather than disappear
// behind a box. So what is pinned down here is which values a box can stand
// for, what a click writes back, and which columns get boxes at all.
//
// Run after `npm run compile` (or `tsc -p ./`):  node test/bool-checkbox.test.cjs

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { BOOL_PAIRS, readBool, flipBoolValue } = require('../out/webview/utils/bool-values.js');

// recomputeColTypes fires an event when a type changes, so it needs that piece
// of a document. Nothing here renders.
global.document = { dispatchEvent: () => {} };
global.CustomEvent = class { constructor(name) { this.type = name; } };

const { getColumnType, recomputeColTypes } = require('../out/webview/grid/column-type.js');
const { state } = require('../out/webview/state.js');

let failures = 0;
function test(name, fn) {
    try { fn(); console.log('  ✓ ' + name); }
    catch (e) { failures++; console.error('  ✗ ' + name + '\n      ' + e.message); }
}

// getColumnType reads a column out of the body rows, so a list of values has to
// be shaped like one.
function typeOf(values) {
    return getColumnType(values.map(v => [v]), 0);
}

console.log('boolean checkboxes');

// ── which values a box can stand for ─────────────────────────────────────────

test('every known pair reads as true and false', () => {
    assert.deepStrictEqual(
        BOOL_PAIRS.map(p => p[0] + '/' + p[1]),
        ['true/false', 'yes/no', 'y/n', 't/f', 'on/off'],
    );
    for (const [yes, no] of BOOL_PAIRS) {
        assert.strictEqual(readBool(yes), true,  yes + ' did not read as true');
        assert.strictEqual(readBool(no), false,  no + ' did not read as false');
    }
});

test('case and padding do not stop a value being read', () => {
    assert.strictEqual(readBool('TRUE'), true);
    assert.strictEqual(readBool('True'), true);
    assert.strictEqual(readBool('tRuE'), true);
    assert.strictEqual(readBool('  no  '), false);
    assert.strictEqual(readBool('OFF'), false);
});

test('anything else keeps its text instead of getting a box', () => {
    // null is the renderer's signal to draw the value as it always was.
    for (const v of ['', '   ', 'maybe', 'unknown', 'N/A', '1', '0', '2', 'yes please', '-']) {
        assert.strictEqual(readBool(v), null, JSON.stringify(v) + ' was taken for a true/false value');
    }
});

// ── what a click writes back ─────────────────────────────────────────────────

test('a click stays inside the pair the cell already used', () => {
    assert.strictEqual(flipBoolValue('true'), 'false');
    assert.strictEqual(flipBoolValue('false'), 'true');
    assert.strictEqual(flipBoolValue('yes'), 'no');
    assert.strictEqual(flipBoolValue('no'), 'yes');
    assert.strictEqual(flipBoolValue('y'), 'n');
    assert.strictEqual(flipBoolValue('n'), 'y');
    assert.strictEqual(flipBoolValue('t'), 'f');
    assert.strictEqual(flipBoolValue('f'), 't');
    assert.strictEqual(flipBoolValue('on'), 'off');
    assert.strictEqual(flipBoolValue('off'), 'on');
});

test('a click keeps the capitalisation the file uses', () => {
    assert.strictEqual(flipBoolValue('TRUE'), 'FALSE');
    assert.strictEqual(flipBoolValue('False'), 'True');
    assert.strictEqual(flipBoolValue('Yes'), 'No');
    assert.strictEqual(flipBoolValue('NO'), 'YES');
    assert.strictEqual(flipBoolValue('Y'), 'N');
    assert.strictEqual(flipBoolValue('Off'), 'On');
    // Neither all caps nor merely capitalised: falls back to the plain spelling.
    assert.strictEqual(flipBoolValue('tRuE'), 'false');
});

test('a click keeps the padding around the value', () => {
    assert.strictEqual(flipBoolValue(' true '), ' false ');
    assert.strictEqual(flipBoolValue('\tYES'), '\tNO');
});

test('a value the box cannot express is never rewritten', () => {
    // null means "leave it alone", and nothing without a box can be clicked.
    for (const v of ['', 'maybe', '1', '0', 'true false']) {
        assert.strictEqual(flipBoolValue(v), null, JSON.stringify(v) + ' would have been rewritten');
    }
});

// ── which columns get boxes at all ───────────────────────────────────────────

test('every pair makes a column boolean', () => {
    assert.strictEqual(typeOf(['true', 'false', 'true']), 'boolean');
    assert.strictEqual(typeOf(['yes', 'no', 'yes']), 'boolean');
    assert.strictEqual(typeOf(['Y', 'N', 'Y', 'N']), 'boolean');
    assert.strictEqual(typeOf(['t', 'f', 't', 'f']), 'boolean');
    assert.strictEqual(typeOf(['on', 'off', 'on']), 'boolean');
});

test('empty cells do not count against a boolean column', () => {
    assert.strictEqual(typeOf(['true', '', '', 'false', '   ']), 'boolean');
});

test('a column of ones and zeros stays numeric', () => {
    // 1 and 0 read just as well as counts, so they get no box. Typing the word
    // is the way to say a column means true and false.
    assert.strictEqual(typeOf(['1', '0', '1', '0']), 'integer');
});

test('a column mixing two pairs is not a boolean column', () => {
    // Half "yes" and half "t" is not a column of answers in one language, and
    // half of it would flip into the other pair's word on a click.
    assert.strictEqual(typeOf(['yes', 't', 'yes', 't', 'no', 'f']), 'string');
});

test('a mostly-text column is not dragged in by a few true/false words', () => {
    assert.strictEqual(typeOf(['yes', 'maybe', 'later', 'no', 'ask Anna']), 'string');
});

// ── the promise the feature makes about the file ─────────────────────────────

test('switching the mode redraws cells and writes nothing', () => {
    // The guard for the one thing this feature must never do. Turning the mode
    // on or off may only repaint; if this file ever assigns to state.data or
    // posts an edit, a file opened and closed again would no longer be the file
    // that was opened.
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'webview', 'features', 'bool-checkbox.ts'), 'utf8');
    assert.ok(!/state\.data\s*(\[|=)/.test(src), 'bool-checkbox.ts writes to state.data');
    assert.ok(!/type:\s*'edit'/.test(src), 'bool-checkbox.ts posts an edit of its own');
    assert.ok(/refreshCells/.test(src), 'switching the mode no longer redraws the cells');
    // A click is an edit, and it goes through the grid's own edit path so it
    // lands on the undo stack like a typed value (grid/builder.ts).
    assert.ok(/setDataValue/.test(src), 'a click no longer goes through the grid edit path');
});

test('a column whose type is worked out again gets redrawn', () => {
    // The undo case, found in the real grid: refreshGrid drops every column type
    // and has them worked out again afterwards. In between, a true/false column
    // has no type and its cells are drawn as plain words. Without a redraw here
    // the words stayed there after an undo, with the checkbox mode on.
    const refreshed = [];
    state.data = [['answer'], ['yes'], ['no'], ['yes']];
    state.colTypes = [];
    // A changed type is also written into the column defs for the header badge.
    // This grid has none, so there is nothing to write.
    state.gridApi = { refreshCells: (opts) => refreshed.push(opts), getColumnDefs: () => [] };

    recomputeColTypes();
    assert.strictEqual(state.colTypes[0], 'boolean');
    assert.strictEqual(refreshed.length, 1, 'the column was not redrawn after its type came back');
    assert.deepStrictEqual(refreshed[0].columns, ['col_0']);
    assert.strictEqual(refreshed[0].force, true);

    // Nothing changed the second time, so nothing is redrawn.
    recomputeColTypes();
    assert.strictEqual(refreshed.length, 1, 'cells are redrawn even when no type changed');
    state.gridApi = null;
});

console.log(failures === 0 ? '\nAll boolean checkbox tests passed.' : `\n${failures} test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
