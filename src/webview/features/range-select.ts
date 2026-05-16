import { state } from '../state';
import { pushUndo, notifyChange } from './undo-redo';
import { recomputeColTypes } from '../grid/column-type';
import { tsvCell } from '../utils/csv';

// ── Excel-style range selection for the main grid ─────────────────────────────
// AG Grid Community has no built-in cell-range selection (Enterprise only), so
// the whole thing is hand-rolled: a selection model in display coordinates plus
// a `cellClassRules` entry for the highlight (same mechanism find & duplicates
// already use). Coordinates are display-relative — they become meaningless when
// the sort or filter changes, so the selection is cleared on those events.

type SelType = 'cells' | 'rows' | 'cols' | 'all';

let selActive = false;
let selType: SelType = 'cells';
let anchorRow = 0, anchorCol = 0;   // display row index / display column position
let focusRow  = 0, focusCol  = 0;

// Derived cache — read by the cellClassRules hot path on every cell render.
let selRowLo = 0, selRowHi = -1;
let selColIds = new Set<string>();
let selCellCount = 0;

let dragging = false;
let dragMode: 'cells' | 'rows' = 'cells';

let statsTimer: ReturnType<typeof setTimeout> | null = null;

// ── grid geometry helpers ─────────────────────────────────────────────────────

function displayedColIds(): string[] {
    if (!state.gridApi) return [];
    return (state.gridApi.getAllDisplayedColumns() as any[])
        .map(c => c.getColId() as string)
        .filter(id => id.startsWith('col_'));
}

function displayedRowCount(): number {
    return state.gridApi ? state.gridApi.getDisplayedRowCount() : 0;
}

// map[displayRowIndex] = original 1-based data-row index
function displayRowToOrig(): number[] {
    const map: number[] = [];
    state.gridApi?.forEachNodeAfterFilterAndSort((node: any) => {
        map.push(node.data?._origIndex != null ? Number(node.data._origIndex) : -1);
    });
    return map;
}

// ── selection cache ───────────────────────────────────────────────────────────

function recomputeCache(): void {
    const cols = displayedColIds();
    const rowCount = displayedRowCount();
    if (!selActive || cols.length === 0 || rowCount === 0) {
        selRowLo = 0; selRowHi = -1; selColIds = new Set(); selCellCount = 0;
        return;
    }
    let rLo: number, rHi: number, cLo: number, cHi: number;
    if (selType === 'all') {
        rLo = 0; rHi = rowCount - 1; cLo = 0; cHi = cols.length - 1;
    } else if (selType === 'rows') {
        rLo = Math.min(anchorRow, focusRow); rHi = Math.max(anchorRow, focusRow);
        cLo = 0; cHi = cols.length - 1;
    } else if (selType === 'cols') {
        rLo = 0; rHi = rowCount - 1;
        cLo = Math.min(anchorCol, focusCol); cHi = Math.max(anchorCol, focusCol);
    } else {
        rLo = Math.min(anchorRow, focusRow); rHi = Math.max(anchorRow, focusRow);
        cLo = Math.min(anchorCol, focusCol); cHi = Math.max(anchorCol, focusCol);
    }
    rLo = Math.max(0, rLo); rHi = Math.min(rowCount - 1, rHi);
    cLo = Math.max(0, cLo); cHi = Math.min(cols.length - 1, cHi);
    selRowLo = rLo; selRowHi = rHi;
    selColIds = new Set(cols.slice(cLo, cHi + 1));
    selCellCount = Math.max(0, rHi - rLo + 1) * selColIds.size;
}

function repaint(): void {
    state.gridApi?.refreshCells({ force: true });
}

function selectionChanged(): void {
    recomputeCache();
    repaint();
    scheduleStats();
}

// ── highlight rule (merged into defaultColDef.cellClassRules by builder.ts) ────

export function getRangeCellClassRules(): Record<string, (p: any) => boolean> {
    return {
        'cell-range-sel': (p: any) => {
            if (!selActive || selCellCount <= 1) return false;
            if (p.rowIndex < selRowLo || p.rowIndex > selRowHi) return false;
            const colId = p.column.getColId();
            // The row-number gutter is highlighted only when whole rows are selected.
            if (colId === 'row-index') return selType === 'rows' || selType === 'all';
            return selColIds.has(colId);
        },
    };
}

// ── status-bar aggregates ─────────────────────────────────────────────────────

function fmtNum(n: number): string {
    if (Number.isInteger(n)) return n.toLocaleString();
    return (+n.toFixed(2)).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function scheduleStats(): void {
    if (statsTimer !== null) clearTimeout(statsTimer);
    statsTimer = setTimeout(renderStats, 80);
}

function renderStats(): void {
    statsTimer = null;
    const el = document.getElementById('sel-stats');
    if (!el) return;
    if (!selActive || selCellCount <= 1) { el.textContent = ''; return; }

    const cols = displayedColIds();
    const selCols = cols.filter(id => selColIds.has(id));
    const rowMap = displayRowToOrig();

    let count = 0, numCount = 0, sum = 0;
    let min = Infinity, max = -Infinity;

    for (let r = selRowLo; r <= selRowHi; r++) {
        const orig = rowMap[r];
        if (orig == null || orig < 0) continue;
        const dataRow = state.data[orig];
        if (!dataRow) continue;
        for (const colId of selCols) {
            const ci = parseInt(colId.slice(4), 10);
            const raw = dataRow[ci];
            const v = raw != null ? String(raw).trim() : '';
            if (v === '') continue;
            count++;
            const n = Number(v);
            if (!isNaN(n)) {
                numCount++; sum += n;
                if (n < min) min = n;
                if (n > max) max = n;
            }
        }
    }

    const nRows = selRowHi - selRowLo + 1;
    const nCols = selColIds.size;
    let txt = `${nRows.toLocaleString()}R × ${nCols}C` +
              `  ·  Count ${count.toLocaleString()}`;
    if (numCount > 0) {
        txt += `  ·  Sum ${fmtNum(sum)}` +
               `  ·  Avg ${fmtNum(sum / numCount)}` +
               `  ·  Min ${fmtNum(min)}` +
               `  ·  Max ${fmtNum(max)}`;
    }
    el.textContent = txt;
}

// ── clipboard ─────────────────────────────────────────────────────────────────

function writeClipboard(text: string): void {
    if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text).catch(() => execCopy(text));
    } else {
        execCopy(text);
    }
}

function execCopy(text: string): void {
    try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0;';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
    } catch { /* ignore */ }
}

export function hasMultiSelection(): boolean {
    return selActive && selCellCount > 1;
}

export function copySelection(withHeader = false): void {
    if (!state.gridApi || !selActive) return;
    const cols = displayedColIds();
    const selCols = cols.filter(id => selColIds.has(id));
    const rowMap = displayRowToOrig();

    const lines: string[] = [];
    if (withHeader) {
        const header = state.data[0] ?? [];
        lines.push(selCols.map(colId => {
            const ci = parseInt(colId.slice(4), 10);
            return tsvCell(String(header[ci] ?? ''));
        }).join('\t'));
    }
    for (let r = selRowLo; r <= selRowHi; r++) {
        const orig = rowMap[r];
        const dataRow = orig != null && orig >= 0 ? state.data[orig] : undefined;
        lines.push(selCols.map(colId => {
            const ci = parseInt(colId.slice(4), 10);
            const v = dataRow?.[ci];
            return tsvCell(v != null ? String(v) : '');
        }).join('\t'));
    }
    writeClipboard(lines.join('\n'));
}

// ── delete (clear cells) ──────────────────────────────────────────────────────

function clearSelectedCells(): void {
    if (!state.gridApi || !selActive || IS_PREVIEW || IS_CHUNKED) return;
    const cols = displayedColIds();
    const selCols = cols.filter(id => selColIds.has(id));
    const rowMap = displayRowToOrig();

    // Pre-scan — don't push an undo entry if every selected cell is already empty.
    let anyNonEmpty = false;
    scan: for (let r = selRowLo; r <= selRowHi; r++) {
        const orig = rowMap[r];
        if (orig == null || orig < 0) continue;
        const dataRow = state.data[orig];
        if (!dataRow) continue;
        for (const colId of selCols) {
            const ci = parseInt(colId.slice(4), 10);
            if ((dataRow[ci] ?? '') !== '') { anyNonEmpty = true; break scan; }
        }
    }
    if (!anyNonEmpty) return;

    pushUndo();
    for (let r = selRowLo; r <= selRowHi; r++) {
        const orig = rowMap[r];
        if (orig == null || orig < 0) continue;
        const dataRow = state.data[orig];
        if (!dataRow) continue;
        const node = state.gridApi.getDisplayedRowAtIndex(r);
        for (const colId of selCols) {
            const ci = parseInt(colId.slice(4), 10);
            while (dataRow.length <= ci) dataRow.push('');
            dataRow[ci] = '';
            if (node?.data) node.data[colId] = '';
        }
    }
    // refreshCells (not a rowData reset) keeps the selection highlight in place.
    state.gridApi.refreshCells({ force: true });
    recomputeColTypes();
    notifyChange();
}

// ── selection entry points ────────────────────────────────────────────────────

export function clearRangeSelection(): void {
    if (!selActive && selCellCount === 0) return;
    selActive = false;
    dragging = false;
    document.body.style.userSelect = '';
    recomputeCache();
    repaint();
    const el = document.getElementById('sel-stats');
    if (el) el.textContent = '';
}

function selectWholeColumn(colId: string): void {
    const cpos = displayedColIds().indexOf(colId);
    if (cpos < 0) return;
    selActive = true;
    selType = 'cols';
    anchorCol = focusCol = cpos;
    anchorRow = focusRow = 0;
    selectionChanged();
}

function selectAll(): void {
    if (displayedRowCount() === 0) return;
    selActive = true;
    selType = 'all';
    selectionChanged();
}

function extendByKey(key: string): void {
    const cols = displayedColIds();
    const rowCount = displayedRowCount();
    if (cols.length === 0 || rowCount === 0) return;

    if (!selActive) {
        const fr = state.focusedCellRowIndex;
        const fc = state.focusedCellColId;
        if (fr == null || fc == null) return;
        const cpos = fc === 'row-index' ? 0 : cols.indexOf(fc);
        if (cpos < 0) return;
        selActive = true;
        anchorRow = focusRow = fr;
        anchorCol = focusCol = cpos;
    }
    // Shift+Arrow always works on a rectangular cell selection.
    if (selType !== 'cells') selType = 'cells';

    if (key === 'ArrowUp')    focusRow = Math.max(0, focusRow - 1);
    if (key === 'ArrowDown')  focusRow = Math.min(rowCount - 1, focusRow + 1);
    if (key === 'ArrowLeft')  focusCol = Math.max(0, focusCol - 1);
    if (key === 'ArrowRight') focusCol = Math.min(cols.length - 1, focusCol + 1);

    state.gridApi?.ensureIndexVisible(focusRow);
    selectionChanged();
}

// ── mouse handlers (called from builder.ts gridOptions) ───────────────────────

export function onCellMouseDownHandler(e: any): void {
    if (state.isCellEditing) return;
    const native: MouseEvent | undefined = e.event;
    if (native && native.button !== 0) return;   // left button only — right = context menu

    const colId: string | undefined = e.column?.getColId?.();
    const rowIndex: number | null = e.rowIndex;
    if (colId == null || rowIndex == null) return;

    const shift = !!native?.shiftKey;

    if (colId === 'row-index') {
        if (shift && selActive && selType === 'rows') {
            focusRow = rowIndex;
        } else {
            selActive = true; selType = 'rows';
            anchorRow = focusRow = rowIndex;
            anchorCol = focusCol = 0;
        }
        dragging = true; dragMode = 'rows';
    } else {
        const cpos = displayedColIds().indexOf(colId);
        if (cpos < 0) return;
        if (shift && selActive && selType !== 'all') {
            selType = 'cells';
            focusRow = rowIndex; focusCol = cpos;
        } else {
            selActive = true; selType = 'cells';
            anchorRow = focusRow = rowIndex;
            anchorCol = focusCol = cpos;
        }
        dragging = true; dragMode = 'cells';
    }
    document.body.style.userSelect = 'none';
    selectionChanged();
}

export function onCellMouseOverHandler(e: any): void {
    if (!dragging) return;
    const rowIndex: number | null = e.rowIndex;
    if (rowIndex == null) return;
    const colId: string | undefined = e.column?.getColId?.();

    focusRow = rowIndex;
    if (dragMode === 'cells') {
        if (colId === 'row-index') {
            focusCol = 0;
        } else if (colId != null) {
            const cpos = displayedColIds().indexOf(colId);
            if (cpos >= 0) focusCol = cpos;
        }
    }
    selectionChanged();
}

// ── keyboard handler (capture phase — runs before keyboard.ts and AG Grid) ────

function isTypingTarget(t: EventTarget | null): boolean {
    if (t instanceof HTMLElement) {
        const tag = t.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || t.isContentEditable) return true;
    }
    return false;
}

const ARROWS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];

function onKeyDown(e: KeyboardEvent): void {
    if (state.isCellEditing) return;
    if (isTypingTarget(e.target)) return;
    if (!state.gridApi) return;

    const ctrl = e.ctrlKey || e.metaKey;
    const key = e.key;

    if (ctrl && (key === 'a' || key === 'A')) {
        e.preventDefault(); e.stopPropagation();
        selectAll();
        return;
    }

    if (ctrl && (key === 'c' || key === 'C')) {
        // Single cell / nothing selected → let keyboard.ts handle single-cell copy.
        if (selActive && selCellCount > 1) {
            e.preventDefault(); e.stopPropagation();
            copySelection();
        }
        return;
    }

    if (key === 'Delete' || key === 'Backspace') {
        if (selActive && selCellCount >= 1 && !IS_PREVIEW && !IS_CHUNKED) {
            e.preventDefault(); e.stopPropagation();
            clearSelectedCells();
        }
        return;
    }

    if (ARROWS.includes(key)) {
        if (e.shiftKey && !ctrl) {
            e.preventDefault(); e.stopPropagation();
            extendByKey(key);
        } else if (!e.shiftKey && !ctrl && selActive && selCellCount > 1) {
            // Plain arrow collapses a multi-cell selection — AG Grid then moves focus.
            clearRangeSelection();
        }
        return;
    }
}

// ── setup ─────────────────────────────────────────────────────────────────────

export function setupRangeSelect(): void {
    document.addEventListener('keydown', onKeyDown, true /* capture */);
    document.addEventListener('mouseup', () => {
        if (!dragging) return;
        dragging = false;
        document.body.style.userSelect = '';
    });

    const colMenu = document.getElementById('col-context-menu') as HTMLElement | null;
    document.getElementById('col-ctx-select')?.addEventListener('click', () => {
        const colId = colMenu?.dataset.colId;
        if (colId) selectWholeColumn(colId);
        colMenu?.classList.add('hidden');
    });
}
