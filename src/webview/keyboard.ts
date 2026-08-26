import { state } from './state';
import { tsvCell } from './utils/csv';
import { undo, redo } from './features/undo-redo';
import { zoomIn, zoomOut } from './features/zoom';
import { openFindBar } from './features/find-replace';
import { insertRowAtFocus, deleteRowsAtFocus } from './features/delete-row-col';

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

export function setupKeyboard(): void {
    document.addEventListener('keydown', onGridShortcut, true /* capture */);

    document.addEventListener('keydown', e => {
        // Single-cell copy. Multi-cell range copy is handled in capture phase by
        // range-select.ts, which stops propagation before this listener runs.
        if ((e.ctrlKey || e.metaKey) && e.key === 'c' && !state.isCellEditing) {
            if (state.gridApi
                    && state.focusedCellColId !== null
                    && state.focusedCellColId !== 'row-index'
                    && state.focusedCellRowIndex !== null) {
                const rowNode = state.gridApi.getDisplayedRowAtIndex(state.focusedCellRowIndex);
                if (rowNode?.data) {
                    const val = rowNode.data[state.focusedCellColId];
                    // Quote the same way the range copy does (range-select.ts).
                    // Without it a cell holding a line break arrives in Excel as
                    // three separate cells, and pasting it back into the grid
                    // creates three rows. tsvCell leaves ordinary values alone.
                    writeToClipboard(val != null ? tsvCell(String(val)) : '');
                    e.preventDefault();
                }
            }
        }

        if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '=')) { zoomIn();  e.preventDefault(); }
        if ((e.ctrlKey || e.metaKey) && e.key === '-') { zoomOut(); e.preventDefault(); }
        if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'h') && !state.isCellEditing) { e.preventDefault(); openFindBar(); }
    });
}
