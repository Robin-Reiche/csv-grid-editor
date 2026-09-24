import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { getWebviewContent } from './webview';
import { delimiterOfFile } from './webview/utils/csv';
import { SETTING_DEFAULTS, isSettingKey, type Settings, type SettingKey } from './webview/settings';
import {
    RowPageIndex,
    PreviewEncoding,
    readFirstRecords,
    countRecords,
    readTailRecords,
    buildPageIndex,
    readFirstLine,
    readPreviewEncoding,
    readPage
} from './largeFileReader';
import { FileEncoding, decodeExactly, decodeFile, encodeFile, isFileEncoding } from './encoding';

const LARGE_FILE_THRESHOLD   = 10  * 1024 * 1024; // 10 MB
const CHUNKED_THRESHOLD      = 50  * 1024 * 1024; // 50 MB
const PREVIEW_ROW_COUNT      = 1000;
const PAGE_SIZE              = 500;
const CANCELLED_PREVIEW_MODE = '__cancelled__';
// How long a save waits for an editor to hand over the value being typed in
// one of its cells (see flushTyping).
const FLUSH_TIMEOUT_MS       = 1000;
// How long a hot exit backup waits for it. The grid writes out the whole
// file for its answer. On a large file or a busy machine that took longer
// than the second a save waits. The backup then went without the value and
// the restart lost it. Nobody waits for a backup while typing, but quitting
// does, so it does not wait for ever either.
const BACKUP_TIMEOUT_MS      = 5000;
const NO_ANSWER              = Symbol('no answer');
// How long and how often Overwrite and Reload from Disk try to bring the
// grid to the front before they give up on running File > Save or File >
// Revert File on it (see toFront).
const FRONT_TIMEOUT_MS       = 1500;
const FRONT_RETRY_MS         = 300;
// How long the unsaved edits of a renamed file wait for VS Code to open it
// under its new name when no grid tab of that name is open (see carryEdits).
// A move to another drive copies the file first.
const CARRY_MS               = 60000;
// How long the unsaved edits of a grid VS Code closed for a rename wait for
// it to tell of that rename (see keepClosed). It tells of an undone rename
// a few milliseconds after it closed the grid.
const CLOSED_MS              = 1000;
// How long VS Code has to tell of a rename after the extension handed on the
// unsaved edits for it before it counts as failed (see renameFailed).
const FAILED_MS              = 2000;

// A hot exit backup is written as UTF-8, which holds any edit whatever the
// file's encoding, but for one thing: a lone surrogate, which it turns into
// U+FFFD. Only UTF-16 can hold one and a save of such a file keeps it, so a
// UTF-16 file is backed up as UTF-16 LE. The id carries the file's encoding
// back to the restore, whether the backup is UTF-16, the fingerprint of the
// file the edits were made on and whether a change on disk still waits for
// Overwrite or Reload from Disk (see restoreBackup). An id from 1.22.0 is the
// bare URI of a backup in UTF-8 without the byte order mark, even when the
// file had one.
interface Backup {
    uri: vscode.Uri;
    encoding?: FileEncoding;
    utf16?: boolean;
    disk?: string;
    conflict?: boolean;
}

function backupId(destination: vscode.Uri, encoding: FileEncoding, utf16: boolean, disk: string, conflict: boolean): string {
    return JSON.stringify({ backup: destination.toString(), encoding, ...(utf16 ? { text: 'utf16le' } : {}), disk, ...(conflict ? { conflict } : {}) });
}

function parseBackupId(id: string): Backup {
    if (!id.startsWith('{')) return { uri: vscode.Uri.parse(id) };
    const { backup, encoding, text, disk, conflict } = JSON.parse(id) as { backup: string; encoding: unknown; text?: unknown; disk?: unknown; conflict?: unknown };
    return {
        uri: vscode.Uri.parse(backup),
        encoding: isFileEncoding(encoding) ? encoding : undefined,
        utf16: text === 'utf16le',
        disk: typeof disk === 'string' ? disk : undefined,
        conflict: conflict === true
    };
}

// Tells whether a file still holds the text and encoding a backup's edits
// were made on without keeping that text in the id. The text goes in as
// UTF-16, the one form in which no two strings look the same.
function fingerprint(text: string, encoding: FileEncoding): string {
    return createHash('sha256').update(encoding + '\0').update(text, 'utf16le').digest('hex');
}

// Told after a save that could not keep the file in Windows-1252, see
// CsvDocument.encode.
function warnSavedAsUtf8(uri: vscode.Uri): void {
    void vscode.window.showWarningMessage(
        `${path.basename(uri.fsPath)} was saved as UTF-8 because it now holds characters that Windows-1252 cannot store.`
    );
}

// The files whose first row is data, not a header ("First row is the header"
// switched off in the grid's settings menu). A property of one file, so it is
// kept per file: one globalState map from the file's URI to true. Only those
// files are in it, a file switched back on is taken out again. Nothing about
// it is written into the file itself.
const HEADERLESS_KEY = 'csvGridEditor.headerless';

// The key of a document's file in that map. VS Code opens the HEAD side of a
// Source Control diff as a grid too, under a git: URI with the file's path and
// the ref in its query. Keyed by that URI, the two grids of the diff were one
// row out of step and a switch made on the HEAD side stayed there.
function headerKey(uri: vscode.Uri): string {
    return uri.scheme === 'git' ? vscode.Uri.file(uri.fsPath).toString() : uri.toString();
}

function isHeaderless(stored: unknown, uri: string): boolean {
    return !!stored && typeof stored === 'object'
        && Object.prototype.hasOwnProperty.call(stored, uri)
        && (stored as Record<string, unknown>)[uri] === true;
}

// The map to store after the switch was set for `uri`. Only true survives
// from what was stored before, so whatever else ended up in there is dropped
// rather than carried along.
export function rememberHeaderRow(stored: unknown, uri: string, firstRowIsHeader: boolean): Record<string, true> {
    const map: Record<string, true> = {};
    if (stored && typeof stored === 'object') {
        for (const [key, value] of Object.entries(stored)) {
            if (value === true) map[key] = true;
        }
    }
    if (firstRowIsHeader) delete map[uri];
    else map[uri] = true;
    return map;
}

// The map to store after the file or folder at `from` was renamed or moved to
// `to`. Null when that changes nothing in it. A folder takes the files in it
// along. What was stored for `to` belonged to a file the move replaced.
export function moveHeaderRows(stored: unknown, from: string, to: string): Record<string, true> | null {
    if (!stored || typeof stored !== 'object') return null;
    const within = (key: string, base: string) => key === base || key.startsWith(base + '/');
    if (!Object.keys(stored).some(key => within(key, from) || within(key, to))) return null;
    const map: Record<string, true> = {};
    for (const [key, value] of Object.entries(stored)) {
        if (value !== true || within(key, to)) continue;
        map[within(key, from) ? to + key.slice(from.length) : key] = true;
    }
    return map;
}

// The unsaved edits of a document whose file VS Code renamed or moved and
// what the file held, as they were at the rename (see takeEdits). The
// document can go on under the old name. For a renamed folder VS Code asks
// whether to save a grid with unsaved edits in it and Save writes the file
// under the old name. Taken from the document after that, the file under the
// new name, which nobody changed, looked changed on disk and every save of it
// was refused.
interface Carried {
    document: CsvDocument;
    content: string;
    encoding: FileEncoding;
    diskText: string;
    conflict: boolean;
    // Set when only a Source Control diff showed the file, no grid tab of
    // its own (see openDiffOnly).
    diffOnly?: boolean;
}

function carried(document: CsvDocument): Carried {
    const { content, encoding, diskText, conflict } = document;
    return { document, content, encoding, diskText, conflict };
}

// A rename or move VS Code told of beforehand (onWillRenameFiles) and not yet
// afterwards (onDidRenameFiles): its files and the edits carryEdits handed on
// for it, by the name they wait under.
interface Renaming {
    files: readonly { readonly oldUri: vscode.Uri; readonly newUri: vscode.Uri }[];
    carried: Map<string, Carried>;
    // For edits that waited for a tab VS Code had not shown since an earlier
    // rename, the name they waited under before (see renameFailed).
    from: Map<string, string>;
    // The edits renameFailed gave back to their document, should VS Code
    // tell of the rename after all (see renamed).
    failed: Map<string, Carried>;
}

// Whether a grid tab of the file `key` is open, shown or not.
function hasGridTab(key: string): boolean {
    return vscode.window.tabGroups.all.some(group => group.tabs.some(tab => tab.input instanceof vscode.TabInputCustom
        && tab.input.viewType === CsvEditorProvider.viewType && tab.input.uri.toString() === key));
}

// The URI of the file `key` names after VS Code renamed or moved `files`,
// the file itself or a folder it lies in. Undefined when none of them is it.
// VS Code moves them one after the other, so a file can move more than once:
// an extension swaps a.csv and b.csv through t.csv. Taken at its first move,
// a.csv stayed at t.csv.
function renamedTo(key: string, files: readonly { readonly oldUri: vscode.Uri; readonly newUri: vscode.Uri }[]): string | undefined {
    let to: string | undefined;
    for (const { oldUri, newUri } of files) {
        const from = oldUri.toString();
        const now = to ?? key;
        if (now === from || now.startsWith(from + '/')) to = newUri.toString() + now.slice(from.length);
    }
    return to;
}

// The watcher's pattern for a file of this name. VS Code reads the pattern as
// a glob. The bare name made data[1].csv match data1.csv and never itself
// ([1] is a character class), the same with the braces in report{2024}.csv.
// Such a file never reloaded. Each glob character goes into brackets of its
// own, which match exactly that character. VS Code also trims the pattern, so
// spaces at either end of the name are bracketed too.
function watchPattern(fileName: string): string {
    return fileName
        .replace(/[[\]{}*?]/g, '[$&]')
        .replace(/^\s+|\s+$/g, spaces => spaces.replace(/[\s\S]/g, '[$&]'));
}

// Whether two URIs name the same file the way VS Code decides it: paths are
// compared without regard to case except on Linux, where file names are case
// sensitive. Save As onto data.csv typed as Data.csv on Windows is Save As
// onto the file itself, and VS Code keeps the document open for it.
export function sameResource(a: vscode.Uri, b: vscode.Uri, platform: string = process.platform): boolean {
    if (a.scheme !== 'file' || b.scheme !== 'file') return a.toString() === b.toString();
    return platform === 'linux' ? a.fsPath === b.fsPath : a.fsPath.toLowerCase() === b.fsPath.toLowerCase();
}

// Whether two file: URIs are two names of one file on disk. A disk that
// ignores case under Linux (WSL's /mnt/c, a FAT stick, an SMB share) takes
// big.csv and BIG.csv for one file, which sameResource cannot know. VS Code's
// copy with overwrite deletes the target first. Here that was the file itself.
async function sameFileOnDisk(a: vscode.Uri, b: vscode.Uri): Promise<boolean> {
    if (a.scheme !== 'file' || b.scheme !== 'file') return false;
    try {
        const [x, y] = await Promise.all([fs.promises.stat(a.fsPath, { bigint: true }), fs.promises.stat(b.fsPath, { bigint: true })]);
        // Some file systems on Windows give every file the number 0. Any two
        // files were taken for one there, so Save As onto another file that
        // was there already left it as it was.
        if (x.ino !== 0n && x.dev === y.dev && x.ino === y.ino) return true;
        // A mount without stable inode numbers (FUSE without use_ino, cifs
        // with noserverino) gives each name a number of its own. The file was
        // still deleted there. Where the two paths differ only in case, a
        // folder that does not list both spellings found one of them by
        // ignoring case. Two files are two entries in it.
        if (a.fsPath.toLowerCase() !== b.fsPath.toLowerCase()) return false;
        const [aParts, bParts] = [a.fsPath.split(path.sep), b.fsPath.split(path.sep)];
        for (let i = 0; i < bParts.length; i++) {
            if (aParts[i] === bParts[i]) continue;
            const names = await fs.promises.readdir(bParts.slice(0, i).join(path.sep) || path.sep);
            if (names.includes(aParts[i]) && names.includes(bParts[i])) return false;
        }
        return true;
    } catch {
        return false;
    }
}

class CsvDocument implements vscode.CustomDocument {
    public content: string;
    public pageIndex: RowPageIndex | null = null;
    // The text we know the file on disk holds: what was read on open, what we
    // last saved, or the outside change we last loaded. The watcher compares
    // against this, not only against content, see reload() below.
    public get diskText(): string {
        return this._diskText;
    }
    public set diskText(text: string) {
        this._diskText = text;
        this.diskPrint = undefined;
        this.editsOnDisk = false;
    }
    private _diskText: string;
    // Set when another program wrote the very text of the grid's unsaved
    // edits (see reload). diskText then holds that text, but the tab still
    // shows the edits unsaved. A change on disk after that is one under
    // unsaved edits all the same. A new diskText drops it.
    public editsOnDisk = false;
    // The file's encoding, byte order mark included (see encoding.ts). The
    // grid never sees either, so the document remembers them and every write
    // puts them back. Excel reads UTF-8 without the mark as ANSI, so a save
    // that dropped it turned every umlaut into mojibake.
    public encoding: FileEncoding = 'utf8';
    // A save that is still being written: its text and the encoding it goes
    // out in. The watcher can report the write before the call returns, and
    // that event is ours. diskText only takes the text once the write has
    // landed, because a write that fails leaves the old file on disk.
    public pendingSave: { text: string; encoding: FileEncoding } | null = null;
    // Set while another program's change to the file waits for the user to
    // choose Overwrite or Reload from Disk on the warning about it (see
    // warnChangedOnDisk). No save is made until then. With auto-save after a
    // delay the next save wrote the edits over the change half a second after
    // the warning offered to load it.
    public conflict = false;
    // Every editor that shows this document. Usually one, but VS Code opens a
    // second editor on the same document for the modified side of a Source
    // Control diff while the grid tab stays open.
    public readonly panels = new Set<vscode.WebviewPanel>();
    // The editors with a cell open that holds a value typed into it, which
    // the document does not have yet. The tab is marked unsaved for it. A
    // save asks each of them for the value first (see flushTyping).
    public readonly typing = new Set<vscode.WebviewPanel>();
    // The answer a save or a backup is waiting for from an editor and how
    // many of them still wait for it, see flushTyping.
    public readonly flushes = new Map<vscode.WebviewPanel, { answer: Promise<unknown>; take(text: unknown): void; waiting: number }>();
    // The file with the value being typed in it, as each editor with such a
    // value sends it while another editor shows the file. A Source Control
    // diff closes without asking while the grid tab stays open. The value
    // then goes to the other editors (see resolveCustomEditor).
    public readonly typed = new Map<vscode.WebviewPanel, string>();
    // The editors whose page has the keyboard, as each page reports it (see
    // toFront).
    public readonly focused = new Set<vscode.WebviewPanel>();
    // How many times the document was reported changed, so a save can tell
    // whether a change came in while it was writing.
    public changes = 0;
    // The one watcher on the file while any editor is open, see
    // resolveCustomEditor. A preview has none.
    public watcher: vscode.FileSystemWatcher | undefined;
    // The fingerprint of diskText in this encoding for the hot exit backup. A
    // backup follows every edit, so hashing a large file each time would add
    // a pause to each of them. A new diskText drops it. Kept together with the
    // text it was taken of, it held on to what the file had before a save
    // until the next edit: as much memory again as a large file takes.
    public diskPrint: { encoding: FileEncoding; print: string } | undefined;

    constructor(
        public readonly uri: vscode.Uri,
        content: string,
        public readonly delimiter: string,
        public readonly isPreview: boolean,
        public readonly previewMode: string,
        public readonly totalLineCount: number,
        public readonly isChunked: boolean = false
    ) {
        this.content = content;
        this._diskText = content;
    }

    dispose(): void {}

    // Sends the message to every editor of this document but `except`.
    post(message: { type: string; [key: string]: unknown }, except?: vscode.WebviewPanel): void {
        for (const panel of this.panels) {
            if (panel === except) continue;
            // A new text closes the cell open in that editor (readText in
            // messaging.ts), so the value typed there is gone.
            if (message.type === 'update') this.typed.delete(panel);
            panel.webview.postMessage(message);
        }
    }

    // The bytes to write for this document and the encoding they are in: the
    // file's own, unless an edit brought in a character that encoding cannot
    // hold. Writing that as a question mark would lose it, so the file turns
    // into UTF-8 with a byte order mark instead, which Excel reads as UTF-8.
    encode(): { bytes: Uint8Array; encoding: FileEncoding } {
        const bytes = encodeFile(this.content, this.encoding);
        if (bytes) return { bytes, encoding: this.encoding };
        return { bytes: encodeFile(this.content, 'utf8bom') as Uint8Array, encoding: 'utf8bom' };
    }

    // The file on disk was found holding the grid's text. A text that differs
    // from diskText is the grid's unsaved edits, which another program wrote.
    recordContentOnDisk(): void {
        if (this.content === this.diskText) return;
        this.diskText = this.content;
        this.editsOnDisk = true;
    }

    // Whether the tab shows edits the file does not have: a text of its own,
    // the very text another program then wrote (editsOnDisk) or a value still
    // being typed in a cell.
    hasUnsavedEdits(): boolean {
        return this.content !== this.diskText || this.editsOnDisk || this.typing.size > 0;
    }
}

export class CsvEditorProvider implements vscode.CustomEditorProvider<CsvDocument> {

    public static readonly viewType = 'csvViewer.grid';

    private readonly _onDidChangeCustomDocument = new vscode.EventEmitter<vscode.CustomDocumentContentChangeEvent<CsvDocument>>();
    public readonly onDidChangeCustomDocument = this._onDidChangeCustomDocument.event;

    // The open documents by URI, so the reload command, which only knows the
    // active tab, can reach the same reload the watcher uses. Keyed by URI
    // and not by editor: an editor closing must not take the document out
    // while another editor still shows it.
    private readonly _documents = new Map<string, CsvDocument>();
    // The unsaved edits that wait for VS Code to open their file under its
    // new name, by the URI of that name (see carryEdits).
    private readonly _carried = new Map<string, Carried>();
    // The unsaved edits of documents whose last editor VS Code just closed
    // for a rename it has not told of yet, by URI (see keepClosed).
    private readonly _closed = new Map<string, Carried>();
    // The documents that took the edits of a renamed file and wait for their
    // first editor to mark the tab unsaved (see takeEdits).
    private readonly _unsaved = new WeakSet<CsvDocument>();
    // The documents that took the edits of a renamed file when they were
    // opened and have no editor yet, by URI, with the edits they took. An
    // extension renamed the file again a few milliseconds after the first
    // rename. Neither in _carried nor in _documents, the document was not
    // found and its edits stayed in a tab of the vanished name (see
    // followCarried).
    private readonly _taking = new Map<string, { document: CsvDocument; from: Carried }>();
    // The renames VS Code told of beforehand and not yet afterwards (see
    // carryEdits).
    private readonly _renaming = new Set<Renaming>();
    // Resolves once VS Code tells of the next rename (see openCustomDocument).
    private _renamed: { promise: Promise<void>; resolve(): void } | undefined;

    public static register(context: vscode.ExtensionContext): vscode.Disposable {
        const provider = new CsvEditorProvider(context);
        return vscode.Disposable.from(
            vscode.window.registerCustomEditorProvider(
                CsvEditorProvider.viewType,
                provider,
                { webviewOptions: { retainContextWhenHidden: true } }
            ),
            vscode.commands.registerCommand('csvViewer.reloadFromDisk', () => provider.reloadActiveFromDisk()),
            vscode.workspace.onWillRenameFiles(e => e.waitUntil(provider.carryEdits(e.files))),
            vscode.workspace.onDidRenameFiles(e => {
                provider.followRenames(e.files);
                provider.renamed(e.files);
            }),
            vscode.window.tabGroups.onDidChangeTabs(e => {
                for (const tab of e.closed) {
                    if (tab.input instanceof vscode.TabInputCustom) provider.tabClosed(tab.input.uri.toString());
                }
            })
        );
    }

    // VS Code renames or moves a file (F2 in the Explorer, a drag, a
    // WorkspaceEdit of an extension) and backs up its unsaved edits. It then
    // opens the file under the new name as a new document without that
    // backup, read from disk. The tab came back saved with the file's old
    // text and closing it asked nothing, so the edits were gone without a
    // word. With a change on disk that still waited for Overwrite or Reload
    // from Disk, the other program's text took their place. VS Code's own
    // text editor keeps them. So a document with unsaved edits hands them to
    // the new name here, a value being typed in a cell included. The new
    // name takes them when it opens (see openCustomDocument). A tab behind
    // another opens only once it is shown. A preview has no edits. The value
    // being typed is waited for as long as a backup waits for it. The grid
    // writes out the whole file for its answer, which took over a second at
    // 90 MB. A rename by an extension leaves the cell open, so the answer
    // came after the edits had gone on without it and the value was lost
    // with the grid VS Code closed.
    private async carryEdits(files: readonly { readonly oldUri: vscode.Uri; readonly newUri: vscode.Uri }[]): Promise<void> {
        const renaming: Renaming = { files, carried: new Map(), from: new Map(), failed: new Map() };
        this.followCarried(files, renaming);
        await Promise.all([...this._documents].map(async ([key, document]) => {
            const to = renamedTo(key, files);
            if (to === undefined || document.isPreview) return;
            if (document.typing.size > 0) await this.flushTyping(document, BACKUP_TIMEOUT_MS);
            if (!document.hasUnsavedEdits()) return;
            const edits: Carried = { ...carried(document), diffOnly: !hasGridTab(key) };
            this.carry(to, edits);
            renaming.carried.set(to, edits);
        }));
        if (renaming.carried.size === 0) return;
        this._renaming.add(renaming);
        setTimeout(() => void this.renameFailed(renaming), FAILED_MS);
        setTimeout(() => this._renaming.delete(renaming), CARRY_MS);
    }

    // VS Code tells of a rename or move. The edits carryEdits handed on for
    // it already wait under the name they end up with. Those of grids VS
    // Code closed for it or has not shown since an earlier rename go along
    // (see followCarried). A rename can take longer than FAILED_MS when
    // another extension is slow over its part of it. It then counted as
    // failed and its edits went back to their document (see renameFailed).
    // They go to the new name now, as the document holds them. For a file
    // only a Source Control diff showed, VS Code closed the diff, no tab
    // opened and the edits were gone at once. A failed rename tried again
    // is told of beforehand once more, so the rename told of now is the last
    // of those.
    private renamed(files: readonly { readonly oldUri: vscode.Uri; readonly newUri: vscode.Uri }[]): void {
        const told = [...this._renaming].filter(renaming => renaming.files.length === files.length && renaming.files.every((file, i) =>
            file.oldUri.toString() === files[i].oldUri.toString() && file.newUri.toString() === files[i].newUri.toString()));
        for (const renaming of told) this._renaming.delete(renaming);
        const renaming = told[told.length - 1];
        this.followCarried(files, renaming);
        if (renaming) {
            for (const [key, { document, diffOnly }] of renaming.failed) {
                if (this._carried.has(key) || !document.hasUnsavedEdits()) continue;
                const edits: Carried = { ...carried(document), diffOnly };
                this.carry(key, edits);
                renaming.carried.set(key, edits);
            }
            this.openDiffOnly(renaming);
        }
        const waiting = this._renamed;
        this._renamed = undefined;
        waiting?.resolve();
    }

    // Resolves once VS Code tells of the next rename or once `ms` have passed.
    private nextRename(ms: number): Promise<void> {
        if (!this._renamed) {
            let resolve!: () => void;
            const promise = new Promise<void>(done => { resolve = done; });
            this._renamed = { promise, resolve };
        }
        const { promise } = this._renamed;
        return new Promise<void>(done => {
            const timer = setTimeout(done, ms);
            void promise.then(() => {
                clearTimeout(timer);
                done();
            });
        });
    }

    // A document that only a Source Control diff showed, no grid tab of its
    // own. VS Code closes such a diff for a rename and opens nothing in its
    // place. The edits carried for it waited unseen and were gone a minute
    // later. VS Code's own text editor turns the diff into a tab of the new
    // name that shows the edits unsaved, so the grid opens one too, behind
    // the editor in front.
    private openDiffOnly(renaming: Renaming): void {
        for (const [key, edits] of renaming.carried) {
            if (!edits.diffOnly || this._carried.get(key) !== edits || hasGridTab(key)) continue;
            void vscode.commands.executeCommand('vscode.openWith', vscode.Uri.parse(key), CsvEditorProvider.viewType,
                { preview: false, preserveFocus: true });
        }
    }

    // A rename VS Code has not told of FAILED_MS after the edits were handed
    // on: a folder without write access, a file another program holds open
    // on Windows. VS Code marks the grid tab saved right before it moves the
    // file and puts the mark back after a failed move only for its own text
    // editor. The grid still showed the edits and closing its tab lost them
    // without a word. So a document still in an editor, with its file still
    // under the old name, is marked unsaved again. The edits handed on for
    // the new name are taken back, a file of that name opened later is
    // another one. A rename that only takes longer brings them to the new
    // name when VS Code tells of it (see renamed). Edits that waited for a
    // tab VS Code had not shown since an earlier rename go back to the name
    // of that tab. Left under the name of the failed move, they were lost to
    // that tab, which showed the file saved from disk. They go back after
    // the others: in a swap the edits of another file can wait under that
    // name for the failed rename.
    private async renameFailed(renaming: Renaming): Promise<void> {
        if (!this._renaming.has(renaming)) return;
        for (const [key, edits] of [...renaming.carried]) {
            const { document } = edits;
            if (renaming.from.has(key) || document.panels.size === 0 || !document.hasUnsavedEdits()) continue;
            try {
                await vscode.workspace.fs.stat(document.uri);
            } catch {
                continue;
            }
            if (!this._renaming.has(renaming) || document.panels.size === 0) continue;
            renaming.carried.delete(key);
            renaming.failed.set(key, edits);
            if (this._carried.get(key) === edits) this._carried.delete(key);
            this.fireChange(document);
        }
        for (const [key, edits] of [...renaming.carried]) {
            const from = renaming.from.get(key);
            if (from === undefined || this._carried.get(key) !== edits) continue;
            try {
                await vscode.workspace.fs.stat(vscode.Uri.parse(from));
            } catch {
                continue;
            }
            if (!this._renaming.has(renaming) || this._carried.get(key) !== edits) continue;
            renaming.carried.delete(key);
            this._carried.delete(key);
            if (!this._carried.has(from)) this.carry(from, edits);
        }
    }

    private carry(key: string, edits: Carried): void {
        this._carried.set(key, edits);
        setTimeout(() => { if (this._carried.get(key) === edits) this.dropCarried(key); }, CARRY_MS);
    }

    // Edits carried to a file that no grid tab shows are dropped: a rename
    // that failed, a name that opens in another editor. A grid tab VS Code
    // has not shown since the rename keeps them until it is shown or closed.
    private dropCarried(key: string): void {
        if (!hasGridTab(key)) this._carried.delete(key);
    }

    // A grid tab was closed. Edits carried to it before VS Code showed it go
    // with it. VS Code tells of a rename before it closes the tab of the old
    // name, so the file of a document kept by keepClosed was not renamed.
    // A rename that writes over a file or swaps it with another closes the
    // tab of that name before it opens the moved file there. It tells of the
    // rename only after that. The edits it carried there were dropped and
    // the file came up saved without them.
    private tabClosed(key: string): void {
        this._closed.delete(key);
        this._taking.delete(key);
        const edits = this._carried.get(key);
        if (edits && [...this._renaming].some(renaming => renaming.carried.get(key) === edits)) return;
        this.dropCarried(key);
    }

    // The last editor of a document with unsaved edits closed while its tab
    // is still open: VS Code renamed or moved its file and closes that tab
    // next. Ctrl+Z in the Explorer undoes a rename without telling the
    // extension beforehand (see carryEdits), so the edits are kept until VS
    // Code tells of the rename a moment later (see followCarried) or closes
    // the tab, for a second at most. Don't Save, Save As and any other close
    // take the tab away before the editor. Kept then, the edits Don't Save
    // threw away came back when the file was renamed later and took the place
    // of a save made since.
    private keepClosed(document: CsvDocument): void {
        if (document.panels.size > 0 || document.isPreview || !document.hasUnsavedEdits()) return;
        if ([...this._carried.values()].some(edits => edits.document === document)) return;
        const key = document.uri.toString();
        if (!hasGridTab(key)) return;
        const edits = carried(document);
        this._closed.set(key, edits);
        setTimeout(() => { if (this._closed.get(key) === edits) this._closed.delete(key); }, CLOSED_MS);
    }

    // Edits carried to a file that VS Code has not shown yet go along when
    // it is renamed again, the same as those of a document kept by
    // keepClosed and those of a document that took edits and has no editor
    // yet. VS Code tells of an undone rename once it started to open the
    // file under its old name again, which waits for them (see
    // openCustomDocument). The edits `renaming` handed on wait under the
    // name they end up with already. Moved once more, the edits of a swap
    // through a third name went back to the name they came from.
    private followCarried(files: readonly { readonly oldUri: vscode.Uri; readonly newUri: vscode.Uri }[], renaming?: Renaming): void {
        const move = (to: string, edits: Carried, from?: string) => {
            if (this._carried.has(to)) return;
            this.carry(to, edits);
            renaming?.carried.set(to, edits);
            if (from !== undefined) renaming?.from.set(to, from);
        };
        for (const kept of [this._carried, this._closed]) {
            for (const [key, edits] of [...kept]) {
                const to = renaming?.carried.get(key) === edits ? undefined : renamedTo(key, files);
                if (to === undefined) continue;
                kept.delete(key);
                move(to, edits, kept === this._carried ? key : undefined);
            }
        }
        for (const [key, { document, from }] of [...this._taking]) {
            const to = renaming?.carried.get(key) === from ? undefined : renamedTo(key, files);
            if (to === undefined) continue;
            this._taking.delete(key);
            // The edits went on, so should VS Code still give it an editor,
            // its tab of the vanished name does not ask to save them.
            this._unsaved.delete(document);
            move(to, carried(document));
        }
    }

    // Gives `doc`, the file under its new name, the unsaved edits `from` held
    // under the old one and their encoding. The file is read for what it
    // holds now. When that is not what the old one held, another program
    // changed it before the watcher of the new name was there to tell, which
    // is warned about the way the watcher does it. So is a change on disk
    // that still waited for Overwrite or Reload from Disk. VS Code only knows
    // the document once it has an editor, so the tab is marked unsaved then.
    private async takeEdits(doc: CsvDocument, from: Carried): Promise<void> {
        doc.content = from.content;
        doc.encoding = from.encoding;
        let changed = false;
        try {
            const raw = await vscode.workspace.fs.readFile(doc.uri);
            const known = encodeFile(from.diskText, from.encoding);
            if (known && Buffer.compare(known, raw) === 0) {
                doc.diskText = from.diskText;
            } else {
                const onDisk = decodeFile(raw, from.encoding);
                doc.diskText = onDisk.text;
                if (onDisk.text !== from.diskText || onDisk.encoding !== from.encoding) {
                    doc.encoding = onDisk.encoding;
                    changed = true;
                }
            }
        } catch {
            doc.diskText = '';
        }
        // The file holds the very edits: the tab still shows them unsaved
        // (see recordContentOnDisk).
        if (doc.diskText === doc.content) doc.editsOnDisk = true;
        if ((changed || from.conflict) && doc.diskText !== doc.content) this.warnChangedOnDisk(doc);
        this._unsaved.add(doc);
    }

    // "First row is the header" is kept by URI. A file renamed or moved in VS
    // Code takes it along, the same as the files in a renamed folder. VS Code
    // opens the file again as a new document, which looks the switch up by
    // the new URI.
    private followRenames(files: readonly { readonly oldUri: vscode.Uri; readonly newUri: vscode.Uri }[]): void {
        let stored: unknown = this.context.globalState.get(HEADERLESS_KEY);
        let changed = false;
        for (const { oldUri, newUri } of files) {
            const moved = moveHeaderRows(stored, oldUri.toString(), newUri.toString());
            if (moved) {
                stored = moved;
                changed = true;
            }
        }
        if (changed) this.context.globalState.update(HEADERLESS_KEY, stored);
    }

    // A copy made by Save As holds the same rows, so it keeps the file's
    // "First row is the header". VS Code opens the copy as a new document,
    // which looks the switch up by the copy's URI.
    private copyHeaderRow(from: vscode.Uri, to: vscode.Uri): void {
        const stored = this.context.globalState.get(HEADERLESS_KEY);
        const headerless = isHeaderless(stored, headerKey(from));
        if (headerless === isHeaderless(stored, headerKey(to))) return;
        this.context.globalState.update(HEADERLESS_KEY, rememberHeaderRow(stored, headerKey(to), !headerless));
    }

    // "CSV Grid: Reload from Disk". File > Revert File cannot serve as the manual
    // escape hatch here: VSCode drops a revert before it reaches the provider
    // unless the document has unsaved changes, so on a file only changed on disk
    // it does nothing at all (issue #25).
    private async reloadActiveFromDisk(): Promise<void> {
        // The grid that is the active editor: a grid tab or a side of a
        // Source Control diff whose sides are grids, a tab VS Code tells an
        // extension nothing about. The other side of such a diff is in front
        // in the same group. It was looked up in the active tab group, which
        // VS Code does not move to a floating window. With the focus in such
        // a window the command took the grid in front in the main window for
        // the one to reload.
        const active = [...this._documents.values()].flatMap(document => [...document.panels]).filter(panel => panel.active);
        let documents = [...this._documents.values()].filter(document => [...document.panels].some(panel =>
            active.some(other => other === panel || (panel.visible && other.viewColumn === panel.viewColumn))));
        if (!documents.length) {
            vscode.window.showWarningMessage('Reload from Disk works on an open CSV Grid Editor tab.');
            return;
        }

        documents = documents.filter(document => !document.isPreview);
        if (!documents.length) {
            vscode.window.showWarningMessage('This grid cannot be reloaded (preview mode).');
            return;
        }

        // Without this the command looks broken whenever the file is already in
        // sync, which is exactly the confusion that made #25 hard to report.
        let changed = false;
        for (const document of documents) {
            if (await this.reloadFromDisk(document)) changed = true;
        }
        if (!changed) {
            vscode.window.setStatusBarMessage('CSV Grid: already up to date', 3000);
        }
    }

    constructor(private readonly context: vscode.ExtensionContext) {}

    // ── Document lifecycle ──

    async openCustomDocument(
        uri: vscode.Uri,
        openContext: vscode.CustomDocumentOpenContext,
        _token: vscode.CancellationToken
    ): Promise<CsvDocument> {
        // The unsaved edits of a file VS Code renamed or moved to this one
        // (see carryEdits). They are taken once, whatever this open does.
        let from = this.takeCarried(uri);

        // Hot exit: VS Code saved the unsaved edits with backupCustomDocument
        // and now hands them back. Reading the file instead brought the tab
        // back dirty but with the old content. The edits were gone.
        if (openContext.backupId) {
            return this.restoreBackup(uri, openContext.backupId);
        }

        // VS Code opens the file of an undone rename under its old name
        // before it tells of that rename, which brings the edits of the grid
        // it closed for it (see keepClosed). For a file over 10 MB the size
        // question came first. Any answer but Open Full File threw the edits
        // away without a word. So the open waits for that rename, a second
        // at most, the same as the edits do.
        if (!from && this._closed.size > 0) {
            await this.nextRename(CLOSED_MS);
            from = this.takeCarried(uri);
        }

        if (from) return this.openCarried(uri, from);

        const stat = await vscode.workspace.fs.stat(uri);
        const fileSize = stat.size;

        let content: string = '';
        let isPreview = false;
        let previewMode = 'full';
        let totalLineCount = 0;
        let isChunked = false;
        let encoding: FileEncoding = 'utf8';
        let scanDelimiter = ',';
        let previewEncoding: PreviewEncoding = 'utf8';

        if (fileSize > LARGE_FILE_THRESHOLD) {
            const sizeMB = (fileSize / (1024 * 1024)).toFixed(2);

            const quickPickItems: (vscode.QuickPickItem & { id: string })[] = [
                { label: '$(file) Open Full File',      description: 'Load all data into the grid (may be slow)', detail: `Full file size: ${sizeMB} MB`, id: 'full' },
                { label: '$(arrow-up) Show Head',       description: `Preview the first ${PREVIEW_ROW_COUNT.toLocaleString()} rows`,                         id: 'head' },
                { label: '$(arrow-down) Show Tail',     description: `Preview the last ${PREVIEW_ROW_COUNT.toLocaleString()} rows`,                          id: 'tail' },
                { label: '$(code) Open as Plain Text',  description: 'Fast raw text view without grid features',                                              id: 'plaintext' },
            ];

            if (fileSize > CHUNKED_THRESHOLD) {
                quickPickItems.splice(1, 0, {
                    label: '$(layers) Paged View',
                    description: `Browse ${PAGE_SIZE}-row pages (efficient for large files)`,
                    detail: `File size: ${sizeMB} MB`,
                    id: 'chunked'
                });
            }

            // Head, tail and the paged view read the file with Node's fs, which
            // knows nothing but the path. The HEAD side of a Source Control
            // diff is a git: URI with the working file's path, so they showed
            // the working copy on both sides of the diff. A file that is not
            // on disk is read through VS Code, which gives only all of it.
            const offered = uri.scheme === 'file'
                ? quickPickItems
                : quickPickItems.filter(item => item.id === 'full' || item.id === 'plaintext');
            const choice = await vscode.window.showQuickPick(offered, {
                placeHolder: `This file is large (${sizeMB} MB). How would you like to open it?`,
                ignoreFocusOut: true
            });

            // A rename VS Code told of while the question was open can have
            // brought unsaved edits for this file. A preview cannot show them
            // and closing the tab would lose them, so they win over the
            // answer.
            const late = this.takeCarried(uri);
            if (late) return this.openCarried(uri, late);

            if (!choice) {
                // Don't throw — VSCode would log the rejection as a hard error. And don't
                // dispose the webview from resolveCustomEditor either — VSCode is still
                // wiring it up at that point and trips an "OverlayWebview has been disposed"
                // race. Instead, return a sentinel doc and close the matching tab via the
                // tabGroups API on the next tick; that lets VSCode manage the webview
                // lifecycle correctly. The resolver returns early for the sentinel.
                queueMicrotask(() => {
                    try {
                        const tab = vscode.window.tabGroups.all
                            .flatMap(group => group.tabs)
                            .find(t =>
                                t.input instanceof vscode.TabInputCustom &&
                                t.input.viewType === CsvEditorProvider.viewType &&
                                t.input.uri.toString() === uri.toString()
                            );
                        if (tab) {
                            void vscode.window.tabGroups.close(tab);
                        }
                    } catch {}
                });
                return new CsvDocument(uri, '', ',', true, CANCELLED_PREVIEW_MODE, 0, false);
            }

            previewMode = choice.id;
            const filePath = uri.fsPath;
            // The record scanners need the delimiter to tell a quote that opens a
            // field from an inch mark inside a value. Detection only reads the
            // first line, so reading that line up front gives the same answer the
            // document gets below. Plain text and the full file never scan.
            if (previewMode === 'head' || previewMode === 'tail' || previewMode === 'chunked') {
                scanDelimiter = this.detectDelimiter(filePath, await readFirstLine(filePath));
                previewEncoding = await readPreviewEncoding(filePath);
            }

            if (previewMode === 'plaintext') {
                content = decodeFile(await vscode.workspace.fs.readFile(uri)).text;
                isPreview = true;
            } else if (previewMode === 'head') {
                content = await readFirstRecords(filePath, PREVIEW_ROW_COUNT + 1, scanDelimiter, previewEncoding);
                totalLineCount = await countRecords(filePath, scanDelimiter);
                isPreview = true;
            } else if (previewMode === 'tail') {
                const result = await readTailRecords(filePath, PREVIEW_ROW_COUNT, scanDelimiter, previewEncoding);
                content = result.content;
                totalLineCount = result.totalRecordCount;
                isPreview = true;
            } else if (previewMode === 'chunked') {
                isChunked = true;
                isPreview = true;
                // content stays empty — pages are served on demand
            } else {
                const raw = await vscode.workspace.fs.readFile(uri);
                ({ text: content, encoding } = decodeFile(raw));
            }
        } else {
            const raw = await vscode.workspace.fs.readFile(uri);
            ({ text: content, encoding } = decodeFile(raw));
        }

        // The paged view learns its row total only from the index, and the preview
        // banner needs that number, so the index is built before the document
        // rather than hung on it afterwards. Header included, the way head and
        // tail count it.
        const pageIndex = isChunked ? await buildPageIndex(uri.fsPath, PAGE_SIZE, scanDelimiter, previewEncoding) : null;
        if (pageIndex) totalLineCount = pageIndex.totalRows + 1;

        // The paged view holds no text of its own, its pages are served on demand,
        // so detection used to look at an empty string, find no separator to count
        // and fall back to the comma whatever the file used (issue #34). The index
        // has already read the header line, which is exactly what detection wants.
        const delimiter = this.detectDelimiter(uri.fsPath, pageIndex ? pageIndex.headerLine : content);

        const doc = new CsvDocument(uri, content, delimiter, isPreview, previewMode, totalLineCount, isChunked);
        doc.pageIndex = pageIndex;
        doc.encoding = encoding;

        return doc;
    }

    // The unsaved edits carried to `uri`, which only one document takes.
    private takeCarried(uri: vscode.Uri): Carried | undefined {
        const from = this._carried.get(uri.toString());
        this._carried.delete(uri.toString());
        return from;
    }

    // All of the file's text, so the size question is not asked.
    private async openCarried(uri: vscode.Uri, from: Carried): Promise<CsvDocument> {
        const doc = new CsvDocument(uri, from.content, from.document.delimiter, false, 'full', 0, false);
        await this.takeEdits(doc, from);
        this._taking.set(uri.toString(), { document: doc, from });
        return doc;
    }

    // Only an editable document gets backed up (a preview never turns dirty),
    // so a restore always opens in full mode and skips the size question.
    private async restoreBackup(uri: vscode.Uri, id: string): Promise<CsvDocument> {
        const { uri: backupUri, encoding, utf16, disk, conflict } = parseBackupId(id);
        const raw = await vscode.workspace.fs.readFile(backupUri);
        // The encoding comes with the id: nothing in plain ASCII text tells
        // Windows-1252 from UTF-8. Every character of the text is the edits',
        // a U+FEFF at its start included.
        const backup = encoding
            ? { text: utf16 ? Buffer.from(raw).toString('utf16le') : new TextDecoder('utf-8', { ignoreBOM: true }).decode(raw), encoding }
            : decodeFile(raw);
        const doc = new CsvDocument(uri, backup.text, this.detectDelimiter(uri.fsPath, backup.text), false, 'full', 0, false);
        doc.encoding = backup.encoding;
        // The watcher and Reload from Disk compare against the file, not
        // against the restored edits. A file deleted since the backup holds
        // nothing. Failing the restore over that would lose the edits too.
        try {
            const raw = await vscode.workspace.fs.readFile(uri);
            const onDisk = decodeFile(raw, backup.encoding);
            doc.diskText = onDisk.text;
            // 1.22.0 backed the edits up without the file's byte order mark,
            // so its backup reads as plain UTF-8 and the next save dropped
            // the mark. Excel then showed the umlauts wrong again. The file
            // on disk still has it.
            if (!encoding && backup.encoding === 'utf8' && onDisk.encoding === 'utf8bom') doc.encoding = 'utf8bom';
            // Another program changed the file while VS Code was closed, a
            // git pull for one. Nothing watched it then. Taking the new file
            // for the one the edits were made on let the next save write
            // over the change without a word. The edits are kept and the
            // user is told, the way the watcher does it. A file that now
            // holds the very edits has nothing to tell.
            let changed = false;
            if (disk !== undefined && fingerprint(onDisk.text, onDisk.encoding) !== disk) {
                // Read by its bytes, a file can give another text than the
                // one the document saved into it: a U+FEFF at the start of a
                // UTF-8 text reads back as the byte order mark. Such a file
                // did not change. Taken for changed, it also took the mark
                // for its encoding and the next save wrote the mark twice.
                const saved = decodeExactly(raw, backup.encoding);
                if (saved !== undefined && fingerprint(saved, backup.encoding) === disk) {
                    doc.diskText = saved;
                } else {
                    doc.encoding = onDisk.encoding;
                    changed = true;
                }
            }
            // A change on disk the user was warned of before quitting and
            // did not decide on is still there. A save would still write over
            // it, so the warning comes back. An edit after the warning
            // made VS Code take a new backup, whose fingerprint is that of the
            // changed file. Then only the mark the id carries tells of it.
            if ((changed || conflict) && doc.diskText !== doc.content) this.warnChangedOnDisk(doc);
            // A file that already holds the restored edits, after a git
            // checkout while VS Code was closed for one. The tab still shows
            // them unsaved, so a change on disk after this is one under
            // unsaved edits (see recordContentOnDisk). Taken for a clean
            // file, the grid loaded it over them without a word.
            if (doc.diskText === doc.content) doc.editsOnDisk = true;
        } catch {
            doc.diskText = '';
        }
        return doc;
    }

    async resolveCustomEditor(
        document: CsvDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        if (document.previewMode === CANCELLED_PREVIEW_MODE) {
            // Cancellation sentinel — openCustomDocument has already scheduled the tab
            // close. Don't touch the webview or VSCode raises an OverlayWebview race.
            return;
        }

        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')]
        };

        const key = document.uri.toString();
        // The edits of an undone rename, which VS Code tells of only after it
        // opened this document from disk (see followCarried). Its grid is
        // not there yet, so it gets them before it shows anything.
        const from = document.panels.size === 0 ? this._carried.get(key) : undefined;
        if (from) {
            this._carried.delete(key);
            if (!document.isPreview && !document.hasUnsavedEdits() && from.document.delimiter === document.delimiter) await this.takeEdits(document, from);
        }
        document.panels.add(webviewPanel);
        if (document.panels.size === 2) this.tellShared(document, webviewPanel);
        this._documents.set(key, document);
        if (this._taking.get(key)?.document === document) this._taking.delete(key);
        webviewPanel.onDidDispose(() => {
            document.panels.delete(webviewPanel);
            document.focused.delete(webviewPanel);
            const typed = document.typing.delete(webviewPanel) ? document.typed.get(webviewPanel) : undefined;
            document.typed.delete(webviewPanel);
            document.flushes.get(webviewPanel)?.take(undefined);
            if (document.panels.size > 0) {
                // VS Code closes a Source Control diff without asking while
                // the file's grid tab is open. Neither Ctrl+W nor the close
                // button takes the focus out of the page first. A value being
                // typed in the diff was lost, while the grid tab went on
                // showing the file unsaved. It goes to the other editors now.
                if (typed !== undefined) this.takeText(document, typed, webviewPanel);
                if (document.panels.size === 1) this.tellShared(document);
                return;
            }
            document.watcher?.dispose();
            document.watcher = undefined;
            if (this._documents.get(key) === document) this._documents.delete(key);
        });
        webviewPanel.onDidDispose(() => this.keepClosed(document));

        const fileName  = path.basename(document.uri.fsPath);
        const zoomIndex = this.context.globalState.get<number>('csvGridEditor.zoomIndex', 4);
        const settings = { ...SETTING_DEFAULTS } as Settings;
        for (const key of Object.keys(SETTING_DEFAULTS) as SettingKey[]) {
            settings[key] = this.context.globalState.get<boolean>('csvGridEditor.' + key, SETTING_DEFAULTS[key]);
        }
        const wrapText  = this.context.globalState.get<boolean>('csvGridEditor.wrapText', false);
        const profileLayout = {
            dock:   this.context.globalState.get<string>('csvGridEditor.profileDock', 'right'),
            width:  this.context.globalState.get<number>('csvGridEditor.profileWidth', 0),
            height: this.context.globalState.get<number>('csvGridEditor.profileHeight', 0)
        };

        webviewPanel.webview.html = getWebviewContent(
            webviewPanel.webview,
            this.context.extensionUri,
            document.delimiter,
            document.isPreview,
            document.previewMode,
            document.totalLineCount,
            fileName,
            document.isChunked,
            process.platform === 'darwin',
            zoomIndex,
            settings,
            wrapText,
            profileLayout
        );

        // F3: File System Watcher. Reloads the grid on outside changes, not in a
        // preview. One per document, however many editors show it. With one per
        // editor the first to read a change took it, the others kept the old text.
        if (!document.isPreview && !document.watcher) {
            const watcher = vscode.workspace.createFileSystemWatcher(
                new vscode.RelativePattern(vscode.Uri.file(path.dirname(document.uri.fsPath)), watchPattern(path.basename(document.uri.fsPath)))
            );
            document.watcher = watcher;

            // Both events reload, not just onDidChange (issue #25). A rewrite in
            // place arrives as a change, but a script that replaces the file —
            // rmtree the folder and write it fresh, or write a temp file and move
            // it over — arrives as a delete followed by a create. Measured on
            // Windows: a python or PowerShell regenerate produced delete+create
            // ~100 ms apart, so it never reached a change-only listener and the
            // grid silently kept showing stale data. onDidDelete is deliberately
            // not wired: the file is gone at that point, and the create that
            // follows is what carries the new content.
            watcher.onDidChange(() => void this.reload(document, true));
            watcher.onDidCreate(() => void this.reload(document, true));
        }

        webviewPanel.webview.onDidReceiveMessage(async (msg) => {
            if (msg.type === 'ready') {
                const firstRowIsHeader = !isHeaderless(this.context.globalState.get(HEADERLESS_KEY), headerKey(document.uri));
                if (document.isChunked && document.pageIndex) {
                    const pageText = await readPage(document.uri.fsPath, document.pageIndex, 0);
                    webviewPanel.webview.postMessage({
                        type: 'init',
                        text: pageText,
                        delimiter: document.delimiter,
                        firstRowIsHeader
                    });
                    webviewPanel.webview.postMessage({
                        type: 'pageData',
                        pageNumber: 0,
                        totalPages: document.pageIndex.offsets.length,
                        text: pageText
                    });
                } else {
                    webviewPanel.webview.postMessage({
                        type: 'init',
                        text: document.content,
                        delimiter: document.delimiter,
                        firstRowIsHeader,
                        shared: document.panels.size > 1
                    });
                }
            } else if (msg.type === 'zoomChanged') {
                this.context.globalState.update('csvGridEditor.zoomIndex', msg.zoomIndex);

            // The settings menu. Only the keys in settings.ts and only real
            // booleans get written: the webview is the other side of a trust
            // boundary, and globalState is shared by every file.
            } else if (msg.type === 'settingChanged') {
                if (isSettingKey(msg.key) && typeof msg.value === 'boolean') {
                    this.context.globalState.update('csvGridEditor.' + msg.key, msg.value);
                }

            // "First row is the header", for this file only. The file is the
            // document this webview belongs to, never one the message names,
            // for the same trust boundary as above.
            } else if (msg.type === 'headerRowChanged') {
                if (typeof msg.value === 'boolean') {
                    this.context.globalState.update(HEADERLESS_KEY,
                        rememberHeaderRow(this.context.globalState.get(HEADERLESS_KEY), headerKey(document.uri), msg.value));
                }

            } else if (msg.type === 'wrapTextChanged') {
                this.context.globalState.update('csvGridEditor.wrapText', msg.wrapText);

            } else if (msg.type === 'profileLayoutChanged') {
                this.context.globalState.update('csvGridEditor.profileDock',   msg.dock);
                this.context.globalState.update('csvGridEditor.profileWidth',  msg.width);
                this.context.globalState.update('csvGridEditor.profileHeight', msg.height);

            } else if (msg.type === 'edit' && !document.isPreview) {
                document.typed.delete(webviewPanel);
                this.takeText(document, msg.text, webviewPanel);

            // A cell of this editor holds a value typed into it. It reaches
            // the document only when the cell is committed, but the tab has
            // to show it unsaved now: Ctrl+W or the tab's close button closed
            // it without asking and the value was lost. Sent with every
            // change of the value. That marks the tab again after a save
            // took the value. VS Code then also backs the file up and
            // auto-saves it only once the typing pauses.
            } else if (msg.type === 'typing' && !document.isPreview) {
                document.typing.add(webviewPanel);
                this.fireChange(document);

            // The cell was closed. When a save took its value and the cell
            // was then left with Escape, the grid sends the text it holds, so
            // the document gives that value up as well.
            } else if (msg.type === 'typingEnded') {
                document.typing.delete(webviewPanel);
                document.typed.delete(webviewPanel);
                if (typeof msg.text === 'string' && !document.isPreview) this.takeText(document, msg.text, webviewPanel);

            // The file with the value being typed in a cell of this editor,
            // which the grid sends while another editor shows the file. Kept
            // for when this editor closes. Without a text the value is the
            // cell's own again.
            } else if (msg.type === 'typedText') {
                if (typeof msg.text === 'string' && document.typing.has(webviewPanel)) document.typed.set(webviewPanel, msg.text);
                else document.typed.delete(webviewPanel);

            } else if (msg.type === 'flushed') {
                document.flushes.get(webviewPanel)?.take(msg.text);
                // The value the save took replaces an older one kept from
                // before, which would take it back when this editor closes.
                // An answer without a text drops it: the value is the cell's
                // own again. A value typed into a Source Control diff and
                // deleted right before a backup came back in the grid tab
                // when the diff closed.
                if (typeof msg.text === 'string' && document.typing.has(webviewPanel)) document.typed.set(webviewPanel, msg.text);
                else document.typed.delete(webviewPanel);

            // Whether this editor's page has the keyboard (see toFront).
            } else if (msg.type === 'focus') {
                if (msg.value === true) document.focused.add(webviewPanel);
                else document.focused.delete(webviewPanel);

            // F4: Export handler — the webview sends the converted text plus a
            // suggested filename; the extension picks dialog filters from its
            // extension (.json / .jsonl / .xml / .md).
            } else if (msg.type === 'export') {
                const filename   = msg.filename ?? 'export.json';
                const defaultUri = vscode.Uri.file(
                    path.join(path.dirname(document.uri.fsPath), filename)
                );
                const ext = path.extname(filename).toLowerCase();
                const filters: Record<string, string[]> =
                    ext === '.jsonl' ? { 'JSON Lines': ['jsonl', 'ndjson'] } :
                    ext === '.xml'   ? { 'XML':        ['xml'] } :
                    ext === '.md'    ? { 'Markdown':   ['md'] } :
                                       { 'JSON':       ['json'] };
                filters['All files'] = ['*'];
                const saveUri = await vscode.window.showSaveDialog({ defaultUri, filters });
                if (saveUri) {
                    await vscode.workspace.fs.writeFile(saveUri, new TextEncoder().encode(msg.text ?? ''));
                    vscode.window.showInformationMessage(`Exported to ${path.basename(saveUri.fsPath)}`);
                }

            // F7: Chunked paging
            } else if (msg.type === 'requestPage' && document.isChunked && document.pageIndex) {
                const totalPages = document.pageIndex.offsets.length;
                let pageNum = msg.pageNumber as number;
                if (pageNum < 0) pageNum = totalPages - 1;
                pageNum = Math.max(0, Math.min(pageNum, totalPages - 1));
                const pageText = await readPage(document.uri.fsPath, document.pageIndex, pageNum);
                webviewPanel.webview.postMessage({
                    type: 'pageData',
                    pageNumber: pageNum,
                    totalPages,
                    text: pageText
                });
            }
        });

        // A document that took the edits of a renamed file (see takeEdits).
        if (this._unsaved.delete(document)) this.fireChange(document);
    }

    // Marks the tab unsaved.
    private fireChange(document: CsvDocument): void {
        document.changes++;
        this._onDidChangeCustomDocument.fire({ document });
    }

    // Tells the editors of the document but `except` whether another editor
    // shows it too. `except` learns it with its init message. A grid that
    // knows of another editor sends the value being typed in it (the
    // typedText message). Writing out the whole file costs a pause on a
    // large one, so a lone editor does not do it.
    private tellShared(document: CsvDocument, except?: vscode.WebviewPanel): void {
        document.post({ type: 'shared', value: document.panels.size > 1 }, except);
    }

    // The whole text of the file as one editor has it now. Another editor of
    // this document that kept the old one would send that back with its next
    // edit and undo this one, so the others get it too. A text the document
    // already holds changes nothing. A save that took a value being typed
    // gets it again when the cell is committed. Marking the tab unsaved for
    // it asked to save a file that already held it.
    private takeText(document: CsvDocument, text: string, from: vscode.WebviewPanel): void {
        if (text === document.content) return;
        document.content = text;
        document.post({ type: 'update', text: document.content, delimiter: document.delimiter }, from);
        this.fireChange(document);
    }

    // A value being typed into a cell reaches the document only when the cell
    // is committed. Auto-save and Save All by its key chord saved the file
    // without it and marked the tab saved. Each editor with such a value is
    // asked for the file with the value in it, which leaves the cell open.
    // Messages from one editor arrive in order, so an edit it sent before its
    // answer is already in the document. An editor that does not answer
    // within `waitMs` is not waited for. Its value is then missing from the
    // file. The result says whether that happened. The other editors get the
    // text as they would an edit (takeText). The commit that follows brings
    // nothing new. Without the text they kept the old one and their next
    // edit wrote it back over the value.
    private async flushTyping(document: CsvDocument, waitMs = FLUSH_TIMEOUT_MS): Promise<boolean> {
        const asking = [...document.typing];
        const answers = asking.map(panel => {
            let flush = document.flushes.get(panel);
            if (!flush) {
                let take!: (text: unknown) => void;
                const answer = new Promise<unknown>(resolve => { take = resolve; });
                flush = { answer, take, waiting: 0 };
                document.flushes.set(panel, flush);
                void answer.then(() => {
                    if (document.flushes.get(panel)?.answer === answer) document.flushes.delete(panel);
                });
                void panel.webview.postMessage({ type: 'flush' });
            }
            // A save and a backup share one answer, but each waits only as
            // long as it may. A save that comes while a backup waits would
            // otherwise wait as long as the backup. Once nobody waits any
            // more, the next one asks again.
            const asked = flush;
            asked.waiting++;
            return new Promise<unknown>(resolve => {
                const timer = setTimeout(() => {
                    if (--asked.waiting === 0) asked.take(NO_ANSWER);
                    resolve(NO_ANSWER);
                }, waitMs);
                void asked.answer.then(text => {
                    clearTimeout(timer);
                    resolve(text);
                });
            });
        });
        let missed = false;
        (await Promise.all(answers)).forEach((text, i) => {
            if (typeof text === 'string' && text !== document.content) {
                document.content = text;
                document.post({ type: 'update', text, delimiter: document.delimiter }, asking[i]);
            }
            if (text === NO_ANSWER) missed = true;
        });
        return missed;
    }

    // Re-reads the file and hands it to every editor of the document. The
    // watcher calls it with fromWatcher for a change on disk, Reload from Disk
    // calls it without.
    private async reload(document: CsvDocument, fromWatcher = false): Promise<boolean> {
        try {
            const raw = await vscode.workspace.fs.readFile(document.uri);
            // Whether the file holds exactly what a save of this text writes.
            const holds = (text: string): boolean => {
                const bytes = encodeFile(text, document.encoding);
                return !!bytes && Buffer.compare(bytes, raw) === 0;
            };
            // Ignore our own writes. saveCustomDocument writes document.content
            // verbatim, so a watcher event whose file holds what we already
            // hold is the echo of our own save, not an external edit. Reloading
            // on it would re-parse the CSV into fresh arrays and wipe in-memory
            // view state (frozen rows, in particular). Only genuinely external
            // changes differ from document.content. The bytes are compared,
            // not the text read back from them: bytes that are valid UTF-8 read
            // as UTF-8 whatever they were written in, so the save of a
            // Windows-1252 file with its last umlaut edited away looked like
            // another program's. The encoding counts this way too, byte order
            // mark included: the grid never sees it, so a program that only
            // changes it leaves the text as it was, but the next save has to
            // write the file the way it is now. A file that holds the grid's
            // text also leaves no change on disk for a save to write over.
            // The disk holds the grid's text now, which is recorded too. Left
            // at an outside change warned about before, that change coming
            // again was taken for the late echo below and ignored. The next
            // save wrote over it. The grid's edits still count as unsaved
            // (see recordContentOnDisk).
            if (holds(document.content)) {
                document.conflict = false;
                document.recordContentOnDisk();
                return false;
            }
            // The echo of a save that is still being written, which the
            // watcher can report before the write call returns. By then the
            // grid may have moved on to a newer edit.
            const pending = document.pendingSave;
            if (fromWatcher && pending) {
                const bytes = encodeFile(pending.text, pending.encoding);
                if (bytes && Buffer.compare(bytes, raw) === 0) return false;
            }
            // The same echo, arriving late. The watcher reports a save only
            // after the write. With auto-save on the next edit can land in
            // between: the editor has moved on, the disk still holds the
            // save and the comparison above sees a difference. Taking that
            // for an outside change reset the grid to the saved text and threw
            // away the newest edit, all of it when the saved text was a header
            // of blank names like ",,,,". A disk that holds what we last knew
            // it holds has nothing new to say. Only the watcher waits like
            // this: Reload from Disk is the explicit request for the disk.
            if (fromWatcher && holds(document.diskText)) return false;
            const { text, encoding } = decodeFile(raw, document.encoding);
            // The same two checks for a file with stray bytes behind a UTF-8
            // byte order mark (see encoding.ts). A save writes those bytes as
            // UTF-8, so its bytes never match the file's, but the text read
            // from it tells whether anything changed.
            if (encoding === document.encoding
                && (text === document.content || (fromWatcher && text === document.diskText))) {
                if (text === document.content) {
                    document.conflict = false;
                    document.recordContentOnDisk();
                }
                return false;
            }
            // Another program changed the file while the grid holds
            // unsaved edits. Loading it silently replaced those edits and
            // left the tab dirty, so the next save made the loss final.
            // Like VS Code's own text editors, keep the edits and let the
            // user choose. Recording the new disk text makes a second
            // event for the same write stay quiet. A later save still
            // resets it to what we wrote. The encoding is recorded as
            // well, so that save keeps the file's new encoding. A value
            // being typed counts as such an edit. The tab shows it unsaved
            // and loading the file would close the cell and drop it. When a
            // save took that value, the tab looks saved and the commit that
            // follows brings nothing new. It is marked unsaved here, since the
            // grid no longer holds what the file does. Closing it lost the
            // value and kept the other program's text.
            if (fromWatcher && document.hasUnsavedEdits()) {
                // A tab whose edits another program wrote is marked unsaved
                // already (see recordContentOnDisk). Marking it again started
                // one more save with auto-save on, which was refused and put
                // the warning up once more.
                const looksSaved = document.content === document.diskText && !document.editsOnDisk;
                document.diskText = text;
                document.encoding = encoding;
                // Another program wrote the grid's text in another encoding,
                // with a byte order mark the file did not have for one. The
                // edits still count as unsaved, so the next change on disk is
                // warned about too. Taken for a change under no unsaved edits,
                // it was loaded over them without a word.
                if (text === document.content) document.editsOnDisk = true;
                if (looksSaved) this.fireChange(document);
                this.warnChangedOnDisk(document);
                return false;
            }
            // When only the encoding changed, the grid already shows this
            // text. Loading it again would cost the view state for nothing.
            const textChanged = text !== document.content;
            document.content = text;
            document.diskText = text;
            document.encoding = encoding;
            document.conflict = false;
            if (textChanged) {
                document.post({
                    type: 'update',
                    text: document.content,
                    delimiter: document.delimiter
                });
            }
            return true;
        } catch {
            return false;
        }
    }

    // The file changed on disk while the grid holds unsaved edits, which were
    // kept. The user chooses whether to load the file instead or to write the
    // edits over it. No save is made until then (see saveCustomDocument).
    // VS Code shows the same message with the same buttons only once, so a
    // second warning replaces the one on screen. Named by the base name alone,
    // the warnings for d1/data.csv and d2/data.csv were one and its buttons
    // acted on the file that warned last.
    private warnChangedOnDisk(document: CsvDocument): void {
        document.conflict = true;
        // In a workspace of several folders the name starts with the folder's
        // name. Two folders of the same name, one/app and two/app, gave their
        // data.csv one name again, so the full path is used then.
        const folder = vscode.workspace.getWorkspaceFolder(document.uri);
        const shared = !!folder && (vscode.workspace.workspaceFolders ?? []).filter(f => f.name === folder.name).length > 1;
        void vscode.window.showWarningMessage(
            `${shared ? document.uri.fsPath : vscode.workspace.asRelativePath(document.uri)} changed on disk. Your unsaved edits in the grid were kept.`,
            'Reload from Disk', 'Overwrite'
        ).then(choice => {
            if (choice === 'Reload from Disk') void this.reloadFromDisk(document);
            else if (choice === 'Overwrite') void this.overwrite(document);
        });
    }

    // Overwrite on that warning: the edits go over the change on disk. The
    // save runs on the grid's own tab the way Ctrl+S does, which also shows
    // why a save failed. workspace.save saved every editor of the file. A
    // text editor of it that had loaded the change wrote it back over the
    // edits. The grid then loaded it as a change on disk. The change on disk
    // is given up only right before that save. Given up first, a save that
    // never ran left the file with the other program's text and no warning.
    // A grid that does not come to the front is written from here, which
    // touches no other editor but leaves its tab marked unsaved. The warning
    // stays in the notification list after its grid tab was closed with
    // Don't Save, which loads the file into the document. Overwrite on it
    // then wrote that text over a newer change on disk. With no editor left
    // there are no edits to write.
    private async overwrite(document: CsvDocument): Promise<void> {
        if (document.panels.size === 0) return;
        if (await this.onOwnTab(document, 'workbench.action.files.save', () => { document.conflict = false; })) return;
        document.conflict = false;
        try {
            await this.saveCustomDocument(document, new vscode.CancellationTokenSource().token);
        } catch (e) {
            void vscode.window.showErrorMessage(`Failed to save '${path.basename(document.uri.fsPath)}': ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    // Reload from Disk, the command and the button on the warning above. A
    // reload under unsaved edits left the tab marked unsaved although the grid
    // showed exactly the file, so closing it asked to save. Only a save or a
    // revert takes that mark off. No API lets an extension revert a document
    // itself. So a tab with unsaved edits goes through File > Revert File,
    // which calls revertCustomDocument. VS Code drops that revert for a tab
    // without unsaved edits (issue #25), so such a tab is reloaded here.
    private async reloadFromDisk(document: CsvDocument): Promise<boolean> {
        return await this.onOwnTab(document, 'workbench.action.files.revert') || this.reload(document);
    }

    // Runs File > Revert File or File > Save on the document's own grid tab
    // and tells whether it ran. Both work on the editor in front of the
    // window that has the focus. A tab without unsaved edits is left alone.
    // `before` runs right before the command.
    private async onOwnTab(document: CsvDocument, command: string, before?: () => void): Promise<boolean> {
        const isOwnTab = (tab: vscode.Tab | undefined): tab is vscode.Tab =>
            tab?.input instanceof vscode.TabInputCustom
            && tab.input.viewType === CsvEditorProvider.viewType
            && tab.input.uri.toString() === document.uri.toString();
        const ownTab = () => vscode.window.tabGroups.all.flatMap(group => group.tabs).find(isOwnTab);
        const tab = ownTab();
        // A document that only a Source Control diff shows has no tab of its
        // own. The unsaved mark sits on the diff's tab, which VS Code tells an
        // extension nothing about. So the document is opened in a tab of its
        // own for the command, which takes the mark off the diff as well. That
        // tab is closed again afterwards, so the editor that was in front
        // comes back. A tab not marked unsaved drops the revert (issue #25),
        // so Reload from Disk then loads the file the way it does for such a
        // tab.
        if (!tab && document.panels.size > 0 && document.hasUnsavedEdits()) {
            const viewColumn = vscode.window.tabGroups.activeTabGroup.viewColumn;
            const inFront = await this.toFront(document, () => vscode.commands.executeCommand('vscode.openWith',
                document.uri, CsvEditorProvider.viewType, { viewColumn, preserveFocus: false, preview: false }));
            const front = ownTab();
            if (front && inFront) {
                const ran = front.isDirty;
                if (ran) {
                    before?.();
                    await vscode.commands.executeCommand(command);
                }
                const opened = ownTab();
                if (opened && !opened.isDirty) await vscode.window.tabGroups.close(opened);
                if (ran) return true;
            }
        }
        if (tab?.isDirty) {
            // The tab comes to the front first. This also takes the focus
            // from the Open Editors view, where the command would act on the
            // selection instead. Should another tab still be in front, the
            // command is not run: a revert would throw away that tab's
            // unsaved edits.
            const viewColumn = tab.group.viewColumn;
            if (await this.toFront(document, () => vscode.commands.executeCommand('vscode.openWith',
                document.uri, CsvEditorProvider.viewType, { viewColumn, preserveFocus: false }))) {
                before?.();
                await vscode.commands.executeCommand(command);
                return true;
            }
        }
        return false;
    }

    // Brings an editor of the document to the front with `open` and tells
    // whether it got there, so that the command above acts on it: VS Code's
    // active editor, with its page holding the keyboard. The active tab
    // group cannot tell. VS Code does not move it to a floating window, so
    // Overwrite found no grid tab in front there and did nothing. With the
    // focus in a floating window, a grid in the main window looked to be in
    // front and Reload from Disk reverted the other window's editor. The
    // active editor alone cannot tell either: a click on a notification gives
    // its window the focus and leaves the active editor as it was. VS Code
    // moves the focus to the window of the tab a moment later. A tab in a
    // floating window often gets only its window to the front at first, so
    // it is brought to the front again until it gets there.
    private async toFront(document: CsvDocument, open: () => Thenable<unknown>): Promise<boolean> {
        const inFront = () => [...document.panels].some(panel => panel.active && document.focused.has(panel));
        const giveUp = Date.now() + FRONT_TIMEOUT_MS;
        while (Date.now() < giveUp) {
            await open();
            const retry = Math.min(Date.now() + FRONT_RETRY_MS, giveUp);
            while (!inFront() && Date.now() < retry) await new Promise(resolve => setTimeout(resolve, 20));
            if (inFront()) return true;
        }
        return false;
    }

    // ── Save / Revert / Backup ──

    async saveCustomDocument(document: CsvDocument, _cancellation: vscode.CancellationToken): Promise<void> {
        if (document.isPreview) {
            vscode.window.showWarningMessage('Cannot save in preview mode. Open the full file to edit.');
            return;
        }
        // A value being typed in a cell goes into the file too (flushTyping).
        // A save refused below does not wait for it.
        const waited = !document.conflict && document.typing.size > 0;
        const missed = waited && await this.flushTyping(document);
        // The changes are counted right after the answer. Anything that
        // comes in after it, during the read below or during the write,
        // marks the tab again once the save is through. Counted after the
        // read, a key typed during it looked written. With auto-save after
        // a delay the tab then looked saved with only part of the value in
        // the file. Ctrl+W threw the rest away.
        const changes = document.changes;
        // A change on disk during that wait can also be reported only after
        // it. With a large file VS Code told of the change once the grid's
        // answer was in, when the save had written over it already. So the
        // file is read once more after the wait, which sets the mark below
        // the way the watcher does (see reload).
        if (waited) await this.reload(document, true);
        // Another program changed the file under the unsaved edits and the
        // user has not chosen between the two yet (see warnChangedOnDisk).
        // Auto-save wrote the edits over that change and Reload from Disk had
        // nothing left to load. The error keeps the tab marked unsaved, the
        // way VS Code's own editor refuses to save over a newer file.
        // The warning comes back with every refused save. Its toast hides
        // after a few seconds and the warning then waits behind the bell,
        // where nobody saw it.
        // The change can also come in while the save waits for the value
        // being typed. The warning showed and the save then wrote over the
        // change all the same. So the mark is looked at once that wait is
        // over, right before the write.
        if (document.conflict) {
            this.warnChangedOnDisk(document);
            throw new Error('The file changed on disk and your edits were not saved over it. Choose Overwrite or Reload from Disk on the warning.');
        }
        // The text goes out as a pending save first, so a watcher event that
        // arrives while the write is still running is known as ours (see
        // reload). It becomes the disk's text only once the write has landed.
        // Taking it for the disk's text up front had two ways to lose edits:
        // an outside change during the write found nothing unsaved and loaded
        // silently over them, and a write that failed (the file locked or
        // read-only) left the provider believing the edits were on disk. The
        // encoding goes with the text, since the watcher compares both.
        const { bytes, encoding } = document.encode();
        const before = document.encoding;
        const pending = { text: document.content, encoding };
        document.pendingSave = pending;
        try {
            await vscode.workspace.fs.writeFile(document.uri, bytes);
        } finally {
            if (document.pendingSave === pending) document.pendingSave = null;
        }
        document.diskText = pending.text;
        document.encoding = encoding;
        if (encoding !== before) warnSavedAsUtf8(document.uri);
        // VS Code marks the tab saved once this returns, whatever came in
        // while the file was being read or written: an edit or a value
        // typed into a cell after the save took the one before. The tab
        // then looked saved without it and closing it lost it. It is marked
        // again once the save is through, the same for a value the save did
        // not get.
        if (missed || document.content !== pending.text || document.changes !== changes) {
            setTimeout(() => this.fireChange(document), 0);
        }
    }

    async saveCustomDocumentAs(document: CsvDocument, destination: vscode.Uri, cancellation: vscode.CancellationToken): Promise<void> {
        // A preview holds only part of the file (Paged View holds none of it)
        // and writing that produced a truncated or empty copy. A preview cannot
        // be edited, so the file on disk is exactly what Save As should give.
        if (document.isPreview) {
            if (!sameResource(destination, document.uri) && !await sameFileOnDisk(document.uri, destination)) {
                await vscode.workspace.fs.copy(document.uri, destination, { overwrite: true });
                this.copyHeaderRow(document.uri, destination);
            }
            return;
        }
        // Save As onto the file itself is a save. VS Code keeps this document
        // open for the tab and marks it saved. Written like a copy, the
        // document went on taking the text from before for the disk's: an
        // outside change after it was ignored or reported as clashing with
        // unsaved edits the tab did not have.
        if (sameResource(destination, document.uri)) {
            return this.saveCustomDocument(document, cancellation);
        }
        // A value being typed in a cell goes into the copy too.
        if (document.typing.size > 0) await this.flushTyping(document);
        // The file itself under another name, SMALL.csv for small.csv on a
        // disk that ignores case under Linux. Written like a copy, it also
        // went over a change on disk that still waited for Overwrite or
        // Reload from Disk. VS Code then shows the file under the other name
        // as a new document, so the header switch goes along to it.
        if (await sameFileOnDisk(document.uri, destination)) {
            await this.saveCustomDocument(document, cancellation);
        } else {
            const { bytes, encoding } = document.encode();
            await vscode.workspace.fs.writeFile(destination, bytes);
            if (encoding !== document.encoding) warnSavedAsUtf8(destination);
        }
        this.copyHeaderRow(document.uri, destination);
    }

    async revertCustomDocument(document: CsvDocument, _cancellation: vscode.CancellationToken): Promise<void> {
        // A preview cannot be edited, so there is nothing to revert. Reading the
        // file here would load all of it, which is what the preview was picked
        // to avoid on a file this large. The grid would also get rows the
        // preview does not show. Re-reading the preview instead would turn
        // revert into a reload, which a preview does not offer either (no
        // watcher, no Reload from Disk). So the preview stays as it is.
        if (document.isPreview) return;
        const raw = await vscode.workspace.fs.readFile(document.uri);
        ({ text: document.content, encoding: document.encoding } = decodeFile(raw, document.encoding));
        document.diskText = document.content;
        document.conflict = false;

        document.post({
            type: 'update',
            text: document.content,
            delimiter: document.delimiter
        });
    }

    async backupCustomDocument(document: CsvDocument, context: vscode.CustomDocumentBackupContext, _cancellation: vscode.CancellationToken): Promise<vscode.CustomDocumentBackup> {
        // A value being typed in a cell marks the tab unsaved, so the backup
        // takes it too, the way a save does (flushTyping). Ctrl+Q with the
        // cell open brought the tab back after the restart without it. The
        // grid tells of every change of the value, so VS Code takes a newer
        // backup once the typing pauses.
        // The grid writes out the whole file for its answer. Above the size
        // where the extension asks how to open a file, that holds the grid
        // up for a third of a second at 35 MB and for over a second at
        // 94 MB, each time the typing pauses. So the backup of such a file
        // keeps what the document has. A value still being typed in it does
        // not come back after a restart. A save still takes it.
        if (document.typing.size > 0 && document.content.length <= LARGE_FILE_THRESHOLD) {
            await this.flushTyping(document, BACKUP_TIMEOUT_MS);
        }
        const utf16 = document.encoding === 'utf16le' || document.encoding === 'utf16be';
        const bytes = utf16 ? Buffer.from(document.content, 'utf16le') : new TextEncoder().encode(document.content);
        await vscode.workspace.fs.writeFile(context.destination, bytes);
        let known = document.diskPrint;
        if (!known || known.encoding !== document.encoding) {
            known = { encoding: document.encoding, print: fingerprint(document.diskText, document.encoding) };
            document.diskPrint = known;
        }
        return {
            id: backupId(context.destination, document.encoding, utf16, known.print, document.conflict),
            delete: async () => {
                try { await vscode.workspace.fs.delete(context.destination); } catch {}
            }
        };
    }

    // ── Delimiter detection ──

    // The grid asks the same function before it writes a header, so a save
    // keeps the delimiter the file opens with.
    private detectDelimiter(fileName: string, content: string): string {
        return delimiterOfFile(fileName, content);
    }
}
