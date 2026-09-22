// Regression guards for how the extension reads, saves and restores a file:
//
// - Hot exit. VS Code backs up unsaved edits on quit and hands the backup back
//   on restart. The provider used to ignore it and read the file from disk, so
//   the tab came back dirty with the old content and the edits were gone.
// - Save As from Show Head, Show Tail or Paged View. Those hold only part of
//   the file (the paged view holds nothing) and Save As wrote exactly that: a
//   truncated or empty copy, without a word.
// - An outside change while the grid holds unsaved edits. The watcher loaded
//   the file over them, the tab stayed dirty and the next save made the loss
//   permanent.
// - A UTF-8 byte order mark. Reading dropped it and saving never wrote it
//   back, so Excel opened the saved file as ANSI and umlauts came out garbled.
//
// This drives the real provider against a stubbed vscode API on top of the
// real file system, in a temp folder.
//
// Run after `tsc -p ./`:  node test/host-document.test.cjs

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csv-grid-host-'));
const BOM = Buffer.from([0xEF, 0xBB, 0xBF]);

const watchers = [];
const warnings = [];
let quickPickChoice = null;
// Lets a test pretend a small file is a large one, so the preview modes can be
// reached without writing 50 MB to disk.
let fakeSize = null;

class EventEmitter {
    constructor() { this.listeners = []; this.event = l => { this.listeners.push(l); return { dispose() {} }; }; }
    fire(e) { for (const l of this.listeners) l(e); }
    dispose() {}
}

const uriFile = p => ({ fsPath: p, toString: () => 'file://' + p });

const vscodeStub = {
    EventEmitter,
    Uri: {
        file: uriFile,
        parse: s => uriFile(s.replace(/^file:\/\//, '')),
        joinPath: (base, ...parts) => uriFile([base.fsPath, ...parts].join('/')),
    },
    RelativePattern: class { constructor(base, pattern) { this.base = base; this.pattern = pattern; } },
    workspace: {
        fs: {
            stat: async uri => ({ size: fakeSize ?? fs.statSync(uri.fsPath).size }),
            readFile: async uri => new Uint8Array(fs.readFileSync(uri.fsPath)),
            writeFile: async (uri, bytes) => fs.writeFileSync(uri.fsPath, bytes),
            copy: async (from, to) => fs.copyFileSync(from.fsPath, to.fsPath),
            delete: async uri => fs.rmSync(uri.fsPath, { force: true }),
        },
        createFileSystemWatcher: () => {
            const w = { change: [], create: [], onDidChange(f) { this.change.push(f); }, onDidCreate(f) { this.create.push(f); }, dispose() {} };
            watchers.push(w);
            return w;
        },
    },
    window: {
        showQuickPick: async items => items.find(i => i.id === quickPickChoice),
        showWarningMessage: (msg, ...actions) => {
            const w = { msg, actions, pick: null };
            warnings.push(w);
            return new Promise(resolve => { w.pick = resolve; });
        },
        setStatusBarMessage() {},
    },
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
    warnings.length = 0;
    fakeSize = null;
    quickPickChoice = null;
    try { await fn(); console.log('  ✓ ' + name); }
    catch (e) { failures++; console.error('  ✗ ' + name + '\n      ' + e.message); }
}

function file(name, content) {
    const p = path.join(tmpDir, name);
    fs.writeFileSync(p, content);
    return p;
}

// Opens a file in the provider and hands back what a test needs to drive it.
async function open(filePath, openContext = {}) {
    watchers.length = 0;
    const context = { extensionUri: uriFile('/ext'), globalState: { get: (_k, d) => d, update() {} } };
    const provider = new CsvEditorProvider(context);
    const uri = uriFile(filePath);
    const doc = await provider.openCustomDocument(uri, openContext, {});
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
        ready: () => onMessage({ type: 'ready' }),
        edit: text => onMessage({ type: 'edit', text }),
        save: () => provider.saveCustomDocument(doc, {}),
        saveAs: dest => provider.saveCustomDocumentAs(doc, uriFile(dest), {}),
        backup: dest => provider.backupCustomDocument(doc, { destination: uriFile(dest) }, {}),
        // The watcher's listeners fire and forget, so give the read a moment.
        fireWatcher: async () => { for (const f of watcher.change) f(); await new Promise(r => setTimeout(r, 20)); },
        updates: () => posted.filter(m => m.type === 'update'),
    };
}

const tick = () => new Promise(r => setTimeout(r, 20));

async function main() {
    console.log('reading, saving and restoring a file');

    await test('hot exit brings the unsaved edits back, not the file on disk', async () => {
        const p = file('hot.csv', 'h\nold\n');
        const before = await open(p);
        await before.edit('h\nUNSAVED EDIT\n');
        const backupPath = path.join(tmpDir, 'hot.backup');
        const backup = await before.backup(backupPath);

        const after = await open(p, { backupId: backup.id });
        assert.strictEqual(after.doc.content, 'h\nUNSAVED EDIT\n', 'the restored tab lost the unsaved edits');
        await after.ready();
        const init = after.posted.find(m => m.type === 'init');
        assert.strictEqual(init && init.text, 'h\nUNSAVED EDIT\n', 'the grid was handed the old disk content');
    });

    await test('a restored backup still knows what the disk holds', async () => {
        // The watcher and Reload from Disk compare against the real file, so
        // the restored edits must not be taken for the file's own text.
        const p = file('hot2.csv', 'h\nold\n');
        const before = await open(p);
        await before.edit('h\nedited\n');
        const backup = await before.backup(path.join(tmpDir, 'hot2.backup'));
        const after = await open(p, { backupId: backup.id });
        const reload = after.provider._reloaders.get(after.uri.toString());
        assert.strictEqual(await reload(), true, 'Reload from Disk thought the restored edits were the file');
        assert.strictEqual(after.doc.content, 'h\nold\n');
    });

    await test('hot exit of a large file skips the size question', async () => {
        const p = file('hot-large.csv', 'h\nold\n');
        const before = await open(p);
        await before.edit('h\nedited\n');
        const backup = await before.backup(path.join(tmpDir, 'hot-large.backup'));
        fakeSize = 60 * 1024 * 1024;
        quickPickChoice = 'head';
        const after = await open(p, { backupId: backup.id });
        assert.strictEqual(after.doc.isPreview, false, 'a backup of an editable document came back as a read-only preview');
        assert.strictEqual(after.doc.content, 'h\nedited\n');
    });

    for (const mode of ['head', 'tail', 'chunked', 'plaintext']) {
        await test(`Save As from ${mode} writes the whole file`, async () => {
            const text = 'id,name\n' + Array.from({ length: 1500 }, (_, i) => `${i},row ${i}`).join('\n') + '\n';
            const p = file(`big-${mode}.csv`, text);
            fakeSize = 60 * 1024 * 1024;
            quickPickChoice = mode;
            const t = await open(p);
            assert.strictEqual(t.doc.isPreview, true, 'the test did not reach the preview');
            const dest = path.join(tmpDir, `copy-${mode}.csv`);
            await t.saveAs(dest);
            const written = fs.readFileSync(dest, 'utf8');
            assert.strictEqual(written.length, text.length,
                `Save As wrote ${written.length} of ${text.length} characters`);
            assert.strictEqual(written, text);
        });
    }

    await test('an outside change does not replace unsaved edits', async () => {
        const p = file('dirty.csv', 'h\n1\n');
        const t = await open(p);
        await t.edit('h\nMY UNSAVED EDIT\n');
        fs.writeFileSync(p, 'h\n1\nexternal\n');
        await t.fireWatcher();
        assert.strictEqual(t.updates().length, 0, 'the grid was reloaded over the unsaved edit');
        assert.strictEqual(t.doc.content, 'h\nMY UNSAVED EDIT\n', 'the unsaved edit was replaced');
        assert.strictEqual(warnings.length, 1, 'the user was not told the file changed on disk');
        assert.ok(warnings[0].actions.includes('Reload from Disk'), 'the warning offers no way to load the disk');
    });

    await test('the same outside change warns only once', async () => {
        const p = file('dirty-twice.csv', 'h\n1\n');
        const t = await open(p);
        await t.edit('h\n2\n');
        fs.writeFileSync(p, 'h\nexternal\n');
        await t.fireWatcher();
        await t.fireWatcher();                          // a second event for the same write
        assert.strictEqual(warnings.length, 1, 'one outside write raised ' + warnings.length + ' warnings');
    });

    await test('Reload from Disk on the warning loads the file', async () => {
        const p = file('dirty-reload.csv', 'h\n1\n');
        const t = await open(p);
        await t.edit('h\nmine\n');
        fs.writeFileSync(p, 'h\ntheirs\n');
        await t.fireWatcher();
        warnings[0].pick('Reload from Disk');
        await tick();
        assert.strictEqual(t.doc.content, 'h\ntheirs\n', 'the action did not load the disk');
        assert.strictEqual(t.updates().length, 1);
        assert.strictEqual(t.updates()[0].text, 'h\ntheirs\n');
    });

    await test('saving after the warning keeps the edits', async () => {
        const p = file('dirty-save.csv', 'h\n1\n');
        const t = await open(p);
        await t.edit('h\nmine\n');
        fs.writeFileSync(p, 'h\ntheirs\n');
        await t.fireWatcher();
        warnings[0].pick(undefined);                    // dismissed
        await t.save();
        await t.fireWatcher();                          // the echo of that save
        assert.strictEqual(fs.readFileSync(p, 'utf8'), 'h\nmine\n');
        assert.strictEqual(t.updates().length, 0);
    });

    await test('an unchanged document still reloads silently', async () => {
        const p = file('clean.csv', 'h\n1\n');
        const t = await open(p);
        fs.writeFileSync(p, 'h\n2\n');
        await t.fireWatcher();
        assert.strictEqual(t.updates().length, 1, 'an outside change no longer reaches a clean grid');
        assert.strictEqual(t.doc.content, 'h\n2\n');
        assert.strictEqual(warnings.length, 0, 'a clean document asked before reloading');
    });

    const EXCEL = Buffer.concat([BOM, Buffer.from('name,city\nJürgen,Köln\n', 'utf8')]);

    await test('the grid never sees the byte order mark', async () => {
        const t = await open(file('bom-read.csv', EXCEL));
        assert.strictEqual(t.doc.content, 'name,city\nJürgen,Köln\n', 'the first header name starts with U+FEFF');
    });

    await test('save keeps the byte order mark', async () => {
        const p = file('bom-save.csv', EXCEL);
        const t = await open(p);
        await t.edit('name,city\nJürgen,Köln\nAnna,Wien\n');
        await t.save();
        assert.deepStrictEqual([...fs.readFileSync(p).subarray(0, 3)], [...BOM], 'the saved file lost its BOM');
        assert.strictEqual(fs.readFileSync(p, 'utf8'), '\ufeffname,city\nJürgen,Köln\nAnna,Wien\n');
    });

    await test('Save As keeps the byte order mark', async () => {
        const t = await open(file('bom-saveas.csv', EXCEL));
        const dest = path.join(tmpDir, 'bom-saveas-copy.csv');
        await t.saveAs(dest);
        assert.ok(fs.readFileSync(dest).equals(EXCEL), 'Save As changed the bytes of an unedited file');
    });

    await test('a hot exit backup keeps the byte order mark through the restore', async () => {
        const p = file('bom-backup.csv', EXCEL);
        const before = await open(p);
        await before.edit('name,city\nJürgen,Köln\nAnna,Wien\n');
        const backup = await before.backup(path.join(tmpDir, 'bom.backup'));
        const after = await open(p, { backupId: backup.id });
        assert.strictEqual(after.doc.content, 'name,city\nJürgen,Köln\nAnna,Wien\n');
        await after.save();
        assert.deepStrictEqual([...fs.readFileSync(p).subarray(0, 3)], [...BOM], 'the restored document lost the BOM');
    });

    await test('a file without a byte order mark does not gain one', async () => {
        const p = file('no-bom.csv', 'a,b\n1,2\n');
        const t = await open(p);
        await t.edit('a,b\n1,3\n');
        await t.save();
        assert.strictEqual(fs.readFileSync(p, 'utf8'), 'a,b\n1,3\n');
    });

    await test('Revert File picks the byte order mark up from the disk', async () => {
        const p = file('bom-revert.csv', 'a\n1\n');
        const t = await open(p);
        fs.writeFileSync(p, Buffer.concat([BOM, Buffer.from('a\n2\n')]));
        await t.provider.revertCustomDocument(t.doc, {});
        await t.edit('a\n3\n');
        await t.save();
        assert.deepStrictEqual([...fs.readFileSync(p).subarray(0, 3)], [...BOM]);
    });

    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (failures) { console.error(`\n${failures} test(s) failed`); process.exit(1); }
    console.log('\nAll host document tests passed.');
}

main();
