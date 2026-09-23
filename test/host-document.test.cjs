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
// - A save that fails (the file is locked or read-only). The provider took
//   the unsaved edits for what the disk holds, so the next outside change or
//   change event replaced them without a word.
// - A file in Windows-1252 (Excel's plain "CSV") or in UTF-16. It was read
//   as UTF-8, every umlaut became U+FFFD and the first save wrote that over
//   the whole file.
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
// What the last size question offered.
let offered = null;
// Lets a test pretend a small file is a large one, so the preview modes can be
// reached without writing 50 MB to disk.
let fakeSize = null;
// The next write fails the way a file Excel holds open does on Windows.
let failNextWrite = false;
// Runs inside the next write, before it lands or fails, so a test can make
// something happen while a save is still on its way to the disk.
let duringNextWrite = null;

class EventEmitter {
    constructor() { this.listeners = []; this.event = l => { this.listeners.push(l); return { dispose() {} }; }; }
    fire(e) { for (const l of this.listeners) l(e); }
    dispose() {}
}

const uriFile = p => ({ scheme: 'file', fsPath: p, toString: () => 'file://' + p });
// The HEAD side of a Source Control diff: the git extension keeps the working
// file's path and puts the ref in the query, so its fsPath is the working file.
// VS Code reads it through the git extension, which serves the committed text
// kept here.
const gitBlobs = new Map();
const uriGit = p => ({ scheme: 'git', fsPath: p, toString: () => 'git:' + p + '?%7B%22ref%22%3A%22~%22%7D' });
const readUri = uri => uri.scheme === 'git' ? gitBlobs.get(uri.fsPath) : fs.readFileSync(uri.fsPath);

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
            stat: async uri => ({ size: fakeSize ?? readUri(uri).length }),
            readFile: async uri => new Uint8Array(readUri(uri)),
            writeFile: async (uri, bytes) => {
                if (duringNextWrite) {
                    const during = duringNextWrite;
                    duringNextWrite = null;
                    await during();
                }
                if (failNextWrite) {
                    failNextWrite = false;
                    throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' });
                }
                fs.writeFileSync(uri.fsPath, bytes);
            },
            copy: async (from, to) => fs.copyFileSync(from.fsPath, to.fsPath),
            delete: async uri => fs.rmSync(uri.fsPath, { force: true }),
        },
        createFileSystemWatcher: () => {
            const w = {
                change: [], create: [], disposed: false,
                onDidChange(f) { this.change.push(f); }, onDidCreate(f) { this.create.push(f); },
                dispose() { this.disposed = true; },
            };
            watchers.push(w);
            return w;
        },
    },
    window: {
        showQuickPick: async items => {
            offered = items.map(i => i.id);
            return items.find(i => i.id === quickPickChoice);
        },
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

// VS Code's tabs, as far as the provider looks at them: one editor group with
// a tab for each file open() opens. An edit marks a tab unsaved the way VS
// Code marks it on a content change event. Only a save or a revert takes the
// mark off again.
class TabInputCustom { constructor(uri, viewType) { this.uri = uri; this.viewType = viewType; } }
const group = { tabs: [], activeTab: null, viewColumn: 1, isActive: true };
vscodeStub.TabInputCustom = TabInputCustom;
vscodeStub.window.tabGroups = {
    all: [group], activeTabGroup: group,
    close: async tab => {
        group.tabs.splice(group.tabs.indexOf(tab), 1);
        if (group.activeTab === tab) group.activeTab = group.tabs[group.tabs.length - 1] || null;
        return true;
    },
};
// Lets a test pretend VS Code could not bring a tab to the front.
let openWithFails = false;
vscodeStub.commands.executeCommand = async (id, ...args) => {
    if (id === 'vscode.openWith') {
        const [uri, viewType] = args;
        let tab = group.tabs.find(t => t.input && t.input.uri.toString() === uri.toString() && t.input.viewType === viewType);
        // A document that only a Source Control diff shows opens in a tab of
        // its own. The two tabs share the document, so its unsaved mark and
        // its revert.
        const diff = group.tabs.find(t => !t.input && t.uri.toString() === uri.toString());
        if (!tab && diff && !openWithFails) {
            tab = {
                input: new TabInputCustom(uri, viewType), group, isActive: true, revert: diff.revert,
                get isDirty() { return diff.isDirty; }, set isDirty(v) { diff.isDirty = v; },
            };
            group.tabs.push(tab);
        }
        if (tab && !openWithFails) group.activeTab = tab;
    } else if (id === 'workbench.action.files.revert') {
        // File > Revert File reverts the active editor if it has unsaved
        // edits. VS Code drops it for any other.
        const tab = group.activeTab;
        if (tab && tab.isDirty) {
            tab.isDirty = false;
            await tab.revert();
        }
    }
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
    failNextWrite = false;
    duringNextWrite = null;
    openWithFails = false;
    group.tabs.length = 0;
    group.activeTab = null;
    try { await fn(); console.log('  ✓ ' + name); }
    catch (e) { failures++; console.error('  ✗ ' + name + '\n      ' + e.message); }
}

function file(name, content) {
    const p = path.join(tmpDir, name);
    fs.writeFileSync(p, content);
    return p;
}

// Shows `doc` in one more editor panel and hands back what a test needs to
// drive that panel.
async function attach(provider, doc) {
    const posted = [];
    const disposeListeners = [];
    let onMessage = null;
    const panel = {
        webview: {
            options: null, html: '', cspSource: 'stub',
            asWebviewUri: u => u,
            postMessage: m => { posted.push(m); return Promise.resolve(true); },
            onDidReceiveMessage: f => { onMessage = f; },
        },
        onDidDispose(f) { disposeListeners.push(f); },
        // In the one editor group, in front.
        visible: true, viewColumn: 1,
    };
    await provider.resolveCustomEditor(doc, panel, {});
    return {
        posted,
        ready: () => onMessage({ type: 'ready' }),
        edit: text => onMessage({ type: 'edit', text }),
        updates: () => posted.filter(m => m.type === 'update'),
        close: () => { for (const f of disposeListeners) f(); },
    };
}

// Opens a file in the provider and hands back what a test needs to drive it.
async function open(filePath, openContext = {}, uri = uriFile(filePath)) {
    const context = { extensionUri: uriFile('/ext'), globalState: { get: (_k, d) => d, update() {} } };
    const provider = new CsvEditorProvider(context);
    const doc = await provider.openCustomDocument(uri, openContext, {});
    const tab = {
        input: new TabInputCustom(uri, 'csvViewer.grid'), group, isActive: true, isDirty: false,
        revert: () => provider.revertCustomDocument(doc, {}),
    };
    provider.onDidChangeCustomDocument(e => { if (e.document === doc) tab.isDirty = true; });
    group.tabs.push(tab);
    group.activeTab = tab;
    // The watchers made for this file, see fireWatcher.
    const own = [];
    const watched = async fn => {
        const before = watchers.length;
        const result = await fn();
        own.push(...watchers.slice(before));
        return result;
    };
    const editor = await watched(() => attach(provider, doc));
    return {
        ...editor, provider, doc, uri, tab, watchers: own,
        save: async () => {
            await provider.saveCustomDocument(doc, {});
            tab.isDirty = false;
        },
        saveAs: dest => provider.saveCustomDocumentAs(doc, uriFile(dest), {}),
        backup: dest => provider.backupCustomDocument(doc, { destination: uriFile(dest) }, {}),
        // A second editor on the same document, which VS Code opens for the
        // modified side of a Source Control diff while the grid tab is open.
        openSecondEditor: () => watched(() => attach(provider, doc)),
        // The watchers' listeners fire and forget, so give the read a moment.
        fireWatcher: async () => {
            for (const w of own) if (!w.disposed) for (const f of w.change) f();
            await new Promise(r => setTimeout(r, 20));
        },
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
        assert.strictEqual(await after.provider.reload(after.doc), true, 'Reload from Disk thought the restored edits were the file');
        assert.strictEqual(after.doc.content, 'h\nold\n');
    });

    // A program that changes the file while VS Code is closed (a git pull, an
    // export run overnight) changes what the restored edits were made on.
    // The restore took the new file for the one the edits knew, so nothing
    // warned and the next save wrote over the change without a word.
    await test('a file changed while VS Code was closed is reported on restore', async () => {
        const p = file('hot-changed.csv', 'id,val\n1,a\n2,b\n');
        const before = await open(p);
        await before.edit('id,val\n1,MY EDIT\n2,b\n');
        const backup = await before.backup(path.join(tmpDir, 'hot-changed.backup'));
        before.close();
        group.tabs.splice(group.tabs.indexOf(before.tab), 1);   // VS Code quits
        fs.writeFileSync(p, 'id,val\n1,a\n2,b\n3,TEAMMATE ROW\n');
        const after = await open(p, { backupId: backup.id });
        assert.strictEqual(after.doc.content, 'id,val\n1,MY EDIT\n2,b\n', 'the restore lost the unsaved edits');
        assert.deepStrictEqual(warnings.map(w => w.msg),
            ['hot-changed.csv changed on disk. Your unsaved edits in the grid were kept.'], 'the change was not reported');
        assert.ok(warnings[0].actions.includes('Reload from Disk'), 'the warning offers no way to load the disk');
        await after.fireWatcher();                      // a late event for the same change
        assert.strictEqual(warnings.length, 1, 'the same change was reported twice');
        after.tab.isDirty = true;                       // VS Code marks a restored backup unsaved
        warnings[0].pick('Reload from Disk');
        await tick();
        assert.strictEqual(after.doc.content, 'id,val\n1,a\n2,b\n3,TEAMMATE ROW\n', 'the action did not load the disk');
        assert.strictEqual(after.tab.isDirty, false, 'the tab is still marked unsaved');
    });

    await test('a restore of a file nobody changed says nothing', async () => {
        const p = file('hot-same.csv', 'id,val\n1,a\n');
        const before = await open(p);
        await before.edit('id,val\n1,MINE\n');
        const backup = await before.backup(path.join(tmpDir, 'hot-same.backup'));
        before.close();
        const after = await open(p, { backupId: backup.id });
        assert.deepStrictEqual(warnings.map(w => w.msg), []);
        await after.save();
        assert.strictEqual(fs.readFileSync(p, 'utf8'), 'id,val\n1,MINE\n');
    });

    await test('a restore says nothing when the file changed to the very edits', async () => {
        const p = file('hot-same-edit.csv', 'id,val\n1,a\n');
        const before = await open(p);
        await before.edit('id,val\n1,SAME\n');
        const backup = await before.backup(path.join(tmpDir, 'hot-same-edit.backup'));
        before.close();
        fs.writeFileSync(p, 'id,val\n1,SAME\n');      // a teammate made the same edit
        await open(p, { backupId: backup.id });
        assert.deepStrictEqual(warnings.map(w => w.msg), [], 'the file holds the edits, nothing of them was kept');
    });

    // The disk the edits were made on is the one the document last knew:
    // the file as it was opened or an outside change it has since heard of.
    await test('a restore compares with the outside change the document already knew', async () => {
        const p = file('hot-known.csv', 'h\n1\n');
        const before = await open(p);
        await before.edit('h\nmine\n');
        fs.writeFileSync(p, 'h\ntheirs\n');
        await before.fireWatcher();
        assert.strictEqual(warnings.length, 1, 'the test did not reach the warning');
        const backup = await before.backup(path.join(tmpDir, 'hot-known.backup'));
        before.close();
        warnings.length = 0;
        const after = await open(p, { backupId: backup.id });
        assert.deepStrictEqual(warnings.map(w => w.msg), [], 'a change already reported was reported again');
        assert.strictEqual(after.doc.content, 'h\nmine\n');
    });

    // UTF-16 can hold a lone surrogate and a save keeps it. The backup was
    // written as UTF-8, which turns it into U+FFFD.
    await test('a hot exit backup of a UTF-16 file keeps a lone surrogate', async () => {
        const p = file('hot-utf16.csv', Buffer.from([0xFF, 0xFE, 0x68, 0x00, 0x0A, 0x00, 0x00, 0xD8, 0x0A, 0x00]));
        const before = await open(p);
        assert.strictEqual(before.doc.content, 'h\n\uD800\n');
        await before.edit('h\n\uD800\nX\n');
        const backup = await before.backup(path.join(tmpDir, 'hot-utf16.backup'));
        const after = await open(p, { backupId: backup.id });
        assert.strictEqual(after.doc.content, 'h\n\uD800\nX\n', 'restored ' + JSON.stringify(after.doc.content));
        await after.save();
        assert.strictEqual(fs.readFileSync(p).toString('hex'), 'fffe68000a0000d80a0058000a00');
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

    // A preview is read-only, so it has nothing to revert. Reading the whole
    // file there and handing it to the grid would be exactly the load the
    // preview was chosen to avoid.
    for (const mode of ['head', 'tail', 'chunked', 'plaintext']) {
        await test(`Revert File leaves a ${mode} preview as it is`, async () => {
            const text = 'id,name\n' + Array.from({ length: 1500 }, (_, i) => `${i},row ${i}`).join('\n') + '\n';
            const p = file(`revert-${mode}.csv`, text);
            fakeSize = 60 * 1024 * 1024;
            quickPickChoice = mode;
            const t = await open(p);
            assert.strictEqual(t.doc.isPreview, true, 'the test did not reach the preview');
            const before = t.doc.content;
            await t.provider.revertCustomDocument(t.doc, {});
            assert.strictEqual(t.doc.content.length, before.length,
                `revert changed the preview from ${before.length} to ${t.doc.content.length} characters`);
            assert.strictEqual(t.updates().length, 0, 'revert sent the grid a new text');
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

    // Loading the disk under unsaved edits left the tab marked unsaved,
    // although the grid now showed exactly the file. Closing it asked to
    // save and hot exit kept it as unsaved. Only a save or a revert takes
    // that mark off.
    await test('Reload from Disk on the warning takes the unsaved mark off the tab', async () => {
        const p = file('dirty-mark.csv', 'h\n1\n');
        const t = await open(p);
        await t.edit('h\nmine\n');
        assert.strictEqual(t.tab.isDirty, true, 'the test did not reach a tab with unsaved edits');
        fs.writeFileSync(p, 'h\ntheirs\n');
        await t.fireWatcher();
        warnings[0].pick('Reload from Disk');
        await tick();
        assert.strictEqual(t.doc.content, 'h\ntheirs\n', 'the action did not load the disk');
        assert.deepStrictEqual(t.updates().map(m => m.text), ['h\ntheirs\n']);
        assert.strictEqual(t.tab.isDirty, false, 'the tab is still marked unsaved');
    });

    await test('the Reload from Disk command takes the unsaved mark off the tab', async () => {
        const p = file('dirty-mark-command.csv', 'h\n1\n');
        const t = await open(p);
        await t.edit('h\nmine\n');
        fs.writeFileSync(p, 'h\ntheirs\n');
        await t.provider.reloadActiveFromDisk();
        await tick();
        assert.strictEqual(t.doc.content, 'h\ntheirs\n', 'the command did not load the disk');
        assert.deepStrictEqual(t.updates().map(m => m.text), ['h\ntheirs\n']);
        assert.strictEqual(t.tab.isDirty, false, 'the tab is still marked unsaved');
    });

    // File > Revert File works on the editor in front. Run with another tab
    // in front, it would throw away that tab's unsaved edits.
    await test('Reload from Disk on the warning of a tab behind another reverts only its own tab', async () => {
        const p = file('dirty-behind.csv', 'h\n1\n');
        const t = await open(p);
        await t.edit('h\nmine\n');
        const front = await open(file('dirty-front.csv', 'x\n1\n'));
        await front.edit('x\nFRONT UNSAVED\n');
        fs.writeFileSync(p, 'h\ntheirs\n');
        await t.fireWatcher();
        warnings[0].pick('Reload from Disk');
        await tick();
        assert.strictEqual(front.doc.content, 'x\nFRONT UNSAVED\n', 'the tab in front lost its unsaved edits');
        assert.strictEqual(front.tab.isDirty, true);
        assert.strictEqual(t.doc.content, 'h\ntheirs\n', 'the action did not load the disk');
        assert.strictEqual(t.tab.isDirty, false, 'the tab is still marked unsaved');
    });

    await test('Reload from Disk reverts no other tab when its own cannot come to the front', async () => {
        const p = file('dirty-stuck.csv', 'h\n1\n');
        const t = await open(p);
        await t.edit('h\nmine\n');
        const front = await open(file('dirty-stuck-front.csv', 'x\n1\n'));
        await front.edit('x\nFRONT UNSAVED\n');
        fs.writeFileSync(p, 'h\ntheirs\n');
        await t.fireWatcher();
        openWithFails = true;
        warnings[0].pick('Reload from Disk');
        await tick();
        assert.strictEqual(front.doc.content, 'x\nFRONT UNSAVED\n', 'the tab in front lost its unsaved edits');
        assert.strictEqual(front.tab.isDirty, true);
        assert.strictEqual(t.doc.content, 'h\ntheirs\n', 'the action did not load the disk');
    });

    // Only the Source Control diff shows the file, no grid tab of its own.
    // VS Code tells an extension nothing about such a tab: its input is
    // unknown. Reload from Disk loaded the file but left the diff marked
    // unsaved. The command refused to work there at all.
    const diffOnly = async name => {
        const p = file(name, 'h\n1\n');
        const t = await open(p);
        t.tab.input = undefined;
        t.tab.uri = t.uri;
        await t.edit('h\nmine\n');
        assert.strictEqual(t.tab.isDirty, true, 'the test did not reach a diff with unsaved edits');
        fs.writeFileSync(p, 'h\ntheirs\n');
        return t;
    };

    await test('Reload from Disk on the warning takes the unsaved mark off a diff with no grid tab', async () => {
        const t = await diffOnly('diff-only.csv');
        await t.fireWatcher();
        warnings[0].pick('Reload from Disk');
        await tick();
        assert.strictEqual(t.doc.content, 'h\ntheirs\n', 'the action did not load the disk');
        assert.deepStrictEqual(t.updates().map(m => m.text), ['h\ntheirs\n']);
        assert.strictEqual(t.tab.isDirty, false, 'the diff is still marked unsaved');
        assert.deepStrictEqual(group.tabs, [t.tab], 'the tab opened for the revert is still open');
        assert.strictEqual(group.activeTab, t.tab, 'the diff is not in front again');
    });

    await test('the Reload from Disk command works on a diff with no grid tab', async () => {
        const t = await diffOnly('diff-only-command.csv');
        await t.provider.reloadActiveFromDisk();
        await tick();
        assert.deepStrictEqual(warnings.map(w => w.msg), [], 'the command refused the diff');
        assert.strictEqual(t.doc.content, 'h\ntheirs\n', 'the command did not load the disk');
        assert.strictEqual(t.tab.isDirty, false, 'the diff is still marked unsaved');
        assert.deepStrictEqual(group.tabs, [t.tab], 'the tab opened for the revert is still open');
    });

    // File > Revert File does nothing on a tab not marked unsaved. Reload
    // from Disk went on to report the file loaded and the grid kept the edits.
    await test('Reload from Disk on a diff not marked unsaved still loads the file', async () => {
        const t = await diffOnly('diff-only-clean.csv');
        await t.fireWatcher();
        t.tab.isDirty = false;
        warnings[0].pick('Reload from Disk');
        await tick();
        assert.strictEqual(t.doc.content, 'h\ntheirs\n', 'the action did not load the disk');
        assert.deepStrictEqual(t.updates().map(m => m.text), ['h\ntheirs\n']);
        assert.deepStrictEqual(group.tabs, [t.tab], 'the tab opened for the revert is still open');
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

    await test('an outside change after a failed save does not replace the edits', async () => {
        const p = file('locked.csv', 'h\n1\n');
        const t = await open(p);
        await t.edit('h\nMY EDIT\n');
        failNextWrite = true;
        await assert.rejects(t.save(), /EBUSY/, 'the failed write did not reach VS Code');
        fs.writeFileSync(p, 'h\nEXCEL\n');
        await t.fireWatcher();
        assert.strictEqual(t.doc.content, 'h\nMY EDIT\n', 'the outside change replaced the unsaved edit');
        assert.strictEqual(t.updates().length, 0, 'the grid was reloaded over the unsaved edit');
        assert.strictEqual(warnings.length, 1, 'the user was not told the file changed on disk');
    });

    await test('an outside change while a failing save is on its way keeps the edits', async () => {
        // The save used to record its text as the disk's before the write. An
        // outside change arriving meanwhile then found nothing unsaved and
        // loaded over the edits, and the failed write could not bring them back.
        const p = file('locked-race.csv', 'h\n1\n');
        const t = await open(p);
        await t.edit('h\nMY EDIT\n');
        failNextWrite = true;
        duringNextWrite = async () => {
            fs.writeFileSync(p, 'h\nEXCEL\n');
            await t.fireWatcher();
        };
        await assert.rejects(t.save(), /EBUSY/);
        assert.strictEqual(t.doc.content, 'h\nMY EDIT\n', 'the outside change replaced the unsaved edit');
        assert.strictEqual(t.updates().length, 0, 'the grid was reloaded over the unsaved edit');
        assert.strictEqual(warnings.length, 1, 'the user was not told the file changed on disk');
        await t.fireWatcher();                          // a second event for the same change
        assert.strictEqual(t.doc.content, 'h\nMY EDIT\n');
        assert.strictEqual(warnings.length, 1, 'the same change was reported twice');
    });

    await test('the echo of a save still being written is not taken for an outside change', async () => {
        const p = file('slow-save.csv', 'h\n1\n');
        const t = await open(p);
        await t.edit('h\nmine\n');
        duringNextWrite = async () => {
            fs.writeFileSync(p, 'h\nmine\n');         // the bytes land, the call has not returned yet
            await t.fireWatcher();
        };
        await t.save();
        assert.strictEqual(t.updates().length, 0, 'the grid reloaded on its own save');
        assert.strictEqual(warnings.length, 0, 'its own save was reported as an outside change');
        await t.fireWatcher();                          // the echo once more, after the save
        assert.strictEqual(t.updates().length, 0);
    });

    await test('a change event after a failed save leaves the edits alone', async () => {
        const p = file('locked-event.csv', 'h\n1\n');
        const t = await open(p);
        await t.edit('h\nMY EDIT\n');
        failNextWrite = true;
        await assert.rejects(t.save(), /EBUSY/);
        await t.fireWatcher();                          // the file itself did not change
        assert.strictEqual(t.doc.content, 'h\nMY EDIT\n', 'the grid went back to the old disk text');
        assert.strictEqual(t.updates().length, 0);
    });

    // A Source Control diff of the file opens a second editor on the same
    // document next to the grid tab. Each editor used to keep its own watcher
    // and the provider kept only the last editor per file.
    await test('an outside change reaches every editor of the file', async () => {
        const p = file('two-editors.csv', 'a\n1\n');
        const t = await open(p);
        const diff = await t.openSecondEditor();
        fs.writeFileSync(p, 'a\n2\n');
        await t.fireWatcher();
        assert.deepStrictEqual(t.updates().map(m => m.text), ['a\n2\n'], 'the grid tab kept the old text');
        assert.deepStrictEqual(diff.updates().map(m => m.text), ['a\n2\n'], 'the diff kept the old text');
    });

    await test('Revert File reaches every editor of the file', async () => {
        const p = file('two-editors-revert.csv', 'a\n1\n');
        const t = await open(p);
        const diff = await t.openSecondEditor();
        await t.edit('a\nEDIT\n');
        await t.provider.revertCustomDocument(t.doc, {});
        const last = editor => (editor.updates().slice(-1)[0] || {}).text;
        assert.strictEqual(last(t), 'a\n1\n', 'the grid tab still shows the reverted edit');
        assert.strictEqual(last(diff), 'a\n1\n', 'the diff still shows the reverted edit');
    });

    await test('closing one editor leaves the other one working', async () => {
        const p = file('two-editors-close.csv', 'a\n1\n');
        const t = await open(p);
        const diff = await t.openSecondEditor();
        diff.close();
        await t.edit('a\nEDIT\n');
        await t.provider.revertCustomDocument(t.doc, {});
        assert.deepStrictEqual(t.updates().map(m => m.text), ['a\n1\n'], 'Revert File no longer reached the grid tab');
        fs.writeFileSync(p, 'a\n2\n');
        await t.fireWatcher();
        assert.deepStrictEqual(t.updates().map(m => m.text), ['a\n1\n', 'a\n2\n'], 'an outside change no longer reached the grid tab');
        fs.writeFileSync(p, 'a\n3\n');
        await t.provider.reloadActiveFromDisk();
        assert.deepStrictEqual(warnings.map(w => w.msg), [], 'Reload from Disk refused an editable grid');
        assert.strictEqual(t.doc.content, 'a\n3\n', 'Reload from Disk did not load the file');
    });

    await test('closing the last editor stops watching the file', async () => {
        const p = file('two-editors-gone.csv', 'a\n1\n');
        const t = await open(p);
        const diff = await t.openSecondEditor();
        diff.close();
        assert.ok(t.watchers.some(w => !w.disposed), 'closing one of two editors stopped the watcher');
        t.close();
        assert.ok(t.watchers.every(w => w.disposed), 'the file is still watched with no editor open');
    });

    await test('an edit in one editor reaches the other', async () => {
        // Each editor sends the whole text with every edit. An editor that
        // missed the other's edit would write its own old text back over it.
        const p = file('two-editors-edit.csv', 'a\n1\n');
        const t = await open(p);
        const diff = await t.openSecondEditor();
        await diff.edit('a\nFROM THE DIFF\n');
        assert.deepStrictEqual(t.updates().map(m => m.text), ['a\nFROM THE DIFF\n'], 'the grid tab missed the edit');
        assert.strictEqual(diff.updates().length, 0, 'the editor that made the edit was sent it back');
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

    // The grid never sees the mark, so a program that only adds or removes it
    // leaves the text as it was. That is still an outside change and not the
    // echo of our own save: the next save has to write the file the way it is
    // on disk now.
    await test('an outside change that only adds the byte order mark is picked up', async () => {
        const p = file('bom-added.csv', 'a,b\n1,2\n');
        const t = await open(p);
        fs.writeFileSync(p, Buffer.concat([BOM, Buffer.from('a,b\n1,2\n')]));
        await t.fireWatcher();
        // The document keeps the mark as part of its encoding, utf8bom.
        assert.strictEqual(t.doc.encoding, 'utf8bom', 'the document missed the new byte order mark');
        assert.strictEqual(t.updates().length, 0, 'the grid was reloaded although its text did not change');
        await t.edit('a,b\n1,3\n');
        await t.save();
        assert.deepStrictEqual([...fs.readFileSync(p).subarray(0, 3)], [...BOM], 'the save dropped the byte order mark');
    });

    await test('an outside change that only removes the byte order mark is picked up', async () => {
        const p = file('bom-removed.csv', EXCEL);
        const t = await open(p);
        fs.writeFileSync(p, EXCEL.subarray(3));
        await t.fireWatcher();
        // utf8 is the encoding without the mark, see above.
        assert.strictEqual(t.doc.encoding, 'utf8', 'the document kept a byte order mark the file no longer has');
        await t.edit('name,city\nJürgen,Köln\nAnna,Wien\n');
        await t.save();
        assert.strictEqual(fs.readFileSync(p, 'utf8'), 'name,city\nJürgen,Köln\nAnna,Wien\n');
    });

    await test('Reload from Disk picks up a byte order mark added outside', async () => {
        const p = file('bom-reload.csv', 'a\n1\n');
        const t = await open(p);
        fs.writeFileSync(p, Buffer.concat([BOM, Buffer.from('a\n1\n')]));
        assert.strictEqual(await t.provider.reload(t.doc), true, 'Reload from Disk said the file was already up to date');
        // The mark is part of the encoding, see above.
        assert.strictEqual(t.doc.encoding, 'utf8bom');
    });

    await test('a byte order mark added outside under unsaved edits warns once and is kept', async () => {
        const p = file('bom-dirty.csv', 'a\n1\n');
        const t = await open(p);
        await t.edit('a\nmine\n');
        fs.writeFileSync(p, Buffer.concat([BOM, Buffer.from('a\n1\n')]));
        await t.fireWatcher();
        await t.fireWatcher();                          // a second event for the same write
        assert.strictEqual(warnings.length, 1, 'one outside write raised ' + warnings.length + ' warnings');
        assert.strictEqual(t.doc.content, 'a\nmine\n', 'the unsaved edit was replaced');
        await t.save();
        assert.ok(fs.readFileSync(p).equals(Buffer.concat([BOM, Buffer.from('a\nmine\n')])),
            'the save did not keep the byte order mark the file now has');
    });

    // Excel's plain "CSV" is written in the Windows code page, Windows-1252 in
    // Western Europe.
    const ANSI_TEXT = 'Name;Stadt\r\nJörg;Köln\r\nAnna;Wien\r\n';
    const ANSI = Buffer.from(ANSI_TEXT, 'latin1');
    const ansi = text => Buffer.from(text, 'latin1');
    const hex = p => fs.readFileSync(p).toString('hex');

    await test('a Windows-1252 file shows its umlauts', async () => {
        const t = await open(file('ansi-read.csv', ANSI));
        assert.strictEqual(t.doc.content, ANSI_TEXT);
    });

    await test('editing one cell of a Windows-1252 file keeps every other byte', async () => {
        const p = file('ansi-save.csv', ANSI);
        const t = await open(p);
        await t.edit('Name;Stadt\r\nJörg;Köln\r\nAnna;Graz\r\n');
        await t.save();
        assert.ok(fs.readFileSync(p).equals(ansi('Name;Stadt\r\nJörg;Köln\r\nAnna;Graz\r\n')), 'saved ' + hex(p));
        await t.fireWatcher();                          // the echo of that save
        assert.strictEqual(t.updates().length, 0, 'the echo of the save was taken for an outside change');
        assert.strictEqual(warnings.length, 0);
    });

    await test('the Windows-1252 characters from 0x80 to 0x9F survive a save', async () => {
        // The euro sign, typographic quotes and dashes plus the five bytes
        // Windows-1252 leaves unassigned.
        const high = Buffer.from(Array.from({ length: 32 }, (_, i) => 0x80 + i));
        const p = file('ansi-high.csv', Buffer.concat([ansi('a;b\r\n'), high, ansi(';x\r\n')]));
        const t = await open(p);
        assert.ok(t.doc.content.includes('\u20AC'), 'the euro sign did not come through');
        await t.edit(t.doc.content.replace(';x', ';y'));
        await t.save();
        assert.ok(fs.readFileSync(p).equals(Buffer.concat([ansi('a;b\r\n'), high, ansi(';y\r\n')])), 'saved ' + hex(p));
    });

    // Plain ASCII reads the same in UTF-8 and Windows-1252. A file without a
    // byte above 0x7F is taken for UTF-8. Once the last umlaut of a
    // Windows-1252 file was edited away, the echo of its save no longer looked
    // like ours. With auto-save the next edit could land before it: the user
    // was told the file changed on disk. Reload from Disk on that warning then
    // threw the newest edit away.
    await test('the echo of a Windows-1252 save without umlauts is ours, whatever edit came after it', async () => {
        const p = file('ansi-ascii-echo.csv', ANSI);
        const t = await open(p);
        await t.edit('Name;Stadt\r\nAnna;Wien\r\n');
        await t.save();
        await t.edit('Name;Stadt\r\nAnna;Graz\r\n');   // auto-save's next edit, before the watcher reports the save
        await t.fireWatcher();                          // the echo of that save
        assert.deepStrictEqual(warnings.map(w => w.msg), [], 'the echo of our own save was taken for an outside change');
        assert.strictEqual(t.updates().length, 0);
        assert.strictEqual(t.doc.content, 'Name;Stadt\r\nAnna;Graz\r\n', 'the newest edit was lost');
    });

    await test('a Windows-1252 file stays Windows-1252 through the echo of a save without umlauts', async () => {
        const p = file('ansi-ascii-stays.csv', ANSI);
        const t = await open(p);
        await t.edit('Name;Stadt\r\nAnna;Wien\r\n');
        await t.save();
        await t.fireWatcher();                          // the echo of that save
        assert.strictEqual(t.doc.encoding, 'windows1252', 'the echo turned the document into UTF-8');
        await t.edit('Name;Stadt\r\nAnna;Wien\r\nJörg;Köln\r\n');
        await t.save();
        assert.ok(fs.readFileSync(p).equals(ansi('Name;Stadt\r\nAnna;Wien\r\nJörg;Köln\r\n')), 'saved ' + hex(p));
    });

    await test('Revert File keeps a Windows-1252 file Windows-1252 when the disk holds no umlaut', async () => {
        const p = file('ansi-ascii-revert.csv', ANSI);
        const t = await open(p);
        await t.edit('Name;Stadt\r\nAnna;Wien\r\n');
        await t.save();
        await t.edit('Name;Stadt\r\nAnna;Graz\r\n');
        await t.provider.revertCustomDocument(t.doc, {});
        assert.strictEqual(t.doc.content, 'Name;Stadt\r\nAnna;Wien\r\n');
        assert.strictEqual(t.doc.encoding, 'windows1252', 'the revert turned the document into UTF-8');
    });

    // The two bytes of "Ã¶" in Windows-1252 are "ö" in UTF-8. A file left
    // with nothing else above 0x7F reads back as other text than we wrote.
    await test('the echo of a Windows-1252 save that reads as UTF-8 is still ours', async () => {
        const p = file('ansi-mojibake.csv', ansi('Name\r\nJörg\r\nJÃ¶rg\r\n'));
        const t = await open(p);
        await t.edit('Name\r\nJÃ¶rg\r\n');
        await t.save();
        await t.fireWatcher();                          // the echo of that save
        assert.strictEqual(t.updates().length, 0, 'the grid was handed ' + JSON.stringify((t.updates()[0] || {}).text));
        assert.strictEqual(t.doc.content, 'Name\r\nJÃ¶rg\r\n');
        await t.edit('Name\r\nJÃ¶rg\r\nAnna\r\n');
        await t.save();
        await t.edit('Name\r\nJÃ¶rg\r\nAnna\r\nEva\r\n');
        await t.fireWatcher();                          // the echo, after the next edit
        assert.deepStrictEqual(warnings.map(w => w.msg), [], 'the echo of our own save was taken for an outside change');
        assert.strictEqual(t.doc.content, 'Name\r\nJÃ¶rg\r\nAnna\r\nEva\r\n', 'the newest edit was lost');
    });

    await test('Save As writes a Windows-1252 file in Windows-1252', async () => {
        const t = await open(file('ansi-saveas.csv', ANSI));
        const dest = path.join(tmpDir, 'ansi-saveas-copy.csv');
        await t.saveAs(dest);
        assert.ok(fs.readFileSync(dest).equals(ANSI), 'Save As wrote ' + hex(dest));
    });

    // Save As onto the file itself (Ctrl+Shift+S, keep the name, confirm the
    // overwrite) is a save. VS Code keeps the same document open and marks
    // the tab clean. The document went on believing the disk held the text
    // from before, so an outside change was ignored or reported as clashing
    // with unsaved edits the tab did not have.
    await test('Save As onto the file itself counts as a save', async () => {
        const p = file('saveas-self.csv', 'h\nOLD\n');
        const t = await open(p);
        await t.edit('h\nNEW\n');
        await t.saveAs(p);
        t.tab.isDirty = false;
        await t.fireWatcher();                          // the echo of that write
        assert.strictEqual(t.updates().length, 0, 'the echo of the Save As was taken for an outside change');
        fs.writeFileSync(p, 'h\nOLD\n');               // a git checkout
        await t.fireWatcher();
        assert.deepStrictEqual(warnings.map(w => w.msg), [], 'a clean tab was told its unsaved edits were kept');
        assert.deepStrictEqual(t.updates().map(m => m.text), ['h\nOLD\n'], 'the grid kept the text the checkout replaced');
    });

    await test('Save As onto a Windows-1252 file itself that needs UTF-8 says so once', async () => {
        const p = file('saveas-self-ansi.csv', ANSI);
        const t = await open(p);
        const text = 'Name;Stadt\r\nAnna;Łódź\r\n';
        await t.edit(text);
        await t.saveAs(p);
        t.tab.isDirty = false;
        await t.fireWatcher();                          // the echo of that write
        assert.ok(fs.readFileSync(p).equals(Buffer.concat([BOM, Buffer.from(text, 'utf8')])), 'saved ' + hex(p));
        assert.strictEqual(warnings.length, 1, 'warnings: ' + JSON.stringify(warnings.map(w => w.msg)));
        assert.match(warnings[0].msg, /UTF-8/);
        await t.edit(text + 'Eva;Graz\r\n');
        await t.save();
        assert.strictEqual(warnings.length, 1, 'the next save warned again');
    });

    await test('a hot exit backup of a Windows-1252 file restores and saves the same bytes', async () => {
        const p = file('ansi-backup.csv', ANSI);
        const before = await open(p);
        await before.edit('Name;Stadt\r\nJörg;Köln\r\nAnna;Graz\r\n');
        const backup = await before.backup(path.join(tmpDir, 'ansi.backup'));
        const after = await open(p, { backupId: backup.id });
        assert.strictEqual(after.doc.content, 'Name;Stadt\r\nJörg;Köln\r\nAnna;Graz\r\n', 'the restore lost the umlauts');
        await after.save();
        assert.ok(fs.readFileSync(p).equals(ansi('Name;Stadt\r\nJörg;Köln\r\nAnna;Graz\r\n')), 'saved ' + hex(p));
    });

    await test('a restored Windows-1252 document stays Windows-1252 when its edits are plain ASCII', async () => {
        // Nothing in plain ASCII tells Windows-1252 from UTF-8, so the
        // encoding has to come back with the backup rather than be guessed.
        const p = file('ansi-backup-ascii.csv', ANSI);
        const before = await open(p);
        await before.edit('Name;Stadt\r\nAnna;Graz\r\n');
        const backup = await before.backup(path.join(tmpDir, 'ansi-ascii.backup'));
        const after = await open(p, { backupId: backup.id });
        await after.edit('Name;Stadt\r\nAnna;Gräz\r\n');
        await after.save();
        assert.ok(fs.readFileSync(p).equals(ansi('Name;Stadt\r\nAnna;Gräz\r\n')), 'saved ' + hex(p));
    });

    // The restore reads the file the way the document knew it. Plain ASCII
    // reads as UTF-8 on its own, so a Windows-1252 file whose last umlaut was
    // saved away looked changed and turned into UTF-8, which Excel reads as
    // ANSI. The next umlaut came out garbled.
    await test('a restore of a Windows-1252 file that is plain ASCII now says nothing and keeps Windows-1252', async () => {
        const p = file('hot-ansi-ascii.csv', ansi('h\nä\n'));
        const before = await open(p);
        await before.edit('h\na\n');
        await before.save();
        await before.edit('h\nb\n');
        const backup = await before.backup(path.join(tmpDir, 'hot-ansi-ascii.backup'));
        before.close();
        const after = await open(p, { backupId: backup.id });
        assert.deepStrictEqual(warnings.map(w => w.msg), [], 'the unchanged file was reported as changed');
        assert.strictEqual(after.doc.encoding, 'windows1252');
        await after.edit('h\nö\n');
        await after.save();
        assert.strictEqual(hex(p), ansi('h\nö\n').toString('hex'));
    });

    await test('a restore of a Windows-1252 file changed to other plain ASCII keeps Windows-1252', async () => {
        const p = file('hot-ansi-changed.csv', ansi('h\nä\n'));
        const before = await open(p);
        await before.edit('h\nmine\n');
        const backup = await before.backup(path.join(tmpDir, 'hot-ansi-changed.backup'));
        before.close();
        fs.writeFileSync(p, 'h\ntheirs\n');
        const after = await open(p, { backupId: backup.id });
        assert.strictEqual(warnings.length, 1, 'the change was not reported');
        await after.edit('h\nö\n');
        await after.save();
        assert.strictEqual(hex(p), ansi('h\nö\n').toString('hex'), 'the file turned into UTF-8');
    });

    // A save writes the file the way it is now, so a byte order mark another
    // program added while VS Code was closed stays.
    await test('a restore takes the encoding the file was given while VS Code was closed', async () => {
        const p = file('hot-new-bom.csv', 'h\n1\n');
        const before = await open(p);
        await before.edit('h\nmine\n');
        const backup = await before.backup(path.join(tmpDir, 'hot-new-bom.backup'));
        before.close();
        fs.writeFileSync(p, Buffer.concat([BOM, Buffer.from('h\n1\n')]));
        const after = await open(p, { backupId: backup.id });
        await after.save();
        assert.strictEqual(hex(p), Buffer.concat([BOM, Buffer.from('h\nmine\n')]).toString('hex'));
    });

    // A U+FEFF typed in front of the first header name of a UTF-8 file. A
    // save writes it as the bytes of a byte order mark and the file reads back
    // as UTF-8 with the mark, without that character. The restore took that
    // for a change nobody made and for the file's new encoding, so the next
    // save wrote the mark twice.
    await test('a restore of a UTF-8 file whose text starts with U+FEFF says nothing', async () => {
        const p = file('hot-feff.csv', 'h,v\n1,a\n');
        const before = await open(p);
        await before.edit('﻿h,v\n1,a\n');
        await before.save();
        await before.edit('﻿h,v\n1,b\n');
        const backup = await before.backup(path.join(tmpDir, 'hot-feff.backup'));
        before.close();
        const after = await open(p, { backupId: backup.id });
        assert.deepStrictEqual(warnings.map(w => w.msg), [], 'the unchanged file was reported as changed');
        await after.save();
        assert.strictEqual(hex(p), Buffer.concat([BOM, Buffer.from('h,v\n1,b\n')]).toString('hex'));
    });

    // The fingerprint of the file for the hot exit backup was kept together
    // with the text it was taken of. After a save that was the only copy of
    // what the file held before. It stayed in memory until the next edit: as
    // much again as a large file takes.
    await test('a save keeps no copy of the text the file held before', async () => {
        const p = file('hot-print.csv', 'h\nOLD\n');
        const t = await open(p);
        await t.edit('h\nNEW\n');
        await t.backup(path.join(tmpDir, 'hot-print-1.backup'));
        await t.save();
        const held = [];
        const walk = value => {
            if (typeof value === 'string') held.push(value);
            else if (value && typeof value === 'object') Object.values(value).forEach(walk);
        };
        for (const [key, value] of Object.entries(t.doc)) if (key !== 'panels' && key !== 'watcher') walk(value);
        assert.ok(!held.includes('h\nOLD\n'), 'the document still holds the text from before the save');
        // The fingerprint is taken again, of the saved file.
        await t.edit('h\nNEWER\n');
        const backup = await t.backup(path.join(tmpDir, 'hot-print-2.backup'));
        t.close();
        await open(p, { backupId: backup.id });
        assert.deepStrictEqual(warnings.map(w => w.msg), [], 'the saved file was taken for an outside change');
    });

    const UTF16_TEXT = 'name,city\r\nJürgen,Köln\r\n';
    const UTF16_EDIT = 'name,city\r\nJürgen,Köln\r\nAnna,Wien\r\n';
    const utf16 = (text, bigEndian) => {
        const body = Buffer.from(text, 'utf16le');
        return Buffer.concat([Buffer.from(bigEndian ? [0xFE, 0xFF] : [0xFF, 0xFE]), bigEndian ? body.swap16() : body]);
    };
    for (const [name, bigEndian] of [['LE', false], ['BE', true]]) {
        await test(`a UTF-16 ${name} file keeps its encoding through an edit`, async () => {
            const p = file(`utf16${name}.csv`, utf16(UTF16_TEXT, bigEndian));
            const t = await open(p);
            assert.strictEqual(t.doc.content, UTF16_TEXT, 'the grid did not get the text');
            await t.edit(UTF16_EDIT);
            await t.save();
            assert.ok(fs.readFileSync(p).equals(utf16(UTF16_EDIT, bigEndian)), 'saved ' + hex(p));
        });
    }

    await test('an edit Windows-1252 cannot hold saves the file as UTF-8 and says so', async () => {
        const p = file('ansi-unencodable.csv', ANSI);
        const t = await open(p);
        const text = 'Name;Stadt\r\nJörg;Köln\r\nAnna;Łódź\r\n';
        await t.edit(text);
        await t.save();
        assert.ok(fs.readFileSync(p).equals(Buffer.concat([BOM, Buffer.from(text, 'utf8')])),
            'not saved as UTF-8 with a byte order mark: ' + hex(p));
        assert.strictEqual(warnings.length, 1, 'the user was not told the file is UTF-8 now');
        assert.match(warnings[0].msg, /UTF-8/);
        await t.fireWatcher();                          // the echo of that save
        assert.strictEqual(t.updates().length, 0, 'the echo of the save was taken for an outside change');
        await t.edit(text + 'Eva;Graz\r\n');
        await t.save();
        assert.strictEqual(warnings.length, 1, 'the next save warned again');
        assert.ok(fs.readFileSync(p).equals(Buffer.concat([BOM, Buffer.from(text + 'Eva;Graz\r\n', 'utf8')])));
    });

    await test('Save As of an edit Windows-1252 cannot hold writes UTF-8 and says so', async () => {
        const p = file('ansi-unencodable-saveas.csv', ANSI);
        const t = await open(p);
        const text = 'Name;Stadt\r\nAnna;Łódź\r\n';
        await t.edit(text);
        const dest = path.join(tmpDir, 'ansi-unencodable-copy.csv');
        await t.saveAs(dest);
        assert.ok(fs.readFileSync(dest).equals(Buffer.concat([BOM, Buffer.from(text, 'utf8')])), 'Save As wrote ' + hex(dest));
        assert.strictEqual(warnings.length, 1, 'the user was not told the copy is UTF-8');
    });

    await test('a failed save of an edit Windows-1252 cannot hold changes nothing', async () => {
        const p = file('ansi-unencodable-locked.csv', ANSI);
        const t = await open(p);
        await t.edit('Name;Stadt\r\nAnna;Łódź\r\n');
        failNextWrite = true;
        await assert.rejects(t.save(), /EBUSY/);
        assert.strictEqual(warnings.length, 0, 'the user was told of a save that did not happen');
        assert.strictEqual(t.doc.encoding, 'windows1252', 'the document took the encoding of a save that failed');
        await t.fireWatcher();                          // the file did not change
        assert.strictEqual(warnings.length, 0, 'the untouched file was taken for an outside change');
        assert.ok(fs.readFileSync(p).equals(ANSI));
    });

    await test('an outside change of the encoding alone is picked up', async () => {
        const p = file('ansi-to-utf8.csv', ANSI);
        const t = await open(p);
        fs.writeFileSync(p, Buffer.from(ANSI_TEXT, 'utf8'));
        await t.fireWatcher();
        assert.strictEqual(t.doc.encoding, 'utf8', 'the document missed the new encoding');
        assert.strictEqual(t.updates().length, 0, 'the grid was reloaded although its text did not change');
        await t.edit('Name;Stadt\r\nJörg;Köln\r\nAnna;Graz\r\n');
        await t.save();
        assert.strictEqual(fs.readFileSync(p, 'utf8'), 'Name;Stadt\r\nJörg;Köln\r\nAnna;Graz\r\n');
    });

    // A UTF-8 export with a byte order mark that a legacy tool later added a
    // Windows-1252 line to. It was read whole as Windows-1252: the first
    // header name started with "ï»¿", every umlaut was mojibake and a save
    // that needed UTF-8 wrote all of that into the file.
    const STRAY = Buffer.concat([BOM, Buffer.from('name;city\nMüller;Köln\nSch'), Buffer.from([0xF6]), Buffer.from('n;x\n')]);
    const STRAY_TEXT = 'name;city\nMüller;Köln\nSchön;x\n';

    await test('a stray byte in a UTF-8 file with a byte order mark leaves the rest UTF-8', async () => {
        const p = file('stray.csv', STRAY);
        const t = await open(p);
        assert.strictEqual(t.doc.content, STRAY_TEXT);
        await t.edit('name;city\nMüller;Köln\nSch✓n;x\n');
        await t.save();
        assert.ok(fs.readFileSync(p).equals(Buffer.concat([BOM, Buffer.from('name;city\nMüller;Köln\nSch✓n;x\n')])), 'saved ' + hex(p));
        assert.deepStrictEqual(warnings.map(w => w.msg), [], 'a file that was UTF-8 already was reported as turned into UTF-8');
    });

    await test('a change event on a file with a stray byte that did not change keeps quiet', async () => {
        const p = file('stray-event.csv', STRAY);
        const t = await open(p);
        await t.edit(STRAY_TEXT + 'Eva;Graz\n');
        await t.fireWatcher();                          // nothing was written
        await t.fireWatcher();
        assert.deepStrictEqual(warnings.map(w => w.msg), [], 'the unchanged file was taken for an outside change');
        assert.strictEqual(t.doc.content, STRAY_TEXT + 'Eva;Graz\n');
        await t.provider.revertCustomDocument(t.doc, {});
        assert.strictEqual(await t.provider.reload(t.doc), false, 'Reload from Disk found a change in the unchanged file');
    });

    for (const mode of ['head', 'tail', 'chunked', 'plaintext']) {
        await test(`a stray byte in a UTF-8 file with a byte order mark reads the same in ${mode}`, async () => {
            const rows = Array.from({ length: 1500 }, (_, i) => `${i};Köln ${i}`).join('\n') + '\n';
            const p = file(`stray-${mode}.csv`, Buffer.concat([STRAY, Buffer.from(rows)]));
            fakeSize = 60 * 1024 * 1024;
            quickPickChoice = mode;
            const t = await open(p);
            assert.strictEqual(t.doc.isPreview, true, 'the test did not reach the preview');
            await t.ready();
            const shown = t.posted.find(m => m.type === 'init').text;
            assert.ok(shown.startsWith('name;city\n'), 'the preview starts ' + JSON.stringify(shown.slice(0, 20)));
            assert.ok(shown.includes(';Köln ') && !/Ã|�/.test(shown), 'the umlauts of the UTF-8 rows');
            if (mode !== 'tail') assert.ok(shown.includes('Müller;Köln\nSchön;x\n'), 'the rows around the stray byte');
        });
    }

    // A preview reads only part of the file, so it decides the encoding by
    // the start of it. Plain text reads all of it.
    for (const mode of ['head', 'tail', 'chunked', 'plaintext']) {
        await test(`a Windows-1252 file shows its umlauts in ${mode}`, async () => {
            const text = 'id;city\n' + Array.from({ length: 1500 }, (_, i) => `${i};Köln ${i}`).join('\n') + '\n';
            const p = file(`ansi-${mode}.csv`, ansi(text));
            fakeSize = 60 * 1024 * 1024;
            quickPickChoice = mode;
            const t = await open(p);
            assert.strictEqual(t.doc.isPreview, true, 'the test did not reach the preview');
            await t.ready();
            const shown = t.posted.find(m => m.type === 'init').text;
            assert.ok(shown.includes('Köln'), 'the preview shows ' + JSON.stringify(shown.slice(0, 40)));
            assert.ok(!shown.includes('\uFFFD'), 'the preview holds U+FFFD');
        });
    }

    // The HEAD side of the Source Control diff of a large file. Head, tail,
    // the paged view and plain text read the file's path with Node's fs,
    // which is the working copy, so both sides of the diff showed it.
    await test('the HEAD side of a large file\'s diff shows the committed rows', async () => {
        const rows = value => 'id,v\n' + Array.from({ length: 1500 }, (_, i) => `${i},${value}`).join('\n') + '\n';
        const p = file('diff-head.csv', rows('WORKING COPY'));
        gitBlobs.set(p, Buffer.from(rows('COMMITTED')));
        fakeSize = 60 * 1024 * 1024;
        for (const mode of ['plaintext', 'full']) {
            quickPickChoice = mode;
            const t = await open(p, {}, uriGit(p));
            assert.deepStrictEqual(offered, ['full', 'plaintext'], 'the ways offered to open it');
            await t.ready();
            assert.strictEqual(t.posted.find(m => m.type === 'init').text, rows('COMMITTED'), mode + ' showed another text');
        }
        quickPickChoice = 'head';
        await open(p);
        assert.deepStrictEqual(offered, ['full', 'chunked', 'head', 'tail', 'plaintext'], 'the working file lost a way to open it');
    });

    // A classic Mac file ends its rows with a lone CR. Detection counted the
    // separators of the first line up to an LF, which is the whole file there.
    for (const [eol, name] of [['\n', 'LF'], ['\r\n', 'CRLF'], ['\r\r\n', 'CR CR LF'], ['\r', 'CR']]) {
        await test(`the delimiter is detected from the first line of a ${name} file`, async () => {
            const tags = ['id,tags', '1,"red;green;blue;black"', '2,"red;blue;white"', '3,"green;black;white"'];
            const t = await open(file(`delim-${name.replace(/ /g, '')}.csv`, tags.join(eol) + eol));
            assert.strictEqual(t.doc.delimiter, ',', 'the tags file');
            const prices = ['Preis;Menge', '1,50;2,5', '2,20;1,5', '0,80;3,0'];
            const u = await open(file(`delim-eu-${name.replace(/ /g, '')}.csv`, prices.join(eol) + eol));
            assert.strictEqual(u.doc.delimiter, ';', 'the file with decimal commas');
        });
    }

    // The previews of a large Mac file read it as one record: all of it went
    // to the grid, the banner said "of 0 rows" and the paged view put every
    // row into the header.
    const MAC_TEXT = 'id;name;amount\r' + Array.from({ length: 2500 }, (_, i) => `${i};name ${i};${i * 3}`).join('\r') + '\r';
    for (const mode of ['head', 'tail', 'chunked']) {
        await test(`a Mac file shows its rows in ${mode}`, async () => {
            const p = file(`mac-${mode}.csv`, MAC_TEXT);
            fakeSize = 60 * 1024 * 1024;
            quickPickChoice = mode;
            const t = await open(p);
            assert.strictEqual(t.doc.isPreview, true, 'the test did not reach the preview');
            assert.strictEqual(t.doc.delimiter, ';');
            assert.strictEqual(t.doc.totalLineCount, 2501, 'the rows the banner counts');
            await t.ready();
            const shown = t.posted.find(m => m.type === 'init').text;
            const rows = shown.split('\r').filter(Boolean);
            assert.strictEqual(rows[0], 'id;name;amount');
            assert.strictEqual(rows.length, mode === 'chunked' ? 501 : 1001, 'rows sent to the grid');
            assert.ok(!shown.includes('\n'), 'the text sent has an LF, the grid would glue the rows together');
            if (mode === 'tail') assert.strictEqual(rows[1], '1500;name 1500;4500');
            if (mode === 'chunked') {
                assert.strictEqual(t.posted.find(m => m.type === 'pageData').totalPages, 5);
            }
        });
    }

    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (failures) { console.error(`\n${failures} test(s) failed`); process.exit(1); }
    console.log('\nAll host document tests passed.');
}

main();
