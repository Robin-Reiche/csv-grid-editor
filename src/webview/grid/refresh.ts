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
}
