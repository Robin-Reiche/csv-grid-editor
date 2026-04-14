import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { getWebviewContent } from './webview';

const LARGE_FILE_THRESHOLD   = 10  * 1024 * 1024; // 10 MB
const CHUNKED_THRESHOLD      = 50  * 1024 * 1024; // 50 MB
const PREVIEW_ROW_COUNT      = 1000;
const PAGE_SIZE              = 500;

interface RowPageIndex {
    offsets: number[];   // byte offset of the first byte of each page's first data row
    totalRows: number;
    headerLine: string;
}

class CsvDocument implements vscode.CustomDocument {
    public content: string;
    public pageIndex: RowPageIndex | null = null;

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
    }

    dispose(): void {}
}

export class CsvEditorProvider implements vscode.CustomEditorProvider<CsvDocument> {

    public static readonly viewType = 'csvViewer.grid';

    private readonly _onDidChangeCustomDocument = new vscode.EventEmitter<vscode.CustomDocumentContentChangeEvent<CsvDocument>>();
    public readonly onDidChangeCustomDocument = this._onDidChangeCustomDocument.event;

    private readonly _webviews = new Map<string, vscode.WebviewPanel>();

    public static register(context: vscode.ExtensionContext): vscode.Disposable {
        return vscode.window.registerCustomEditorProvider(
            CsvEditorProvider.viewType,
            new CsvEditorProvider(context),
            { webviewOptions: { retainContextWhenHidden: true } }
        );
    }

    constructor(private readonly context: vscode.ExtensionContext) {}

    // ── Document lifecycle ──

    async openCustomDocument(
        uri: vscode.Uri,
        _openContext: vscode.CustomDocumentOpenContext,
        _token: vscode.CancellationToken
    ): Promise<CsvDocument> {
        const stat = await vscode.workspace.fs.stat(uri);
        const fileSize = stat.size;

        let content: string = '';
        let isPreview = false;
        let previewMode = 'full';
        let totalLineCount = 0;
        let isChunked = false;

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
                placeHolder: `This file is large (${sizeMB} MB). How would you like to open it?`
            });

            if (!choice) {
                throw new vscode.CancellationError();
            }

            previewMode = choice.id;
            const filePath = uri.fsPath;

            if (previewMode === 'plaintext') {
                content = await fs.promises.readFile(filePath, 'utf8');
                isPreview = true;
            } else if (previewMode === 'head') {
                content = await this.readFirstLines(filePath, PREVIEW_ROW_COUNT + 1);
                totalLineCount = await this.countLines(filePath);
                isPreview = true;
            } else if (previewMode === 'tail') {
                const result = await this.readTailLines(filePath, PREVIEW_ROW_COUNT);
                content = result.content;
                totalLineCount = result.totalLineCount;
                isPreview = true;
            } else if (previewMode === 'chunked') {
                isChunked = true;
                isPreview = true;
                // content stays empty — pages are served on demand
            } else {
                const raw = await vscode.workspace.fs.readFile(uri);
                content = new TextDecoder().decode(raw);
            }
        } else {
            const raw = await vscode.workspace.fs.readFile(uri);
            content = new TextDecoder().decode(raw);
        }

        const delimiter = this.detectDelimiter(uri.fsPath, content);
        const doc = new CsvDocument(uri, content, delimiter, isPreview, previewMode, totalLineCount, isChunked);

        if (isChunked) {
            doc.pageIndex = await this.buildPageIndex(uri.fsPath, PAGE_SIZE);
        }

        return doc;
    }

    async resolveCustomEditor(
        document: CsvDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')]
        };

        this._webviews.set(document.uri.toString(), webviewPanel);
        webviewPanel.onDidDispose(() => this._webviews.delete(document.uri.toString()));

        const fileName  = path.basename(document.uri.fsPath);
        const zoomIndex = this.context.globalState.get<number>('csvGridEditor.zoomIndex', 4);

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
            zoomIndex
        );

        // F3: File System Watcher — auto-reload on external changes (non-preview only)
        let watcher: vscode.FileSystemWatcher | undefined;
        if (!document.isPreview) {
            watcher = vscode.workspace.createFileSystemWatcher(
                new vscode.RelativePattern(vscode.Uri.file(path.dirname(document.uri.fsPath)), path.basename(document.uri.fsPath))
            );
            watcher.onDidChange(async () => {
                try {
                    const raw = await vscode.workspace.fs.readFile(document.uri);
                    document.content = new TextDecoder().decode(raw);
                    webviewPanel.webview.postMessage({
                        type: 'update',
                        text: document.content,
                        delimiter: document.delimiter
                    });
                } catch {}
            });
            webviewPanel.onDidDispose(() => watcher?.dispose());
        }

        webviewPanel.webview.onDidReceiveMessage(async (msg) => {
            if (msg.type === 'ready') {
                if (document.isChunked && document.pageIndex) {
                    const pageText = await this.readPage(document.uri.fsPath, document.pageIndex, 0);
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

            } else if (msg.type === 'edit' && !document.isPreview) {
                document.content = msg.text;
                this._onDidChangeCustomDocument.fire({ document });

            // F4: Export handler
            } else if (msg.type === 'export') {
                const defaultUri = vscode.Uri.file(
                    path.join(path.dirname(document.uri.fsPath), msg.filename ?? 'export.csv')
                );
                const saveUri = await vscode.window.showSaveDialog({
                    defaultUri,
                    filters: { 'CSV files': ['csv'], 'All files': ['*'] }
                });
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
                const pageText = await this.readPage(document.uri.fsPath, document.pageIndex, pageNum);
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
        await vscode.workspace.fs.writeFile(document.uri, new TextEncoder().encode(document.content));
    }

    async saveCustomDocumentAs(document: CsvDocument, destination: vscode.Uri, _cancellation: vscode.CancellationToken): Promise<void> {
        await vscode.workspace.fs.writeFile(destination, new TextEncoder().encode(document.content));
    }

    async revertCustomDocument(document: CsvDocument, _cancellation: vscode.CancellationToken): Promise<void> {
        const raw = await vscode.workspace.fs.readFile(document.uri);
        document.content = new TextDecoder().decode(raw);

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
        await vscode.workspace.fs.writeFile(context.destination, new TextEncoder().encode(document.content));
        return {
            id: context.destination.toString(),
            delete: async () => {
                try { await vscode.workspace.fs.delete(context.destination); } catch {}
            }
        };
    }

    // ── File reading helpers ──

    private async readFirstLines(filePath: string, lineCount: number): Promise<string> {
        return new Promise((resolve, reject) => {
            const lines: string[] = [];
            const input = fs.createReadStream(filePath);
            const rl = readline.createInterface({ input, crlfDelay: Infinity });
            let done = false;

            rl.on('line', (line) => {
                lines.push(line);
                if (lines.length >= lineCount) {
                    done = true;
                    rl.close();
                    input.destroy();
                    resolve(lines.join('\n'));
                }
            });

            rl.on('close', () => { if (!done) resolve(lines.join('\n')); });
            rl.on('error', (err) => { if (!done) reject(err); });
        });
    }

    private async countLines(filePath: string): Promise<number> {
        return new Promise((resolve, reject) => {
            let count = 0;
            const stream = fs.createReadStream(filePath, { highWaterMark: 64 * 1024 });
            stream.on('data', (chunk: string | Buffer) => {
                const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
                for (let i = 0; i < buf.length; i++) {
                    if (buf[i] === 0x0A) count++;
                }
            });
            stream.on('end', () => resolve(count > 0 ? count + 1 : 1));
            stream.on('error', reject);
        });
    }

    private async readTailLines(filePath: string, rowCount: number): Promise<{ content: string; totalLineCount: number }> {
        return new Promise((resolve, reject) => {
            const allLines: string[] = [];
            const input = fs.createReadStream(filePath);
            const rl = readline.createInterface({ input, crlfDelay: Infinity });

            rl.on('line', (line) => allLines.push(line));

            rl.on('close', () => {
                const header = allLines[0] || '';
                const tail = allLines.slice(-rowCount);
                resolve({
                    content: [header, ...tail].join('\n'),
                    totalLineCount: allLines.length
                });
            });
            rl.on('error', reject);
        });
    }

    // ── F7: Chunked / Paged Mode ──

    private async buildPageIndex(filePath: string, pageSize: number): Promise<RowPageIndex> {
        return new Promise((resolve, reject) => {
            const offsets: number[] = [];
            let byteOffset = 0;
            let lineIndex = 0;
            let headerLine = '';
            let dataRowIndex = 0;

            const stream = fs.createReadStream(filePath, { encoding: 'utf8', highWaterMark: 64 * 1024 });
            let partial = '';

            stream.on('data', (chunk: string | Buffer) => {
                const text = partial + (typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
                const lines = text.split('\n');
                partial = lines.pop() ?? '';

                for (const line of lines) {
                    const lineBytes = Buffer.byteLength(line + '\n', 'utf8');
                    if (lineIndex === 0) {
                        headerLine = line;
                    } else {
                        if (dataRowIndex % pageSize === 0) {
                            offsets.push(byteOffset);
                        }
                        dataRowIndex++;
                    }
                    byteOffset += lineBytes;
                    lineIndex++;
                }
            });

            stream.on('end', () => {
                if (partial.trim()) {
                    if (lineIndex > 0) {
                        if (dataRowIndex % pageSize === 0) {
                            offsets.push(byteOffset);
                        }
                    }
                }
                if (offsets.length === 0) offsets.push(0);
                resolve({ offsets, totalRows: dataRowIndex, headerLine });
            });

            stream.on('error', reject);
        });
    }

    private async readPage(filePath: string, index: RowPageIndex, pageNum: number): Promise<string> {
        const startOffset = index.offsets[pageNum];
        const endOffset   = index.offsets[pageNum + 1]; // undefined = read to EOF

        return new Promise((resolve, reject) => {
            const streamOpts: { start: number; end?: number; encoding: BufferEncoding } = {
                start: startOffset,
                encoding: 'utf8'
            };
            if (endOffset !== undefined) {
                streamOpts.end = endOffset - 1;
            }

            const stream = fs.createReadStream(filePath, streamOpts);
            let raw = '';
            stream.on('data', (chunk: string | Buffer) => { raw += typeof chunk === 'string' ? chunk : chunk.toString('utf8'); });
            stream.on('end', () => {
                const lines = raw.split('\n').filter(l => l.trim() !== '');
                resolve([index.headerLine, ...lines].join('\n'));
            });
            stream.on('error', reject);
        });
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
