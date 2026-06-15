import type { CsvRow, ColType, FindMatch, UndoSnapshot } from './types';

export const state = {
    currentDelimiter: ',',
    rawCsvText: '',
    data: [] as CsvRow[],
    undoStack: [] as UndoSnapshot[],
    redoStack: [] as UndoSnapshot[],
    gridApi: null as any,
    focusedCellColId: null as string | null,
    focusedCellRowIndex: null as number | null,
    isCellEditing: false,

    ZOOM_STEPS: [60, 70, 80, 90, 100, 110, 125, 150, 175, 200],
    zoomIndex: 4,
    isAutoFitted: false,

    // Column color mode — when on, every data column gets a distinct, theme-adaptive
    // background tint so columns are easier to tell apart. Persisted globally via
    // VS Code globalState (csvGridEditor.colorMode), exactly like zoomIndex, so the
    // toggle is remembered across every CSV file and every session. The actual
    // colors are pure CSS (features/color-mode.ts + media/webview.css). In-memory
    // mirror of the persisted flag.
    colorMode: false,
    autoFitCache: null as any,
    autoFitCacheZoom: -1,

    colTypes: [] as ColType[],
    profileOpen: false,
    profileDock: 'right' as 'right' | 'bottom' | 'left',

    findMatches: [] as FindMatch[],
    findMatchIndex: -1,

    currentPage: 0,

    // Freeze rows — the data rows pinned to the top of the grid as always-visible
    // references. Tracked by their array references within state.data (NOT by
    // index) so each freeze follows its row through inserts/deletes/sorts and
    // clears itself automatically when state.data is replaced (paging, undo/redo,
    // re-parse). Empty = no row frozen. Multiple rows can be frozen at once, e.g.
    // a multi-line header. See features/freeze-rows.ts.
    frozenRowRefs: [] as string[][],

    // Hidden columns — set of 0-based data-column indices the user has hidden via
    // the column chooser. Re-applied in buildGrid (so visibility survives a grid
    // rebuild, e.g. paging) and cleared on column insert/delete since those shift
    // indices. In-memory only. See features/column-chooser.ts.
    hiddenCols: new Set<number>(),

    // Frozen columns — set of 0-based data-column indices pinned to the left. Held
    // in state (not only in AG Grid) so the freeze survives a buildGrid rebuild
    // (column insert/delete, delimiter change, paging) — buildGrid rebuilds the
    // column defs from scratch, which would otherwise drop the pinning. Re-applied
    // via colDef.pinned in builder.ts and index-remapped on column insert/delete.
    // See features/freeze-columns.ts.
    pinnedCols: new Set<number>(),

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
