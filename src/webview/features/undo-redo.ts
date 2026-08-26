import { state } from '../state';
import { toCsv } from '../utils/csv';
import { refreshGrid, syncColumnHeaders } from '../grid/refresh';
import { recomputeColTypes } from '../grid/column-type';
import { resetDuplicatesState } from './duplicates';
import { refreshProfileIfOpen } from './profile';
import type { UndoSnapshot } from '../types';

// Captures the undoable view state: a deep clone of the data plus the freeze
// state. The freeze is stored by POSITION (frozen-row indices, pinned-column
// indices) so it survives the deep clone — the clone makes new row arrays, so the
// reference-based state.frozenRowRefs would otherwise go stale after a restore.
// Captured together with the data so positions and data are always consistent.
export function snapshot(): UndoSnapshot {
    return {
        data: JSON.parse(JSON.stringify(state.data)),
        frozenRowIdx: state.frozenRowRefs.map(r => state.data.indexOf(r)).filter(i => i >= 0),
        pinnedCols: [...state.pinnedCols],
    };
}

function restore(snap: UndoSnapshot): void {
    state.data = snap.data;
    // Re-anchor frozen rows to the restored (cloned) arrays at their saved
    // positions, and restore the frozen-column set.
    state.frozenRowRefs = snap.frozenRowIdx.map(i => state.data[i]).filter(Boolean) as string[][];
    state.pinnedCols = new Set(snap.pinnedCols);
}

export function pushUndo(): void {
    state.undoStack.push(snapshot());
    state.redoStack = [];
    state.autoFitCache = null;
    updateButtons();
}

// While a cell is open for editing, undo and redo belong to that cell: they take
// back what is being typed and leave the editor open, the way a spreadsheet does.
// Reaching past the unfinished edit to the last committed action would undo
// something the user is not even looking at. Both the toolbar buttons and Ctrl+Z
// come through here, so both behave the same.
type OpenCellEditor = {
    undoText(): boolean;
    redoText(): boolean;
    canUndo(): boolean;
    canRedo(): boolean;
};

function openCellEditor(): OpenCellEditor | null {
    if (!state.isCellEditing || !state.gridApi) return null;
    const open = state.gridApi.getCellEditorInstances?.() as any[] | undefined;
    return open?.find(i => typeof i?.undoText === 'function') ?? null;
}

export function undo(): void {
    const editor = openCellEditor();
    if (editor) { editor.undoText(); return; }
    if (state.undoStack.length === 0) return;
    state.redoStack.push(snapshot());
    restore(state.undoStack.pop()!);
    refreshGrid();
    syncColumnHeaders(); // header row may have changed (rename column)
    notifyChange();
    updateButtons();
    recomputeColTypes();
}

export function redo(): void {
    const editor = openCellEditor();
    if (editor) { editor.redoText(); return; }
    if (state.redoStack.length === 0) return;
    state.undoStack.push(snapshot());
    restore(state.redoStack.pop()!);
    refreshGrid();
    syncColumnHeaders(); // header row may have changed (rename column)
    notifyChange();
    updateButtons();
    recomputeColTypes();
}

export function updateButtons(): void {
    const u = document.getElementById('btn-undo') as HTMLButtonElement | null;
    const r = document.getElementById('btn-redo') as HTMLButtonElement | null;
    // While a cell is open the buttons belong to that cell's own history, exactly
    // like the keys do. Reading the grid's stacks there left them greyed out with
    // a cell full of typing waiting to be taken back.
    const editor = openCellEditor();
    if (u) u.disabled = editor ? !editor.canUndo() : state.undoStack.length === 0;
    if (r) r.disabled = editor ? !editor.canRedo() : state.redoStack.length === 0;
}

export function notifyChange(): void {
    // Edits invalidate duplicate-detection results (rows may have been added,
    // deleted, or modified into / out of being a duplicate). Clearing here
    // covers cell edits, undo/redo, find-replace, and row/column deletions.
    resetDuplicatesState();
    // Every data mutation funnels through here, so it is the one place that
    // guarantees the analysis panel reflects the current data (row counts,
    // nulls, stats, and the column set) after a delete/insert/paste/edit/undo.
    refreshProfileIfOpen();
    vscodeApi.postMessage({ type: 'edit', text: toCsv(state.data, state.currentDelimiter) });
}

export function setupUndoRedo(): void {
    const undoBtn = document.getElementById('btn-undo');
    const redoBtn = document.getElementById('btn-redo');
    // Never let the button take the browser focus. The grid commits and closes a
    // cell editor as soon as it loses focus (stopEditingWhenCellsLoseFocus), so a
    // plain click would close the editor first and then undo the value it had just
    // written — which is exactly what it did before this line.
    undoBtn?.addEventListener('mousedown', e => e.preventDefault());
    redoBtn?.addEventListener('mousedown', e => e.preventDefault());
    undoBtn?.addEventListener('click', undo);
    redoBtn?.addEventListener('click', redo);
}
