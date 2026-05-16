import { state, getNumCols } from '../state';
import { pushUndo, notifyChange } from './undo-redo';
import { refreshGrid } from '../grid/refresh';
import { recomputeColTypes } from '../grid/column-type';
import { buildGrid } from '../grid/builder';
import { copySelection, hasMultiSelection } from './range-select';

// ── Data mutations ────────────────────────────────────────────────────────────

function deleteColumn(colId: string): void {
    const colIndex = parseInt(colId.replace('col_', ''), 10);
    if (isNaN(colIndex)) return;
    pushUndo();
    state.data = state.data.map(row => row.filter((_, i) => i !== colIndex));
    state.isAutoFitted = false;
    state.autoFitCache = null;
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
    state.data = state.data.filter((_, i) => i === 0 || !toDelete.has(i));
    state.isAutoFitted = false;
    state.autoFitCache = null;
    refreshGrid();
    recomputeColTypes();
    notifyChange();
}

// rowIndex is the displayed (0-based) row index of the data row that the user
// right-clicked. position 'above' inserts before it, 'below' inserts after.
//
// If a sort is active we'd otherwise insert at the right slot in state.data
// only to have AG Grid re-sort the (empty) new row to one of the extremes —
// confusing the user who expected it to appear directly next to their target.
// To avoid that we bake the current displayed order into state.data and clear
// the sort model first, so the spliced row stays exactly where we put it.
function insertRow(rowIndex: number, position: 'above' | 'below'): void {
    if (!state.gridApi) return;

    const targetNode = state.gridApi.getDisplayedRowAtIndex(rowIndex);
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
    state.data.splice(insertAt, 0, Array<string>(numCols).fill(''));

    state.isAutoFitted = false;
    state.autoFitCache = null;
    refreshGrid();
    recomputeColTypes();
    notifyChange();
}

function insertColumn(colId: string, position: 'left' | 'right'): void {
    const baseIndex = parseInt(colId.replace('col_', ''), 10);
    if (isNaN(baseIndex)) return;
    const insertAt = position === 'left' ? baseIndex : baseIndex + 1;

    pushUndo();
    state.data = state.data.map(row => {
        const copy = row.slice();
        copy.splice(insertAt, 0, '');
        return copy;
    });
    state.isAutoFitted = false;
    state.autoFitCache = null;
    // buildGrid (not refreshGrid) — column count changed, columnDefs need rebuild.
    buildGrid();
    notifyChange();
}

// ── Custom context menu ───────────────────────────────────────────────────────

function hideMenu(): void {
    document.getElementById('row-context-menu')?.classList.add('hidden');
}

function showContextMenu(x: number, y: number, rowIndex: number | null, colId: string | null): void {
    const menu = document.getElementById('row-context-menu') as HTMLElement | null;
    if (!menu) return;

    menu.innerHTML = '';

    // ── Copy ──────────────────────────────────────────────────────────────────
    if (hasMultiSelection()) {
        // A range is selected — offer range copy, with and without header row.
        const copyRange = document.createElement('div');
        copyRange.className = 'row-ctx-item';
        copyRange.textContent = 'Copy';
        copyRange.addEventListener('click', () => { copySelection(false); hideMenu(); });
        menu.appendChild(copyRange);

        const copyWithHeader = document.createElement('div');
        copyWithHeader.className = 'row-ctx-item';
        copyWithHeader.textContent = 'Copy with header';
        copyWithHeader.addEventListener('click', () => { copySelection(true); hideMenu(); });
        menu.appendChild(copyWithHeader);

        const sep = document.createElement('div');
        sep.className = 'col-ctx-separator';
        menu.appendChild(sep);
    } else if (colId && rowIndex !== null && colId !== 'row-index') {
        // Read the value from the displayed grid node — rowIndex is a display
        // index, which differs from the state.data position when a sort is active.
        const node  = state.gridApi?.getDisplayedRowAtIndex(rowIndex);
        const raw   = node?.data?.[colId];
        const value = raw != null ? String(raw) : '';

        const copyItem = document.createElement('div');
        copyItem.className = 'row-ctx-item';
        copyItem.textContent = 'Copy';
        copyItem.addEventListener('click', () => {
            navigator.clipboard.writeText(value).catch(() => {});
            hideMenu();
        });
        menu.appendChild(copyItem);

        const sep = document.createElement('div');
        sep.className = 'col-ctx-separator';
        menu.appendChild(sep);
    }

    // ── Insert row above/below ────────────────────────────────────────────────
    if (rowIndex !== null && !IS_PREVIEW) {
        const insertAbove = document.createElement('div');
        insertAbove.className = 'row-ctx-item';
        insertAbove.textContent = 'Insert row above';
        insertAbove.addEventListener('click', () => {
            insertRow(rowIndex, 'above');
            hideMenu();
        });
        menu.appendChild(insertAbove);

        const insertBelow = document.createElement('div');
        insertBelow.className = 'row-ctx-item';
        insertBelow.textContent = 'Insert row below';
        insertBelow.addEventListener('click', () => {
            insertRow(rowIndex, 'below');
            hideMenu();
        });
        menu.appendChild(insertBelow);

        const sep = document.createElement('div');
        sep.className = 'col-ctx-separator';
        menu.appendChild(sep);
    }

    // ── Delete row(s) ─────────────────────────────────────────────────────────
    if (rowIndex !== null && !IS_PREVIEW) {
        const selectedNodes: any[] = state.gridApi?.getSelectedNodes() ?? [];
        const selectedIndices: number[] = selectedNodes.map((n: any) => n.rowIndex as number);
        const rowIndices = selectedIndices.includes(rowIndex) ? selectedIndices : [rowIndex];

        const label = rowIndices.length > 1 ? `Delete ${rowIndices.length} rows` : 'Delete row';
        const delRowItem = document.createElement('div');
        delRowItem.className = 'row-ctx-item danger';
        delRowItem.textContent = label;
        delRowItem.addEventListener('click', () => {
            deleteRows(rowIndices);
            hideMenu();
        });
        menu.appendChild(delRowItem);
    }

    // ── Delete column ─────────────────────────────────────────────────────────
    if (colId && colId !== 'row-index' && !IS_PREVIEW) {
        const delColItem = document.createElement('div');
        delColItem.className = 'row-ctx-item danger';
        delColItem.textContent = 'Delete column';
        delColItem.addEventListener('click', () => {
            if (colId) deleteColumn(colId);
            hideMenu();
        });
        menu.appendChild(delColItem);
    }

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
        if (colId) deleteColumn(colId);
        colMenu?.classList.add('hidden');
    });
    document.getElementById('col-ctx-insert-left')?.addEventListener('click', () => {
        const colId = colMenu?.dataset.colId;
        if (colId) insertColumn(colId, 'left');
        colMenu?.classList.add('hidden');
    });
    document.getElementById('col-ctx-insert-right')?.addEventListener('click', () => {
        const colId = colMenu?.dataset.colId;
        if (colId) insertColumn(colId, 'right');
        colMenu?.classList.add('hidden');
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
        const riStr   = agRow?.getAttribute('row-index');
        const rowIndex = riStr != null ? parseInt(riStr, 10) : null;

        showContextMenu(e.clientX, e.clientY, rowIndex, colId);
    });
}
