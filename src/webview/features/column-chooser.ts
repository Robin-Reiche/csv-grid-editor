import { state } from '../state';
import { closeAllPopups } from './popups';

// ── Column chooser (show / hide columns) ────────────────────────────────────
// A toolbar dropdown listing every data column with a checkbox to toggle its
// visibility. A search box filters the list by column name, and Show all / Hide
// all flip every column at once (Hide all, then search and re-check the few you
// want). Visibility is applied via AG Grid (setColumnsVisible) and mirrored into
// state.hiddenCols (0-based data-column indices) so it survives a grid rebuild —
// e.g. a paged-view page change re-runs buildGrid, which re-applies `hide` from
// this set. In-memory only (not persisted across reload), matching the freeze
// features. Column insert/delete clears the set (see delete-row-col).

let searchQuery = '';

function setColHidden(colIndex: number, hidden: boolean): void {
    if (hidden) state.hiddenCols.add(colIndex);
    else state.hiddenCols.delete(colIndex);
    state.gridApi?.setColumnsVisible(['col_' + colIndex], !hidden);
    updateButton();
}

function allColIds(): string[] {
    const n = (state.data[0] ?? []).length;
    const ids: string[] = [];
    for (let c = 0; c < n; c++) ids.push('col_' + c);
    return ids;
}

function showAll(): void {
    state.hiddenCols.clear();
    state.gridApi?.setColumnsVisible(allColIds(), true);
    buildList();
    updateButton();
}

function hideAll(): void {
    const n = (state.data[0] ?? []).length;
    state.hiddenCols.clear();
    for (let c = 0; c < n; c++) state.hiddenCols.add(c);
    state.gridApi?.setColumnsVisible(allColIds(), false);
    buildList();
    updateButton();
}

function colLabel(header: string[], c: number): string {
    const name = header[c] ?? '';
    return name !== '' ? name : '(column ' + (c + 1) + ')';
}

function buildList(): void {
    const list = document.getElementById('col-chooser-list');
    if (!list) return;
    list.innerHTML = '';
    const header = state.data[0] ?? [];
    const q = searchQuery.trim().toLowerCase();
    let shown = 0;
    for (let c = 0; c < header.length; c++) {
        const label = colLabel(header, c);
        if (q && !label.toLowerCase().includes(q)) continue;
        shown++;

        const row = document.createElement('label');
        row.className = 'col-chooser-item';

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = !state.hiddenCols.has(c);
        const idx = c;
        cb.addEventListener('change', () => setColHidden(idx, !cb.checked));

        const span = document.createElement('span');
        span.className = 'col-chooser-label';
        span.textContent = label;

        row.appendChild(cb);
        row.appendChild(span);
        list.appendChild(row);
    }

    if (shown === 0) {
        const empty = document.createElement('div');
        empty.className = 'csv-filter-empty';
        empty.textContent = 'No matching columns';
        list.appendChild(empty);
    }
}

function updateButton(): void {
    document.getElementById('btn-columns')?.classList.toggle('btn-active', state.hiddenCols.size > 0);
}

function openChooser(): void {
    const pop = document.getElementById('col-chooser-popover');
    const btn = document.getElementById('btn-columns');
    if (!pop || !btn) return;
    searchQuery = '';
    const search = document.getElementById('col-chooser-search') as HTMLInputElement | null;
    if (search) search.value = '';
    buildList();
    pop.classList.remove('hidden');
    const r  = btn.getBoundingClientRect();
    const pw = pop.offsetWidth || 220;
    const vw = window.innerWidth;
    pop.style.top  = (r.bottom + 4) + 'px';
    pop.style.left = Math.max(4, Math.min(r.left, vw - pw - 4)) + 'px';
    search?.focus();
}

function closeChooser(): void {
    document.getElementById('col-chooser-popover')?.classList.add('hidden');
}

export function setupColumnChooser(): void {
    const btn = document.getElementById('btn-columns');
    btn?.addEventListener('click', (e) => {
        e.stopPropagation();
        const pop = document.getElementById('col-chooser-popover');
        const wasOpen = pop != null && !pop.classList.contains('hidden');
        closeAllPopups();
        if (!wasOpen) openChooser();
    });

    document.getElementById('col-chooser-showall')?.addEventListener('click', showAll);
    document.getElementById('col-chooser-hideall')?.addEventListener('click', hideAll);

    const search = document.getElementById('col-chooser-search') as HTMLInputElement | null;
    search?.addEventListener('input', () => {
        searchQuery = search.value;
        buildList();
    });

    document.addEventListener('mousedown', (evt) => {
        const pop = document.getElementById('col-chooser-popover');
        if (!pop || pop.classList.contains('hidden')) return;
        const t = evt.target as Node;
        if (pop.contains(t)) return;
        if (btn?.contains(t)) return; // toggle button handles itself
        closeChooser();
    }, true);
}
