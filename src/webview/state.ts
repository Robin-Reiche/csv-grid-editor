import type { CsvRow, ColType, FindMatch, UndoSnapshot } from './types';
import { SETTING_DEFAULTS, type Settings } from './settings';
import { colLetter, type LineFormat } from './utils/csv';

export const state = {
    currentDelimiter: ',',
    // The text of the file as the grid last saw it: what it was opened with, an
    // outside change or the last edit it wrote. In the paged view it is the page
    // on display. A delimiter switch re-splits this (features/delimiter.ts).
    rawCsvText: '',
    // How that text ends its rows, read every time it is split into state.data.
    // Every edit writes the file back the same way (utils/csv.ts toCsv).
    lineFormat: { eol: '\n', finalNewline: false } as LineFormat,
    // Whether the file's first row is its header ("First row is the header" in
    // the settings menu, remembered per file by the extension). Off, the grid
    // still keeps a header in state.data[0], so every part of it that reads
    // the names there and the rows below works the same: a row of column
    // letters (A, B, C) that the grid makes up and relabelVirtualHeader keeps
    // in step with the columns. That row is not in the file and must never get
    // there. The one place that writes the file leaves it out (fileRows in
    // notifyChange). Nothing may write a name into it either, which is why
    // Rename column is not offered. See features/header-row.ts.
    firstRowIsHeader: true,
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
    totalPages: 1,

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

// ── A file without a header row ──────────────────────────────────────────────
// Apart from relabelVirtualHeader the helpers below take the mode as an
// argument rather than reading state.firstRowIsHeader, so the tests can run
// them outside the page.

// The names of n columns in a file without a header: A, B, C and on past Z
// the way a spreadsheet goes, AA, AB.
export function letterRow(n: number): string[] {
    return Array.from({ length: n }, (_, i) => colLetter(i));
}

// The grid's table for the rows of a file. Without a header the letters go
// on top, so the file's first row is row 1 like all the others.
export function withVirtualHeader(rows: CsvRow[], headerless: boolean): CsvRow[] {
    return headerless ? [letterRow(getNumCols(rows)), ...rows] : rows;
}

// The rows that make up the file: the grid's table without the letters.
export function fileRows(data: CsvRow[], headerless: boolean): CsvRow[] {
    return headerless ? data.slice(1) : data;
}

// Puts fresh letters on top of the grid's table. Inserting or deleting a
// column changes the letter row like any other row, which leaves it reading
// A, (blank), B after an insert. There are as many columns as the widest row
// has cells, the same as with a header, where a column past the header goes
// away with the last row that reaches it. With no rows left the letters are
// all there is to count by, so they keep their number. The grid calls this
// before it reads the names (grid/builder.ts, grid/refresh.ts).
export function relabelVirtualHeader(): void {
    const data = state.data;
    if (state.firstRowIsHeader || data.length === 0) return;
    let n = data.length > 1 ? 0 : data[0].length;
    for (let i = 1; i < data.length; i++) {
        if (data[i].length > n) n = data[i].length;
    }
    data[0] = letterRow(n);
}

// An undo step moved into the other mode, the way the switch moves the grid's
// table (features/header-row.ts), so undo keeps working across a switch. The
// frozen rows are kept by position and move along. A row that would become
// the header is no longer frozen, the header never is.
export function snapshotInHeaderMode(snap: UndoSnapshot, headerless: boolean): UndoSnapshot {
    return headerless
        ? {
            data: withVirtualHeader(snap.data, true),
            frozenRowIdx: snap.frozenRowIdx.map(i => i + 1),
            pinnedCols: snap.pinnedCols,
        }
        : {
            data: fileRows(snap.data, true),
            frozenRowIdx: snap.frozenRowIdx.map(i => i - 1).filter(i => i >= 1),
            pinnedCols: snap.pinnedCols,
        };
}
