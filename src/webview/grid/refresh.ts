import { state, getNumCols } from '../state';
import { applyColorMode } from '../features/color-mode';

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
            const name = header[ci] ?? '';
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

export function refreshGrid(): void {
    if (!state.gridApi) return;
    // Read the focus BEFORE the swap. Replacing the row data can dispatch a
    // cellFocused event with no column, and builder.ts answers that by clearing
    // the tracked coordinates — so after the swap there is nothing left to read.
    const focusRow   = state.focusedCellRowIndex;
    const focusColId = state.focusedCellColId;

    state.autoFitCache = null;
    state.colTypes = [];

    const numCols  = getNumCols(state.data);
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
    focusCell(focusRow, focusColId);
    // refreshGrid only swaps rowData, so the row/column counters in the toolbar
    // and status bar would otherwise go stale after a delete/insert/paste/undo.
    updateCountsDisplay();
    // Keep the per-column color hues in sync with the live column count. Undo/redo
    // of a column insert/delete reaches here (not buildGrid), so the hue rules must
    // be regenerated for the current numCols, not left at the pre-undo count.
    applyColorMode();
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
