import { state } from '../state';
import { pushUndo, notifyChange } from './undo-redo';
import { syncColumnHeaders } from '../grid/refresh';

// ── Rename column ───────────────────────────────────────────────────────────
// A column header is the first row of the CSV (state.data[0]), so renaming
// writes the new name there (undoable) and updates the live AG Grid header in
// place via a columnDefs swap — no full rebuild, so column widths, sort order
// and freeze state are preserved. Entry point: the column header context menu
// ("Rename column"). Double-click is deliberately NOT used because a single click
// already sorts the column, and fast sort-toggle clicks were being misread as a
// double-click and opening rename (issue #10). Disabled in preview (read-only) mode.

let pendingColIndex: number | null = null;

function renameColumn(colIndex: number, newName: string): void {
    if (isNaN(colIndex) || !state.gridApi) return;

    const header = state.data[0] ?? (state.data[0] = []);
    if ((header[colIndex] ?? '') === newName) return; // no-op — nothing changed

    pushUndo();
    while (header.length <= colIndex) header.push('');
    header[colIndex] = newName;
    syncColumnHeaders(); // push the new label onto the live header (preserves state)
    notifyChange();
}

function openRenamePopover(colId: string, anchorEl: HTMLElement | null): void {
    const colIndex = parseInt(colId.replace('col_', ''), 10);
    if (isNaN(colIndex)) return;

    const pop   = document.getElementById('rename-popover');
    const input = document.getElementById('rename-input') as HTMLInputElement | null;
    if (!pop || !input) return;

    pendingColIndex = colIndex;
    input.value = state.data[0]?.[colIndex] ?? '';

    pop.classList.remove('hidden');
    const pw   = pop.offsetWidth || 240;
    const vw   = window.innerWidth;
    const r    = anchorEl?.getBoundingClientRect();
    const top  = r ? r.bottom + 4 : 80;
    const left = r ? r.left : 80;
    pop.style.top  = top + 'px';
    pop.style.left = Math.max(4, Math.min(left, vw - pw - 4)) + 'px';

    setTimeout(() => { input.focus(); input.select(); }, 0);
}

function closeRenamePopover(): void {
    document.getElementById('rename-popover')?.classList.add('hidden');
    pendingColIndex = null;
}

function commitRename(): void {
    const input = document.getElementById('rename-input') as HTMLInputElement | null;
    if (input && pendingColIndex != null) renameColumn(pendingColIndex, input.value);
    closeRenamePopover();
}

export function setupRenameColumn(): void {
    if (IS_PREVIEW) return; // header is read-only in preview / large-file modes

    const colMenu = document.getElementById('col-context-menu') as HTMLElement | null;
    document.getElementById('col-ctx-rename')?.addEventListener('click', () => {
        const colId = colMenu?.dataset.colId;
        colMenu?.classList.add('hidden');
        if (colId && colId !== 'row-index') {
            const headerCell = document.querySelector<HTMLElement>(`.ag-header-cell[col-id="${colId}"]`);
            openRenamePopover(colId, headerCell);
        }
    });

    document.getElementById('rename-ok')?.addEventListener('click', commitRename);
    document.getElementById('rename-cancel')?.addEventListener('click', closeRenamePopover);

    const input = document.getElementById('rename-input') as HTMLInputElement | null;
    input?.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Enter')  { e.preventDefault(); commitRename(); }
        if (e.key === 'Escape') { e.preventDefault(); closeRenamePopover(); }
    });

    // Click-outside dismiss (capture phase, like the other popovers).
    document.addEventListener('mousedown', (evt) => {
        const pop = document.getElementById('rename-popover');
        if (!pop || pop.classList.contains('hidden')) return;
        if (pop.contains(evt.target as Node)) return;
        closeRenamePopover();
    }, true);
}
