// Regression guard: with auto-save on, the file watcher must not roll the grid
// back to what was just saved.
//
// The watcher reloads the grid whenever the file on disk differs from what the
// editor holds (issue #25). Our own saves were meant to be ignored by that
// comparison: a save writes exactly what the editor holds, so the two match.
// But the watcher reports a save only after the write, and with
// files.autoSave = afterDelay the next edit can land in between. By the time
// the watcher reads the file, the editor has moved on one edit, the disk still
// has the save, the two differ and the save's own echo was taken for an
// outside change. The grid was reset to the saved text and the newest edit
// was gone. Reported as "add many empty columns and at some point they all
// disappear": the saved text of a header of blank names is ",,,," and that
// used to read back as no table at all, so the rollback took everything.
//
// This drives the real provider against a stubbed vscode API with an
// in-memory disk, so the race can be staged step by step.
//
// Run after `tsc -p ./`:  node test/autosave-echo.test.cjs

const assert = require('assert');
const Module = require('module');

const disk = new Map();
const watchers = [];

class EventEmitter {
    constructor() { this.listeners = []; this.event = l => { this.listeners.push(l); return { dispose() {} }; }; }
    fire(e) { for (const l of this.listeners) l(e); }
    dispose() {}
}

const vscodeStub = {
    EventEmitter,
    Uri: {
        file: p => ({ fsPath: p, toString: () => 'file://' + p }),
        joinPath: (base, ...parts) => ({ fsPath: [base.fsPath, ...parts].join('/') }),
    },
    RelativePattern: class { constructor(base, pattern) { this.base = base; this.pattern = pattern; } },
    workspace: {
        fs: {
            stat: async uri => ({ size: (disk.get(uri.fsPath) ?? '').length }),
            readFile: async uri => new TextEncoder().encode(disk.get(uri.fsPath) ?? ''),
            writeFile: async (uri, bytes) => { disk.set(uri.fsPath, new TextDecoder().decode(bytes)); },
        },
        createFileSystemWatcher: () => {
            const w = { change: [], create: [], onDidChange(f) { this.change.push(f); }, onDidCreate(f) { this.create.push(f); }, dispose() {} };
            watchers.push(w);
            return w;
        },
    },
    window: {},
    commands: {},
    Disposable: { from() {} },
};

const load = Module._load;
Module._load = function (request, ...rest) {
    if (request === 'vscode') return vscodeStub;
    return load.call(this, request, ...rest);
};

const { CsvEditorProvider } = require('../out/csvEditorProvider.js');

let failures = 0;
async function test(name, fn) {
    try { await fn(); console.log('  ✓ ' + name); }
    catch (e) { failures++; console.error('  ✗ ' + name + '\n      ' + e.message); }
}

// Opens a file in the provider and hands back what a test needs to drive it.
async function open(filePath, text) {
    disk.set(filePath, text);
    watchers.length = 0;
    const context = { extensionUri: { fsPath: '/ext' }, globalState: { get: (_k, d) => d, update() {} } };
    const provider = new CsvEditorProvider(context);
    const uri = vscodeStub.Uri.file(filePath);
    const doc = await provider.openCustomDocument(uri, {}, {});
    const posted = [];
    let onMessage = null;
    const panel = {
        webview: {
            options: null, html: '', cspSource: 'stub',
            asWebviewUri: u => u,
            postMessage: m => { posted.push(m); return Promise.resolve(true); },
            onDidReceiveMessage: f => { onMessage = f; },
        },
        onDidDispose() {},
    };
    await provider.resolveCustomEditor(doc, panel, {});
    const watcher = watchers[watchers.length - 1];
    return {
        provider, doc, posted, uri,
        edit: text => onMessage({ type: 'edit', text }),
        save: () => provider.saveCustomDocument(doc, {}),
        // The watcher's listeners fire and forget, so give the read a moment.
        fireWatcher: async () => { for (const f of watcher.change) f(); await new Promise(r => setTimeout(r, 20)); },
        updates: () => posted.filter(m => m.type === 'update'),
    };
}

async function main() {
    console.log('auto-save does not roll back the newest edit');

    await test('the echo of a save that an edit has since overtaken is ignored', async () => {
        const t = await open('/data/grow.csv', 'Name\n');
        await t.edit('Name,');        // Add column
        await t.save();               // auto-save writes "Name,"
        await t.edit('Name,,');       // Add column again, before the watcher reports the save
        await t.fireWatcher();        // the save's echo arrives
        assert.strictEqual(t.updates().length, 0,
            'the grid was told to reload "' + (t.updates()[0] || {}).text + '", rolling back the newest edit');
        assert.strictEqual(t.doc.content, 'Name,,', 'the editor lost the newest edit');
    });

    await test('a header of blank names is not wiped by its own save', async () => {
        const t = await open('/data/blank.csv', '');
        await t.edit(',,,');
        await t.save();
        await t.edit(',,,,');
        await t.fireWatcher();
        assert.strictEqual(t.updates().length, 0, 'reloaded on the echo of our own save');
        assert.strictEqual(t.doc.content, ',,,,');
    });

    await test('a real change from outside still reloads the grid', async () => {
        const t = await open('/data/outside.csv', 'a,b\n1,2\n');
        await t.edit('a,b\n1,2\n3,4');
        await t.save();
        disk.set('/data/outside.csv', 'a,b\n9,9\n');   // another program rewrites the file
        await t.fireWatcher();
        assert.strictEqual(t.updates().length, 1, 'an outside change no longer reaches the grid');
        assert.strictEqual(t.updates()[0].text, 'a,b\n9,9\n');
        assert.strictEqual(t.doc.content, 'a,b\n9,9\n');
    });

    await test('after an outside change, the next echo of it is ignored too', async () => {
        const t = await open('/data/twice.csv', 'a\n1\n');
        disk.set('/data/twice.csv', 'a\n2\n');
        await t.fireWatcher();                          // applied
        await t.edit('a\n2\n3');                         // user keeps working
        await t.fireWatcher();                          // a late second event for the same write
        assert.strictEqual(t.updates().length, 1, 'the same outside write was applied twice, over the new edit');
        assert.strictEqual(t.doc.content, 'a\n2\n3');
    });

    await test('Reload from Disk still loads the disk over unsaved edits', async () => {
        // The command is the explicit "give me what is on disk" (issue #25). It
        // shares the reload path, so it must not inherit the watcher's patience.
        const t = await open('/data/manual.csv', 'a\n1\n');
        await t.edit('a\n1\n2');
        const reload = t.provider._reloaders.get(t.uri.toString());
        const changed = await reload();
        assert.strictEqual(changed, true, 'the command reported "already up to date" with unsaved edits on screen');
        assert.strictEqual(t.doc.content, 'a\n1\n');
    });

    await test('an edit with CRLF is saved as it came and its echo is ignored', async () => {
        // The grid sends the file back with the line endings it was opened
        // with. The save has to write them unchanged. Otherwise the watcher
        // would take the echo of that save for an outside change.
        const t = await open('/data/crlf.csv', 'a,b\r\n1,2\r\n');
        await t.edit('a,b\r\n1,3\r\n');
        await t.save();
        assert.strictEqual(disk.get('/data/crlf.csv'), 'a,b\r\n1,3\r\n', 'the save changed the text');
        await t.fireWatcher();
        assert.strictEqual(t.updates().length, 0, 'reloaded on the echo of our own save');
        assert.strictEqual(t.doc.content, 'a,b\r\n1,3\r\n');
    });

    if (failures) { console.error(`\n${failures} test(s) failed`); process.exit(1); }
    console.log('\nAll auto-save echo tests passed.');
}

main();
