import { state, getNumCols, emptyTableKind } from '../state';
import { buildGrid } from './builder';
import { recomputeColTypes } from './column-type';
import { shownValue } from './control-char-cell';

// Splits a freshly-built rowData array into the scrollable body and the frozen
// reference rows (AG Grid renders the latter in a fixed pinned-top band). Frozen
// rows are tracked by their array references in state.frozenRowRefs, matched back
// to their current position in state.data — which equals their _origIndex
// (state.data[0] is the header). References that can no longer be found (row
// deleted, or state.data replaced by paging/undo/re-parse) are dropped here, so
// callers never have to clear stale freezes. Pinned rows keep FREEZE order (the
// order they were frozen in), so a newly frozen row is appended at the end rather
// than jumping to a data-sorted position. Used by buildGrid() and refreshGrid().
export function partitionFrozenRows<T extends { _origIndex?: number }>(
    rowData: T[]
): { body: T[]; pinnedTop: T[] } {
    if (state.frozenRowRefs.length === 0) return { body: rowData, pinnedTop: [] };

    // Map each current row array to its position, then self-heal the freeze list to
    // the rows that still exist WHILE PRESERVING freeze order (newest stays last).
    const idxOf = new Map<string[], number>();
    state.data.forEach((row, i) => idxOf.set(row, i));
    state.frozenRowRefs = state.frozenRowRefs.filter(r => idxOf.has(r));
    if (state.frozenRowRefs.length === 0) return { body: rowData, pinnedTop: [] };

    const frozenOrigs = new Set<number>(state.frozenRowRefs.map(r => idxOf.get(r) as number));
    const byOrig = new Map<number, T>();
    const body: T[] = [];
    for (const row of rowData) {
        const oi = Number(row._origIndex);
        if (frozenOrigs.has(oi)) byOrig.set(oi, row);
        else body.push(row);
    }
    // Emit pinned rows in freeze order (the frozenRowRefs array order).
    const pinnedTop: T[] = [];
    for (const r of state.frozenRowRefs) {
        const row = byOrig.get(idxOf.get(r) as number);
        if (row) pinnedTop.push(row);
    }
    return { body, pinnedTop };
}

// Re-applies header labels from state.data[0] onto the live column defs. The
// header row is editable data (rename column), but refreshGrid only swaps
// rowData — so after undo/redo restores state.data[0] the header labels must be
// re-synced WITHOUT a full buildGrid (which would drop widths/sort/freeze).
export function syncColumnHeaders(): void {
    if (!state.gridApi) return;
    const header = state.data[0] ?? [];
    const defs = state.gridApi.getColumnDefs() as any[] | undefined;
    if (!defs) return;
    let changed = false;
    for (const d of defs) {
        if (typeof d.field === 'string' && d.field.indexOf('col_') === 0) {
            const ci   = parseInt(d.field.slice(4), 10);
            const name = shownValue(header[ci] ?? '');
            if (d.headerName !== name) { d.headerName = name; changed = true; }
        }
    }
    if (changed) {
        state.gridApi.setGridOption('columnDefs', defs);
        state.gridApi.refreshHeader();
    }
}

// Puts the browser focus back on a grid cell, clamped to what is still there.
//
// A rowData swap tears the cell elements down and builds them again, so the
// browser focus that was sitting on the focused cell ends up on <body>. AG Grid
// keeps drawing its focus ring, because its own focusedCellPosition survives, so
// the grid LOOKS focused while every arrow key from then on goes nowhere and
// only a mouse click puts the keyboard back in business. setFocusedCell moves
// the real focus (it forces the browser focus, see gridApi.setFocusedCell), which
// is the part the swap lost.
//
// Clamping is what makes deleting the last row land somewhere sensible: the old
// index now points past the end, and the row that is now last is where a person
// expects to be.
export function focusCell(rowIndex: number | null, colId: string | null): void {
    if (!state.gridApi || rowIndex === null || colId === null) return;
    // Deferred one frame for the reason go-to-row already defers it: setFocusedCell
    // races the row render and is dropped without a word when the row is not in the
    // DOM yet, and a rowData swap is exactly that render. Queued calls keep their
    // order, so a caller that re-focuses after us still wins.
    requestAnimationFrame(() => {
        if (!state.gridApi) return;
        // Only ever take focus back while this view already has it. An external
        // file change refreshes the grid too, and that must not pull the cursor
        // out of whatever the user is typing in somewhere else.
        if (!document.hasFocus()) return;
        const row = clampRow(rowIndex, state.gridApi.getDisplayedRowCount());
        if (row === null) return; // nothing but the header left
        try { state.gridApi.setFocusedCell(row, colId); } catch {}
    });
}

// The row a focus restore actually lands on, given how many rows are left.
// Deleting the last row is the case this exists for: the remembered index now
// points past the end, and one row up is where a person expects to be. null
// means there is no row to focus at all.
export function clampRow(rowIndex: number, rowCount: number): number | null {
    if (rowCount < 1) return null;
    return Math.max(0, Math.min(rowIndex, rowCount - 1));
}

// The displayed index of state.data[dataIndex], a blank row that was just
// added. null means it is frozen into the band above instead. Call it after
// the grid has the new row.
//
// A column filter judges the new row like any other and nearly always hides
// it: a value list never ticked (Blank), a condition such as "contains" never
// matches an empty value. The row went into the file unseen and the focus landed on
// the next row the filter let through, so the next keystroke overwrote that
// row. The filters are cleared instead, the way the "Clear filters" button
// does it. Keeping them and hiding the row the user just asked for is the
// worse surprise. A filter that lets blank rows through is left alone. Both
// ways of adding a blank row come through here: inserting next to a row
// (features/delete-row-col.ts) and starting the first row of an empty table
// (features/empty-state.ts).
export function revealAddedRow(dataIndex: number): number | null {
    if (!state.gridApi) return null;
    const shown = displayIndexOfDataRow(dataIndex);
    if (shown !== null || !state.gridApi.isAnyFilterPresent()) return shown;
    state.gridApi.setFilterModel(null);
    return displayIndexOfDataRow(dataIndex);
}

// The displayed row that shows state.data[dataIndex]. null means a filter hides
// it or it is frozen into the pinned band.
function displayIndexOfDataRow(dataIndex: number): number | null {
    if (!state.gridApi) return null;
    const count = state.gridApi.getDisplayedRowCount();
    for (let i = 0; i < count; i++) {
        if (Number(state.gridApi.getDisplayedRowAtIndex(i)?.data?._origIndex) === dataIndex) return i;
    }
    return null;
}

// How many data columns the grid has, the '#' gutter not counted.
function gridDataColCount(): number {
    const defs = state.gridApi?.getColumnDefs() as any[] | undefined;
    return (defs ?? []).filter(d => typeof d.field === 'string' && d.field.indexOf('col_') === 0).length;
}

export function refreshGrid(): void {
    // No grid to refresh (the file was empty, then content arrived by undo, redo
    // or an edit in another editor), or no columns left to show (undo back to an
    // empty file). Swapping rows cannot fix either, the column set itself has to
    // be built or torn down, and only buildGrid does that (issue #40).
    if (!state.gridApi || emptyTableKind(state.data) === 'no-columns') { buildGrid(); return; }
    // Read the focus BEFORE the swap. Replacing the row data can dispatch a
    // cellFocused event with no column, and builder.ts answers that by clearing
    // the tracked coordinates — so after the swap there is nothing left to read.
    const focusRow   = state.focusedCellRowIndex;
    const focusColId = state.focusedCellColId;
    const numCols    = getNumCols(state.data);

    // A row swap fills the columns the grid already has. It cannot add or remove
    // one, so a restored column would stay invisible and a removed one would
    // stay on screen. An outside change to the file and undo or redo of a column
    // insert or delete can change how many columns there are. The columns are
    // built again then. Frozen rows follow their row on their own
    // (partitionFrozenRows). Frozen and hidden columns keep every place that
    // still exists. The focus goes back to its cell. Widths, sort and filters
    // start over, as they do when a column is inserted or deleted: they belong
    // to a position, which may now hold other data.
    if (gridDataColCount() !== numCols) {
        for (const set of [state.hiddenCols, state.pinnedCols]) {
            for (const c of [...set]) if (c >= numCols) set.delete(c);
        }
        state.isAutoFitted = false;
        state.autoFitCache = null;
        state.colTypes = [];
        buildGrid();
        // A focus on a column that is gone goes to the last one left.
        const focusCol = focusColId !== null && parseInt(focusColId.slice(4), 10) >= numCols
            ? 'col_' + (numCols - 1) : focusColId;
        focusCell(focusRow, focusCol);
        return;
    }

    state.autoFitCache = null;
    state.colTypes = [];

    const bodyRows = state.data.slice(1);
    // _origIndex must match the convention in builder.ts so duplicate detection
    // and the row-index column keep working after refresh (undo/redo, delete row).
    const rowData  = bodyRows.map((row, i) => {
        const obj: Record<string, string | number> = { _origIndex: i + 1 };
        for (let c = 0; c < numCols; c++) obj['col_' + c] = row[c] ?? '';
        return obj as Record<string, string>;
    });
    const { body, pinnedTop } = partitionFrozenRows(rowData);
    state.gridApi.setGridOption('rowData', body);
    state.gridApi.setGridOption('pinnedTopRowData', pinnedTop);
    // AG Grid keeps an overlay that is already up instead of building it again.
    // One that said "No Rows To Show" because the only row was frozen would stay
    // that way once the row is deleted, without the Add row button. Rebuild it.
    if (emptyTableKind(state.data) === 'no-rows') {
        state.gridApi.hideOverlay();
        state.gridApi.showNoRowsOverlay();
    }
    focusCell(focusRow, focusColId);
    // refreshGrid only swaps rowData, so the row/column counters in the toolbar
    // and status bar would otherwise go stale after a delete/insert/paste/undo.
    updateCountsDisplay();
    // The types were dropped above and the rows have been swapped, so work them
    // out again here rather than leaving it to each caller. Most callers already
    // ask for it, but the ones arriving from an external file change or from
    // freezing a row do not, and a column whose type is unknown is drawn as
    // plain text even where it should be drawn as checkboxes.
    recomputeColTypes();
    // The header row is data like any other. An outside change or an undo can
    // rename a column without changing how many there are.
    syncColumnHeaders();
}

// Recomputes the "<n> rows × <n> columns" toolbar text and the "<n> records"
// status-bar text from state.data, honouring an active filter. Called by both
// buildGrid() and refreshGrid() (and the filter handler) so the counts stay live
// across every structural change, not just full rebuilds.
export function updateCountsDisplay(): void {
    const infoEl   = document.getElementById('info');
    const statusEl = document.getElementById('status');
    if (!infoEl && !statusEl) return;

    const totalRows = Math.max(0, state.data.length - 1);
    const cols      = getNumCols(state.data);
    const filtered  = !!state.gridApi?.isAnyFilterPresent?.();

    if (filtered && state.gridApi) {
        let displayed = 0;
        state.gridApi.forEachNodeAfterFilter(() => displayed++);
        displayed += state.frozenRowRefs.length; // pinned reference rows are always visible
        if (infoEl)   infoEl.textContent   = `${displayed} of ${totalRows} rows × ${cols} columns`;
        if (statusEl) statusEl.textContent = `${displayed} of ${totalRows} records (filtered)`;
    } else {
        if (infoEl)   infoEl.textContent   = `${totalRows} rows × ${cols} columns`;
        if (statusEl) statusEl.textContent = `${totalRows} records`;
    }
}
