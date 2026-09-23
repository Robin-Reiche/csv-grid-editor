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
const errors = [];
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
            // VS Code's copy with overwrite deletes the target first. On a disk
            // that ignores case, big.csv and BIG.csv are one file, so that
            // deletes the source as well. A hard link stands in for the other
            // spelling here: every name of the target's file goes.
            copy: async (from, to, options) => {
                if (options && options.overwrite && fs.existsSync(to.fsPath)) {
                    const { ino } = fs.statSync(to.fsPath);
                    const dir = path.dirname(to.fsPath);
                    for (const name of fs.readdirSync(dir)) {
                        if (fs.statSync(path.join(dir, name)).ino === ino) fs.rmSync(path.join(dir, name));
                    }
                }
                fs.copyFileSync(from.fsPath, to.fsPath);
            },
            delete: async uri => fs.rmSync(uri.fsPath, { force: true }),
        },
        // Came with VS Code 1.86: saves every editor of this file, a text
        // editor of it as well. It forces the save, so a text editor without
        // unsaved edits writes what it holds too. Gives back the URI,
        // undefined when no editor shows it. A save that fails rejects with
        // its error.
        save: async uri => {
            const editors = group.tabs.filter(t => t.save && t.input && t.input.uri.toString() === uri.toString());
            if (!editors.length) return undefined;
            for (const editor of editors) await editor.save();
            return uri;
        },
        // The workspace is the temp folder.
        asRelativePath: uri => {
            const relative = path.relative(tmpDir, uri.fsPath);
            return relative.startsWith('..') ? uri.fsPath : relative.split(path.sep).join('/');
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
        // VS Code shows a notification once: the same message with the same
        // buttons closes the one on screen and takes its place. A closed one
        // can no longer be clicked.
        showWarningMessage: (msg, ...actions) => {
            for (const shown of warnings) {
                if (shown.open && shown.msg === msg && shown.actions.join('\n') === actions.join('\n')) shown.pick(undefined);
            }
            const w = { msg, actions, open: true, pick: null };
            warnings.push(w);
            return new Promise(resolve => {
                w.pick = choice => {
                    if (!w.open) return;
                    w.open = false;
                    resolve(choice);
                };
            });
        },
        setStatusBarMessage() {},
        showErrorMessage: msg => { errors.push(msg); return Promise.resolve(undefined); },
    },
    commands: {},
    Disposable: { from() {} },
    CancellationTokenSource: class { constructor() { this.token = { isCancellationRequested: false }; } },
};

// VS Code's tabs, as far as the provider looks at them: one editor group with
// a tab for each file open() opens. An edit marks a tab unsaved the way VS
// Code marks it on a content change event. Only a save or a revert takes the
// mark off again.
class TabInputCustom { constructor(uri, viewType) { this.uri = uri; this.viewType = viewType; } }
const group = { tabs: [], activeTab: null, viewColumn: 1, isActive: true };
// The group of a floating window (Move Editor into New Window). VS Code
// never makes it the extension's active tab group, not even while that
// window has the focus.
const floating = { tabs: [], activeTab: null, viewColumn: 2, isActive: false };
// The group of the window that has the focus. File > Save and File > Revert
// File act on its active tab. A tab brought to the front in another window
// gets the focus a moment later (focusDelay).
let focusedGroup = group;
let focusDelay = 0;
// Every editor panel, see attach. The panel of the focused group's active
// tab is the active one and its page has the keyboard.
const panels = [];
function settleFocus() {
    const front = focusedGroup.activeTab;
    for (const panel of panels) {
        const active = !!front && front.panel === panel;
        if (panel.active !== active) {
            panel.active = active;
            for (const f of panel.viewStateListeners) f({ webviewPanel: panel });
        }
        if (panel.hasKeyboard !== active) {
            panel.hasKeyboard = active;
            panel.receive({ type: 'focus', value: active });
        }
    }
}
function focus(g) {
    const move = () => { focusedGroup = g; settleFocus(); };
    if (focusDelay) setTimeout(move, focusDelay);
    else move();
}
// The command palette or a notification takes the keyboard from the page.
function blurPages() {
    for (const panel of panels) {
        if (!panel.hasKeyboard) continue;
        panel.hasKeyboard = false;
        panel.receive({ type: 'focus', value: false });
    }
}
// A click on a notification in the main window: that window takes the
// focus, but VS Code keeps the editor it had for the active one.
function clickMainWindow() {
    focusedGroup = group;
    blurPages();
}
const allTabs = () => [...group.tabs, ...floating.tabs];
vscodeStub.TabInputCustom = TabInputCustom;
vscodeStub.window.tabGroups = {
    all: [group, floating], activeTabGroup: group,
    close: async tab => {
        const g = tab.group;
        g.tabs.splice(g.tabs.indexOf(tab), 1);
        if (g.activeTab === tab) g.activeTab = g.tabs[g.tabs.length - 1] || null;
        settleFocus();
        return true;
    },
};
// Lets a test pretend VS Code could not bring a tab to the front.
let openWithFails = false;
// How many times bringing a tab to the front moves only the focus to its
// window, which VS Code does for a tab in a floating window at times.
let windowOnly = 0;
vscodeStub.commands.executeCommand = async (id, ...args) => {
    if (id === 'vscode.openWith') {
        const [uri, viewType, options] = args;
        let tab = allTabs().find(t => t.input && t.input.uri.toString() === uri.toString() && t.input.viewType === viewType);
        // A document that only a Source Control diff shows opens in a tab of
        // its own. The two tabs share the document, so its unsaved mark, its
        // revert and its save.
        const diff = allTabs().find(t => !t.input && t.uri && t.uri.toString() === uri.toString());
        if (!tab && diff && !openWithFails) {
            const into = options && options.viewColumn === floating.viewColumn ? floating : group;
            tab = {
                input: new TabInputCustom(uri, viewType), group: into, isActive: true, revert: diff.revert, save: diff.save,
                panel: diff.panel,
                get isDirty() { return diff.isDirty; }, set isDirty(v) { diff.isDirty = v; },
            };
            into.tabs.push(tab);
        }
        if (tab && !openWithFails) {
            tab.group.activeTab = tab;
            if (windowOnly > 0) {
                windowOnly--;
                focusedGroup = tab.group;
            } else {
                focus(tab.group);
            }
        }
    } else if (id === 'workbench.action.files.revert') {
        // File > Revert File reverts the active editor if it has unsaved
        // edits. VS Code drops it for any other.
        const tab = focusedGroup.activeTab;
        if (tab && tab.isDirty) {
            tab.isDirty = false;
            await tab.revert();
        }
    } else if (id === 'workbench.action.files.save') {
        // File > Save saves the active editor and nothing else. A save that
        // fails is shown as an error, the tab keeps its unsaved mark.
        const tab = focusedGroup.activeTab;
        if (tab && tab.save) {
            try {
                await tab.save();
            } catch (e) {
                errors.push(`Failed to save '${path.basename(tab.input.uri.fsPath)}': ${e.message}`);
            }
        }
    }
};

const load = Module._load;
Module._load = function (request, ...rest) {
    if (request === 'vscode') return vscodeStub;
    return load.call(this, request, ...rest);
};

const { CsvEditorProvider, sameResource } = require('../out/csvEditorProvider.js');

// A test takes it away to act as VS Code before 1.86.
const workspaceSave = vscodeStub.workspace.save;

let failures = 0;
async function test(name, fn) {
    vscodeStub.workspace.save = workspaceSave;
    warnings.length = 0;
    errors.length = 0;
    fakeSize = null;
    quickPickChoice = null;
    failNextWrite = false;
    duringNextWrite = null;
    openWithFails = false;
    windowOnly = 0;
    group.tabs.length = 0;
    group.activeTab = null;
    floating.tabs.length = 0;
    floating.activeTab = null;
    focusedGroup = group;
    focusDelay = 0;
    panels.length = 0;
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
        // Whether it is VS Code's active editor and whether its page has the
        // keyboard, see settleFocus.
        active: false, hasKeyboard: false,
        viewStateListeners: [],
        onDidChangeViewState(f) {
            this.viewStateListeners.push(f);
            return { dispose: () => this.viewStateListeners.splice(this.viewStateListeners.indexOf(f), 1) };
        },
        receive: m => onMessage(m),
    };
    panels.push(panel);
    await provider.resolveCustomEditor(doc, panel, {});
    return {
        posted, panel,
        ready: () => onMessage({ type: 'ready' }),
        edit: text => onMessage({ type: 'edit', text }),
        updates: () => posted.filter(m => m.type === 'update'),
        close: () => {
            panels.splice(panels.indexOf(panel), 1);
            for (const f of disposeListeners) f();
        },
        // A cell of this editor holds a value being typed: the grid says so
        // on the first change, hands the value over when a save asks for it
        // (flush) and says when the cell is closed again.
        typing: () => onMessage({ type: 'typing' }),
        typingEnded: text => onMessage(text === undefined ? { type: 'typingEnded' } : { type: 'typingEnded', text }),
        flushed: text => onMessage(text === undefined ? { type: 'flushed' } : { type: 'flushed', text }),
        flushes: () => posted.filter(m => m.type === 'flush'),
        // While another editor shows the file, the grid sends the file with
        // the value being typed in it. Without a text when the value is the
        // cell's again.
        typedText: text => onMessage(text === undefined ? { type: 'typedText' } : { type: 'typedText', text }),
        // What the extension told this editor about other editors of the file.
        shared: () => posted.filter(m => m.type === 'shared').map(m => m.value),
    };
}

// Opens a file in the provider and hands back what a test needs to drive it.
// A new provider unless the test hands one over, like the one VS Code keeps
// for all files.
async function open(filePath, openContext = {}, uri = uriFile(filePath), provider = undefined) {
    const context = { extensionUri: uriFile('/ext'), globalState: { get: (_k, d) => d, update() {} } };
    provider = provider || new CsvEditorProvider(context);
    const doc = await provider.openCustomDocument(uri, openContext, {});
    // VS Code shows a document restored from a backup as unsaved.
    const tab = {
        input: new TabInputCustom(uri, 'csvViewer.grid'), group, isActive: true, isDirty: !!openContext.backupId,
        revert: () => provider.revertCustomDocument(doc, {}),
        save: async () => {
            await provider.saveCustomDocument(doc, {});
            tab.isDirty = false;
        },
    };
    // VS Code backs up a document with unsaved edits a moment after each
    // change of its content. At quit it backs up only a content it has no
    // backup of yet. A warning that the file changed on disk changes no
    // content, so VS Code takes no backup for it.
    let changes = 0;
    let backedUp = null;
    provider.onDidChangeCustomDocument(e => {
        if (e.document !== doc) return;
        tab.isDirty = true;
        changes++;
    });
    const backUpLikeVsCode = async () => {
        if (!backedUp || backedUp.changes !== changes) {
            const destination = uriFile(path.join(tmpDir, `${path.basename(uri.fsPath)}.${changes}.backup`));
            backedUp = { changes, backup: await provider.backupCustomDocument(doc, { destination }, {}) };
        }
        return backedUp.backup;
    };
    // A backup is handed back after a restart, which left no tab of the file
    // from before it.
    if (openContext.backupId) {
        for (const old of group.tabs.filter(t => t.input && t.input.uri.toString() === uri.toString())) {
            group.tabs.splice(group.tabs.indexOf(old), 1);
        }
    }
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
    // The new tab is the active editor and has the keyboard.
    tab.panel = editor.panel;
    focusedGroup = group;
    settleFocus();
    return {
        ...editor, provider, doc, uri, tab, watchers: own,
        // How many times the document was reported changed.
        changes: () => changes,
        save: tab.save,
        saveAs: dest => provider.saveCustomDocumentAs(doc, uriFile(dest), {}),
        backup: dest => provider.backupCustomDocument(doc, { destination: uriFile(dest) }, {}),
        // The backup VS Code takes after the last change of the content.
        backUpLikeVsCode,
        // VS Code quits and keeps the backup it holds for the next start.
        quit: async () => {
            const backup = await backUpLikeVsCode();
            editor.close();
            group.tabs.splice(group.tabs.indexOf(tab), 1);
            return backup;
        },
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
// Long enough for the provider to give up on a grid that does not come to
// the front (FRONT_TIMEOUT_MS in csvEditorProvider.ts).
const gaveUp = () => new Promise(r => setTimeout(r, 2000));
// The warnings still on screen, the ones a user can click.
const onScreen = () => warnings.filter(w => w.open);

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

    // A change on disk the user was warned of and did not decide on before
    // quitting is still there after the restart. A save would still write
    // over it, so the warning comes back. VS Code takes no backup for the
    // warning, so its backup knows the file from before the change.
    await test('a change on disk left undecided at quit is reported again after the restart', async () => {
        const p = file('hot-known.csv', 'h\n1\n');
        const before = await open(p);
        await before.edit('h\nmine\n');
        await before.backUpLikeVsCode();
        fs.writeFileSync(p, 'h\ntheirs\n');
        await before.fireWatcher();
        assert.strictEqual(warnings.length, 1, 'the test did not reach the warning');
        const backup = await before.quit();
        warnings.length = 0;
        const after = await open(p, { backupId: backup.id });
        assert.deepStrictEqual(warnings.map(w => w.msg),
            ['hot-known.csv changed on disk. Your unsaved edits in the grid were kept.'], 'the undecided change was not reported');
        assert.strictEqual(after.doc.content, 'h\nmine\n');
        await assert.rejects(after.save(), /changed on disk/, 'the save went through');
        assert.strictEqual(fs.readFileSync(p, 'utf8'), 'h\ntheirs\n', 'the save wrote over the change on disk');
    });

    // An edit after the warning makes VS Code back up again. That backup
    // knows the changed file, so only the mark it carries tells the restore
    // that nobody decided on the change.
    await test('a change on disk left undecided is reported after the restart when edits followed the warning', async () => {
        const p = file('hot-known-edited.csv', 'h\n1\n');
        const before = await open(p);
        await before.edit('h\nmine\n');
        await before.backUpLikeVsCode();
        fs.writeFileSync(p, 'h\ntheirs\n');
        await before.fireWatcher();
        assert.strictEqual(warnings.length, 1, 'the test did not reach the warning');
        await before.edit('h\nmine\nmore\n');
        const backup = await before.quit();
        warnings.length = 0;
        const after = await open(p, { backupId: backup.id });
        assert.deepStrictEqual(warnings.map(w => w.msg),
            ['hot-known-edited.csv changed on disk. Your unsaved edits in the grid were kept.'], 'the undecided change was not reported');
        assert.strictEqual(after.doc.content, 'h\nmine\nmore\n');
        await assert.rejects(after.save(), /changed on disk/, 'the save went through');
        assert.strictEqual(fs.readFileSync(p, 'utf8'), 'h\ntheirs\n', 'the save wrote over the change on disk');
        onScreen()[0].pick('Overwrite');
        await tick();
        assert.strictEqual(fs.readFileSync(p, 'utf8'), 'h\nmine\nmore\n', 'Overwrite did not write the edits');
    });

    // 1.22.0 wrote a backup as UTF-8 without the byte order mark and gave it
    // the bare URI for its id. Restored as plain UTF-8, the next save dropped
    // the mark and Excel showed the umlauts wrong again.
    await test('a hot exit backup from 1.22.0 keeps the byte order mark of the file', async () => {
        const text = 'name,city\nJürgen,Köln\nAnna,Wien\n';
        const legacy = (name, onDisk) => {
            const p = file(name, onDisk);
            const backupPath = path.join(tmpDir, name + '.backup');
            fs.writeFileSync(backupPath, new TextEncoder().encode(text));
            return { p, backupId: 'file://' + backupPath };
        };
        const bom = legacy('legacy-bom.csv', Buffer.concat([BOM, Buffer.from('name,city\nJürgen,Köln\n')]));
        const t = await open(bom.p, { backupId: bom.backupId });
        assert.strictEqual(t.doc.content, text);
        await t.save();
        assert.strictEqual(fs.readFileSync(bom.p).toString('hex'), Buffer.concat([BOM, Buffer.from(text)]).toString('hex'),
            'the save dropped the byte order mark');
        const plain = legacy('legacy-plain.csv', 'name,city\nJürgen,Köln\n');
        const u = await open(plain.p, { backupId: plain.backupId });
        await u.save();
        assert.strictEqual(fs.readFileSync(plain.p).toString('hex'), Buffer.from(text).toString('hex'), 'a file without the mark gained one');
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

    // On a disk that ignores case under Linux (WSL's /mnt/c, a FAT stick, an
    // SMB share) Save As from a preview onto BIG.csv copied big.csv onto
    // itself. VS Code deleted the target first, which was big.csv. The copy
    // then found nothing to copy and the whole file was gone.
    await test('Save As from a preview onto the file under another name keeps the file', async () => {
        const text = 'id,name\n' + Array.from({ length: 1500 }, (_, i) => `${i},row ${i}`).join('\n') + '\n';
        const p = file('big-self.csv', text);
        const other = path.join(tmpDir, 'BIG-SELF.csv');
        fs.linkSync(p, other);                          // one file under two names
        fakeSize = 60 * 1024 * 1024;
        quickPickChoice = 'head';
        const t = await open(p);
        assert.strictEqual(t.doc.isPreview, true, 'the test did not reach the preview');
        await t.saveAs(other);
        assert.ok(fs.existsSync(p), 'the file is gone');
        assert.strictEqual(fs.readFileSync(p, 'utf8'), text);
    });

    // A mount without stable inode numbers (FUSE without use_ino, cifs with
    // noserverino) gives big.csv and BIG.csv a number each although they are
    // one file. Here the folder lists big.csv only and the disk finds BIG.csv
    // by ignoring case.
    await test('Save As from a preview onto the file in other case keeps it on a disk that numbers each name', async () => {
        const text = 'id,name\n' + Array.from({ length: 1500 }, (_, i) => `${i},row ${i}`).join('\n') + '\n';
        const p = file('big-noino.csv', text);
        const other = path.join(tmpDir, 'BIG-NOINO.csv');
        const stat = fs.promises.stat;
        const copy = vscodeStub.workspace.fs.copy;
        fs.promises.stat = async (name, ...rest) => {
            if (name !== other) return stat(name, ...rest);
            const s = await stat(p, ...rest);
            return Object.assign(Object.create(Object.getPrototypeOf(s)), s, { ino: s.ino + (typeof s.ino === 'bigint' ? 1n : 1) });
        };
        // VS Code deletes the target first, which is the file itself here.
        vscodeStub.workspace.fs.copy = async (from, to, options) => {
            if (options && options.overwrite && to.fsPath === other) fs.rmSync(p);
            fs.copyFileSync(from.fsPath, to.fsPath);
        };
        try {
            fakeSize = 60 * 1024 * 1024;
            quickPickChoice = 'head';
            const t = await open(p);
            assert.strictEqual(t.doc.isPreview, true, 'the test did not reach the preview');
            await t.saveAs(other).catch(() => {});
            assert.ok(fs.existsSync(p), 'the file is gone');
            assert.strictEqual(fs.readFileSync(p, 'utf8'), text);
        } finally {
            fs.promises.stat = stat;
            vscodeStub.workspace.fs.copy = copy;
        }
    });

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
        await gaveUp();
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

    await test('Overwrite on the warning saves a diff with no grid tab', async () => {
        const t = await diffOnly('diff-only-overwrite.csv');
        await t.fireWatcher();
        warnings[0].pick('Overwrite');
        await tick();
        assert.strictEqual(fs.readFileSync(t.uri.fsPath, 'utf8'), 'h\nmine\n', 'Overwrite did not write the edits');
        assert.strictEqual(t.tab.isDirty, false, 'the diff is still marked unsaved');
        assert.deepStrictEqual(group.tabs, [t.tab], 'the tab opened for the save is still open');
        assert.strictEqual(group.activeTab, t.tab, 'the diff is not in front again');
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

    // With files.autoSave on afterDelay the next save came half a second
    // after the warning and wrote the edits over the change it had just
    // reported. Reload from Disk on the warning then had nothing left to
    // load. VS Code's own text editor refuses such a save.
    await test('a save after the warning does not write over the change on disk', async () => {
        const p = file('dirty-save.csv', 'h\n1\n');
        const t = await open(p);
        await t.edit('h\nmine\n');
        fs.writeFileSync(p, 'h\ntheirs\n');
        await t.fireWatcher();
        await assert.rejects(t.save(), /changed on disk/, 'the save went through');
        assert.strictEqual(fs.readFileSync(p, 'utf8'), 'h\ntheirs\n', 'the save wrote over the change on disk');
        assert.strictEqual(t.tab.isDirty, true);
        assert.strictEqual(t.doc.content, 'h\nmine\n', 'the edits are gone');
        assert.strictEqual(onScreen().length, 1, 'the refused save stacked a second warning');
        onScreen()[0].pick('Reload from Disk');
        await tick();
        assert.strictEqual(t.doc.content, 'h\ntheirs\n', 'Reload from Disk did not load the change');
        await t.edit('h\ntheirs\nmore\n');
        await t.save();
        assert.strictEqual(fs.readFileSync(p, 'utf8'), 'h\ntheirs\nmore\n', 'a save after Reload from Disk was refused');
    });

    // The warning's toast hides after a few seconds and the warning waits
    // behind the bell. A refused auto-save then said nothing at all. A
    // refused Ctrl+S pointed to buttons nobody could see.
    await test('every refused save shows the warning again in place of the one before', async () => {
        const p = file('dirty-save-again.csv', 'h\n1\n');
        const t = await open(p);
        await t.edit('h\nmine\n');
        fs.writeFileSync(p, 'h\ntheirs\n');
        await t.fireWatcher();
        await assert.rejects(t.save(), /changed on disk/);   // the warning is still open, its toast hidden
        assert.strictEqual(warnings.length, 2, 'the refused save did not show the warning again');
        assert.deepStrictEqual(onScreen(), [warnings[1]], 'the warnings stacked');
        assert.deepStrictEqual(warnings[1].actions, ['Reload from Disk', 'Overwrite']);
        onScreen()[0].pick(undefined);                  // closed
        await tick();
        await assert.rejects(t.save(), /changed on disk/);
        assert.strictEqual(onScreen().length, 1, 'the refused save did not bring the closed warning back');
        await assert.rejects(t.save(), /changed on disk/);   // auto-save after the next edit
        assert.strictEqual(onScreen().length, 1, 'the warnings stacked');
        onScreen()[0].pick('Overwrite');
        await tick();
        assert.strictEqual(fs.readFileSync(p, 'utf8'), 'h\nmine\n', 'Overwrite on the warning shown last did not write');
    });

    await test('Overwrite on the warning writes the edits over the change on disk', async () => {
        const p = file('dirty-overwrite.csv', 'h\n1\n');
        const t = await open(p);
        await t.edit('h\nmine\n');
        fs.writeFileSync(p, 'h\ntheirs\n');
        await t.fireWatcher();
        warnings[0].pick('Overwrite');
        await tick();
        assert.strictEqual(fs.readFileSync(p, 'utf8'), 'h\nmine\n', 'the edits were not written');
        assert.strictEqual(t.tab.isDirty, false, 'the tab is still marked unsaved');
        await t.fireWatcher();                          // the echo of that save
        assert.strictEqual(t.updates().length, 0);
        assert.strictEqual(warnings.length, 1);
    });

    // workspace.save saves every editor of the file and forces it. A text
    // editor that had loaded the other program's change wrote it back over
    // the edits. The grid then loaded it as a change on disk. Or VS Code
    // refused the text editor's save as older than the file and its own
    // Overwrite wrote the change back the same way.
    await test('Overwrite saves the grid only, not a text editor of the same file', async () => {
        const p = file('dirty-overwrite-text.csv', 'a,b\n1,2\n');
        const t = await open(p);
        await t.edit('a,b\n1,Mine\n');
        const text = { input: { uri: t.uri }, group, isDirty: false, content: 'a,b\n1,2\n' };
        text.save = async () => fs.writeFileSync(p, text.content);
        group.tabs.push(text);
        fs.writeFileSync(p, 'a,b\n1,OUTSIDE\n');
        text.content = 'a,b\n1,OUTSIDE\n';            // the text editor loads the change
        await t.fireWatcher();
        warnings[0].pick('Overwrite');
        await tick();
        await t.fireWatcher();                          // what landed on disk
        assert.strictEqual(fs.readFileSync(p, 'utf8'), 'a,b\n1,Mine\n', 'the text editor wrote the change back');
        assert.strictEqual(t.doc.content, 'a,b\n1,Mine\n', 'the grid lost the edits');
        assert.strictEqual(t.tab.isDirty, false);
    });

    // A file another program still holds open. VS Code shows nothing for a
    // save that workspace.save asked for, so the button seemed to do nothing.
    // Its File > Save shows why the save failed.
    await test('Overwrite that cannot write the file says so', async () => {
        const p = file('dirty-overwrite-locked.csv', 'h\n1\n');
        const t = await open(p);
        await t.edit('h\nmine\n');
        fs.writeFileSync(p, 'h\ntheirs\n');
        await t.fireWatcher();
        failNextWrite = true;
        warnings[0].pick('Overwrite');
        await tick();
        assert.deepStrictEqual(errors, ["Failed to save 'dirty-overwrite-locked.csv': EBUSY: resource busy or locked"]);
        assert.strictEqual(fs.readFileSync(p, 'utf8'), 'h\ntheirs\n');
        assert.strictEqual(t.tab.isDirty, true);
        await t.save();
        assert.strictEqual(fs.readFileSync(p, 'utf8'), 'h\nmine\n', 'the next save did not write');
    });

    await test('Overwrite writes on VS Code before 1.86 as well', async () => {
        vscodeStub.workspace.save = undefined;
        const p = file('dirty-overwrite-old.csv', 'h\n1\n');
        const t = await open(p);
        await t.edit('h\nmine\n');
        fs.writeFileSync(p, 'h\ntheirs\n');
        await t.fireWatcher();
        warnings[0].pick('Overwrite');
        await tick();
        assert.strictEqual(fs.readFileSync(p, 'utf8'), 'h\nmine\n', 'Overwrite did not write');
        assert.strictEqual(t.tab.isDirty, false);
    });

    // Move Editor into New Window puts a tab into a floating window, which
    // takes the focus. File > Save and File > Revert File act on the editor
    // in front of the window that has the focus. VS Code moves the focus to
    // the window of a tab brought to the front a moment later. It keeps the
    // extension's active tab group on the main window's group throughout.
    const toFloating = tab => {
        tab.group.tabs.splice(tab.group.tabs.indexOf(tab), 1);
        if (tab.group.activeTab === tab) tab.group.activeTab = tab.group.tabs[tab.group.tabs.length - 1] || null;
        floating.tabs.push(tab);
        floating.activeTab = tab;
        tab.group = floating;
        if (tab.panel) tab.panel.viewColumn = floating.viewColumn;
        focusedGroup = floating;
        settleFocus();
    };
    // A text file with unsaved edits in front of group `g`, which has the focus.
    const notesIn = g => {
        const notes = {
            input: { uri: uriFile(path.join(tmpDir, 'notes.txt')) }, group: g, isDirty: true, text: 'UNSAVED NOTES',
            revert: async () => { notes.text = 'saved notes'; },
            save: async () => { notes.saved = notes.text; notes.isDirty = false; },
        };
        g.tabs.push(notes);
        g.activeTab = notes;
        focusedGroup = g;
        settleFocus();
        return notes;
    };
    const untouched = notes => {
        assert.strictEqual(notes.text, 'UNSAVED NOTES', 'the text file in front lost its unsaved edits');
        assert.strictEqual(notes.isDirty, true, 'the text file is no longer marked unsaved');
        assert.strictEqual(notes.saved, undefined, 'the text file was saved');
    };

    // The command palette of the floating window ran Reload from Disk. The
    // active tab group named the grid in the main window, so the command
    // brought that grid to the front and ran File > Revert File at once. The
    // floating window still had the focus: its text file lost its unsaved
    // edits and the grid kept the change on disk waiting.
    await test('the Reload from Disk command reverts no editor of a floating window that has the focus', async () => {
        const p = file('float-command.csv', 'h\n1\n');
        const t = await open(p);
        await t.edit('h\nmine\n');
        const notes = notesIn(group);
        toFloating(notes);
        fs.writeFileSync(p, 'h\ntheirs\n');
        await t.fireWatcher();
        focusDelay = 50;
        await t.provider.reloadActiveFromDisk();
        await gaveUp();
        untouched(notes);
        assert.ok(warnings.some(w => w.msg === 'Reload from Disk works on an open CSV Grid Editor tab.'),
            'the command did not say it needs a grid tab');
        assert.strictEqual(t.doc.content, 'h\nmine\n', 'the grid nobody looked at was reloaded');
    });

    await test('the Reload from Disk command reloads the grid of the floating window that has the focus', async () => {
        const a = await open(file('float-command-a.csv', 'h\n1\n'));
        await a.edit('h\nA MINE\n');
        const p = file('float-command-b.csv', 'h\n1\n');
        const b = await open(p, {}, uriFile(p), a.provider);
        await b.edit('h\nB MINE\n');
        toFloating(b.tab);
        group.activeTab = a.tab;
        fs.writeFileSync(p, 'h\nB THEIRS\n');
        await b.fireWatcher();
        focusDelay = 50;
        blurPages();                                    // the command palette takes the keyboard
        await b.provider.reloadActiveFromDisk();
        await gaveUp();
        assert.strictEqual(a.doc.content, 'h\nA MINE\n', 'the grid in the main window lost its unsaved edits');
        assert.strictEqual(a.tab.isDirty, true);
        assert.strictEqual(b.doc.content, 'h\nB THEIRS\n', 'the grid in front was not reloaded');
        assert.strictEqual(b.tab.isDirty, false, 'the grid in front is still marked unsaved');
    });

    // The HEAD side of a Source Control diff whose sides are grids has the
    // focus. The command reloads the working file, whose grid is in front on
    // the other side of the diff.
    await test('the Reload from Disk command reloads the other side of a diff too', async () => {
        const p = file('float-diff-sides.csv', 'h\n1\n');
        gitBlobs.set(p, Buffer.from('h\n0\n'));
        const t = await open(p);
        const head = await open(p, {}, uriGit(p), t.provider);
        t.panel.active = false;
        head.panel.active = true;
        fs.writeFileSync(p, 'h\nnew\n');
        await t.provider.reloadActiveFromDisk();
        await tick();
        assert.deepStrictEqual(warnings.map(w => w.msg), [], 'the command refused the diff');
        assert.strictEqual(t.doc.content, 'h\nnew\n', 'the working file was not reloaded');
    });

    // The grid tab sits in a floating window and the warning in the main
    // window, whose click gives that window the focus. Overwrite looked for
    // the grid in the extension's active tab group, did not find it there
    // and ran nothing. It had already taken the change on disk off the
    // document: no warning was left and the file kept the other program's
    // text. Reload from Disk loaded the file but left the tab marked unsaved.
    await test('Overwrite saves a grid tab of a floating window', async () => {
        const p = file('float-overwrite.csv', 'h\n1\n');
        const t = await open(p);
        await t.edit('h\nmine\n');
        toFloating(t.tab);
        const notes = notesIn(group);
        fs.writeFileSync(p, 'h\ntheirs\n');
        await t.fireWatcher();
        focusDelay = 50;
        clickMainWindow();
        warnings[0].pick('Overwrite');
        await gaveUp();
        assert.strictEqual(fs.readFileSync(p, 'utf8'), 'h\nmine\n', 'Overwrite did not write the edits');
        assert.strictEqual(t.tab.isDirty, false, 'the tab is still marked unsaved');
        assert.strictEqual(t.doc.conflict, false);
        untouched(notes);
    });

    await test('Overwrite brings a grid tab of a floating window to the front a second time', async () => {
        const p = file('float-twice.csv', 'h\n1\n');
        const t = await open(p);
        await t.edit('h\nmine\n');
        toFloating(t.tab);
        const notes = notesIn(group);
        fs.writeFileSync(p, 'h\ntheirs\n');
        await t.fireWatcher();
        clickMainWindow();
        windowOnly = 1;
        warnings[0].pick('Overwrite');
        await gaveUp();
        assert.strictEqual(fs.readFileSync(p, 'utf8'), 'h\nmine\n', 'Overwrite did not write the edits');
        assert.strictEqual(t.tab.isDirty, false, 'the save did not run on the grid tab');
        untouched(notes);
    });

    await test('Reload from Disk takes the unsaved mark off a grid tab of a floating window', async () => {
        const p = file('float-revert.csv', 'h\n1\n');
        const t = await open(p);
        await t.edit('h\nmine\n');
        toFloating(t.tab);
        const notes = notesIn(group);
        fs.writeFileSync(p, 'h\ntheirs\n');
        await t.fireWatcher();
        focusDelay = 50;
        clickMainWindow();
        warnings[0].pick('Reload from Disk');
        await gaveUp();
        assert.strictEqual(t.doc.content, 'h\ntheirs\n', 'the action did not load the disk');
        assert.strictEqual(t.tab.isDirty, false, 'the tab is still marked unsaved');
        untouched(notes);
    });

    // The grid was the active editor in the floating window when the user
    // clicked the warning in the main window. VS Code keeps such an editor
    // active, but File > Revert File acts on the window that has the focus
    // until the grid's window takes it back.
    await test('Reload from Disk waits for the grid\'s own window to have the focus', async () => {
        const p = file('float-stale.csv', 'h\n1\n');
        const t = await open(p);
        await t.edit('h\nmine\n');
        const notes = notesIn(group);
        toFloating(t.tab);
        assert.strictEqual(t.panel.active, true, 'the test did not reach an active grid');
        fs.writeFileSync(p, 'h\ntheirs\n');
        await t.fireWatcher();
        focusDelay = 50;
        clickMainWindow();
        warnings[0].pick('Reload from Disk');
        await gaveUp();
        untouched(notes);
        assert.strictEqual(t.doc.content, 'h\ntheirs\n', 'the action did not load the disk');
        assert.strictEqual(t.tab.isDirty, false, 'the tab is still marked unsaved');
    });

    // A grid that does not come to the front runs no command at all. The
    // change on disk stays taken care of: Overwrite writes the edits itself.
    // That leaves the tab marked unsaved but never touches another editor.
    await test('Overwrite writes the edits when the grid does not come to the front', async () => {
        const p = file('float-stuck.csv', 'h\n1\n');
        const t = await open(p);
        await t.edit('h\nmine\n');
        const notes = notesIn(group);
        toFloating(t.tab);
        fs.writeFileSync(p, 'h\ntheirs\n');
        await t.fireWatcher();
        clickMainWindow();
        openWithFails = true;
        warnings[0].pick('Overwrite');
        await gaveUp();
        untouched(notes);
        assert.strictEqual(fs.readFileSync(p, 'utf8'), 'h\nmine\n', 'Overwrite did not write the edits');
        assert.strictEqual(t.doc.conflict, false);
        await t.fireWatcher();                          // the echo of that write
        assert.strictEqual(t.updates().length, 0);
        assert.strictEqual(onScreen().length, 0, 'the echo was taken for another change');
    });

    await test('Overwrite that cannot write the file itself says so', async () => {
        const p = file('float-stuck-locked.csv', 'h\n1\n');
        const t = await open(p);
        await t.edit('h\nmine\n');
        fs.writeFileSync(p, 'h\ntheirs\n');
        await t.fireWatcher();
        openWithFails = true;
        failNextWrite = true;
        clickMainWindow();
        warnings[0].pick('Overwrite');
        await gaveUp();
        assert.deepStrictEqual(errors, ["Failed to save 'float-stuck-locked.csv': EBUSY: resource busy or locked"]);
        assert.strictEqual(fs.readFileSync(p, 'utf8'), 'h\ntheirs\n');
        assert.strictEqual(t.tab.isDirty, true);
    });

    // Ctrl+W on the grid tab and Don't Save: VS Code loads the file into the
    // document and closes the tab. The warning stays in the notification
    // list. Overwrite on it wrote that text over a newer change on disk.
    await test('Overwrite on the warning of a grid tab closed without saving writes nothing', async () => {
        const p = file('closed-overwrite.csv', 'h\n1\n');
        const t = await open(p);
        await t.edit('h\nmine\n');
        fs.writeFileSync(p, 'h\ntheirs1\n');
        await t.fireWatcher();
        await t.provider.revertCustomDocument(t.doc, {});    // Don't Save
        t.close();
        await vscodeStub.window.tabGroups.close(t.tab);
        fs.writeFileSync(p, 'h\ntheirs2\n');                // another program writes again
        warnings[0].pick('Overwrite');
        await gaveUp();
        assert.strictEqual(fs.readFileSync(p, 'utf8'), 'h\ntheirs2\n', 'Overwrite wrote over the newer change on disk');
        assert.deepStrictEqual(errors, []);
    });

    await test('Save As onto the file itself after the warning is refused, onto another file it is not', async () => {
        const p = file('dirty-saveas.csv', 'h\n1\n');
        const t = await open(p);
        await t.edit('h\nmine\n');
        fs.writeFileSync(p, 'h\ntheirs\n');
        await t.fireWatcher();
        await assert.rejects(t.saveAs(p), /changed on disk/, 'Save As went through');
        assert.strictEqual(fs.readFileSync(p, 'utf8'), 'h\ntheirs\n', 'Save As wrote over the change on disk');
        const copy = path.join(tmpDir, 'dirty-saveas-copy.csv');
        await t.saveAs(copy);
        assert.strictEqual(fs.readFileSync(copy, 'utf8'), 'h\nmine\n');
    });

    // On a disk that ignores case under Linux, Save As onto SMALL.csv is Save
    // As onto small.csv. Written like a copy, it went over the change on disk
    // that still waited for Overwrite or Reload from Disk. A hard link stands
    // in for the other spelling.
    await test('Save As onto the file under another name after the warning is refused', async () => {
        const p = file('dirty-saveas-other.csv', 'h\n1\n');
        const other = path.join(tmpDir, 'DIRTY-SAVEAS-OTHER.csv');
        fs.linkSync(p, other);
        const t = await open(p);
        await t.edit('h\nmine\n');
        fs.writeFileSync(p, 'h\ntheirs\n');
        await t.fireWatcher();
        await assert.rejects(t.saveAs(other), /changed on disk/, 'Save As went through');
        assert.strictEqual(fs.readFileSync(p, 'utf8'), 'h\ntheirs\n', 'Save As wrote over the change on disk');
    });

    await test('a file that now holds the edits settles the change on disk', async () => {
        const p = file('dirty-settled.csv', 'h\n1\n');
        const t = await open(p);
        await t.edit('h\nmine\n');
        fs.writeFileSync(p, 'h\ntheirs\n');
        await t.fireWatcher();
        fs.writeFileSync(p, 'h\nmine\n');              // the other program writes the same edit
        await t.fireWatcher();
        await t.save();
        assert.strictEqual(warnings.length, 1);
    });

    // A file with a stray byte behind a UTF-8 byte order mark reads as the
    // grid's text although a save would write other bytes.
    await test('a file with a stray byte that holds the edits again settles the change on disk', async () => {
        const stray = rest => Buffer.concat([BOM, Buffer.from('name;city\nMüller;Köln\nSch'), Buffer.from([0xF6]), Buffer.from('n;x\n' + rest)]);
        const p = file('dirty-settled-stray.csv', stray(''));
        const t = await open(p);
        assert.strictEqual(t.doc.content, 'name;city\nMüller;Köln\nSchön;x\n', 'the test did not read the stray byte');
        await t.edit('name;city\nMüller;Köln\nSchön;x\nEva;Graz\n');
        fs.writeFileSync(p, stray('Otto;Linz\n'));
        await t.fireWatcher();
        assert.strictEqual(warnings.length, 1, 'the test did not reach the warning');
        fs.writeFileSync(p, stray('Eva;Graz\n'));    // the other program writes the same edit
        await t.fireWatcher();
        await t.save();
        assert.strictEqual(t.tab.isDirty, false);
    });

    // Two warnings with the same text are one notification to VS Code, so
    // the second closed the first. Overwrite on the one left wrote the file
    // whose warning came last, whichever grid the user looked at.
    await test('warnings for two files of the same name tell which file they are about', async () => {
        const [p1, p2] = ['same-1', 'same-2'].map(dir => {
            fs.mkdirSync(path.join(tmpDir, dir));
            return file(path.join(dir, 'data.csv'), 'h\n1\n');
        });
        const t1 = await open(p1);
        const t2 = await open(p2);
        await t1.edit('h\nmine 1\n');
        await t2.edit('h\nmine 2\n');
        fs.writeFileSync(p1, 'h\ntheirs\n');
        fs.writeFileSync(p2, 'h\ntheirs\n');
        await t1.fireWatcher();
        await t2.fireWatcher();
        assert.deepStrictEqual(onScreen().map(w => w.msg), [
            'same-1/data.csv changed on disk. Your unsaved edits in the grid were kept.',
            'same-2/data.csv changed on disk. Your unsaved edits in the grid were kept.'
        ]);
        onScreen()[0].pick('Overwrite');
        await tick();
        assert.strictEqual(fs.readFileSync(p1, 'utf8'), 'h\nmine 1\n', 'Overwrite did not write the file its warning named');
        assert.strictEqual(fs.readFileSync(p2, 'utf8'), 'h\ntheirs\n', 'Overwrite wrote the other file');
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

    // Closing a Source Control diff does not ask to save while the file's
    // grid tab is open. Neither Ctrl+W nor the close button takes the focus
    // out of the page. A value being typed in the diff never reached the
    // document. The grid tab kept the old value and still showed the file
    // unsaved. A save wrote the file without the value. While another editor
    // shows the file, the grid sends the file with the value in it. The
    // document takes that when the editor goes.
    await test('the value being typed in an editor that closes goes to the other editor', async () => {
        const p = file('typed-close.csv', 'h\n1\n');
        const t = await open(p);
        const diff = await t.openSecondEditor();
        await diff.typing();
        await diff.typedText('h\nTYPED\n');
        assert.strictEqual(t.doc.content, 'h\n1\n', 'the document took the value before the editor closed');
        assert.strictEqual(t.updates().length, 0, 'the other editor was sent the value before the editor closed');
        diff.close();
        assert.strictEqual(t.doc.content, 'h\nTYPED\n', 'the value was lost');
        assert.deepStrictEqual(t.updates().map(m => m.text), ['h\nTYPED\n'], 'the grid tab kept the old value');
        assert.strictEqual(t.tab.isDirty, true);
        await t.save();
        assert.strictEqual(fs.readFileSync(p, 'utf8'), 'h\nTYPED\n', 'the save wrote the file without the value');
    });

    // Writing out the whole file for every pause in the typing costs time on
    // a large file, so the grid does it only while another editor shows it.
    await test('an editor is told whether another editor shows the file', async () => {
        const t = await open(file('typed-shared.csv', 'h\n1\n'));
        await t.ready();
        assert.strictEqual(t.posted.find(m => m.type === 'init').shared, false);
        const diff = await t.openSecondEditor();
        await diff.ready();
        assert.strictEqual(diff.posted.find(m => m.type === 'init').shared, true, 'the new editor was not told');
        assert.deepStrictEqual(t.shared(), [true], 'the first editor was not told');
        diff.close();
        assert.deepStrictEqual(t.shared(), [true, false], 'the editor left alone was not told');
    });

    await test('a value given up with Escape is not handed over when the editor closes', async () => {
        const t = await open(file('typed-escape.csv', 'h\n1\n'));
        const diff = await t.openSecondEditor();
        await diff.typing();
        await diff.typedText('h\nTYPED\n');
        await diff.typingEnded();
        diff.close();
        assert.strictEqual(t.doc.content, 'h\n1\n');
        assert.strictEqual(t.updates().length, 0);
    });

    await test('a value typed back to the cell\'s own is not handed over', async () => {
        const t = await open(file('typed-back.csv', 'h\n1\n'));
        const diff = await t.openSecondEditor();
        await diff.typing();
        await diff.typedText('h\nTYPED\n');
        await diff.typedText();
        diff.close();
        assert.strictEqual(t.doc.content, 'h\n1\n');
        assert.strictEqual(t.updates().length, 0);
    });

    // Don't Save on the question VS Code asks when a tab closes reverts the
    // document. The value being typed goes with it.
    await test('a revert drops the value being typed', async () => {
        const t = await open(file('typed-revert.csv', 'h\n1\n'));
        const diff = await t.openSecondEditor();
        await diff.typing();
        await diff.typedText('h\nTYPED\n');
        await t.provider.revertCustomDocument(t.doc, {});
        diff.close();
        assert.strictEqual(t.doc.content, 'h\n1\n', 'the value came back after the revert');
    });

    // A new text closes the cell open in an editor (readText in messaging.ts).
    // The value typed there would undo the edit that brought the text.
    await test('an edit in the other editor drops the value being typed', async () => {
        const t = await open(file('typed-other-edit.csv', 'h\n1\n'));
        const diff = await t.openSecondEditor();
        await diff.typing();
        await diff.typedText('h\nTYPED\n');
        await t.edit('h\nOTHER\n');
        diff.close();
        assert.strictEqual(t.doc.content, 'h\nOTHER\n', 'the value undid the edit of the other editor');
    });

    await test('a value a save took is not taken back when the editor closes', async () => {
        const p = file('typed-saved.csv', 'h\n1\n');
        const t = await open(p);
        const diff = await t.openSecondEditor();
        await diff.typing();
        await diff.typedText('h\nTYP\n');
        const saving = t.save();
        await tick();
        await diff.flushed('h\nTYPED\n');
        await saving;
        diff.close();
        assert.strictEqual(t.doc.content, 'h\nTYPED\n', 'an older value came back');
        assert.strictEqual(fs.readFileSync(p, 'utf8'), 'h\nTYPED\n');
    });

    // A value being typed into a cell reached the extension only when the cell
    // was committed. Ctrl+W closed the tab without asking and the value was
    // lost. Auto-save and Save All saved the file without it and the tab
    // looked saved.
    await test('a value being typed marks the tab unsaved', async () => {
        const t = await open(file('typing-mark.csv', 'h\n1\n'));
        const diff = await t.openSecondEditor();
        await t.typing();
        assert.strictEqual(t.tab.isDirty, true, 'the tab would close without asking');
        assert.strictEqual(t.doc.content, 'h\n1\n', 'the document took something before the value was handed over');
        assert.strictEqual(diff.updates().length, 0, 'the other editor was sent a text');
    });

    await test('a preview is never marked for a value being typed', async () => {
        const text = 'id,name\n' + Array.from({ length: 1500 }, (_, i) => `${i},row ${i}`).join('\n') + '\n';
        fakeSize = 60 * 1024 * 1024;
        quickPickChoice = 'head';
        const t = await open(file('typing-preview.csv', text));
        assert.strictEqual(t.doc.isPreview, true, 'the test did not reach the preview');
        await t.typing();
        assert.strictEqual(t.changes(), 0);
    });

    await test('a save takes the value being typed and writes it', async () => {
        const p = file('typing-save.csv', 'h\n1\n');
        const t = await open(p);
        await t.typing();
        const saving = t.save();
        await tick();
        assert.strictEqual(t.flushes().length, 1, 'the save did not ask the editor for the value');
        assert.strictEqual(fs.readFileSync(p, 'utf8'), 'h\n1\n', 'the save wrote before the answer came');
        await t.flushed('h\nTYPED\n');
        await saving;
        assert.strictEqual(fs.readFileSync(p, 'utf8'), 'h\nTYPED\n');
        assert.strictEqual(t.doc.content, 'h\nTYPED\n');
        await tick();
        assert.strictEqual(t.tab.isDirty, false, 'the tab is still marked unsaved');
        // The cell is committed with the same value: nothing changes.
        await t.edit('h\nTYPED\n');
        await t.typingEnded();
        assert.strictEqual(t.tab.isDirty, false, 'the commit marked a saved file unsaved');
    });

    await test('Save As takes the value being typed', async () => {
        const t = await open(file('typing-save-as.csv', 'h\n1\n'));
        await t.typing();
        const dest = path.join(tmpDir, 'typing-save-as-copy.csv');
        const saving = t.saveAs(dest);
        await tick();
        assert.strictEqual(t.flushes().length, 1, 'Save As did not ask the editor for the value');
        await t.flushed('h\nTYPED\n');
        await saving;
        assert.strictEqual(fs.readFileSync(dest, 'utf8'), 'h\nTYPED\n');
    });

    // The modified side of a Source Control diff is a second editor. It kept
    // the text from before the save and the commit that followed brought
    // nothing new. Its next edit wrote the old value back over the saved one.
    await test('the other editor gets the value a save took', async () => {
        const p = file('typing-other.csv', 'h\n1\n');
        const t = await open(p);
        const diff = await t.openSecondEditor();
        await t.typing();
        const saving = t.save();
        await tick();
        await t.flushed('h\nTYPED\n');
        await saving;
        assert.deepStrictEqual(diff.updates().map(m => m.text), ['h\nTYPED\n'], 'the other editor kept the text without the value');
        assert.strictEqual(t.updates().length, 0, 'the editor that handed the value over was sent it back');
        await t.edit('h\nTYPED\n');
        await t.typingEnded();
        await diff.edit('h\nTYPED\nNEW\n');
        await t.save();
        assert.strictEqual(fs.readFileSync(p, 'utf8'), 'h\nTYPED\nNEW\n');
    });

    await test('a save with no value being typed asks nothing', async () => {
        const p = file('typing-none.csv', 'h\n1\n');
        const t = await open(p);
        await t.edit('h\n2\n');
        const start = Date.now();
        await t.save();
        assert.ok(Date.now() - start < 200, 'the save waited ' + (Date.now() - start) + ' ms');
        assert.strictEqual(t.flushes().length, 0);
        assert.strictEqual(fs.readFileSync(p, 'utf8'), 'h\n2\n');
    });

    await test('a save does not wait long for an editor that does not answer', async () => {
        const p = file('typing-timeout.csv', 'h\n1\n');
        const t = await open(p);
        await t.edit('h\n2\n');
        await t.typing();
        const start = Date.now();
        await t.save();
        const took = Date.now() - start;
        assert.ok(took >= 900 && took < 3000, 'the save took ' + took + ' ms');
        assert.strictEqual(fs.readFileSync(p, 'utf8'), 'h\n2\n', 'what the document held was not written');
        await tick();
        assert.strictEqual(t.tab.isDirty, true, 'the value the save did not get sits behind a tab that looks saved');
    });

    await test('a save does not wait for an editor that was closed', async () => {
        const p = file('typing-closed.csv', 'h\n1\n');
        const t = await open(p);
        await t.edit('h\n2\n');
        await t.typing();
        const start = Date.now();
        const saving = t.save();
        await tick();
        t.close();
        await saving;
        assert.ok(Date.now() - start < 500, 'the save waited ' + (Date.now() - start) + ' ms');
        // The closed editor is not asked again.
        await t.save();
        assert.strictEqual(t.flushes().length, 1);
    });

    await test('an edit that brings the text the document holds changes nothing', async () => {
        const t = await open(file('typing-same.csv', 'h\n1\n'));
        const diff = await t.openSecondEditor();
        await t.edit('h\n1\n');
        assert.strictEqual(t.changes(), 0, 'the tab was marked unsaved');
        assert.strictEqual(diff.updates().length, 0, 'the other editor was sent the text');
    });

    // Escape after a save took the value: the file holds it, the grid does not.
    await test('the end of typing brings back what the grid holds', async () => {
        const p = file('typing-escape.csv', 'h\n1\n');
        const t = await open(p);
        const diff = await t.openSecondEditor();
        await t.typing();
        const saving = t.save();
        await tick();
        await t.flushed('h\nTYPED\n');
        await saving;
        await tick();
        await t.typingEnded('h\n1\n');
        assert.strictEqual(t.doc.content, 'h\n1\n');
        assert.strictEqual(t.tab.isDirty, true, 'the tab looks saved while the file holds a value the grid does not');
        assert.deepStrictEqual(diff.updates().map(m => m.text), ['h\nTYPED\n', 'h\n1\n'], 'the other editor was not told');
        assert.strictEqual(t.updates().length, 0, 'the editor that sent it was sent it back');
        // No cell is open any more, so the next save asks nothing.
        await t.save();
        assert.strictEqual(t.flushes().length, 1);
        assert.strictEqual(fs.readFileSync(p, 'utf8'), 'h\n1\n');
    });

    await test('the end of typing without a text changes nothing', async () => {
        const t = await open(file('typing-end.csv', 'h\n1\n'));
        await t.typing();
        await t.typingEnded();
        assert.strictEqual(t.doc.content, 'h\n1\n');
        assert.strictEqual(t.updates().length, 0);
        await t.save();
        assert.strictEqual(t.flushes().length, 0, 'a closed cell was asked for its value');
    });

    // VS Code marks the tab saved once a save is through, whatever came in
    // while the file was being written.
    await test('an edit that comes in while the file is written leaves the tab unsaved', async () => {
        const p = file('typing-during.csv', 'h\n1\n');
        const t = await open(p);
        await t.edit('h\nFIRST\n');
        duringNextWrite = () => t.edit('h\nSECOND\n');
        await t.save();
        assert.strictEqual(fs.readFileSync(p, 'utf8'), 'h\nFIRST\n');
        await tick();
        assert.strictEqual(t.tab.isDirty, true, 'SECOND sits behind a tab that looks saved');
        assert.strictEqual(t.doc.content, 'h\nSECOND\n');
    });

    await test('a value typed while the file is written leaves the tab unsaved', async () => {
        const p = file('typing-during-typing.csv', 'h\n1\n');
        const t = await open(p);
        await t.typing();
        duringNextWrite = () => t.typing();
        const saving = t.save();
        await tick();
        await t.flushed('h\nTYPED\n');
        await saving;
        await tick();
        assert.strictEqual(t.tab.isDirty, true, 'the newer value sits behind a tab that looks saved');
    });

    await test('a save with nothing new leaves the tab saved', async () => {
        const t = await open(file('typing-clean.csv', 'h\n1\n'));
        await t.edit('h\n2\n');
        await t.save();
        await tick();
        assert.strictEqual(t.tab.isDirty, false);
    });

    await test('an outside change while a value is being typed keeps the grid and warns', async () => {
        const p = file('typing-outside.csv', 'h\n1\n');
        const t = await open(p);
        await t.typing();
        fs.writeFileSync(p, 'h\nEXCEL\n');
        await t.fireWatcher();
        assert.strictEqual(t.updates().length, 0, 'the grid was reloaded under the open cell');
        assert.strictEqual(t.doc.content, 'h\n1\n');
        assert.deepStrictEqual(warnings.map(w => w.msg),
            ['typing-outside.csv changed on disk. Your unsaved edits in the grid were kept.']);
    });

    // Auto-save took the value and marked the tab saved. The grid kept the
    // cell open over the outside change, the commit brought nothing new and
    // the tab closed without asking. The file kept the other program's text.
    await test('an outside change after a save took the value being typed marks the tab unsaved', async () => {
        const p = file('typing-outside-saved.csv', 'h\n1\n');
        const t = await open(p);
        await t.typing();
        const saving = t.save();
        await tick();
        await t.flushed('h\nTYPED\n');
        await saving;
        await tick();
        assert.strictEqual(t.tab.isDirty, false, 'the test did not reach a saved tab');
        fs.writeFileSync(p, 'h\nEXCEL\n');
        await t.fireWatcher();
        assert.strictEqual(t.updates().length, 0, 'the grid was reloaded under the open cell');
        assert.strictEqual(t.tab.isDirty, true, 'the tab looks saved while the file holds another text');
        await t.edit('h\nTYPED\n');
        await t.typingEnded();
        assert.strictEqual(t.tab.isDirty, true);
        // The change on disk waits for a decision, so a save does not write
        // over it. Overwrite then writes the typed value.
        await assert.rejects(t.save(), /changed on disk/, 'the save wrote over the change on disk');
        assert.strictEqual(fs.readFileSync(p, 'utf8'), 'h\nEXCEL\n');
        onScreen()[0].pick('Overwrite');
        await tick();
        assert.strictEqual(fs.readFileSync(p, 'utf8'), 'h\nTYPED\n');
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
        warnings[0].pick('Overwrite');
        await tick();
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
        warnings[0].pick('Overwrite');
        await tick();
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
        await open(p, { backupId: backup.id });
        warnings[0].pick('Overwrite');
        await tick();
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

    // Only a file with no LF at all ends its first line at a CR. A CR inside
    // the header of an LF or CRLF file cut the line short, so the separators
    // after it were not counted and a semicolon file opened split at commas.
    for (const [eol, name] of [['\n', 'LF'], ['\r\n', 'CRLF']]) {
        await test(`a CR inside the header of a ${name} file does not end the first line`, async () => {
            const text = ['"Name\rZusatz";Stadt;Land', 'A;B;C', 'D;E;F'].join(eol) + eol;
            const t = await open(file(`delim-cr-in-${name}.csv`, text));
            assert.strictEqual(t.doc.delimiter, ';');
            const { readFirstLine } = require('../out/largeFileReader.js');
            assert.strictEqual(await readFirstLine(t.uri.fsPath), '"Name\rZusatz";Stadt;Land',
                'the first line the previews detect from');
        });
    }

    await test('Save As onto the file itself is recognized the way VS Code names files', () => {
        // On Windows and macOS VS Code takes Data.csv and data.csv for the same
        // file, so Save As typed in another case is a save of the file itself.
        const a = uriFile('C:\\work\\data.csv');
        const b = uriFile('C:\\Work\\Data.csv');
        assert.strictEqual(sameResource(a, b, 'win32'), true);
        assert.strictEqual(sameResource(a, b, 'darwin'), true);
        assert.strictEqual(sameResource(a, b, 'linux'), false, 'Linux file names are case sensitive');
        assert.strictEqual(sameResource(a, uriFile('C:\\work\\other.csv'), 'win32'), false);
        assert.strictEqual(sameResource(a, uriGit('C:\\work\\data.csv'), 'win32'), false, 'a git side is not the file');
    });

    await test('a quoted header name right behind a byte order mark is read as quoted', async () => {
        const { readFirstLine } = require('../out/largeFileReader.js');
        const p = file('bom-quoted-header.csv', Buffer.concat([BOM, Buffer.from('"Name, Vorname";Stadt\nA;B\n')]));
        assert.strictEqual(await readFirstLine(p), '"Name, Vorname";Stadt');
        const t = await open(p);
        assert.strictEqual(t.doc.delimiter, ';');
    });

    // An inch mark in a header name is part of the name. Only a quote at the
    // start of a value opens a quoted one. Detection took any two quotes for a
    // pair, so the separators between two inch marks did not count. The file
    // opened as one comma column and the first edit wrote the header back as
    // one quoted name. Every way to open a file detects the same way.
    const HEADERS = [
        ['Breite (");Höhe (")', ';', 2],
        ['Diagonale (");Hersteller;Modell;Rahmen (")', ';', 4],
        ['Size 5"\tSize 7"', '\t', 2],
        ['Zoll 5";Zoll 7";Preis, EUR', ';', 3],
        ['"Name, Vorname";Stadt', ';', 2],
    ];
    for (const mode of ['full', 'head', 'tail', 'chunked']) {
        await test(`inch marks in the header leave its delimiter to count in ${mode}`, async () => {
            for (const [i, [header, delimiter, columns]] of HEADERS.entries()) {
                const row = n => Array.from({ length: columns }, (_, c) => n * 10 + c).join(delimiter);
                const p = file(`inch-${mode}-${i}.csv`, [header, row(1), row(2), row(3)].join('\n') + '\n');
                if (mode !== 'full') {
                    fakeSize = 60 * 1024 * 1024;
                    quickPickChoice = mode;
                }
                const t = await open(p);
                assert.strictEqual(t.doc.previewMode, mode, 'the test did not reach ' + mode);
                assert.strictEqual(t.doc.delimiter, delimiter, JSON.stringify(header));
                await t.ready();
                assert.strictEqual(t.posted.find(m => m.type === 'init').delimiter, delimiter,
                    'the grid is told another delimiter for ' + JSON.stringify(header));
            }
        });
    }

    // The header is what detection reads when the file is opened again. The
    // grid writes a value in quotes only when it has to. "Name, Vorname"
    // lost its quotes on the first save, which left one comma against one
    // semicolon. The file opened again as a comma file split in the wrong
    // places.
    await test('a quoted header name keeps a semicolon file a semicolon file after a save', async () => {
        const { parseCsv, toCsv, detectLineFormat } = require('../out/webview/utils/csv.js');
        const text = '"Name, Vorname";Stadt\r\n"Müller, Jörg";Köln\r\n"Schmidt, Anna";Wien\r\n';
        const p = file('quoted-header-save.csv', text);
        const t = await open(p);
        assert.strictEqual(t.doc.delimiter, ';');
        await t.ready();
        // What the grid sends for an edit of one value: the rows it read,
        // written back the way the file ends its lines.
        const rows = parseCsv(text, ';', false, true);
        rows[1][1] = 'Düsseldorf';
        const edited = toCsv(rows, ';', detectLineFormat(text, ';'));
        assert.strictEqual(edited.split('\r\n')[0], '"Name, Vorname";Stadt', 'the header line written');
        await t.edit(edited);
        await t.save();
        t.close();
        const again = await open(p);
        assert.strictEqual(again.doc.delimiter, ';', 'the saved file opens as ' + JSON.stringify(again.doc.delimiter));
    });

    // A header that tells its delimiter plainly is written exactly as it was.
    await test('a header that needs no quotes keeps its bytes', () => {
        const { parseCsv, toCsv, detectLineFormat } = require('../out/webview/utils/csv.js');
        for (const [text, delimiter] of [
            ['Preis;Menge, kg;Summe\r\n1;2;3\r\n', ';'],
            ['Name, Vorname;Stadt;PLZ\n1;2;3\n', ';'],
            ['size;"5"" disk"\n1;2\n', ';'],
            ['a,b;c,d\n1,2,3\n', ','],
            ['a\tb,c\td\n1\t2\t3\n', '\t'],
        ]) {
            const rows = parseCsv(text, delimiter, false, true);
            rows[1][0] = 'X';
            const written = toCsv(rows, delimiter, detectLineFormat(text, delimiter));
            assert.strictEqual(written.split(/\r?\n/)[0], text.split(/\r?\n/)[0], JSON.stringify(text));
        }
    });

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
