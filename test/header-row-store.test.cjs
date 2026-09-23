// The extension side of "First row is the header": which files it remembers as
// having no header row and what it tells the grid when a file opens.
//
// Header or not is a fact about one file, so it is remembered per file, in one
// globalState map from the file's URI to true. The switch arrives as a
// headerRowChanged message from the webview, which is the other side of a trust
// boundary. Only a real true or false is taken. The file it applies to is
// always the document the webview belongs to, never one the message names.
//
// Drives the real provider against a stubbed vscode API.
//
// Run after `tsc -p ./`:  node test/header-row-store.test.cjs

const assert = require('assert');
const Module = require('module');

const vscodeStub = {
    EventEmitter: class { constructor() { this.event = () => ({ dispose() {} }); } fire() {} dispose() {} },
    Uri: {
        file: p => ({ fsPath: p, toString: () => 'file://' + p }),
        parse: s => ({ fsPath: s.replace(/^file:\/\//, ''), toString: () => s }),
        joinPath: (base, ...parts) => ({ fsPath: [base.fsPath, ...parts].join('/') }),
    },
    RelativePattern: class {},
    workspace: {
        fs: {
            stat: async () => ({ size: 4 }),
            readFile: async () => new TextEncoder().encode('1,2\n3,4\n'),
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

const { CsvEditorProvider, rememberHeaderRow } = require('../out/csvEditorProvider.js');

const KEY = 'csvGridEditor.headerless';

let failures = 0;
async function test(name, fn) {
    try { await fn(); console.log('  ✓ ' + name); }
    catch (e) { failures++; console.error('  ✗ ' + name + '\n      ' + e.message); }
}

// Opens `filePath` against a globalState held in `store`. Returns what the
// grid was told at start and a way to send the provider messages.
async function open(store, filePath, openContext = {}) {
    const context = {
        extensionUri: { fsPath: '/ext' },
        globalState: {
            get: (k, d) => store.has(k) ? store.get(k) : d,
            update: (k, v) => { store.set(k, v); return Promise.resolve(); },
        },
    };
    const provider = new CsvEditorProvider(context);
    const doc = await provider.openCustomDocument(vscodeStub.Uri.file(filePath), openContext, {});
    const posted = [];
    let onMessage = null;
    const panel = {
        webview: {
            options: null, html: '', cspSource: 'stub',
            asWebviewUri: u => u.fsPath,
            postMessage: m => { posted.push(m); return Promise.resolve(true); },
            onDidReceiveMessage: f => { onMessage = f; },
        },
        onDidDispose() {},
    };
    await provider.resolveCustomEditor(doc, panel, {});
    const send = m => onMessage(m);
    await send({ type: 'ready' });
    const init = posted.find(m => m.type === 'init');
    return { init, send };
}

async function main() {
    console.log('"First row is the header" is remembered per file');

    await test('a switch off is stored as true for that file', () => {
        assert.deepStrictEqual(rememberHeaderRow(undefined, 'file:///a.csv', false), { 'file:///a.csv': true });
    });

    await test('a switch back on removes the file from the map', () => {
        const map = { 'file:///a.csv': true, 'file:///b.csv': true };
        assert.deepStrictEqual(rememberHeaderRow(map, 'file:///a.csv', true), { 'file:///b.csv': true });
        assert.deepStrictEqual(map, { 'file:///a.csv': true, 'file:///b.csv': true }, 'the stored map was changed in place');
    });

    await test('only true is kept from what was stored', () => {
        const stored = { 'file:///a.csv': true, 'file:///b.csv': 'yes', 'file:///c.csv': 1 };
        assert.deepStrictEqual(rememberHeaderRow(stored, 'file:///d.csv', false), { 'file:///a.csv': true, 'file:///d.csv': true });
        assert.deepStrictEqual(rememberHeaderRow('broken', 'file:///d.csv', false), { 'file:///d.csv': true });
    });

    await test('a file opens with its header unless it was switched off', async () => {
        const store = new Map();
        const { init } = await open(store, '/data/a.csv');
        assert.strictEqual(init.firstRowIsHeader, true);
        assert.strictEqual(store.has(KEY), false, 'opening a file wrote to the map');
    });

    await test('the switch is remembered for that file and no other', async () => {
        const store = new Map();
        const a = await open(store, '/data/a.csv');
        await a.send({ type: 'headerRowChanged', value: false });
        assert.deepStrictEqual(store.get(KEY), { 'file:///data/a.csv': true });
        assert.strictEqual((await open(store, '/data/a.csv')).init.firstRowIsHeader, false);
        assert.strictEqual((await open(store, '/data/b.csv')).init.firstRowIsHeader, true);

        const again = await open(store, '/data/a.csv');
        await again.send({ type: 'headerRowChanged', value: true });
        assert.deepStrictEqual(store.get(KEY), {});
        assert.strictEqual((await open(store, '/data/a.csv')).init.firstRowIsHeader, true);
    });

    await test('unsaved edits restored after a restart keep it', async () => {
        const store = new Map([[KEY, { 'file:///data/a.csv': true }]]);
        const { init } = await open(store, '/data/a.csv', { backupId: 'file:///backups/a-1' });
        assert.strictEqual(init.firstRowIsHeader, false);
    });

    await test('the message cannot name another file', async () => {
        const store = new Map();
        const a = await open(store, '/data/a.csv');
        await a.send({ type: 'headerRowChanged', value: false, uri: 'file:///data/other.csv' });
        assert.deepStrictEqual(store.get(KEY), { 'file:///data/a.csv': true });
    });

    await test('only a real true or false is taken', async () => {
        const store = new Map();
        const a = await open(store, '/data/a.csv');
        await a.send({ type: 'headerRowChanged', value: 'false' });
        await a.send({ type: 'headerRowChanged', value: 0 });
        await a.send({ type: 'headerRowChanged' });
        assert.strictEqual(store.has(KEY), false);
    });

    if (failures) { console.error(`\n${failures} test(s) failed`); process.exit(1); }
    console.log('\nAll header row store tests passed.');
}

main();
