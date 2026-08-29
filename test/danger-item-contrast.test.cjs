// Guard for the hover colour of the destructive menu items (Delete row, Delete
// column) in media/webview.css.
//
// These used to force `color: #fff` on hover on top of the themed error
// background. That reads fine on a dark theme, where the background is a deep
// red, and is close to invisible on a light one, where the same variable is a
// pale pink - the item looked disabled exactly while you were pointing at it.
// Since the extension is developed on dark themes, the regression is easy to
// reintroduce and hard to notice, so the rule is asserted here: a danger item's
// hover colour has to come from the theme, never from a literal.
//
// Run:  node test/danger-item-contrast.test.cjs

const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Comments go first: they sit between rules, so the crude block matcher below
// would otherwise read a comment as part of the following selector - and these
// rules are commented with the very selectors being matched.
const css = fs.readFileSync(path.join(__dirname, '..', 'media', 'webview.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');

let failures = 0;
function test(name, fn) {
    try { fn(); console.log('  ✓ ' + name); }
    catch (e) { failures++; console.error('  ✗ ' + name + '\n      ' + e.message); }
}

// Every rule block in the stylesheet, as { selector, body }.
function rules() {
    const out = [];
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let m;
    while ((m = re.exec(css)) !== null) {
        out.push({ selector: m[1].trim().replace(/\s+/g, ' '), body: m[2] });
    }
    return out;
}

// The `color` declaration of a rule body, ignoring `background-color`.
function colorOf(body) {
    const m = /(?:^|[;{\s])color\s*:\s*([^;]+)/.exec(body);
    return m ? m[1].trim() : null;
}

const dangerHover = rules().filter(r =>
    /danger/.test(r.selector) && /:hover/.test(r.selector) && colorOf(r.body) !== null
);

console.log('danger menu item contrast');

test('the danger hover rules are still in the stylesheet', () => {
    // Three of them: the column header menu, the row/cell menu and the AG Grid
    // menu. If a rename drops one, this test would otherwise pass vacuously.
    assert.strictEqual(dangerHover.length, 3,
        `expected 3 danger :hover rules with a colour, found ${dangerHover.length}: ` +
        dangerHover.map(r => r.selector).join(' | '));
});

test('no danger item hard-codes its hover colour', () => {
    for (const r of dangerHover) {
        const color = colorOf(r.body);
        assert.ok(!/^(#|rgb|hsl|white\b)/i.test(color),
            `${r.selector} hard-codes "color: ${color}" - a literal cannot be legible ` +
            'on both the dark and the light themed error background');
    }
});

test('a danger item stays red on hover', () => {
    for (const r of dangerHover) {
        const color = colorOf(r.body);
        assert.ok(color.includes('--vscode-errorForeground'),
            `${r.selector} sets "color: ${color}" on hover - it should keep the error ` +
            'foreground so the item still reads as destructive');
    }
});

console.log(failures === 0 ? '\nAll danger item contrast tests passed.' : `\n${failures} test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
