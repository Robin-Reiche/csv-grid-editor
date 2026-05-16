import { state } from '../state';
import { toCsv } from '../utils/csv';
import { refreshGrid } from '../grid/refresh';
import { recomputeColTypes } from '../grid/column-type';
import { resetDuplicatesState } from './duplicates';

export function snapshot(): string[][] {
    return JSON.parse(JSON.stringify(state.data));
}

export function pushUndo(): void {
    state.undoStack.push(snapshot());
    state.redoStack = [];
    state.autoFitCache = null;
    updateButtons();
}

export function undo(): void {
    if (state.undoStack.length === 0) return;
    state.redoStack.push(snapshot());
    state.data = state.undoStack.pop()!;
    refreshGrid();
    notifyChange();
    updateButtons();
    recomputeColTypes();
}

export function redo(): void {
    if (state.redoStack.length === 0) return;
    state.undoStack.push(snapshot());
    state.data = state.redoStack.pop()!;
    refreshGrid();
    notifyChange();
    updateButtons();
    recomputeColTypes();
}

export function updateButtons(): void {
    const u = document.getElementById('btn-undo') as HTMLButtonElement | null;
    const r = document.getElementById('btn-redo') as HTMLButtonElement | null;
    if (u) u.disabled = state.undoStack.length === 0;
    if (r) r.disabled = state.redoStack.length === 0;
}

export function notifyChange(): void {
    // Edits invalidate duplicate-detection results (rows may have been added,
    // deleted, or modified into / out of being a duplicate). Clearing here
    // covers cell edits, undo/redo, find-replace, and row/column deletions.
    resetDuplicatesState();
    vscodeApi.postMessage({ type: 'edit', text: toCsv(state.data, state.currentDelimiter) });
}

export function setupUndoRedo(): void {
    document.getElementById('btn-undo')?.addEventListener('click', undo);
    document.getElementById('btn-redo')?.addEventListener('click', redo);
}
