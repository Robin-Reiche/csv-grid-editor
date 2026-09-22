// Regression guard: the values the extension writes into the page's inline
// script must arrive as data, whatever they contain.
//
// The file name used to be put between single quotes with only the quote
// escaped. On Linux and macOS a name may hold a backslash or a line break, so
// "it\'s.csv" made the script a syntax error (none of the page globals got
// defined and the grid never loaded) and "C\new.csv" came through with a line
// break in it. A crafted name even ran its own code inside the webview. The
// profile layout comes back from the webview through globalState, so it is no
// more trusted than a file name. A "</script>" in it would end the script
// early.
//
// This builds the real page and runs its inline script the way the browser
// would: only up to the first </script>, then as JavaScript.
//
// Run after `tsc -p ./`:  node test/webview-globals.test.cjs

const assert = require('assert');
const vm = require('vm');
const Module = require('module');

const load = Module._load;
Module._load = function (request, ...rest) {
    if (request === 'vscode') return { Uri: { joinPath: (_b, ...parts) => 'ASSET:' + parts.join('/') } };
    return load.call(this, request, ...rest);
};
const { getWebviewContent } = require('../out/webview.js');
const { SETTING_DEFAULTS } = require('../out/webview/settings.js');

let failures = 0;
function test(name, fn) {
    try { fn(); console.log('  ✓ ' + name); }
    catch (e) { failures++; console.error('  ✗ ' + name + '\n      ' + e.message); }
}

// Returns the globals the page's inline script defines. When the script
// cannot run it throws what the browser would have thrown.
function globalsOf({ fileName = 'test.csv', delimiter = ',', previewMode = 'full', isPreview = false, profileLayout, zoomIndex = 4 } = {}, sandbox = {}) {
    const html = getWebviewContent(
        { asWebviewUri: u => u, cspSource: 'stub' }, '/ext', delimiter,
        isPreview, previewMode, 0, fileName, false, false, zoomIndex, { ...SETTING_DEFAULTS }, false,
        profileLayout ?? { dock: 'right', width: 0, height: 0 },
    );
    const marker = html.indexOf('const vscodeApi');
    assert.ok(marker > 0, 'could not find the inline globals script');
    const start = html.lastIndexOf('>', marker) + 1;
    // The HTML parser ends a script at the first </script>, whatever the
    // JavaScript around it means.
    const code = html.slice(start, html.indexOf('</script>', start));
    sandbox.acquireVsCodeApi = () => ({});
    return vm.runInNewContext(code + '\n;({ PREVIEW_MODE, DELIMITER, FILENAME, INITIAL_ZOOM_INDEX, INITIAL_SETTINGS, INITIAL_PROFILE_LAYOUT })', sandbox);
}

console.log('page globals carry any value as data');

for (const name of ["it's.csv", "it\\'s.csv", 'C\\new.csv', 'line\nbreak.csv', 'x\\\';globalThis.PWNED=1;//.csv', '</script><b>.csv', 'Café "quoted" ü.csv']) {
    test('file name ' + JSON.stringify(name), () => {
        let g;
        assert.doesNotThrow(() => { g = globalsOf({ fileName: name }); }, 'the inline script does not run');
        assert.strictEqual(g.FILENAME, name);
    });
}

test('a crafted file name runs no code', () => {
    const sandbox = {};
    try { globalsOf({ fileName: "x\\';globalThis.PWNED=1;//.csv" }, sandbox); } catch {}
    assert.strictEqual(sandbox.PWNED, undefined, 'the file name ran as code');
});

for (const d of [',', ';', '\t', '|']) {
    test('delimiter ' + JSON.stringify(d), () => {
        assert.strictEqual(globalsOf({ delimiter: d }).DELIMITER, d);
    });
}

test('preview mode', () => {
    assert.strictEqual(globalsOf({ isPreview: true, previewMode: 'head' }).PREVIEW_MODE, 'head');
});

test('a profile layout from globalState cannot end the script', () => {
    const dock = '</script><script>globalThis.PWNED=1</script>';
    const g = globalsOf({ profileLayout: { dock, width: 10, height: 20 } });
    assert.deepStrictEqual({ ...g.INITIAL_PROFILE_LAYOUT }, { dock, width: 10, height: 20 });
});

test('a zoom index from globalState stays a value', () => {
    // globalState holds whatever the webview last sent, so it is not
    // guaranteed to be the number the type says.
    const g = globalsOf({ zoomIndex: '4;globalThis.PWNED=1' });
    assert.strictEqual(g.INITIAL_ZOOM_INDEX, '4;globalThis.PWNED=1');
    assert.strictEqual(globalsOf({ zoomIndex: 6 }).INITIAL_ZOOM_INDEX, 6);
});

test('the settings arrive intact', () => {
    assert.deepStrictEqual({ ...globalsOf().INITIAL_SETTINGS }, { ...SETTING_DEFAULTS });
});

if (failures) { console.error(`\n${failures} test(s) failed`); process.exit(1); }
console.log('\nAll page globals tests passed.');
