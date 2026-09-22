import type { CsvRow, ColType, FindMatch, UndoSnapshot } from './types';
import { SETTING_DEFAULTS, type Settings } from './settings';

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

    // The switches in the settings menu (color mode, row highlight, type badges,
    // number alignment, empty-cell marks, checkboxes, space trimming, Enter
    // behaviour). Each is remembered in VS Code globalState as
    // csvGridEditor.<key>, and this is the in-memory mirror. See settings.ts for the
    // list and features/settings-menu.ts for what each one does.
    settings: { ...SETTING_DEFAULTS } as Settings,

    // Wrap cell text — when on, a value wraps at its own line breaks AND at the
    // column edge, and rows grow to fit (AG Grid wrapText + autoHeight); when
    // off, the row height stays fixed and anything too wide is clipped. The chip
    // marking a real line break is drawn in both modes, so a wrap can always be
    // told apart from a break in the data. Persisted globally via VS Code
    // globalState (csvGridEditor.wrapText) like the settings. In-memory mirror of
    // the persisted flag. See features/wrap-text.ts.
    wrapText: false,

    autoFitCache: null as any,
    autoFitCacheZoom: -1,

    colTypes: [] as ColType[],
    profileOpen: false,

    // Column Profile panel layout. The dock side plus the size the user dragged
    // the panel to, kept as width (left/right dock) and height (bottom dock)
    // separately so switching sides does not carry one over into the other. 0
    // means never resized, the CSS default applies. All three are persisted via
    // VS Code globalState (csvGridEditor.profileDock / .profileWidth /
    // .profileHeight) like zoom and color mode, so the panel comes back the size
    // it was left at on the next file. See features/profile.ts.
    profileDock: 'right' as 'right' | 'bottom' | 'left',
    profileWidth: 0,
    profileHeight: 0,

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

// What an empty table is missing, or null when it has columns and rows (issue
// #40). Every way of adding to a table was anchored to something already there:
// a row to insert next to, a cell to right-click, a header to open the column
// menu on. With nothing there, there was no way in at all. The grid asks this to
// decide what to offer instead.
//   'no-columns'  an empty file, or every column deleted: offer the first column
//   'no-rows'     a header and nothing under it: offer the first row
export function emptyTableKind(rows: CsvRow[]): 'no-columns' | 'no-rows' | null {
    if (getNumCols(rows) === 0) return 'no-columns';
    if (rows.length <= 1) return 'no-rows';
    return null;
}
