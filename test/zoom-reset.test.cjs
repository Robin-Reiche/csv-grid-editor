// Guard for "back to 100%" — the toolbar percentage click and the Ctrl/Cmd+0
// key, both of which run features/zoom.ts resetZoom().
//
// resetZoom() does not hard-code an index. It looks 100 up in ZOOM_STEPS and
// switches itself off if it is not there, which is the right call (better a
// dead control than a jump to some arbitrary step) but also a silent one: drop
// 100 from the steps and the feature simply stops existing, with nothing to
// notice. Since the steps are a plain literal that anyone might tune, the
// invariant is asserted here instead.
//
// Run after `npm run compile` (or `tsc -p ./`):  node test/zoom-reset.test.cjs

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { state } = require('../out/webview/state.js');

let failures = 0;
function test(name, fn) {
    try { fn(); console.log('  ✓ ' + name); }
    catch (e) { failures++; console.error('  ✗ ' + name + '\n      ' + e.message); }
}

console.log('zoom reset');

test('100 is one of the zoom steps, so the reset has somewhere to go', () => {
    assert.ok(state.ZOOM_STEPS.includes(100),
        `ZOOM_STEPS is ${JSON.stringify(state.ZOOM_STEPS)} — without 100 in it, resetZoom() ` +
        'returns early and both the percentage click and Ctrl+0 become dead controls');
});

test('the reset lands on the same step a fresh install starts at', () => {
    // The provider defaults globalState 'csvGridEditor.zoomIndex' to the same
    // number (src/csvEditorProvider.ts). If the two ever drift apart, "reset"
    // stops meaning "the size this opened at", which is the whole promise.
    assert.strictEqual(state.ZOOM_STEPS.indexOf(100), state.zoomIndex,
        `reset target is index ${state.ZOOM_STEPS.indexOf(100)} but the default zoomIndex is ` +
        `${state.zoomIndex} — reset would not return to the size a new file opens at`);
});

test('the steps are ordered, so stepping and resetting agree on direction', () => {
    for (let i = 1; i < state.ZOOM_STEPS.length; i++) {
        assert.ok(state.ZOOM_STEPS[i] > state.ZOOM_STEPS[i - 1],
            `ZOOM_STEPS is not ascending at index ${i}: ` +
            `${state.ZOOM_STEPS[i - 1]} then ${state.ZOOM_STEPS[i]}`);
    }
});

test('Ctrl/Cmd+0 is wired to the reset', () => {
    // Source-level, the same way the danger-item contrast test guards its CSS:
    // the handler needs a real DOM to run, and what is worth catching is the
    // binding going missing, not the event plumbing.
    const js = fs.readFileSync(path.join(__dirname, '..', 'out', 'webview', 'keyboard.js'), 'utf8');
    assert.ok(/e\.key === '0'/.test(js),
        'out/webview/keyboard.js no longer tests for key "0" — the reset shortcut is gone');
    assert.ok(/resetZoom/.test(js),
        'out/webview/keyboard.js no longer references resetZoom');
});

console.log(failures === 0 ? '\nAll zoom reset tests passed.' : `\n${failures} test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
