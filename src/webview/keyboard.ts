import { state } from './state';
import { tsvCell } from './utils/csv';
import { shownValue } from './grid/control-char-cell';
import { undo, redo } from './features/undo-redo';
import { zoomIn, zoomOut, resetZoom } from './features/zoom';
import { openFindBar } from './features/find-replace';
import { insertRowAtFocus, deleteRowsAtFocus } from './features/delete-row-col';
import { commitOpenEditor } from './grid/builder';

function writeToClipboard(text: string): void {
    if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text);
    } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0;';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
    }
}

// The three row shortcuts (issue #36). Each one mirrors the key VS Code's own
// editor puts the same job on, so the grid does not ask anyone to learn a second
// set: Ctrl+Enter a row below, Ctrl+Shift+Enter a row above, Ctrl+Shift+K gone.
//
// The key half of each check is pure and exported so the split can be asserted
// on without a DOM: no combination may claim two jobs, and none of the ones that
// used to insert a line break may go silently dead.
type KeyLike = { key: string; altKey: boolean; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean };

// Whenever Shift is held the browser reports the UPPER-case letter, so every
// letter check has to allow for both. Ctrl+Shift+Z used to be written as
// `key === 'z' && shiftKey`, a condition that can never be true, which is why
// that redo never once fired.
function isLetter(e: KeyLike, letter: string): boolean {
    return e.key.toLowerCase() === letter;
}

export function isInsertRowBelowKey(e: KeyLike): boolean {
    return e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey;
}

export function isInsertRowAboveKey(e: KeyLike): boolean {
    return e.key === 'Enter' && (e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey;
}

export function isDeleteRowKey(e: KeyLike): boolean {
    return isLetter(e, 'k') && (e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey;
}

export function isUndoKey(e: KeyLike): boolean {
    return isLetter(e, 'z') && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey;
}

export function isRedoKey(e: KeyLike): boolean {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return false;
    return (isLetter(e, 'y') && !e.shiftKey) || (isLetter(e, 'z') && e.shiftKey);
}

// The test VS Code's webview host makes before it saves: Ctrl or Cmd with
// the S key, whatever else is held. keyCode names that key on any keyboard
// layout, where `key` may be another letter. AltGr is left out, like in the
// shortcuts above. Chromium on Windows can report it as Ctrl+Alt. AltGr+S
// types a letter on some layouts (Polish ś). It closed the cell and wrote the
// half typed word.
function isSaveKey(e: KeyLike & { keyCode: number }): boolean {
    if (e.ctrlKey && e.altKey && !e.metaKey) return false;
    return (e.ctrlKey || e.metaKey) && e.keyCode === 83;
}

// Ctrl+S saves what is being typed in a cell, the way a spreadsheet does
// (grid/builder.ts commitOpenEditor). Capture phase, so it runs before
// anything in the page can stop the key. The key itself goes on to VS Code,
// which does the saving. Only the key does this. Every other save takes the
// value and leaves the cell open (flushOpenEditor in grid/builder.ts).
function onSaveKey(e: KeyboardEvent): void {
    if (e !== state.chordKey && isSaveKey(e)) commitOpenEditor();
}

// VS Code's two key chords start with Ctrl+K, Cmd+K on macOS, where Ctrl+K
// is a text editing key. The page keeps the focus while VS Code waits for
// the second key, so that key went into the open cell or started typing over
// the focused one: Ctrl+K S (Save All on Windows) put an S into the value.
// The key after the chord's start is VS Code's. It types nothing and nothing
// in the grid acts on it (state.chordKey). It still has to bubble up to the
// window, where VS Code's webview host picks it up to finish the chord, so
// it is never stopped. VS Code gives a chord up after five seconds and so
// does the page. Waiting on, it swallowed the next key typed however late.
// The time the chord started, null with none pending.
let chordStartedAt: number | null = null;
const CHORD_TIMEOUT_MS = 5000;

function isChordStartKey(e: KeyLike & { keyCode: number }): boolean {
    const mac = navigator.userAgent.includes('Macintosh');
    const mod = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
    return mod && !e.shiftKey && !e.altKey && e.keyCode === 75;
}

function onChordKey(e: KeyboardEvent): void {
    // Ctrl and the other modifiers go down on their own between the keys.
    if (e.key === 'Control' || e.key === 'Shift' || e.key === 'Alt' || e.key === 'Meta' || e.key === 'AltGraph') return;
    const started = chordStartedAt;
    chordStartedAt = null;
    if (started === null || e.timeStamp - started > CHORD_TIMEOUT_MS) {
        if (isChordStartKey(e)) chordStartedAt = e.timeStamp;
        return;
    }
    state.chordKey = e;
    e.preventDefault();
    // AG Grid closes an open cell on Escape from a listener of its own. The
    // mark tells that listener to leave the key alone, the way AG Grid's own
    // parts do it.
    agGrid._stopPropagationForAgGrid(e);
}

// The open cell editor is a <textarea> and has to get through — editing is the
// case the issue is about. The find bar, the go-to-row box and the rename field
// are text boxes too and must not move rows around while being typed in.
function isOtherTextInput(t: EventTarget | null): boolean {
    if (!(t instanceof HTMLElement)) return false;
    if (t.classList.contains('csv-multiline-editor')) return false;
    return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable;
}

// Capture phase on purpose: AG Grid handles Enter on the way up, so left to
// bubble, Ctrl+Enter would have committed the edit and moved the focus one row
// down before we ever saw it, and the new row would land a place too low. Undo
// and redo ride along here so nothing between the key and this handler — the
// grid, the open textarea's own undo — can eat them first. stopPropagation keeps
// everything else out of all five.
function onGridShortcut(e: KeyboardEvent): void {
    if (e === state.chordKey) return;
    let run: (() => void) | null = null;
    if (isInsertRowBelowKey(e))      run = () => insertRowAtFocus('below');
    else if (isInsertRowAboveKey(e)) run = () => insertRowAtFocus('above');
    else if (isDeleteRowKey(e))      run = deleteRowsAtFocus;
    else if (isUndoKey(e))           run = undo;
    else if (isRedoKey(e))           run = redo;
    if (!run || isOtherTextInput(e.target)) return;

    e.preventDefault();
    e.stopPropagation();
    run();
}

// The row and column of the cell Ctrl+C copies. The grid tracks the focused
// cell of the body only (onCellFocused in grid/builder.ts), so a focused cell
// in a frozen row is asked of AG Grid. That one copied nothing, although the
// frozen row's menu copies its value.
function copiedCell(): { node: any; colId: string } | null {
    const api = state.gridApi;
    if (!api) return null;
    let node: any;
    let colId: string | null | undefined;
    if (state.focusedCellColId !== null && state.focusedCellRowIndex !== null) {
        node = api.getDisplayedRowAtIndex(state.focusedCellRowIndex);
        colId = state.focusedCellColId;
    } else {
        const f = api.getFocusedCell();
        if (f?.rowPinned !== 'top') return null;
        node = api.getPinnedTopRow(f.rowIndex);
        colId = f.column?.getColId?.();
    }
    if (!node?.data || colId == null || colId === 'row-index') return null;
    return { node, colId };
}

export function setupKeyboard(): void {
    // On the window and in the capture phase, so it runs before every other
    // key handler in the page.
    window.addEventListener('keydown', onChordKey, true /* capture */);
    // VS Code gives the chord up when the focus goes elsewhere.
    window.addEventListener('blur', () => { chordStartedAt = null; });
    document.addEventListener('keydown', onGridShortcut, true /* capture */);
    document.addEventListener('keydown', onSaveKey, true /* capture */);
    // A click on another editor, a view or the menu takes the focus out of
    // the page with a cell still open. The value is committed then, the way
    // a click on another cell commits it. Saves do not wait for this. VS Code
    // can save before the page has lost the focus and a key chord never
    // takes it away. A save asks for the value itself (flushOpenEditor in
    // grid/builder.ts).
    window.addEventListener('blur', () => commitOpenEditor(false));

    document.addEventListener('keydown', e => {
        if (e === state.chordKey) return;
        // Single-cell copy. Multi-cell range copy is handled in capture phase by
        // range-select.ts, which stops propagation before this listener runs.
        // In the find box and the other text boxes the key copies the text
        // selected there, which the browser does. The grid's focused cell went
        // to the clipboard instead.
        if ((e.ctrlKey || e.metaKey) && e.key === 'c' && !state.isCellEditing && !isOtherTextInput(e.target)) {
            const cell = copiedCell();
            if (cell) {
                const val = cell.node.data[cell.colId];
                // Quote the same way the range copy does (range-select.ts).
                // Without it a cell holding a line break arrives in Excel as
                // three separate cells and pasting it back into the grid
                // creates three rows. tsvCell leaves ordinary values alone.
                // The value goes as the cell shows it, the way Export
                // writes it. With "Hide spaces around values" on, the
                // hidden spaces stay off the clipboard.
                writeToClipboard(val != null ? tsvCell(shownValue(String(val))) : '');
                e.preventDefault();
            }
        }

        if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '=')) { zoomIn();  e.preventDefault(); }
        if ((e.ctrlKey || e.metaKey) && e.key === '-') { zoomOut(); e.preventDefault(); }
        // Back to 100%. The zoom is remembered across files and sessions, so a
        // size set once on a wide file follows you everywhere until you undo it,
        // and stepping back was up to five presses of the key above. `key` is
        // '0' for the number row and for NumPad 0 with NumLock on, which covers
        // both the browser shortcut people know (Ctrl+0) and VS Code's own
        // Reset Zoom (Ctrl+NumPad0) in one condition.
        if ((e.ctrlKey || e.metaKey) && e.key === '0') { resetZoom(); e.preventDefault(); }
        if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'h') && !state.isCellEditing) { e.preventDefault(); openFindBar(); }
    });
}
