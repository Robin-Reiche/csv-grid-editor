import { state, fileRows } from '../state';
import { toCsv } from '../utils/csv';
import { refreshGrid } from '../grid/refresh';
import { buildGrid } from '../grid/builder';
import { recomputeColTypes } from '../grid/column-type';
import { resetDuplicatesState } from './duplicates';
import { refreshProfileIfOpen } from './profile';
import { updateDelimiterBadge } from './delimiter';
import { followRestoredRows } from './find-replace';
import type { UndoSnapshot } from '../types';

// Captures the undoable view state: a deep clone of the data plus the freeze
// state. The freeze is stored by POSITION (frozen-row indices, pinned-column
// indices) so it survives the deep clone — the clone makes new row arrays, so the
// reference-based state.frozenRowRefs would otherwise go stale after a restore.
// Captured together with the data so positions and data are always consistent.
// The delimiter and the line format go along, since the rows are only what the
// file says when they are written back with the delimiter they were split on.
// So does the text the file held, which is what undo and redo write back.
export function snapshot(): UndoSnapshot {
    return {
        data: JSON.parse(JSON.stringify(state.data)),
        frozenRowIdx: state.frozenRowRefs.map(r => state.data.indexOf(r)).filter(i => i >= 0),
        pinnedCols: [...state.pinnedCols],
        delimiter: state.currentDelimiter,
        lineFormat: { ...state.lineFormat },
        text: state.rawCsvText,
    };
}

// Puts a step back and shows it. A step taken before a delimiter switch brings
// its delimiter back, since its rows were split on that one. They used to be
// written with the delimiter on the badge. A value holding the new delimiter
// got quoted, which turned every line of the file into a single value. Where
// the rows held the old one, it was swapped for the new one all through the
// file.
function restore(snap: UndoSnapshot): void {
    const resplit = snap.delimiter !== state.currentDelimiter;
    const before = state.data;
    state.data = snap.data;
    // The grid searches again once it shows these rows and looks for the
    // active match at its old place, so the matches move with their rows
    // first.
    followRestoredRows(before);
    state.currentDelimiter = snap.delimiter;
    state.lineFormat = snap.lineFormat;
    // Re-anchor frozen rows to the restored (cloned) arrays at their saved
    // positions, and restore the frozen-column set.
    state.frozenRowRefs = snap.frozenRowIdx.map(i => state.data[i]).filter(Boolean) as string[][];
    state.pinnedCols = new Set(snap.pinnedCols);
    if (!resplit) { refreshGrid(); return; }
    // Other columns, so the grid is built for them the way a switch builds it
    // (features/delimiter.ts).
    updateDelimiterBadge(state.currentDelimiter);
    state.hiddenCols.clear();
    state.autoFitCache = null;
    state.colTypes = [];
    buildGrid();
}

// The step the last pushUndo took and the redo steps it cleared. Every change
// that takes a step ends in notifyChange, which drops the step again when the
// change left the table as it was (see there).
let lastPushed: { step: UndoSnapshot; redo: UndoSnapshot[] } | null = null;

export function pushUndo(): void {
    const step = snapshot();
    lastPushed = { step, redo: state.redoStack };
    state.undoStack.push(step);
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
    const step = state.undoStack.pop()!;
    restore(step);
    notifyChange(step.text);
    updateButtons();
    recomputeColTypes();
}

export function redo(): void {
    const editor = openCellEditor();
    if (editor) { editor.redoText(); return; }
    if (state.redoStack.length === 0) return;
    state.undoStack.push(snapshot());
    const step = state.redoStack.pop()!;
    restore(step);
    notifyChange(step.text);
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

// `known` is the file's text when the caller has it already: undo and redo
// pass the text their step was taken at.
export function notifyChange(known?: string): void {
    // Edits invalidate duplicate-detection results (rows may have been added,
    // deleted, or modified into / out of being a duplicate). Clearing here
    // covers cell edits, undo/redo, find-replace, and row/column deletions.
    resetDuplicatesState();
    // Every data mutation funnels through here, so it is the one place that
    // guarantees the analysis panel reflects the current data (row counts,
    // nulls, stats, and the column set) after a delete/insert/paste/edit/undo.
    refreshProfileIfOpen();
    // This text becomes the file, so it is also what the next delimiter switch
    // re-splits (features/delimiter.ts). A switch that re-split the text the file
    // was opened with would bring back every value edited since. The next edit
    // would then write them into the file. The rows end the way the file ends
    // them, so an edit leaves the line breaks between the rows as they were.
    // A file without a header row gets its rows only, never the column
    // letters the grid shows in its place (state.firstRowIsHeader).
    // Undo and redo write back the text of their step as it was. Written
    // again from the rows, a step taken after a delimiter switch lost the
    // quotes the file needed: its rows were split on a delimiter the file
    // was not written with.
    const text = known ?? toCsv(fileRows(state.data, !state.firstRowIsHeader), state.currentDelimiter, state.lineFormat, FILENAME);
    // The file already holds this text when it is the one last sent or
    // received. The extension marks the file unsaved for every edit it gets,
    // so a Replace on a cell that no longer held the search text made the tab
    // dirty with nothing changed. Such a change is not sent. The undo step it
    // took is dropped as well when the table is still the one in that step,
    // since it would undo nothing. The redo steps the step cleared come back.
    const pushed = lastPushed;
    lastPushed = null;
    if (text === state.rawCsvText) {
        const top = state.undoStack[state.undoStack.length - 1];
        if (pushed && top === pushed.step && JSON.stringify(top.data) === JSON.stringify(state.data)) {
            state.undoStack.pop();
            state.redoStack = pushed.redo;
            updateButtons();
        }
        return;
    }
    state.rawCsvText = text;
    vscodeApi.postMessage({ type: 'edit', text });
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
