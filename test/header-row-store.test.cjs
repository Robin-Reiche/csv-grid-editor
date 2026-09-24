// The extension side of "First row is the header": which files it remembers as
// having no header row and what it tells the grid when a file opens.
//
// Header or not is a fact about one file, so it is remembered per file, in one
// globalState map from the file's URI to true. The switch arrives as a
// headerRowChanged message from the webview, which is the other side of a trust
// boundary. Only a real true or false is taken. The file it applies to is
// always the document the webview belongs to, never one the message names.
//
// A copy made with Save As and a file renamed or moved in VS Code keep the
// switch. VS Code opens either as a new document under the new URI, which had
// no entry, so the first data row turned back into column names. The HEAD
// side of a Source Control diff shows the same file under a git: URI and
// looks the switch up under the file's own.
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
    env: {},
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

// An extension context whose globalState is held in `store`.
function contextFor(store) {
    return {
        extensionUri: { fsPath: '/ext' },
        globalState: {
            get: (k, d) => store.has(k) ? store.get(k) : d,
            update: (k, v) => { store.set(k, v); return Promise.resolve(); },
        },
    };
}

// Registers the extension against a globalState held in `store`. Returns a
// way to tell it that VS Code renamed or moved files, as [from, to] paths.
function register(store) {
    let onRename = null;
    vscodeStub.workspace.onDidRenameFiles = listener => { onRename = listener; return { dispose() {} }; };
    vscodeStub.workspace.onWillRenameFiles = () => ({ dispose() {} });
    vscodeStub.window.tabGroups = { all: [], onDidChangeTabs: () => ({ dispose() {} }) };
    vscodeStub.window.registerCustomEditorProvider = () => ({ dispose() {} });
    vscodeStub.commands.registerCommand = () => ({ dispose() {} });
    CsvEditorProvider.register(contextFor(store));
    assert.ok(onRename, 'the extension does not listen for renamed files');
    return pairs => onRename({
        files: pairs.map(([from, to]) => ({ oldUri: vscodeStub.Uri.file(from), newUri: vscodeStub.Uri.file(to) })),
    });
}

// Opens `file`, a path or a URI, against a globalState held in `store`.
// Returns what the grid was told at start and a way to send the provider
// messages.
async function open(store, file, openContext = {}) {
    const provider = new CsvEditorProvider(contextFor(store));
    const uri = typeof file === 'string' ? vscodeStub.Uri.file(file) : file;
    const doc = await provider.openCustomDocument(uri, openContext, {});
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
    const saveAs = dest => provider.saveCustomDocumentAs(doc, vscodeStub.Uri.file(dest), {});
    return { init, send, saveAs };
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

    await test('a copy made with Save As keeps the switch', async () => {
        const store = new Map();
        const a = await open(store, '/data/a.csv');
        await a.send({ type: 'headerRowChanged', value: false });
        await a.saveAs('/data/b.csv');
        assert.strictEqual((await open(store, '/data/b.csv')).init.firstRowIsHeader, false, 'the copy took its first row for the header');
        assert.strictEqual((await open(store, '/data/a.csv')).init.firstRowIsHeader, false, 'the original lost the switch');
    });

    await test('Save As over a file without a header row gives it the header of the original', async () => {
        const store = new Map([[KEY, { 'file:///data/b.csv': true }]]);
        const a = await open(store, '/data/a.csv');
        await a.saveAs('/data/b.csv');
        assert.strictEqual((await open(store, '/data/b.csv')).init.firstRowIsHeader, true);
    });

    // A Source Control diff opens the HEAD side as a grid of its own, under
    // the file's path with the git scheme and the ref in the query.
    const gitUri = (p, ref) => {
        const query = JSON.stringify({ path: p, ref });
        return { scheme: 'git', fsPath: p, toString: () => 'git:' + p + '?' + encodeURIComponent(query) };
    };

    await test('both sides of a Source Control diff show the file the same way', async () => {
        const store = new Map([[KEY, { 'file:///data/a.csv': true }]]);
        const head = await open(store, gitUri('/data/a.csv', 'HEAD'));
        assert.strictEqual(head.init.firstRowIsHeader, false, 'the HEAD side took its first row for the header');
    });

    await test('the switch on the HEAD side of a diff is stored for the file', async () => {
        const store = new Map();
        const head = await open(store, gitUri('/data/a.csv', '~'));
        await head.send({ type: 'headerRowChanged', value: false });
        assert.deepStrictEqual(store.get(KEY), { 'file:///data/a.csv': true });
        assert.strictEqual((await open(store, '/data/a.csv')).init.firstRowIsHeader, false);
    });

    await test('a renamed or moved file keeps the switch', async () => {
        const store = new Map([[KEY, { 'file:///data/a.csv': true, 'file:///data/other.csv': true }]]);
        const rename = register(store);
        await rename([['/data/a.csv', '/archive/a 2024.csv']]);
        assert.deepStrictEqual(store.get(KEY), { 'file:///archive/a 2024.csv': true, 'file:///data/other.csv': true });
        assert.strictEqual((await open(store, '/archive/a 2024.csv')).init.firstRowIsHeader, false);
    });

    await test('a file renamed over one without a header row gives it its own header', async () => {
        const store = new Map([[KEY, { 'file:///data/b.csv': true }]]);
        const rename = register(store);
        await rename([['/data/a.csv', '/data/b.csv']]);
        assert.deepStrictEqual(store.get(KEY), {});
    });

    await test('a renamed folder takes the switch of the files in it along', async () => {
        const store = new Map([[KEY, { 'file:///data/in/a.csv': true, 'file:///data/in/sub/b.csv': true, 'file:///data/inside.csv': true }]]);
        const rename = register(store);
        await rename([['/data/in', '/data/out']]);
        assert.deepStrictEqual(store.get(KEY),
            { 'file:///data/out/a.csv': true, 'file:///data/out/sub/b.csv': true, 'file:///data/inside.csv': true });
    });

    await test('a rename of other files writes nothing', async () => {
        const stored = { 'file:///data/a.csv': true };
        const store = new Map([[KEY, stored]]);
        const rename = register(store);
        await rename([['/data/x.csv', '/data/y.csv']]);
        assert.strictEqual(store.get(KEY), stored, 'the map was written for a rename it has nothing to do with');
    });

    if (failures) { console.error(`\n${failures} test(s) failed`); process.exit(1); }
    console.log('\nAll header row store tests passed.');
}

main();
