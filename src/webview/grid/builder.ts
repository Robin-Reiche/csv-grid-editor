import { state, getNumCols } from '../state';
import { getColumnType, scheduleRecomputeColTypes } from './column-type';
import { createCombinedFilter } from './filter';
import { pushUndo, notifyChange, updateButtons } from '../features/undo-redo';
import { getFindCellClassRules } from '../features/find-replace';
import { attachHeaderContextMenus } from '../features/freeze-columns';
import { applyZoom } from '../features/zoom';
import { applyGridTheme } from '../features/theme';
import {
    getRangeCellClassRules,
    onCellMouseDownHandler,
    onCellMouseOverHandler,
    clearRangeSelection,
} from '../features/range-select';

const TYPE_LABELS: Record<string, string> = {
    integer: 'Integer', float: 'Float / Decimal', string: 'Text',
    boolean: 'Boolean', date: 'Date', datetime: 'Date & Time', time: 'Time'
};

// ── Grid icons ───────────────────────────────────────────────────────────
// AG Grid header icons are rendered as inline SVG built from the official
// VS Code Codicon path data (16×16 viewBox) so the grid shares the toolbar's
// icon family. SVG is used rather than the Codicon font because it sizes and
// centres predictably inside AG Grid's nested header layout — the font glyphs
// do not. CSS sizes and centres these (see media/webview.css → .ag-icon).
// Explicit width/height on the <svg> element itself — an SVG with only a
// viewBox falls back to the 300×150 default size and gets clipped to nothing.
const codiconSvg = (inner: string, cls = ''): string =>
    `<svg width="12" height="12" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"`
    + `${cls ? ` class="${cls}"` : ''}>${inner}</svg>`;

const CHEVRON_UP    = '<path d="M3.14603 9.85423C3.34103 10.0492 3.65803 10.0492 3.85303 9.85423L7.99903 5.70823L12.145 9.85423C12.34 10.0492 12.657 10.0492 12.852 9.85423C13.047 9.65923 13.047 9.34223 12.852 9.14723L8.35203 4.64723C8.15703 4.45223 7.84003 4.45223 7.64503 4.64723L3.14503 9.14723C2.95003 9.34223 2.95103 9.65923 3.14603 9.85423Z"/>';
const CHEVRON_DOWN  = '<path d="M3.14598 5.85423L7.64598 10.3542C7.84098 10.5492 8.15798 10.5492 8.35298 10.3542L12.853 5.85423C13.048 5.65923 13.048 5.34223 12.853 5.14723C12.658 4.95223 12.341 4.95223 12.146 5.14723L7.99998 9.29323L3.85398 5.14723C3.65898 4.95223 3.34198 4.95223 3.14698 5.14723C2.95198 5.34223 2.95098 5.65923 3.14598 5.85423Z"/>';
const CHEVRON_LEFT  = '<path d="M9.14601 3.14623L4.64601 7.64623C4.45101 7.84123 4.45101 8.15823 4.64601 8.35323L9.14601 12.8532C9.34101 13.0482 9.65801 13.0482 9.85301 12.8532C10.048 12.6582 10.048 12.3412 9.85301 12.1462L5.70701 8.00023L9.85301 3.85423C10.048 3.65923 10.048 3.34223 9.85301 3.14723C9.65801 2.95223 9.34101 2.95223 9.14601 3.14723V3.14623Z"/>';
const CHEVRON_RIGHT = '<path d="M6.14601 3.14579C5.95101 3.34079 5.95101 3.65779 6.14601 3.85279L10.292 7.99879L6.14601 12.1448C5.95101 12.3398 5.95101 12.6568 6.14601 12.8518C6.34101 13.0468 6.65801 13.0468 6.85301 12.8518L11.353 8.35179C11.548 8.15679 11.548 7.83979 11.353 7.64478L6.85301 3.14479C6.65801 2.94979 6.34101 2.95079 6.14601 3.14579Z"/>';

const GRID_ICONS = {
    sortAscending:  codiconSvg('<path d="M4.95693 10.9989C4.14924 10.9989 3.67479 10.0909 4.13603 9.42784L6.76866 5.64342C7.36545 4.78555 8.6346 4.78555 9.23138 5.64342L11.864 9.42784C12.3253 10.0909 11.8508 10.9989 11.0431 10.9989H4.95693Z"/>'),
    sortDescending: codiconSvg('<path d="M4.95693 5C4.14924 5 3.67479 5.90803 4.13603 6.57107L6.76866 10.3555C7.36545 11.2134 8.6346 11.2133 9.23138 10.3555L11.864 6.57106C12.3253 5.90803 11.8508 5 11.0431 5H4.95693Z"/>'),
    // No unsort indicator — the sort glyph appears only once a column is sorted.
    sortUnSort:     '',
    // Single funnel-silhouette path. CSS (webview.css → .ag-icon-filter path)
    // strokes it as a thin outline by default and fills it solid white when
    // the column is filtered.
    filter:         codiconSvg('<path d="M9.5 14H6.5C6.224 14 6 13.776 6 13.5V9.329C6 8.928 5.844 8.552 5.561 8.268L1.561 4.268C1.205 3.911 1 3.418 1 2.914C1 1.858 1.858 1 2.914 1H13.086C14.142 1 15 1.858 15 2.914C15 3.417 14.796 3.911 14.439 4.267L10.439 8.267C10.156 8.551 10 8.927 10 9.328V13.499C10 13.775 9.776 13.999 9.5 13.999V14Z"/>'),
    menu:           codiconSvg('<path d="M8 5C7.44772 5 7 4.55228 7 4C7 3.44772 7.44772 3 8 3C8.55228 3 9 3.44772 9 4C9 4.55228 8.55228 5 8 5ZM8 9C7.44771 9 7 8.55229 7 8C7 7.44772 7.44771 7 8 7C8.55228 7 9 7.44772 9 8C9 8.55229 8.55228 9 8 9ZM7 12C7 12.5523 7.44771 13 8 13C8.55228 13 9 12.5523 9 12C9 11.4477 8.55228 11 8 11C7.44771 11 7 11.4477 7 12Z"/>'),
    columns:        codiconSvg('<path d="M2 3.5C2 3.224 2.224 3 2.5 3H10.5C10.776 3 11 3.224 11 3.5C11 3.776 10.776 4 10.5 4H2.5C2.224 4 2 3.776 2 3.5ZM13.5 6H2.5C2.224 6 2 6.224 2 6.5C2 6.776 2.224 7 2.5 7H13.5C13.776 7 14 6.776 14 6.5C14 6.224 13.776 6 13.5 6ZM9.5 9H2.5C2.224 9 2 9.224 2 9.5C2 9.776 2.224 10 2.5 10H9.5C9.776 10 10 9.776 10 9.5C10 9.224 9.776 9 9.5 9Z"/><path d="M2.5 12H11.5C11.776 12 12 12.224 12 12.5C12 12.776 11.776 13 11.5 13H2.5C2.224 13 2 12.776 2 12.5C2 12.224 2.224 12 2.5 12Z"/>'),
    cancel:         codiconSvg('<path d="M8.70701 8.00001L12.353 4.35401C12.548 4.15901 12.548 3.84201 12.353 3.64701C12.158 3.45201 11.841 3.45201 11.646 3.64701L8.00001 7.29301L4.35401 3.64701C4.15901 3.45201 3.84201 3.45201 3.64701 3.64701C3.45201 3.84201 3.45201 4.15901 3.64701 4.35401L7.29301 8.00001L3.64701 11.646C3.45201 11.841 3.45201 12.158 3.64701 12.353C3.74501 12.451 3.87301 12.499 4.00101 12.499C4.12901 12.499 4.25701 12.45 4.35501 12.353L8.00101 8.70701L11.647 12.353C11.745 12.451 11.873 12.499 12.001 12.499C12.129 12.499 12.257 12.45 12.355 12.353C12.55 12.158 12.55 11.841 12.355 11.646L8.70901 8.00001H8.70701Z"/>'),
    check:          codiconSvg('<path d="M13.6572 3.13573C13.8583 2.9465 14.175 2.95614 14.3643 3.15722C14.5535 3.35831 14.5438 3.675 14.3428 3.86425L5.84277 11.8642C5.64597 12.0494 5.33756 12.0446 5.14648 11.8535L1.64648 8.35351C1.45121 8.15824 1.45121 7.84174 1.64648 7.64647C1.84174 7.45121 2.15825 7.45121 2.35351 7.64647L5.50976 10.8027L13.6572 3.13573Z"/>'),
    first:          codiconSvg(CHEVRON_LEFT),
    last:           codiconSvg(CHEVRON_RIGHT),
    previous:       codiconSvg(CHEVRON_LEFT),
    next:           codiconSvg(CHEVRON_RIGHT),
    loading:        codiconSvg('<path d="M13.5 8.5C13.224 8.5 13 8.276 13 8C13 5.243 10.757 3 8 3C5.243 3 3 5.243 3 8C3 8.276 2.776 8.5 2.5 8.5C2.224 8.5 2 8.276 2 8C2 4.691 4.691 2 8 2C11.309 2 14 4.691 14 8C14 8.276 13.776 8.5 13.5 8.5Z"/>', 'csv-icon-spin'),
    smallUp:        codiconSvg(CHEVRON_UP),
    smallDown:      codiconSvg(CHEVRON_DOWN),
    smallLeft:      codiconSvg(CHEVRON_LEFT),
    smallRight:     codiconSvg(CHEVRON_RIGHT),
};

// ── Type-aware sort comparators ───────────────────────────────────────────────
// AG Grid's default comparator compares raw string values, which sorts dates,
// times and numbers-stored-as-text incorrectly. Every column gets an explicit
// comparator matching its detected type. Excel-style ordering: ascending sorts
// the valid typed values first, then any value that doesn't parse as that type
// (stray text, blanks) afterwards, compared as natural-order text.

function parseTimeToSeconds(s: string): number {
    const m = s.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (!m) return NaN;
    return (+m[1]) * 3600 + (+m[2]) * 60 + (+(m[3] ?? 0));
}

function textCompare(a: string, b: string): number {
    return String(a ?? '').localeCompare(String(b ?? ''), undefined, {
        numeric: true, sensitivity: 'base',
    });
}

// Builds a comparator that parses each value to a number via `parse`. Parseable
// values sort numerically and come first; unparseable ones sort as text after.
function typedComparator(parse: (s: string) => number): (a: string, b: string) => number {
    return (a, b) => {
        const va = a ? parse(a) : NaN;
        const vb = b ? parse(b) : NaN;
        const aOk = !isNaN(va), bOk = !isNaN(vb);
        if (aOk && bOk) return va - vb;
        if (aOk !== bOk) return aOk ? -1 : 1;
        return textCompare(a, b);
    };
}

function makeComparator(colType: string): (a: string, b: string) => number {
    if (colType === 'integer' || colType === 'float') return typedComparator(s => Number(s));
    if (colType === 'date' || colType === 'datetime') return typedComparator(s => Date.parse(s));
    if (colType === 'time') return typedComparator(parseTimeToSeconds);
    // string / boolean — natural order so "10" sorts after "2"
    return textCompare;
}

export function buildGrid(): void {
    if (!state.data?.length) return;

    const headerRow = state.data[0];
    const bodyRows  = state.data.slice(1);
    const numCols   = getNumCols(state.data);

    // Row index column (Feature 1)
    // In "show only duplicates" mode the column shows the ORIGINAL CSV line number
    // (read from row data via _origIndex) instead of the displayed row index, so
    // users can locate duplicates in the source file.
    const columnDefs: any[] = [{
        headerName: '#',
        colId: 'row-index',
        headerClass: 'row-index-header',
        valueGetter: (p: any) =>
            state.dupShowOnly && p.data?._origIndex != null
                ? p.data._origIndex
                : p.node.rowIndex + 1,
        width: 48, minWidth: 36, maxWidth: 80,
        pinned: 'left',
        suppressHeaderMenuButton: true, sortable: false, filter: false,
        editable: false, resizable: false, suppressMovable: true,
        cellClass: 'row-index-cell',
    }];

    for (let c = 0; c < numCols; c++) {
        const colType   = getColumnType(bodyRows, c);
        state.colTypes[c] = colType;
        const colDef: any = {
            headerName:   headerRow[c] ?? '',
            field:        'col_' + c,
            headerClass:  'col-type-' + colType,
            headerTooltip: TYPE_LABELS[colType] ?? 'Text',
            minWidth: 60,
            editable:     !IS_PREVIEW,
            sortable:     true,
            filter:       createCombinedFilter(colType),
            resizable:    true,
            suppressMovable: false,
        };
        colDef.comparator = makeComparator(colType);
        columnDefs.push(colDef);
    }

    // _origIndex holds the original 1-based data-row position, which lets the
    // duplicate-detection feature show source-file line numbers and survive
    // sort/filter without losing track of which row is which.
    const rowData = bodyRows.map((row, i) => {
        const obj: Record<string, string | number> = { _origIndex: i + 1 };
        for (let c = 0; c < numCols; c++) obj['col_' + c] = row[c] ?? '';
        return obj as Record<string, string>;
    });

    const container = document.getElementById('grid-container')!;
    container.innerHTML = '';
    applyGridTheme(); // ensure correct ag-theme-alpine[-dark] class

    const ZOOM_SCALE = state.ZOOM_STEPS[state.zoomIndex] / 100;
    const BASE_TEXT_BTN_FONT = 11;

    // Merge find-match highlight rules with duplicate-row highlight.
    // Both rule sets must coexist on the same defaultColDef.
    const cellClassRules = {
        ...getFindCellClassRules(),
        ...getRangeCellClassRules(),
        'cell-dup-row': (p: any) =>
            state.dupRowSet.size > 0
            && p.data?._origIndex != null
            && state.dupRowSet.has(p.data._origIndex as number),
    };

    const gridOptions: any = {
        columnDefs,
        rowData,
        defaultColDef: {
            flex: 0, width: 130,
            editable: !IS_PREVIEW,
            sortable: true, resizable: true,
            cellClassRules,
        },
        // External filter for "show only duplicates" mode — kept independent of
        // user column filters so toggling dup-only doesn't clobber them.
        isExternalFilterPresent: () => state.dupShowOnly,
        doesExternalFilterPass:  (node: any) =>
            !!node.data
            && node.data._origIndex != null
            && state.dupRowSet.has(node.data._origIndex as number),
        // Codicon glyphs as inline SVG — defined in GRID_ICONS at the top of
        // this file. AG Grid's own icon font is blocked in VS Code webviews.
        icons: GRID_ICONS,
        animateRows: false,
        // Ctrl+click a second/third header to sort by multiple columns.
        multiSortKey: 'ctrl',
        tooltipShowDelay: 400,
        tooltipHideDelay: 3000,
        suppressFieldDotNotation: true,
        singleClickEdit: false,
        stopEditingWhenCellsLoseFocus: true,
        undoRedoCellEditing: false,

        onCellClicked: (event: any) => {
            const colId = event.column?.getColId?.() ?? event.column;
            if (colId != null && event.rowIndex != null) {
                state.focusedCellColId    = colId;
                state.focusedCellRowIndex = event.rowIndex;
            }
        },

        onCellFocused: (event: any) => {
            if (event.column && event.rowIndex != null) {
                const colId = typeof event.column === 'string' ? event.column : event.column.getColId();
                state.focusedCellColId    = colId;
                state.focusedCellRowIndex = event.rowIndex;
            } else {
                state.focusedCellColId    = null;
                state.focusedCellRowIndex = null;
            }
        },
        onCellEditingStarted: () => { state.isCellEditing = true; },
        onCellEditingStopped:  () => { state.isCellEditing = false; },

        // Range selection (Excel-style) — hand-rolled since AG Grid Community has no
        // built-in cell-range selection.
        onCellMouseDown: onCellMouseDownHandler,
        onCellMouseOver: onCellMouseOverHandler,
        // A rowData reset (undo/redo, row insert/delete, paste, dup-view) shifts
        // display indices, so the display-coordinate selection must be dropped.
        onRowDataUpdated: () => clearRangeSelection(),

        // Display indices shift when sorting or filtering — clear the selection so
        // the highlight doesn't appear on the wrong cells.
        onSortChanged:   () => {
            clearRangeSelection();
            // The '#' column's valueGetter returns the row's display position,
            // which AG Grid won't re-evaluate on its own after a reorder (the
            // row data is unchanged). Force it so the numbers renumber at once.
            state.gridApi?.refreshCells({ columns: ['row-index'], force: true });
        },

        onFilterChanged: () => {
            clearRangeSelection();
            state.gridApi?.refreshCells({ columns: ['row-index'], force: true });
            const isAnyFilter = state.gridApi?.isAnyFilterPresent();
            const cfBtn = document.getElementById('btn-clear-filters') as HTMLButtonElement | null;
            const sepBtn = document.getElementById('sep-filters') as HTMLElement | null;
            if (cfBtn) {
                cfBtn.style.display  = isAnyFilter ? '' : 'none';
                cfBtn.style.fontSize = Math.round(BASE_TEXT_BTN_FONT * ZOOM_SCALE) + 'px';
            }
            if (sepBtn) sepBtn.style.display = isAnyFilter ? '' : 'none';

            const totalRows = state.data.length - 1;
            const cols = numCols;
            if (isAnyFilter) {
                let displayed = 0;
                state.gridApi.forEachNodeAfterFilter(() => displayed++);
                document.getElementById('info')!.textContent   = `${displayed} of ${totalRows} rows \u00D7 ${cols} columns`;
                document.getElementById('status')!.textContent = `${displayed} of ${totalRows} records (filtered)`;
            } else {
                document.getElementById('info')!.textContent   = `${totalRows} rows \u00D7 ${cols} columns`;
                document.getElementById('status')!.textContent = `${totalRows} records`;
            }
        },

        onCellValueChanged: (event: any) => {
            const dataIndex = event.node.rowIndex + 1;
            const colField  = event.colDef.field;
            if (!colField) return;
            const colIndex = parseInt(colField.replace('col_', ''));
            pushUndo();
            while (state.data[dataIndex].length <= colIndex) state.data[dataIndex].push('');
            state.data[dataIndex][colIndex] = event.newValue != null ? String(event.newValue) : '';
            notifyChange();
            scheduleRecomputeColTypes();
        },
    };

    state.gridApi = agGrid.createGrid(container, gridOptions);
    updateButtons();

    // Double-click on resize handle → auto-size that column
    container.addEventListener('dblclick', e => {
        const target = e.target as HTMLElement;
        if (target?.classList.contains('ag-header-cell-resize')) {
            const headerCell = target.closest('.ag-header-cell');
            if (headerCell) {
                const colId = headerCell.getAttribute('col-id');
                if (colId) state.gridApi.autoSizeColumns([colId]);
            }
        }
    });

    const rowCount = bodyRows.length;
    const infoEl   = document.getElementById('info');
    const statusEl = document.getElementById('status');
    if (infoEl)   infoEl.textContent   = `${rowCount} rows \u00D7 ${numCols} columns`;
    if (statusEl) statusEl.textContent = `${rowCount} records`;

    setTimeout(attachHeaderContextMenus, 80);
}
