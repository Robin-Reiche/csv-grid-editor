import { state } from '../state';
import { pushUndo, notifyChange } from './undo-redo';
import { refreshGrid } from '../grid/refresh';
import { recomputeColTypes } from '../grid/column-type';
import { buildGrid } from '../grid/builder';

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

function deleteRows(rowIndices: number[]): void {
    if (rowIndices.length === 0) return;
    pushUndo();
    const toDelete = new Set(rowIndices.map(i => i + 1)); // +1 to skip header
    state.data = state.data.filter((_, i) => !toDelete.has(i));
    state.isAutoFitted = false;
    state.autoFitCache = null;
    refreshGrid();
    recomputeColTypes();
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

    // ── Copy cell value ───────────────────────────────────────────────────────
    if (colId && rowIndex !== null && colId !== 'row-index') {
        const colIndex = parseInt(colId.replace('col_', ''), 10);
        const dataRowIndex = rowIndex + 1; // +1 to skip header
        const value = !isNaN(colIndex) ? (state.data[dataRowIndex]?.[colIndex] ?? '') : '';

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
    // Wire the column-header context menu's delete button
    const colMenu = document.getElementById('col-context-menu') as HTMLElement | null;
    document.getElementById('col-ctx-delete')?.addEventListener('click', () => {
        const colId = colMenu?.dataset.colId;
        if (colId) deleteColumn(colId);
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
