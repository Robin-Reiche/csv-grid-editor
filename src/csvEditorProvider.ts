import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { getWebviewContent } from './webview';
import { SETTING_DEFAULTS, isSettingKey, type Settings, type SettingKey } from './webview/settings';
import {
    RowPageIndex,
    readFirstRecords,
    countRecords,
    readTailRecords,
    buildPageIndex,
    readFirstLine,
    readPage
} from './largeFileReader';

const LARGE_FILE_THRESHOLD   = 10  * 1024 * 1024; // 10 MB
const CHUNKED_THRESHOLD      = 50  * 1024 * 1024; // 50 MB
const PREVIEW_ROW_COUNT      = 1000;
const PAGE_SIZE              = 500;
const CANCELLED_PREVIEW_MODE = '__cancelled__';

// Excel writes UTF-8 CSV with a byte order mark and reads a file without one
// as ANSI, so a save that drops the mark turns every umlaut into mojibake. The
// grid never sees the mark (TextDecoder strips it, which also keeps it out of
// the first header name), so the document remembers it and every write puts
// it back.
const UTF8_BOM = [0xEF, 0xBB, 0xBF];

function decodeFile(raw: Uint8Array): { text: string; hasBom: boolean } {
    const hasBom = raw.length >= 3 && raw[0] === UTF8_BOM[0] && raw[1] === UTF8_BOM[1] && raw[2] === UTF8_BOM[2];
    return { text: new TextDecoder().decode(raw), hasBom };
}

class CsvDocument implements vscode.CustomDocument {
    public content: string;
    public pageIndex: RowPageIndex | null = null;
    // The text we know the file on disk holds: what was read on open, what we
    // last saved, or the outside change we last loaded. The watcher compares
    // against this, not only against content, see reload() below.
    public diskText: string;
    // Whether the file started with a UTF-8 byte order mark, see decodeFile.
    public hasBom = false;

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
        this.diskText = content;
    }

    dispose(): void {}

    // The bytes to write for this document: its text, behind the byte order
    // mark when the file had one.
    encode(): Uint8Array {
        const body = new TextEncoder().encode(this.content);
        if (!this.hasBom) return body;
        const bytes = new Uint8Array(UTF8_BOM.length + body.length);
        bytes.set(UTF8_BOM);
        bytes.set(body, UTF8_BOM.length);
        return bytes;
    }
}

export class CsvEditorProvider implements vscode.CustomEditorProvider<CsvDocument> {

    public static readonly viewType = 'csvViewer.grid';

    private readonly _onDidChangeCustomDocument = new vscode.EventEmitter<vscode.CustomDocumentContentChangeEvent<CsvDocument>>();
    public readonly onDidChangeCustomDocument = this._onDidChangeCustomDocument.event;

    private readonly _webviews = new Map<string, vscode.WebviewPanel>();

    // Per-open-document "re-read the file and push it to the grid" callbacks, so
    // the reload command can reach the same code path the watcher uses.
    private readonly _reloaders = new Map<string, () => Promise<boolean>>();

    public static register(context: vscode.ExtensionContext): vscode.Disposable {
        const provider = new CsvEditorProvider(context);
        return vscode.Disposable.from(
            vscode.window.registerCustomEditorProvider(
                CsvEditorProvider.viewType,
                provider,
                { webviewOptions: { retainContextWhenHidden: true } }
            ),
            vscode.commands.registerCommand('csvViewer.reloadFromDisk', () => provider.reloadActiveFromDisk())
        );
    }

    // "CSV Grid: Reload from Disk". File > Revert File cannot serve as the manual
    // escape hatch here: VSCode drops a revert before it reaches the provider
    // unless the document has unsaved changes, so on a file only changed on disk
    // it does nothing at all (issue #25).
    private async reloadActiveFromDisk(): Promise<void> {
        const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
        const input = tab?.input;
        if (!(input instanceof vscode.TabInputCustom) || input.viewType !== CsvEditorProvider.viewType) {
            vscode.window.showWarningMessage('Reload from Disk works on an open CSV Grid Editor tab.');
            return;
        }

        const reload = this._reloaders.get(input.uri.toString());
        if (!reload) {
            vscode.window.showWarningMessage('This grid cannot be reloaded (preview mode).');
            return;
        }

        // Without this the command looks broken whenever the file is already in
        // sync, which is exactly the confusion that made #25 hard to report.
        const changed = await reload();
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
        let hasBom = false;
        let scanDelimiter = ',';

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

            const choice = await vscode.window.showQuickPick(quickPickItems, {
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
            }

            if (previewMode === 'plaintext') {
                content = await fs.promises.readFile(filePath, 'utf8');
                isPreview = true;
            } else if (previewMode === 'head') {
                content = await readFirstRecords(filePath, PREVIEW_ROW_COUNT + 1, scanDelimiter);
                totalLineCount = await countRecords(filePath, scanDelimiter);
                isPreview = true;
            } else if (previewMode === 'tail') {
                const result = await readTailRecords(filePath, PREVIEW_ROW_COUNT, scanDelimiter);
                content = result.content;
                totalLineCount = result.totalRecordCount;
                isPreview = true;
            } else if (previewMode === 'chunked') {
                isChunked = true;
                isPreview = true;
                // content stays empty — pages are served on demand
            } else {
                const raw = await vscode.workspace.fs.readFile(uri);
                ({ text: content, hasBom } = decodeFile(raw));
            }
        } else {
            const raw = await vscode.workspace.fs.readFile(uri);
            ({ text: content, hasBom } = decodeFile(raw));
        }

        // The paged view learns its row total only from the index, and the preview
        // banner needs that number, so the index is built before the document
        // rather than hung on it afterwards. Header included, the way head and
        // tail count it.
        const pageIndex = isChunked ? await buildPageIndex(uri.fsPath, PAGE_SIZE, scanDelimiter) : null;
        if (pageIndex) totalLineCount = pageIndex.totalRows + 1;

        // The paged view holds no text of its own, its pages are served on demand,
        // so detection used to look at an empty string, find no separator to count
        // and fall back to the comma whatever the file used (issue #34). The index
        // has already read the header line, which is exactly what detection wants.
        const delimiter = this.detectDelimiter(uri.fsPath, pageIndex ? pageIndex.headerLine : content);

        const doc = new CsvDocument(uri, content, delimiter, isPreview, previewMode, totalLineCount, isChunked);
        doc.pageIndex = pageIndex;
        doc.hasBom = hasBom;

        return doc;
    }

    // Only an editable document gets backed up (a preview never turns dirty),
    // so a restore always opens in full mode and skips the size question.
    private async restoreBackup(uri: vscode.Uri, backupId: string): Promise<CsvDocument> {
        const backup = decodeFile(await vscode.workspace.fs.readFile(vscode.Uri.parse(backupId)));
        const doc = new CsvDocument(uri, backup.text, this.detectDelimiter(uri.fsPath, backup.text), false, 'full', 0, false);
        doc.hasBom = backup.hasBom;
        // The watcher and Reload from Disk compare against the file, not
        // against the restored edits. A file deleted since the backup holds
        // nothing. Failing the restore over that would lose the edits too.
        try {
            doc.diskText = decodeFile(await vscode.workspace.fs.readFile(uri)).text;
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

        this._webviews.set(document.uri.toString(), webviewPanel);
        webviewPanel.onDidDispose(() => this._webviews.delete(document.uri.toString()));

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

        // F3: File System Watcher — auto-reload on external changes (non-preview only)
        let watcher: vscode.FileSystemWatcher | undefined;
        if (!document.isPreview) {
            watcher = vscode.workspace.createFileSystemWatcher(
                new vscode.RelativePattern(vscode.Uri.file(path.dirname(document.uri.fsPath)), path.basename(document.uri.fsPath))
            );
            const reload = async (fromWatcher = false): Promise<boolean> => {
                try {
                    const raw = await vscode.workspace.fs.readFile(document.uri);
                    const { text, hasBom } = decodeFile(raw);
                    // Ignore our own writes. saveCustomDocument writes document.content
                    // verbatim, so a watcher event whose content equals what we already
                    // hold is the echo of our own save, not an external edit. Reloading
                    // on it would re-parse the CSV into fresh arrays and wipe in-memory
                    // view state (frozen rows, in particular). Only genuinely external
                    // changes differ from document.content. The byte order mark
                    // counts too: the grid never sees it, so a program that only
                    // adds or removes it leaves the text as it was, but the next
                    // save has to write the file the way it is now.
                    if (text === document.content && hasBom === document.hasBom) return false;
                    // The same echo, arriving late. The watcher reports a save only
                    // after the write, and with auto-save on the next edit can land
                    // in between: the editor has moved on, the disk still holds the
                    // save, and the comparison above sees a difference. Taking that
                    // for an outside change reset the grid to the saved text and threw
                    // away the newest edit, all of it when the saved text was a header
                    // of blank names like ",,,,". A disk that holds what we last knew
                    // it holds has nothing new to say. Only the watcher waits like
                    // this: Reload from Disk is the explicit request for the disk.
                    if (fromWatcher && text === document.diskText && hasBom === document.hasBom) return false;
                    // Another program changed the file while the grid holds
                    // unsaved edits. Loading it silently replaced those edits and
                    // left the tab dirty, so the next save made the loss final.
                    // Like VS Code's own text editors, keep the edits and let the
                    // user choose. Recording the new disk text makes a second
                    // event for the same write stay quiet. A later save still
                    // resets it to what we wrote. The mark is recorded as well,
                    // so that save keeps the file's new mark or lack of one.
                    if (fromWatcher && document.content !== document.diskText) {
                        document.diskText = text;
                        document.hasBom = hasBom;
                        void vscode.window.showWarningMessage(
                            `${fileName} changed on disk. Your unsaved edits in the grid were kept.`,
                            'Reload from Disk'
                        ).then(choice => {
                            if (choice === 'Reload from Disk') void reload();
                        });
                        return false;
                    }
                    // When only the mark changed, the grid already shows this
                    // text. Loading it again would cost the view state for nothing.
                    const textChanged = text !== document.content;
                    document.content = text;
                    document.diskText = text;
                    document.hasBom = hasBom;
                    if (textChanged) {
                        webviewPanel.webview.postMessage({
                            type: 'update',
                            text: document.content,
                            delimiter: document.delimiter
                        });
                    }
                    return true;
                } catch {
                    return false;
                }
            };
            this._reloaders.set(document.uri.toString(), reload);
            webviewPanel.onDidDispose(() => this._reloaders.delete(document.uri.toString()));

            // Both events reload, not just onDidChange (issue #25). A rewrite in
            // place arrives as a change, but a script that replaces the file —
            // rmtree the folder and write it fresh, or write a temp file and move
            // it over — arrives as a delete followed by a create. Measured on
            // Windows: a python or PowerShell regenerate produced delete+create
            // ~100 ms apart, so it never reached a change-only listener and the
            // grid silently kept showing stale data. onDidDelete is deliberately
            // not wired: the file is gone at that point, and the create that
            // follows is what carries the new content.
            watcher.onDidChange(() => void reload(true));
            watcher.onDidCreate(() => void reload(true));
            webviewPanel.onDidDispose(() => watcher?.dispose());
        }

        webviewPanel.webview.onDidReceiveMessage(async (msg) => {
            if (msg.type === 'ready') {
                if (document.isChunked && document.pageIndex) {
                    const pageText = await readPage(document.uri.fsPath, document.pageIndex, 0);
                    webviewPanel.webview.postMessage({
                        type: 'init',
                        text: pageText,
                        delimiter: document.delimiter
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
                        delimiter: document.delimiter
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

            } else if (msg.type === 'wrapTextChanged') {
                this.context.globalState.update('csvGridEditor.wrapText', msg.wrapText);

            } else if (msg.type === 'profileLayoutChanged') {
                this.context.globalState.update('csvGridEditor.profileDock',   msg.dock);
                this.context.globalState.update('csvGridEditor.profileWidth',  msg.width);
                this.context.globalState.update('csvGridEditor.profileHeight', msg.height);

            } else if (msg.type === 'edit' && !document.isPreview) {
                document.content = msg.text;
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

    // ── Save / Revert / Backup ──

    async saveCustomDocument(document: CsvDocument, _cancellation: vscode.CancellationToken): Promise<void> {
        if (document.isPreview) {
            vscode.window.showWarningMessage('Cannot save in preview mode. Open the full file to edit.');
            return;
        }
        // Recorded before the write, so the watcher event it causes is known as
        // ours however late it arrives (see reload in resolveCustomEditor).
        document.diskText = document.content;
        await vscode.workspace.fs.writeFile(document.uri, document.encode());
    }

    async saveCustomDocumentAs(document: CsvDocument, destination: vscode.Uri, _cancellation: vscode.CancellationToken): Promise<void> {
        // A preview holds only part of the file (Paged View holds none of it)
        // and writing that produced a truncated or empty copy. A preview cannot
        // be edited, so the file on disk is exactly what Save As should give.
        if (document.isPreview) {
            if (destination.toString() !== document.uri.toString()) {
                await vscode.workspace.fs.copy(document.uri, destination, { overwrite: true });
            }
            return;
        }
        await vscode.workspace.fs.writeFile(destination, document.encode());
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
        ({ text: document.content, hasBom: document.hasBom } = decodeFile(raw));
        document.diskText = document.content;

        const panel = this._webviews.get(document.uri.toString());
        if (panel) {
            panel.webview.postMessage({
                type: 'update',
                text: document.content,
                delimiter: document.delimiter
            });
        }
    }

    async backupCustomDocument(document: CsvDocument, context: vscode.CustomDocumentBackupContext, _cancellation: vscode.CancellationToken): Promise<vscode.CustomDocumentBackup> {
        await vscode.workspace.fs.writeFile(context.destination, document.encode());
        return {
            id: context.destination.toString(),
            delete: async () => {
                try { await vscode.workspace.fs.delete(context.destination); } catch {}
            }
        };
    }

    // ── Delimiter detection ──

    private detectDelimiter(fileName: string, content: string): string {
        if (fileName.endsWith('.tsv')) return '\t';
        const firstLine = content.split('\n')[0] || '';
        const semicolons = (firstLine.match(/;/g) || []).length;
        const commas     = (firstLine.match(/,/g) || []).length;
        const tabs       = (firstLine.match(/\t/g) || []).length;
        if (tabs > commas && tabs > semicolons) return '\t';
        if (semicolons > commas) return ';';
        return ',';
    }
}
