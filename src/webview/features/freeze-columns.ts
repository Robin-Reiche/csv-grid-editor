import { state } from '../state';
import { getSelectedColIndices } from './range-select';

// Kept as a no-op — builder.ts calls this after grid creation but it is no
// longer needed since setupFreezeColumns uses event delegation on #grid-container.
export function attachHeaderContextMenus(): void {}

export function setupFreezeColumns(): void {
    const menu = document.getElementById('col-context-menu') as HTMLElement | null;
    if (!menu) return;

    document.getElementById('col-ctx-freeze')?.addEventListener('click', () => {
        const colId = menu.dataset.colId;
        if (colId && state.gridApi) {
            state.gridApi.applyColumnState({ state: [{ colId, pinned: 'left' }] });
        }
        menu.classList.add('hidden');
    });

    document.getElementById('col-ctx-unfreeze')?.addEventListener('click', () => {
        const colId = menu.dataset.colId;
        if (colId && state.gridApi) {
            state.gridApi.applyColumnState({ state: [{ colId, pinned: null }] });
        }
        menu.classList.add('hidden');
    });

    document.addEventListener('click', () => menu.classList.add('hidden'));

    // Single contextmenu listener on #grid-container using event delegation.
    // #grid-container is never replaced — only its innerHTML changes — so this
    // listener works for the full lifetime of the page regardless of rebuilds.
    const container = document.getElementById('grid-container');
    if (!container) return;

    container.addEventListener('contextmenu', (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        const headerCell = target.closest<HTMLElement>('.ag-header-cell[col-id]');
        if (!headerCell) return; // not a header cell — handled elsewhere

        e.preventDefault();
        e.stopPropagation(); // don't also trigger the data-cell contextmenu listener

        const colId = headerCell.getAttribute('col-id');
        if (!colId || colId === 'row-index') return;

        const colStateArr = state.gridApi?.getColumnState() as any[] ?? [];
        const col         = colStateArr.find((s: any) => s.colId === colId);
        const isPinned    = col?.pinned === 'left';

        const freezeEl   = document.getElementById('col-ctx-freeze');
        const unfreezeEl = document.getElementById('col-ctx-unfreeze');
        if (freezeEl)   freezeEl.style.display  = isPinned ? 'none'  : 'block';
        if (unfreezeEl) unfreezeEl.style.display = isPinned ? 'block' : 'none';

        // Reflect a multi-column selection in the insert/delete labels so the user
        // sees "Insert/Delete N columns" before clicking (matches the data-cell menu
        // and Google Sheets). N inserts happen anchored to the selection edge.
        const colIndex = parseInt(colId.replace('col_', ''), 10);
        const selectedCols = getSelectedColIndices();
        const n = selectedCols.length > 1 && selectedCols.includes(colIndex) ? selectedCols.length : 1;

        const delEl = document.getElementById('col-ctx-delete');
        if (delEl)  delEl.textContent  = n > 1 ? `✕ Delete ${n} columns`      : '✕ Delete column';
        const insL = document.getElementById('col-ctx-insert-left');
        if (insL)   insL.textContent   = n > 1 ? `⬅️ Insert ${n} columns left`  : '⬅️ Insert column left';
        const insR = document.getElementById('col-ctx-insert-right');
        if (insR)   insR.textContent   = n > 1 ? `➡️ Insert ${n} columns right` : '➡️ Insert column right';

        menu.dataset.colId = colId;
        menu.style.left    = e.clientX + 'px';
        menu.style.top     = e.clientY + 'px';
        menu.classList.remove('hidden');
    });
}
