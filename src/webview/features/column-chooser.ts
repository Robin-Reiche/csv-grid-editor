import { state } from '../state';
import { closeAllPopups } from './popups';

// ── Column chooser (show / hide columns) ────────────────────────────────────
// A toolbar dropdown listing every data column with a checkbox to toggle its
// visibility. A search box filters the list by column name. A pinned tri-state
// "Select all" master checkbox above the list reflects and controls the columns.
// Visibility is applied via AG Grid (setColumnsVisible) and mirrored into state.hiddenCols
// (0-based data-column indices) so it survives a grid rebuild - e.g. a paged-view
// page change re-runs buildGrid, which re-applies `hide` from this set. In-memory
// only (not persisted across reload), matching the freeze features. Column
// insert/delete clears the set (see delete-row-col).

let searchQuery = '';

function setColHidden(colIndex: number, hidden: boolean): void {
    if (hidden) state.hiddenCols.add(colIndex);
    else state.hiddenCols.delete(colIndex);
    state.gridApi?.setColumnsVisible(['col_' + colIndex], !hidden);
    updateButton();
    syncMaster();
}

function colLabel(header: string[], c: number): string {
    const name = header[c] ?? '';
    return name !== '' ? name : '(column ' + (c + 1) + ')';
}

function visibleColIndices(): number[] {
    const header = state.data[0] ?? [];
    const q = searchQuery.trim().toLowerCase();
    const out: number[] = [];
    for (let c = 0; c < header.length; c++) {
        if (q && !colLabel(header, c).toLowerCase().includes(q)) continue;
        out.push(c);
    }
    return out;
}

function setVisibleColsHidden(hidden: boolean): void {
    const cols = visibleColIndices();
    if (cols.length === 0) return;
    if (!hidden && searchQuery.trim() === '') {
        state.hiddenCols.clear();
        state.gridApi?.setColumnsVisible(allColIds(), true);
    } else {
        for (const c of cols) {
            if (hidden) state.hiddenCols.add(c);
            else state.hiddenCols.delete(c);
        }
        state.gridApi?.setColumnsVisible(cols.map(c => 'col_' + c), !hidden);
    }
    buildList();
    updateButton();
}

function allColIds(): string[] {
    const n = (state.data[0] ?? []).length;
    const ids: string[] = [];
    for (let c = 0; c < n; c++) ids.push('col_' + c);
    return ids;
}

function syncMaster(): void {
    const cb = document.getElementById('col-chooser-master-cb') as HTMLInputElement | null;
    const count = document.getElementById('col-chooser-master-count');
    const label = document.getElementById('col-chooser-master-label');
    if (!cb) return;
    const cols = visibleColIndices();
    const visible = cols.reduce((n, c) => n + (state.hiddenCols.has(c) ? 0 : 1), 0);
    const total = cols.length;

    cb.checked = total > 0 && visible === total;
    cb.indeterminate = visible > 0 && visible < total;
    cb.disabled = total === 0;
    if (count) count.textContent = total > 0 ? `${visible} / ${total}` : '';
    if (label) label.textContent = searchQuery.trim() ? 'Select all matches' : 'Select all';
}

function buildList(): void {
    const list = document.getElementById('col-chooser-list');
    if (!list) return;
    list.innerHTML = '';
    const header = state.data[0] ?? [];
    const cols = visibleColIndices();

    for (const c of cols) {
        const row = document.createElement('label');
        row.className = 'col-chooser-item';

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = !state.hiddenCols.has(c);
        const idx = c;
        cb.addEventListener('change', () => setColHidden(idx, !cb.checked));

        const span = document.createElement('span');
        span.className = 'col-chooser-label';
        span.textContent = colLabel(header, c);

        row.appendChild(cb);
        row.appendChild(span);
        list.appendChild(row);
    }

    if (cols.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'csv-filter-empty';
        empty.textContent = 'No matching columns';
        list.appendChild(empty);
    }

    syncMaster();
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
    const r = btn.getBoundingClientRect();
    const pw = pop.offsetWidth || 220;
    const vw = window.innerWidth;
    pop.style.top = (r.bottom + 4) + 'px';
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

    const master = document.getElementById('col-chooser-master-cb') as HTMLInputElement | null;
    master?.addEventListener('change', () => setVisibleColsHidden(!master.checked));

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
