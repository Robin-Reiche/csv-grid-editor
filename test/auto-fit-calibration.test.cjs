// Regression guard for issue #30 (auto-fit leaves the longest value in a column
// truncated). The measurement itself needs a browser, so this pins the two
// things that made it fail and that a later edit could quietly undo.
//
// Auto-fit widens every column before measuring, so the visible cells its
// calibration step compares against are not truncated. That width used to be
// 3000 px, which is wider than any editor pane: AG Grid only renders the
// columns that are in view, so everything except the first column left the DOM
// and the calibration had almost nothing to sample. On a file whose first
// column holds short values (a row number, an id) it found none at all, kept
// its neutral factor of 1.0 and corrected nothing, and the widest value in a
// column came out a hair too wide for the column it was fitted to. It is the
// only value that can show this, because it is the one the column is sized to.
//
// Run after `tsc -p ./`:  node test/auto-fit-calibration.test.cjs

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'webview', 'features', 'auto-fit.ts'), 'utf8');

let failures = 0;
function test(name, fn) {
    try { fn(); console.log('  ✓ ' + name); }
    catch (e) { failures++; console.error('  ✗ ' + name + '\n      ' + e.message); }
}

console.log('auto-fit measures against cells that are actually there (issue #30)');

test('the pre-expand width keeps more than one column inside the viewport', () => {
    const m = src.match(/const CALIB_WIDTH = (\d+);/);
    assert.ok(m, 'CALIB_WIDTH is gone — the pre-expand width is no longer named');
    const px = Number(m[1]);
    assert.ok(px <= 800, `pre-expand width is ${px}px: too wide, the calibration will only ever see the first column`);
});

test('the calibration still needs real samples before it corrects anything', () => {
    assert.ok(/samples\.length >= 3/.test(src), 'the sample threshold is gone');
    assert.ok(/if \(cell\.scrollWidth > cell\.offsetWidth\) return; \/\/ skip truncated/.test(src),
        'the calibration no longer skips truncated cells, so the pre-expand width has no purpose');
});

test('the widest value gets a margin on top of the measurement', () => {
    assert.ok(/const SAFETY = 1\.\d+;/.test(src), 'the safety margin is gone');
    assert.ok(/probe\.offsetWidth \* calibFactor \* SAFETY/.test(src),
        'the safety margin is no longer applied to the cell measurement');
});

console.log('');
if (failures) {
    console.error(failures + ' auto-fit test(s) failed');
    process.exit(1);
}
console.log('All tests passed');
