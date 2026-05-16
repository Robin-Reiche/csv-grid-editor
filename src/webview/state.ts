import type { CsvRow, ColType, FindMatch } from './types';

export const state = {
    currentDelimiter: ',',
    rawCsvText: '',
    data: [] as CsvRow[],
    undoStack: [] as CsvRow[][],
    redoStack: [] as CsvRow[][],
    gridApi: null as any,
    focusedCellColId: null as string | null,
    focusedCellRowIndex: null as number | null,
    isCellEditing: false,

    ZOOM_STEPS: [60, 70, 80, 90, 100, 110, 125, 150, 175, 200],
    zoomIndex: 4,
    isAutoFitted: false,
    autoFitCache: null as any,
    autoFitCacheZoom: -1,

    colTypes: [] as ColType[],
    profileOpen: false,
    profileDock: 'right' as 'right' | 'bottom' | 'left',

    findMatches: [] as FindMatch[],
    findMatchIndex: -1,

    currentPage: 0,

    // Duplicate detection
    // dupRowSet — set of original 1-based row indices (i.e. _origIndex values) that
    // appear more than once. Empty set means dup detection is currently OFF.
    dupRowSet: new Set<number>(),
    dupGroupCount: 0,
    dupShowOnly: false,
    // Snapshot of the current rowData taken when entering "show only duplicates"
    // so we can restore the original row order on dismiss without re-parsing.
    dupOriginalRowData: null as Record<string, string>[] | null,
};

export function getNumCols(rows: CsvRow[]): number {
    let max = 0;
    for (let i = 0; i < rows.length; i++) {
        if (rows[i].length > max) max = rows[i].length;
    }
    return max;
}
