import * as vscode from 'vscode';
import { isFeatureUpdate } from './featureUpdate';

const LAST_VERSION_KEY = 'csvGridEditor.lastVersion';
const NOTE_OFF_KEY = 'csvGridEditor.updateNoteOff';
const KOFI_URL = 'https://ko-fi.com/robinreiche';

/**
 * After an update to a new feature release, says so once, with a way to the
 * changelog and to Ko-fi. Stays quiet after a first install and a bug-fix
 * release, and for good once "Don't Show Again" is picked.
 */
export async function showUpdateNote(context: vscode.ExtensionContext): Promise<void> {
    const current: string = context.extension.packageJSON.version;
    const previous = context.globalState.get<string>(LAST_VERSION_KEY);
    if (previous === current) return;
    // Stored before asking, so a note left unanswered does not come back on the next start.
    await context.globalState.update(LAST_VERSION_KEY, current);
    if (!isFeatureUpdate(previous, current) || context.globalState.get<boolean>(NOTE_OFF_KEY)) return;

    const whatsNew = "What's New";
    const coffee = 'Buy Me a Coffee';
    const off = "Don't Show Again";
    const choice = await vscode.window.showInformationMessage(
        `CSV Grid Editor was updated to ${current}. If it saves you time, a coffee on Ko-fi helps keep it free.`,
        whatsNew, coffee, off);
    if (choice === whatsNew) {
        // The extension's own page in VS Code, opened on its Changelog tab.
        await vscode.commands.executeCommand('extension.open', context.extension.id, 'changelog');
    } else if (choice === coffee) {
        await vscode.env.openExternal(vscode.Uri.parse(KOFI_URL));
    } else if (choice === off) {
        await context.globalState.update(NOTE_OFF_KEY, true);
    }
}
