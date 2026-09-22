// The extension side of the settings menu: what it remembers and what it hands
// the grid when a file opens.
//
// The webview asks for a switch to be remembered with a settingChanged message.
// That message crosses a trust boundary, and what it writes lands in VS Code's
// globalState, which every file shares. So only the keys in settings.ts and only
// real booleans may be written, and a file opened afterwards has to start with
// exactly what was remembered.
//
// Drives the real provider against a stubbed vscode API.
//
// Run after `tsc -p ./`:  node test/settings-store.test.cjs

const assert = require('assert');
const Module = require('module');

const vscodeStub = {
    EventEmitter: class { constructor() { this.event = () => ({ dispose() {} }); } fire() {} dispose() {} },
    Uri: {
        file: p => ({ fsPath: p, toString: () => 'file://' + p }),
        joinPath: (base, ...parts) => ({ fsPath: [base.fsPath, ...parts].join('/') }),
    },
    RelativePattern: class {},
    workspace: {
        fs: {
            stat: async () => ({ size: 4 }),
            readFile: async () => new TextEncoder().encode('a\n1\n'),
            writeFile: async () => {},
        },
        createFileSystemWatcher: () => ({ onDidChange() {}, onDidCreate() {}, dispose() {} }),
    },
    window: {}, commands: {}, Disposable: { from() {} },
};

const load = Module._load;
Module._load = function (request, ...rest) {
    if (request === 'vscode') return vscodeStub;
    return load.call(this, request, ...rest);
};

const { CsvEditorProvider } = require('../out/csvEditorProvider.js');
const { SETTING_DEFAULTS } = require('../out/webview/settings.js');

let failures = 0;
async function test(name, fn) {
    try { await fn(); console.log('  ✓ ' + name); }
    catch (e) { failures++; console.error('  ✗ ' + name + '\n      ' + e.message); }
}

// Opens a file with a globalState that starts from `stored`. Returns the page
// the grid was given, a way to send it messages and what ended up stored.
async function open(stored = {}) {
    const store = new Map(Object.entries(stored));
    const context = {
        extensionUri: { fsPath: '/ext' },
        globalState: {
            get: (k, d) => store.has(k) ? store.get(k) : d,
            update: (k, v) => { store.set(k, v); return Promise.resolve(); },
        },
    };
    const provider = new CsvEditorProvider(context);
    const doc = await provider.openCustomDocument(vscodeStub.Uri.file('/data/s.csv'), {}, {});
    let onMessage = null;
    const panel = {
        webview: {
            options: null, html: '', cspSource: 'stub',
            asWebviewUri: u => u.fsPath,
            postMessage: () => Promise.resolve(true),
            onDidReceiveMessage: f => { onMessage = f; },
        },
        onDidDispose() {},
    };
    await provider.resolveCustomEditor(doc, panel, {});
    const initial = JSON.parse(panel.webview.html.match(/const INITIAL_SETTINGS\s*=\s*(\{[^}]*\});/)[1]);
    return { store, initial, send: m => onMessage(m) };
}

async function main() {
    console.log('settings are remembered safely');

    await test('a file opens with the defaults when nothing is remembered', async () => {
        const { initial } = await open();
        assert.deepStrictEqual(initial, SETTING_DEFAULTS);
    });

    await test('a file opens with what was remembered', async () => {
        const { initial } = await open({ 'csvGridEditor.colorMode': true, 'csvGridEditor.typeBadges': false });
        assert.strictEqual(initial.colorMode, true);
        assert.strictEqual(initial.typeBadges, false);
        assert.strictEqual(initial.rowHighlight, SETTING_DEFAULTS.rowHighlight);
    });

    await test('color mode picked before the menu existed is kept', async () => {
        // It used to be a toolbar button stored under this same key.
        const { initial } = await open({ 'csvGridEditor.colorMode': true });
        assert.strictEqual(initial.colorMode, true);
    });

    await test('a switch in the menu is remembered', async () => {
        const { store, send } = await open();
        await send({ type: 'settingChanged', key: 'markEmpty', value: true });
        assert.strictEqual(store.get('csvGridEditor.markEmpty'), true);
    });

    await test('an unknown key is never written', async () => {
        const { store, send } = await open();
        await send({ type: 'settingChanged', key: 'zoomIndex', value: true });
        await send({ type: 'settingChanged', key: '__proto__', value: true });
        await send({ type: 'settingChanged', key: 'somethingElse', value: false });
        assert.deepStrictEqual([...store.keys()], []);
    });

    await test('only a real true or false is written', async () => {
        const { store, send } = await open();
        await send({ type: 'settingChanged', key: 'colorMode', value: 'yes' });
        await send({ type: 'settingChanged', key: 'colorMode', value: 1 });
        await send({ type: 'settingChanged', key: 'colorMode' });
        assert.strictEqual(store.has('csvGridEditor.colorMode'), false);
    });

    if (failures) { console.error(`\n${failures} test(s) failed`); process.exit(1); }
    console.log('\nAll settings store tests passed.');
}

main();
