import { state } from '../state';
import { getSelectedColIndices } from './range-select';

// Kept as a no-op — builder.ts calls this after grid creation but it is no
// longer needed since setupFreezeColumns uses event delegation on #grid-container.
export function attachHeaderContextMenus(): void {}

export function setupFreezeColumns(): void {
    const menu = document.getElementById('col-context-menu') as HTMLElement | null;
    if (!menu) return;

    // If the right-clicked column is part of a multi-column selection, freeze /
    // unfreeze applies to all selected columns, otherwise just the clicked one.
    const targetColIds = (colId: string): string[] => {
        const colIndex = parseInt(colId.replace('col_', ''), 10);
        const sel = getSelectedColIndices();
        return sel.length > 1 && sel.includes(colIndex) ? sel.map(i => 'col_' + i) : [colId];
    };

    document.getElementById('col-ctx-freeze')?.addEventListener('click', () => {
        const colId = menu.dataset.colId;
        menu.classList.add('hidden');
        if (!colId || !state.gridApi) return;
        const ids = targetColIds(colId);
        // Track the freeze in state so it survives a buildGrid rebuild, then apply
        // it live without a rebuild.
        for (const id of ids) { const ci = parseInt(id.slice(4), 10); if (!isNaN(ci)) state.pinnedCols.add(ci); }
        state.gridApi.applyColumnState({ state: ids.map(id => ({ colId: id, pinned: 'left' })) });
    });

    document.getElementById('col-ctx-unfreeze')?.addEventListener('click', () => {
        const colId = menu.dataset.colId;
        menu.classList.add('hidden');
        if (!colId || !state.gridApi) return;
        const ids = targetColIds(colId);
        for (const id of ids) { const ci = parseInt(id.slice(4), 10); state.pinnedCols.delete(ci); }
        state.gridApi.applyColumnState({ state: ids.map(id => ({ colId: id, pinned: null })) });
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

        // Reflect a multi-column selection in every action label so the user sees
        // "Freeze/Unfreeze/Insert/Delete N columns" before clicking (matches the
        // data-cell menu and Google Sheets). N inserts anchor to the selection edge.
        const colIndex = parseInt(colId.replace('col_', ''), 10);
        const selectedCols = getSelectedColIndices();
        const n = selectedCols.length > 1 && selectedCols.includes(colIndex) ? selectedCols.length : 1;

        const freezeEl   = document.getElementById('col-ctx-freeze');
        const unfreezeEl = document.getElementById('col-ctx-unfreeze');
        if (freezeEl) {
            freezeEl.style.display = isPinned ? 'none' : 'block';
            freezeEl.textContent   = n > 1 ? `📌 Freeze ${n} columns` : '📌 Freeze column';
        }
        if (unfreezeEl) {
            unfreezeEl.style.display = isPinned ? 'block' : 'none';
            unfreezeEl.textContent   = n > 1 ? `📌 Unfreeze ${n} columns` : '📌 Unfreeze column';
        }

        const delEl = document.getElementById('col-ctx-delete');
        if (delEl)  delEl.textContent  = n > 1 ? `✕ Delete ${n} columns`      : '✕ Delete column';
        const insL = document.getElementById('col-ctx-insert-left');
        if (insL)   insL.textContent   = n > 1 ? `⬅️ Insert ${n} columns left`  : '⬅️ Insert column left';
        const insR = document.getElementById('col-ctx-insert-right');
        if (insR)   insR.textContent   = n > 1 ? `➡️ Insert ${n} columns right` : '➡️ Insert column right';

        menu.dataset.colId = colId;
        menu.classList.remove('hidden');
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const mw = menu.offsetWidth || 200;
        const mh = menu.offsetHeight || 240;
        menu.style.left = Math.max(4, Math.min(e.clientX, vw - mw - 4)) + 'px';
        menu.style.top = Math.max(4, Math.min(e.clientY, vh - mh - 4)) + 'px';
    });
}
