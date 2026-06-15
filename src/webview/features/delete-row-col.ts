import { state, getNumCols } from '../state';
import { pushUndo, notifyChange } from './undo-redo';
import { refreshGrid } from '../grid/refresh';
import { recomputeColTypes } from '../grid/column-type';
import { buildGrid } from '../grid/builder';
import {
    deleteColumnsFromData,
    deleteRowsFromData,
    insertRowsIntoData,
    insertColumnsIntoData,
    shiftIndicesAfterDelete,
    shiftIndicesAfterInsert,
} from '../grid/mutations';
import {
    copySelection,
    hasMultiSelection,
    clearRangeSelection,
    getSelectedRowDisplayIndices,
    getSelectedColIndices,
} from './range-select';
import { freezeRows, unfreezeRow, unfreezeAllRows, frozenRowCount } from './freeze-rows';

// ── Data mutations ────────────────────────────────────────────────────────────

function deleteColumn(colId: string): void {
    const colIndex = parseInt(colId.replace('col_', ''), 10);
    if (isNaN(colIndex)) return;
    deleteColumns([colIndex]);
}

// Deletes one or more columns (data indices) in a single pass. The actual array
// surgery lives in the pure deleteColumnsFromData() so the index-shift correctness
// is unit-tested; everything here is the grid-state bookkeeping around it.
function deleteColumns(colIndices: number[]): void {
    const indices = colIndices.filter(c => Number.isInteger(c) && c >= 0);
    if (indices.length === 0) return;
    pushUndo();
    // map() rebuilds every row array, replacing the frozen rows' references —
    // re-anchor them by position (row count is unchanged) so the freezes survive.
    const frozenIdxs = state.frozenRowRefs.map(r => state.data.indexOf(r)).filter(i => i >= 0);
    state.data = deleteColumnsFromData(state.data, indices);
    state.frozenRowRefs = frozenIdxs.map(i => state.data[i]);
    state.pinnedCols = shiftIndicesAfterDelete(state.pinnedCols, indices); // keep frozen columns frozen
    state.hiddenCols.clear(); // column indices shifted — drop index-based hide state
    state.isAutoFitted = false;
    state.autoFitCache = null;
    clearRangeSelection(); // the column selection is now stale
    buildGrid();
    notifyChange();
}

function deleteRows(displayIndices: number[]): void {
    if (displayIndices.length === 0 || !state.gridApi) return;
    pushUndo();
    // Map display indices → original data-row positions. A row's index in
    // state.data differs from its display index whenever a sort is active.
    const toDelete = new Set<number>();
    for (const di of displayIndices) {
        const oi = state.gridApi.getDisplayedRowAtIndex(di)?.data?._origIndex;
        if (oi != null) toDelete.add(Number(oi));
    }
    state.data = deleteRowsFromData(state.data, toDelete);
    state.isAutoFitted = false;
    state.autoFitCache = null;
    refreshGrid();
    recomputeColTypes();
    notifyChange();
}

// anchorDisplayIndex is the displayed (0-based) row used as the reference edge:
// position 'above' inserts before it, 'below' inserts after. `count` blank rows
// are inserted (spreadsheet behaviour: N selected rows → N inserted). The caller
// picks the anchor as the selection's top edge for 'above' and bottom edge for
// 'below', so the insert lands at the selection boundary, not the clicked row.
//
// If a sort is active we'd otherwise insert at the right slot in state.data only
// to have AG Grid re-sort the (empty) new rows to one of the extremes. To avoid
// that we bake the current displayed order into state.data and clear the sort
// model first, so the spliced rows stay exactly where we put them.
function insertRows(anchorDisplayIndex: number, position: 'above' | 'below', count: number): void {
    if (!state.gridApi || count < 1) return;

    const targetNode = state.gridApi.getDisplayedRowAtIndex(anchorDisplayIndex);
    if (!targetNode?.data) return;
    // Hold a reference to the actual row array — survives the reorder below
    // so we can find its new index without doing _origIndex arithmetic on
    // a state.data that has just been reshuffled.
    const targetOrig = Number(targetNode.data._origIndex);
    if (!targetOrig || !state.data[targetOrig]) return;
    const targetRowRef = state.data[targetOrig];

    const colState = state.gridApi.getColumnState() as any[];
    const hasActiveSort = colState.some((s: any) => s.sort);

    pushUndo();

    if (hasActiveSort) {
        const header = state.data[0];
        const visible: string[][] = [];
        const visibleOrigs = new Set<number>();
        // forEachNodeAfterFilterAndSort iterates in displayed order, skipping
        // any rows hidden by an active filter.
        state.gridApi.forEachNodeAfterFilterAndSort((node: any) => {
            const oi = Number(node.data?._origIndex);
            if (oi && state.data[oi]) {
                visible.push(state.data[oi]);
                visibleOrigs.add(oi);
            }
        });
        // Preserve filtered-out rows by appending them at the end in their
        // original file order — they'd otherwise be lost on reorder.
        const hidden: string[][] = [];
        for (let i = 1; i < state.data.length; i++) {
            if (!visibleOrigs.has(i)) hidden.push(state.data[i]);
        }
        state.data = [header, ...visible, ...hidden];

        // Clear the sort indicator. The data now equals what the user saw, so
        // there's nothing left to sort against and a stale arrow would lie.
        state.gridApi.applyColumnState({
            state: colState.map((s: any) => ({ ...s, sort: null })),
        });
    }

    // Locate the target row in (possibly reshuffled) state.data by reference.
    const targetIndex = state.data.indexOf(targetRowRef);
    if (targetIndex < 0) return;

    const insertAt = position === 'above' ? targetIndex : targetIndex + 1;
    const numCols = getNumCols(state.data);
    state.data = insertRowsIntoData(state.data, insertAt, count, numCols);

    state.isAutoFitted = false;
    state.autoFitCache = null;
    refreshGrid();
    recomputeColTypes();
    notifyChange();
}

// baseIndex is the reference column (data index). 'left' inserts before it,
// 'right' after. `count` blank columns are inserted (N selected columns → N).
// The caller anchors to the selection's left edge for 'left' and right edge for
// 'right'.
function insertColumns(baseIndex: number, position: 'left' | 'right', count: number): void {
    if (count < 1 || isNaN(baseIndex)) return;
    const insertAt = position === 'left' ? baseIndex : baseIndex + 1;

    pushUndo();
    // map() (inside insertColumnsIntoData) rebuilds every row array — re-anchor the
    // frozen rows by position afterwards so the freezes survive a column insert (row
    // positions are unchanged).
    const frozenIdxs = state.frozenRowRefs.map(r => state.data.indexOf(r)).filter(i => i >= 0);
    state.data = insertColumnsIntoData(state.data, insertAt, count);
    state.frozenRowRefs = frozenIdxs.map(i => state.data[i]);
    state.pinnedCols = shiftIndicesAfterInsert(state.pinnedCols, insertAt, count); // keep frozen columns frozen
    state.hiddenCols.clear(); // column indices shifted — drop index-based hide state
    state.isAutoFitted = false;
    state.autoFitCache = null;
    clearRangeSelection(); // the column selection is now stale
    // buildGrid (not refreshGrid) — column count changed, columnDefs need rebuild.
    buildGrid();
    notifyChange();
}

// ── Custom context menu ───────────────────────────────────────────────────────
function makeRowItem(label: string, iconClass: string, danger = false): HTMLDivElement {
    const item = document.createElement('div');
    item.className = 'row-ctx-item' + (danger ? ' danger' : '');
    const icon = document.createElement('i');
    icon.className = 'codicon ' + iconClass;
    const span = document.createElement('span');
    span.className = 'row-ctx-label';
    span.textContent = label;
    item.append(icon, span);
    return item;
}

function hideMenu(): void {
    document.getElementById('row-context-menu')?.classList.add('hidden');
}

function showContextMenu(x: number, y: number, rowIndex: number | null, colId: string | null, isPinnedRow = false, pinnedOrig: number | null = null): void {
    const menu = document.getElementById('row-context-menu') as HTMLElement | null;
    if (!menu) return;

    menu.innerHTML = '';

    // Resolve the right-clicked row's grid node. A frozen row lives in the
    // pinned-top band (its DOM row-index would otherwise collide with body row 0),
    // so it must be looked up via getPinnedTopRow, not getDisplayedRowAtIndex.
    const resolveNode = (): any =>
        isPinnedRow            ? state.gridApi?.getPinnedTopRow(rowIndex ?? 0)
        : rowIndex === null    ? null
        : state.gridApi?.getDisplayedRowAtIndex(rowIndex);

    // ── Copy ──────────────────────────────────────────────────────────────────
    if (hasMultiSelection()) {
        // A range is selected — offer range copy, with and without header row.
        const copyRange = makeRowItem('Copy', 'codicon-copy');
        copyRange.addEventListener('click', () => { copySelection(false); hideMenu(); });
        menu.appendChild(copyRange);

        const copyWithHeader = makeRowItem('Copy with header', 'codicon-copy');
        copyWithHeader.addEventListener('click', () => { copySelection(true); hideMenu(); });
        menu.appendChild(copyWithHeader);

        const sep = document.createElement('div');
        sep.className = 'col-ctx-separator';
        menu.appendChild(sep);
    } else if (colId && rowIndex !== null && colId !== 'row-index') {
        // Read the value from the resolved grid node — rowIndex is a display
        // index, which differs from the state.data position when a sort is active.
        const node  = resolveNode();
        const raw   = node?.data?.[colId];
        const value = raw != null ? String(raw) : '';

        const copyItem = makeRowItem('Copy', 'codicon-copy');
        copyItem.addEventListener('click', () => {
            navigator.clipboard.writeText(value).catch(() => {});
            hideMenu();
        });
        menu.appendChild(copyItem);

        const sep = document.createElement('div');
        sep.className = 'col-ctx-separator';
        menu.appendChild(sep);
    }

    // ── Freeze / Unfreeze row(s) ──────────────────────────────────────────────
    // A pure view aid (available in preview too). Suppressed while duplicate
    // detection is active, since that mode drives the grid's rowData itself —
    // the two are mutually exclusive (runDetect() drops any frozen row).
    if (state.dupRowSet.size === 0 && !state.dupShowOnly) {
        if (isPinnedRow) {
            // Right-clicked a pinned (frozen) row -> unfreeze just that row.
            const clickedOrig = pinnedOrig;
            if (clickedOrig != null) {
                const item = makeRowItem('Unfreeze row', 'codicon-pin');
                item.addEventListener('click', () => { unfreezeRow(clickedOrig); hideMenu(); });
                menu.appendChild(item);
            }
        } else if (rowIndex !== null) {
            // Body rows are never frozen themselves (a frozen row moves to the
            // pinned band), so the body menu only offers Freeze. With a multi-row
            // selection that includes the clicked row, freeze them all at once.
            const selectedRows = getSelectedRowDisplayIndices();
            const inSel = selectedRows.length > 1 && selectedRows.includes(rowIndex);
            const displayRows = inSel ? selectedRows : [rowIndex];
            const origs: number[] = [];
            for (const di of displayRows) {
                const oi = state.gridApi?.getDisplayedRowAtIndex(di)?.data?._origIndex;
                if (oi != null) origs.push(Number(oi));
            }

            if (origs.length > 0) {
                const item = makeRowItem(origs.length > 1 ? `Freeze ${origs.length} rows` : 'Freeze row', 'codicon-pinned');
                item.addEventListener('click', () => { freezeRows(origs); hideMenu(); });
                menu.appendChild(item);
            }
        }

        // "Unfreeze all rows (N)" sits below the per-row items, shown on any row
        // while more than one row is frozen - mirrors "Unfreeze all columns".
        if (frozenRowCount() > 1) {
            const all = makeRowItem(`Unfreeze all rows (${frozenRowCount()})`, 'codicon-pin');
            all.addEventListener('click', () => { unfreezeAllRows(); hideMenu(); });
            menu.appendChild(all);
        }

        // One separator for the freeze group, if it has any item.
        const hasFreezeItem = (isPinnedRow && pinnedOrig != null) || (!isPinnedRow && rowIndex !== null) || frozenRowCount() > 1;
        if (hasFreezeItem) {
            const sep = document.createElement('div');
            sep.className = 'col-ctx-separator';
            menu.appendChild(sep);
        }
    }

    // ── Insert row(s) above/below ─────────────────────────────────────────────
    if (rowIndex !== null && !IS_PREVIEW && !isPinnedRow) {
        // If the clicked row is inside a multi-row selection, insert that many
        // rows (Excel/Sheets behaviour) anchored to the selection edge — top for
        // "above", bottom for "below" — not the clicked row.
        const selectedRows = getSelectedRowDisplayIndices();
        const inSel = selectedRows.length > 1 && selectedRows.includes(rowIndex);
        const count = inSel ? selectedRows.length : 1;
        const topEdge    = inSel ? Math.min(...selectedRows) : rowIndex;
        const bottomEdge = inSel ? Math.max(...selectedRows) : rowIndex;

        const insertAbove = makeRowItem(count > 1 ? `Insert ${count} rows above` : 'Insert row above', 'codicon-arrow-up');
        insertAbove.addEventListener('click', () => {
            insertRows(topEdge, 'above', count);
            hideMenu();
        });
        menu.appendChild(insertAbove);

        const insertBelow = makeRowItem(count > 1 ? `Insert ${count} rows below` : 'Insert row below', 'codicon-arrow-down');
        insertBelow.addEventListener('click', () => {
            insertRows(bottomEdge, 'below', count);
            hideMenu();
        });
        menu.appendChild(insertBelow);

        const sep = document.createElement('div');
        sep.className = 'col-ctx-separator';
        menu.appendChild(sep);
    }

    // ── Delete row(s) ─────────────────────────────────────────────────────────
    if (rowIndex !== null && !IS_PREVIEW && !isPinnedRow) {
        // Use the hand-rolled gutter selection (shift-click / drag), not AG Grid's
        // native getSelectedNodes() — rowSelection is never enabled, so that was
        // always empty and "Delete N rows" could never trigger. If the right-clicked
        // row is inside the selection, delete the whole selection, else just it.
        const selectedRows = getSelectedRowDisplayIndices();
        const rowIndices = selectedRows.length > 1 && selectedRows.includes(rowIndex)
            ? selectedRows
            : [rowIndex];

        const delRowItem = makeRowItem(rowIndices.length > 1 ? `Delete ${rowIndices.length} rows` : 'Delete row', 'codicon-trash', true);
        delRowItem.addEventListener('click', () => {
            deleteRows(rowIndices);
            hideMenu();
        });
        menu.appendChild(delRowItem);
    }

    // ── Delete column(s) ──────────────────────────────────────────────────────
    if (colId && colId !== 'row-index' && !IS_PREVIEW) {
        const colIndex = parseInt(colId.replace('col_', ''), 10);
        const selectedCols = getSelectedColIndices();
        const useMulti = selectedCols.length > 1 && selectedCols.includes(colIndex);

        const delColItem = makeRowItem(useMulti ? `Delete ${selectedCols.length} columns` : 'Delete column', 'codicon-trash', true);
        delColItem.addEventListener('click', () => {
            if (useMulti) deleteColumns(selectedCols);
            else if (colId) deleteColumn(colId);
            hideMenu();
        });
        menu.appendChild(delColItem);
    }

    // Remove orphan separators: drop a leading/trailing separator and any two
    // that ended up adjacent (e.g. a middle group rendered nothing).
    const items = Array.from(menu.children);
    let lastWasSep = true;
    for (const el of items) {
        const isSep = el.classList.contains('col-ctx-separator');
        if (isSep && lastWasSep) { el.remove(); continue; }
        lastWasSep = isSep;
    }
    const last = menu.lastElementChild;
    if (last?.classList.contains('col-ctx-separator')) last.remove();

    if (menu.children.length === 0) return;

    // Position — keep menu on screen
    menu.classList.remove('hidden');
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const mw = menu.offsetWidth || 160;
    const mh = menu.offsetHeight || 80;
    menu.style.left = Math.min(x, vw - mw - 4) + 'px';
    menu.style.top  = Math.min(y, vh - mh - 4) + 'px';

    // Close on next click outside
    const closeHandler = (evt: MouseEvent) => {
        if (!menu.contains(evt.target as Node)) {
            hideMenu();
            document.removeEventListener('mousedown', closeHandler, true);
        }
    };
    setTimeout(() => document.addEventListener('mousedown', closeHandler, true), 0);
}

// ── Setup ─────────────────────────────────────────────────────────────────────

export function setupDeleteRowCol(): void {
    // Wire the column-header context menu's insert + delete buttons
    const colMenu = document.getElementById('col-context-menu') as HTMLElement | null;
    document.getElementById('col-ctx-delete')?.addEventListener('click', () => {
        const colId = colMenu?.dataset.colId;
        colMenu?.classList.add('hidden');
        if (!colId) return;
        const colIndex = parseInt(colId.replace('col_', ''), 10);
        const selectedCols = getSelectedColIndices();
        // Right-clicked a header that's part of a multi-column selection → delete
        // them all; otherwise just the one column under the cursor.
        if (selectedCols.length > 1 && selectedCols.includes(colIndex)) deleteColumns(selectedCols);
        else deleteColumn(colId);
    });
    document.getElementById('col-ctx-insert-left')?.addEventListener('click', () => {
        const colId = colMenu?.dataset.colId;
        colMenu?.classList.add('hidden');
        if (!colId) return;
        const baseIndex = parseInt(colId.replace('col_', ''), 10);
        const selectedCols = getSelectedColIndices();
        const inSel = selectedCols.length > 1 && selectedCols.includes(baseIndex);
        // Anchor to the left edge of the selection; insert as many as are selected.
        insertColumns(inSel ? Math.min(...selectedCols) : baseIndex, 'left', inSel ? selectedCols.length : 1);
    });
    document.getElementById('col-ctx-insert-right')?.addEventListener('click', () => {
        const colId = colMenu?.dataset.colId;
        colMenu?.classList.add('hidden');
        if (!colId) return;
        const baseIndex = parseInt(colId.replace('col_', ''), 10);
        const selectedCols = getSelectedColIndices();
        const inSel = selectedCols.length > 1 && selectedCols.includes(baseIndex);
        // Anchor to the right edge of the selection; insert as many as are selected.
        insertColumns(inSel ? Math.max(...selectedCols) : baseIndex, 'right', inSel ? selectedCols.length : 1);
    });

    // Attach a SINGLE contextmenu listener to #grid-container.
    // This element is never replaced — buildGrid() only clears its innerHTML —
    // so the listener survives every grid rebuild and every undo/redo.
    const container = document.getElementById('grid-container');
    if (!container) return;

    container.addEventListener('contextmenu', (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        const cell = target.closest('.ag-cell') as HTMLElement | null;
        if (!cell) return; // outside grid cells — let browser handle normally

        e.preventDefault();

        const colId   = cell.getAttribute('col-id');
        const agRow   = cell.closest('.ag-row') as HTMLElement | null;
        // Frozen rows render in AG Grid's .ag-floating-top band with their own
        // row-index attribute — flag them so the menu resolves the right node.
        const isPinnedRow = !!agRow?.closest('.ag-floating-top');
        const riStr   = agRow?.getAttribute('row-index');
        const rowIndex = riStr != null ? parseInt(riStr, 10) : null;

        // For a pinned (frozen) row, resolve which row it is independently of AG
        // Grid's pinned-row index scheme: the '#' gutter cell renders a pin icon +
        // the origIndex (builder.ts cellRenderer). The icon is a ::before glyph with
        // no text node, so the cell's textContent is just the number - read it from
        // the matching row in the band.
        let pinnedOrig: number | null = null;
        if (isPinnedRow && agRow && riStr != null) {
            const ft = agRow.closest('.ag-floating-top');
            const gutter = ft?.querySelector(`.ag-row[row-index="${riStr}"] [col-id="row-index"]`);
            const m = (gutter?.textContent ?? '').match(/\d+/);
            pinnedOrig = m ? parseInt(m[0], 10) : null;
        }

        showContextMenu(e.clientX, e.clientY, rowIndex, colId, isPinnedRow, pinnedOrig);
    });
}
