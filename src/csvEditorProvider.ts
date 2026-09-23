import * as vscode from 'vscode';
import * as path from 'path';
import { createHash } from 'crypto';
import { getWebviewContent } from './webview';
import { firstLineOf } from './webview/utils/csv';
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

// A hot exit backup is written as UTF-8, which holds any edit whatever the
// file's encoding, but for one thing: a lone surrogate, which it turns into
// U+FFFD. Only UTF-16 can hold one and a save of such a file keeps it, so a
// UTF-16 file is backed up as UTF-16 LE. The id carries the file's encoding
// back to the restore, whether the backup is UTF-16 and the fingerprint of the
// file the edits were made on (see restoreBackup). An id from before is the
// bare URI of a backup written the way a save wrote the file then: UTF-8,
// behind the byte order mark if the file had one.
interface Backup {
    uri: vscode.Uri;
    encoding?: FileEncoding;
    utf16?: boolean;
    disk?: string;
}

function backupId(destination: vscode.Uri, encoding: FileEncoding, utf16: boolean, disk: string): string {
    return JSON.stringify({ backup: destination.toString(), encoding, ...(utf16 ? { text: 'utf16le' } : {}), disk });
}

function parseBackupId(id: string): Backup {
    if (!id.startsWith('{')) return { uri: vscode.Uri.parse(id) };
    const { backup, encoding, text, disk } = JSON.parse(id) as { backup: string; encoding: unknown; text?: unknown; disk?: unknown };
    return {
        uri: vscode.Uri.parse(backup),
        encoding: isFileEncoding(encoding) ? encoding : undefined,
        utf16: text === 'utf16le',
        disk: typeof disk === 'string' ? disk : undefined
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
    }
    private _diskText: string;
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
    // Every editor that shows this document. Usually one, but VS Code opens a
    // second editor on the same document for the modified side of a Source
    // Control diff while the grid tab stays open.
    public readonly panels = new Set<vscode.WebviewPanel>();
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
    post(message: unknown, except?: vscode.WebviewPanel): void {
        for (const panel of this.panels) {
            if (panel !== except) panel.webview.postMessage(message);
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

    public static register(context: vscode.ExtensionContext): vscode.Disposable {
        const provider = new CsvEditorProvider(context);
        return vscode.Disposable.from(
            vscode.window.registerCustomEditorProvider(
                CsvEditorProvider.viewType,
                provider,
                { webviewOptions: { retainContextWhenHidden: true } }
            ),
            vscode.commands.registerCommand('csvViewer.reloadFromDisk', () => provider.reloadActiveFromDisk()),
            vscode.workspace.onDidRenameFiles(e => provider.followRenames(e.files))
        );
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
        const group = vscode.window.tabGroups.activeTabGroup;
        const input = group.activeTab?.input;
        let documents: CsvDocument[];
        if (input instanceof vscode.TabInputCustom && input.viewType === CsvEditorProvider.viewType) {
            const document = this._documents.get(input.uri.toString());
            documents = document ? [document] : [];
        } else {
            // A Source Control diff whose sides are grids. VS Code tells an
            // extension nothing about the tab of such a diff, not even its
            // files. Its grids are the ones in front in the group, though.
            documents = [...this._documents.values()].filter(document =>
                [...document.panels].some(panel => panel.visible && panel.viewColumn === group.viewColumn));
            if (!documents.length) {
                vscode.window.showWarningMessage('Reload from Disk works on an open CSV Grid Editor tab.');
                return;
            }
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
        // Hot exit: VS Code saved the unsaved edits with backupCustomDocument
        // and now hands them back. Reading the file instead brought the tab
        // back dirty but with the old content. The edits were gone.
        if (openContext.backupId) {
            return this.restoreBackup(uri, openContext.backupId);
        }

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

    // Only an editable document gets backed up (a preview never turns dirty),
    // so a restore always opens in full mode and skips the size question.
    private async restoreBackup(uri: vscode.Uri, id: string): Promise<CsvDocument> {
        const { uri: backupUri, encoding, utf16, disk } = parseBackupId(id);
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
            // Another program changed the file while VS Code was closed, a
            // git pull for one. Nothing watched it then. Taking the new file
            // for the one the edits were made on let the next save write
            // over the change without a word. The edits are kept and the
            // user is told, the way the watcher does it. A file that now
            // holds the very edits has nothing to tell.
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
                    if (onDisk.text !== doc.content) this.warnChangedOnDisk(doc);
                }
            }
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
        document.panels.add(webviewPanel);
        this._documents.set(key, document);
        webviewPanel.onDidDispose(() => {
            document.panels.delete(webviewPanel);
            if (document.panels.size > 0) return;
            document.watcher?.dispose();
            document.watcher = undefined;
            if (this._documents.get(key) === document) this._documents.delete(key);
        });

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
                        firstRowIsHeader
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
                document.content = msg.text;
                // Every edit sends the whole text. Another editor of this
                // document that kept the old one would send that back with its
                // next edit and undo this one.
                document.post({ type: 'update', text: document.content, delimiter: document.delimiter }, webviewPanel);
                this._onDidChangeCustomDocument.fire({ document });

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
            // write the file the way it is now.
            if (holds(document.content)) return false;
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
                && (text === document.content || (fromWatcher && text === document.diskText))) return false;
            // Another program changed the file while the grid holds
            // unsaved edits. Loading it silently replaced those edits and
            // left the tab dirty, so the next save made the loss final.
            // Like VS Code's own text editors, keep the edits and let the
            // user choose. Recording the new disk text makes a second
            // event for the same write stay quiet. A later save still
            // resets it to what we wrote. The encoding is recorded as
            // well, so that save keeps the file's new encoding.
            if (fromWatcher && document.content !== document.diskText) {
                document.diskText = text;
                document.encoding = encoding;
                this.warnChangedOnDisk(document);
                return false;
            }
            // When only the encoding changed, the grid already shows this
            // text. Loading it again would cost the view state for nothing.
            const textChanged = text !== document.content;
            document.content = text;
            document.diskText = text;
            document.encoding = encoding;
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
    // kept. The user chooses whether to load the file instead.
    private warnChangedOnDisk(document: CsvDocument): void {
        void vscode.window.showWarningMessage(
            `${path.basename(document.uri.fsPath)} changed on disk. Your unsaved edits in the grid were kept.`,
            'Reload from Disk'
        ).then(choice => {
            if (choice === 'Reload from Disk') void this.reloadFromDisk(document);
        });
    }

    // Reload from Disk, the command and the button on the warning above. A
    // reload under unsaved edits left the tab marked unsaved although the grid
    // showed exactly the file, so closing it asked to save. Only a save or a
    // revert takes that mark off. No API lets an extension revert a document
    // itself. So a tab with unsaved edits goes through File > Revert File,
    // which calls revertCustomDocument. VS Code drops that revert for a tab
    // without unsaved edits (issue #25), so such a tab is reloaded here.
    private async reloadFromDisk(document: CsvDocument): Promise<boolean> {
        const isOwnTab = (tab: vscode.Tab | undefined): tab is vscode.Tab =>
            tab?.input instanceof vscode.TabInputCustom
            && tab.input.viewType === CsvEditorProvider.viewType
            && tab.input.uri.toString() === document.uri.toString();
        const ownTab = () => vscode.window.tabGroups.all.flatMap(group => group.tabs).find(isOwnTab);
        const tab = ownTab();
        // A document that only a Source Control diff shows has no tab of its
        // own. The unsaved mark sits on the diff's tab, which VS Code tells an
        // extension nothing about. So the document is opened in a tab of its
        // own for the revert, which takes the mark off the diff as well. That
        // tab is closed again afterwards, so the editor that was in front
        // comes back. A tab not marked unsaved drops the revert (issue #25),
        // so the file is then loaded below the way it is for such a tab.
        if (!tab && document.panels.size > 0 && document.content !== document.diskText) {
            await vscode.commands.executeCommand('vscode.openWith', document.uri, CsvEditorProvider.viewType,
                { viewColumn: vscode.window.tabGroups.activeTabGroup.viewColumn, preserveFocus: false, preview: false });
            const front = vscode.window.tabGroups.activeTabGroup.activeTab;
            if (isOwnTab(front)) {
                const reverted = front.isDirty;
                if (reverted) await vscode.commands.executeCommand('workbench.action.files.revert');
                const opened = ownTab();
                if (opened && !opened.isDirty) await vscode.window.tabGroups.close(opened);
                if (reverted) return true;
            }
        }
        if (tab?.isDirty) {
            // The revert command works on the editor in front, so the tab
            // comes to the front first. This also takes the focus from the
            // Open Editors view, where the command would revert the selection
            // instead. Should another tab still be in front, the command is
            // not run: it would throw away that tab's unsaved edits.
            await vscode.commands.executeCommand('vscode.openWith', document.uri, CsvEditorProvider.viewType,
                { viewColumn: tab.group.viewColumn, preserveFocus: false });
            if (isOwnTab(vscode.window.tabGroups.activeTabGroup.activeTab)) {
                await vscode.commands.executeCommand('workbench.action.files.revert');
                return true;
            }
        }
        return this.reload(document);
    }

    // ── Save / Revert / Backup ──

    async saveCustomDocument(document: CsvDocument, _cancellation: vscode.CancellationToken): Promise<void> {
        if (document.isPreview) {
            vscode.window.showWarningMessage('Cannot save in preview mode. Open the full file to edit.');
            return;
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
    }

    async saveCustomDocumentAs(document: CsvDocument, destination: vscode.Uri, cancellation: vscode.CancellationToken): Promise<void> {
        // A preview holds only part of the file (Paged View holds none of it)
        // and writing that produced a truncated or empty copy. A preview cannot
        // be edited, so the file on disk is exactly what Save As should give.
        if (document.isPreview) {
            if (!sameResource(destination, document.uri)) {
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
        const { bytes, encoding } = document.encode();
        await vscode.workspace.fs.writeFile(destination, bytes);
        if (encoding !== document.encoding) warnSavedAsUtf8(destination);
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

        document.post({
            type: 'update',
            text: document.content,
            delimiter: document.delimiter
        });
    }

    async backupCustomDocument(document: CsvDocument, context: vscode.CustomDocumentBackupContext, _cancellation: vscode.CancellationToken): Promise<vscode.CustomDocumentBackup> {
        const utf16 = document.encoding === 'utf16le' || document.encoding === 'utf16be';
        const bytes = utf16 ? Buffer.from(document.content, 'utf16le') : new TextEncoder().encode(document.content);
        await vscode.workspace.fs.writeFile(context.destination, bytes);
        let known = document.diskPrint;
        if (!known || known.encoding !== document.encoding) {
            known = { encoding: document.encoding, print: fingerprint(document.diskText, document.encoding) };
            document.diskPrint = known;
        }
        return {
            id: backupId(context.destination, document.encoding, utf16, known.print),
            delete: async () => {
                try { await vscode.workspace.fs.delete(context.destination); } catch {}
            }
        };
    }

    // ── Delimiter detection ──

    private detectDelimiter(fileName: string, content: string): string {
        if (fileName.endsWith('.tsv')) return '\t';
        // The first line ends where the grid ends the first row (firstLineOf):
        // counting to an LF in a classic Mac file counted the separators of the
        // whole file, and cutting at any CR split a header whose quoted name
        // holds one.
        // Separators inside a quoted name are part of the name and do not
        // count: "Name, Vorname";Stadt is a semicolon file.
        const firstLine = firstLineOf(content).replace(/"(?:[^"]|"")*"/g, '');
        const semicolons = (firstLine.match(/;/g) || []).length;
        const commas     = (firstLine.match(/,/g) || []).length;
        const tabs       = (firstLine.match(/\t/g) || []).length;
        if (tabs > commas && tabs > semicolons) return '\t';
        if (semicolons > commas) return ';';
        return ',';
    }
}
