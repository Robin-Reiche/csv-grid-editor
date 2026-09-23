import { state, withVirtualHeader, fileRows, snapshotInHeaderMode } from '../state';
import type { CsvRow } from '../types';
import { parseCsv } from '../utils/csv';
import { buildGrid, commitOpenEditor } from '../grid/builder';
import { updatePreviewBanner } from '../messaging';
import { updatePageBanner } from './pagination';
import { clearRangeSelection } from './range-select';
import { resetDuplicatesState } from './duplicates';
import { frozenRowPositions, reanchorFrozenRows } from './freeze-rows';

// ── First row is the header ──────────────────────────────────────────────────
// Many CSV files have no header row. Read as if they had one, their first row
// would name the columns and could not be seen, sorted or edited as the data
// it is. The switch in the settings menu (This file) turns it into row 1 and
// names the columns A, B, C instead. The extension
// remembers the choice for this file only and hands it over when the file
// opens. How the letters stand in for the header without reaching the file is
// described at state.firstRowIsHeader.

// Whether the text on display starts with a line the rows under it do not
// follow. The paged view sends every page with the file's first line in front
// (largeFileReader.ts readPage). The tail preview puts it in front of the
// file's last rows. With a header that line names the columns. Without one it
// is the file's first row, which belongs on page 1, not on top of rows from
// further down.
function firstLineDetached(parsedCount: number): boolean {
    if (IS_CHUNKED) return state.currentPage > 0;
    return PREVIEW_MODE === 'tail' && TOTAL_LINE_COUNT > parsedCount;
}

// The grid's table for rows just read: a file opened, a page, an outside
// change or a delimiter switch. Every place that splits text into state.data
// comes through here.
export function loadRows(parsed: CsvRow[]): CsvRow[] {
    const headerless = !state.firstRowIsHeader;
    const rows = headerless && firstLineDetached(parsed.length) ? parsed.slice(1) : parsed;
    return withVirtualHeader(rows, headerless);
}

// How many rows the whole file has, as the preview banners count them. The
// extension counts every record, the header among them.
export function rowsInFile(): number {
    return Math.max(0, TOTAL_LINE_COUNT - (state.firstRowIsHeader ? 1 : 0));
}

// Switches between the two. Nothing is written: the file stays exactly as it
// is and is not marked as changed. The rows below the header are the same
// either way, only the first one moves in or out.
export function setFirstRowIsHeader(on: boolean): void {
    if (state.firstRowIsHeader === on) return;
    // The switch sits behind the gear, and clicking the gear takes the focus out
    // of the grid, which saves a value being typed right there
    // (stopEditingWhenCellsLoseFocus in grid/builder.ts). So no editor is open
    // here in practice. Should one be, its value is written before the rows
    // move under it. The grid reports a commit on a timer, after this function
    // has already rebuilt the grid. That report never reached the file.
    if (state.isCellEditing) commitOpenEditor(false);
    // Both hold rows by the place they are shown at, which is about to change.
    clearRangeSelection();
    resetDuplicatesState();

    state.firstRowIsHeader = on;
    // How far each row moves in state.data: one down when the header becomes a
    // row, one up when the first row becomes the header.
    let shift = on ? -1 : 1;
    if (IS_PREVIEW) {
        // Nothing is edited in a preview, so the text on display is the table
        // on screen. Only that text still holds a first line that the paged
        // view or the tail preview left off.
        const frozen = frozenRowPositions();
        const parsed = parseCsv(state.rawCsvText, state.currentDelimiter, false, true);
        if (firstLineDetached(parsed.length)) shift = 0;
        state.data = loadRows(parsed);
        reanchorFrozenRows(frozen.map(i => i + shift).filter(i => i >= 1));
    } else {
        // Moved in place, so every row keeps its array and a frozen row stays
        // frozen. The one that becomes the header does not, the header never is.
        const promoted = state.data[1];
        state.data = on ? fileRows(state.data, true) : withVirtualHeader(state.data, true);
        if (on) state.frozenRowRefs = state.frozenRowRefs.filter(r => r !== promoted);
    }
    // Undo goes on working across the switch. Its steps are moved the same way
    // instead of being thrown away.
    state.undoStack = state.undoStack.map(s => snapshotInHeaderMode(s, !on));
    state.redoStack = state.redoStack.map(s => snapshotInHeaderMode(s, !on));

    // A row joins or leaves the columns, which can change their types. Only a
    // fresh build gives a column the filter and sort of a new type. Widths,
    // sort and filters start over, as after a delimiter switch.
    state.isAutoFitted = false;
    state.autoFitCache = null;
    state.colTypes = [];
    // The focus is kept as a place on screen, which now shows the row next to
    // it. The new grid shows no focus, so none is kept.
    state.focusedCellRowIndex = null;
    state.focusedCellColId = null;
    // Find searches again below. Its current match should stay on the cell it
    // was on, which find looks up by the row's place in state.data.
    for (const m of state.findMatches) m.origIndex += shift;
    // buildGrid searches again, without moving the view.
    buildGrid();
    updatePreviewBanner();
    updatePageBanner();
    vscodeApi.postMessage({ type: 'headerRowChanged', value: on });
}
