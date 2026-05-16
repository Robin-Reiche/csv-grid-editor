import { state, getNumCols } from '../state';

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
    state.gridApi.setGridOption('rowData', rowData);
}
