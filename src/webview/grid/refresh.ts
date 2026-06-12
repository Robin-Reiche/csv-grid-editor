import { state, getNumCols } from '../state';

// Splits a freshly-built rowData array into the scrollable body and the single
// frozen reference row (AG Grid renders the latter in a fixed pinned-top band).
// The frozen row is matched by resolving state.frozenRowRef back to its current
// position in state.data — which equals its _origIndex (state.data[0] is the
// header, so a data row's index in state.data is its 1-based body position).
// If the reference can no longer be found (row deleted, or state.data replaced
// by paging/undo/re-parse) the stale freeze is dropped here, so callers never
// have to clear it explicitly. Used by both buildGrid() and refreshGrid().
export function partitionFrozenRows<T extends { _origIndex?: number }>(
    rowData: T[]
): { body: T[]; pinnedTop: T[] } {
    const frozenOrig = state.frozenRowRef ? state.data.indexOf(state.frozenRowRef) : -1;
    if (frozenOrig < 0) {
        state.frozenRowRef = null; // self-heal: row gone or data replaced
        return { body: rowData, pinnedTop: [] };
    }
    const body: T[] = [];
    const pinnedTop: T[] = [];
    for (const row of rowData) {
        if (Number(row._origIndex) === frozenOrig) pinnedTop.push(row);
        else body.push(row);
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

export function refreshGrid(): void {
    if (!state.gridApi) return;
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
    // refreshGrid only swaps rowData, so the row/column counters in the toolbar
    // and status bar would otherwise go stale after a delete/insert/paste/undo.
    updateCountsDisplay();
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
        if (state.frozenRowRef) displayed++; // the pinned reference row is always visible
        if (infoEl)   infoEl.textContent   = `${displayed} of ${totalRows} rows × ${cols} columns`;
        if (statusEl) statusEl.textContent = `${displayed} of ${totalRows} records (filtered)`;
    } else {
        if (infoEl)   infoEl.textContent   = `${totalRows} rows × ${cols} columns`;
        if (statusEl) statusEl.textContent = `${totalRows} records`;
    }
}
