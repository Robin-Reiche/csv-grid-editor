import { state } from '../state';

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

        menu.dataset.colId = colId;
        menu.style.left    = e.clientX + 'px';
        menu.style.top     = e.clientY + 'px';
        menu.classList.remove('hidden');
    });
}
