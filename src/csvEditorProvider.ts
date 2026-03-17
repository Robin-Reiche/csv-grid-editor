import * as vscode from 'vscode';
import { getWebviewContent } from './webview';

export class CsvEditorProvider implements vscode.CustomTextEditorProvider {

    public static readonly viewType = 'csvViewer.grid';

    public static register(context: vscode.ExtensionContext): vscode.Disposable {
        return vscode.window.registerCustomEditorProvider(
            CsvEditorProvider.viewType,
            new CsvEditorProvider(context),
            { webviewOptions: { retainContextWhenHidden: true } }
        );
    }

    constructor(private readonly context: vscode.ExtensionContext) {}

    public async resolveCustomTextEditor(
        document: vscode.TextDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        webviewPanel.webview.options = { enableScripts: true };

        const delimiter = this.detectDelimiter(document.fileName, document.getText());

        webviewPanel.webview.html = getWebviewContent(
            webviewPanel.webview,
            this.context.extensionUri,
            document.getText(),
            delimiter
        );

        // Update webview when document changes
        const changeSubscription = vscode.workspace.onDidChangeTextDocument(e => {
            if (e.document.uri.toString() === document.uri.toString()) {
                webviewPanel.webview.postMessage({
                    type: 'update',
                    text: document.getText(),
                    delimiter
                });
            }
        });

        webviewPanel.onDidDispose(() => {
            changeSubscription.dispose();
        });
    }

    private detectDelimiter(fileName: string, content: string): string {
        if (fileName.endsWith('.tsv')) {
            return '\t';
        }
        const firstLine = content.split('\n')[0] || '';
        const semicolons = (firstLine.match(/;/g) || []).length;
        const commas = (firstLine.match(/,/g) || []).length;
        const tabs = (firstLine.match(/\t/g) || []).length;

        if (tabs > commas && tabs > semicolons) return '\t';
        if (semicolons > commas) return ';';
        return ',';
    }
}
