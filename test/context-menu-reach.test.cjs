// Guard that every entry of a right-click menu stays reachable.
//
// The row menu is built fresh per click and its height depends on what is
// selected. Fully populated - four copy entries, freeze, two inserts, delete
// row, delete column, separators - it outgrows a short editor pane. The
// positioning did `top = Math.min(y, vh - mh - 4)` with no floor, so once the
// menu was taller than the pane that expression went negative and the menu was
// drawn above the top edge with its first entries off-screen. Nothing looked
// wrong: a clipped menu still reads as a whole menu, so the entries just seemed
// not to exist. The column menu next door had always clamped with Math.max, the
// row menu never did, and "Copy as CSV" made it two entries taller.
//
// Two things keep it fixed and both are asserted here: the floor, and a
// max-height with scrolling for the remaining case where the menu is taller
// than the pane itself and no position can show all of it.
//
// Run after `npm run compile` (or `tsc -p ./`):  node test/context-menu-reach.test.cjs

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'media', 'webview.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
const js = fs.readFileSync(path.join(root, 'out', 'webview', 'features', 'delete-row-col.js'), 'utf8');

let failures = 0;
function test(name, fn) {
    try { fn(); console.log('  ✓ ' + name); }
    catch (e) { failures++; console.error('  ✗ ' + name + '\n      ' + e.message); }
}

// The body of a top-level rule, by exact selector.
function ruleBody(selector) {
    const re = new RegExp(selector.replace('.', '\\.') + '\\s*\\{([^{}]*)\\}');
    const m = re.exec(css);
    assert.ok(m, `no rule "${selector}" in media/webview.css`);
    return m[1];
}

console.log('context menu reachability');

for (const sel of ['.row-context-menu', '.col-context-menu']) {
    test(`${sel} caps its height so a long menu scrolls instead of clipping`, () => {
        const body = ruleBody(sel);
        assert.ok(/max-height\s*:/.test(body),
            `${sel} has no max-height - in a pane shorter than the menu, the entries ` +
            'past the edge cannot be reached at all');
        assert.ok(/overflow-y\s*:\s*(auto|scroll)/.test(body),
            `${sel} caps its height without overflow-y - that hides the overflow ` +
            'rather than making it scrollable, which is the same bug in a new place');
    });
}

test('the row menu cannot be positioned above the top edge', () => {
    // Both coordinates: a floor on top only would still let a wide menu slide
    // off the left edge on a narrow pane.
    assert.ok(/style\.top\s*=\s*Math\.max\(/.test(js),
        'out/webview/features/delete-row-col.js sets style.top without a Math.max floor - ' +
        'with a menu taller than the pane, "vh - mh - 4" is negative and the first ' +
        'entries land above the top edge, unreachable and with no sign they exist');
    assert.ok(/style\.left\s*=\s*Math\.max\(/.test(js),
        'out/webview/features/delete-row-col.js sets style.left without a Math.max floor');
});

console.log(failures === 0 ? '\nAll context menu reachability tests passed.' : `\n${failures} test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
