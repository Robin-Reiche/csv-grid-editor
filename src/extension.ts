import * as vscode from 'vscode';
import { CsvEditorProvider } from './csvEditorProvider';
import { showUpdateNote } from './updateNote';

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(CsvEditorProvider.register(context));
    void showUpdateNote(context);
}

export function deactivate() {}
