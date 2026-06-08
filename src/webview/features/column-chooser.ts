import { state } from '../state';

// ── Column chooser (show / hide columns) ────────────────────────────────────
// A toolbar dropdown listing every data column with a checkbox to toggle its
// visibility. Visibility is applied via AG Grid (setColumnsVisible) and mirrored
// into state.hiddenCols (0-based data-column indices) so it survives a grid
// rebuild — e.g. a paged-view page change re-runs buildGrid, which re-applies
// `hide` from this set. In-memory only (not persisted across reload), matching
// the freeze features. Column insert/delete clears the set (see delete-row-col).

function setColHidden(colIndex: number, hidden: boolean): void {
    if (hidden) state.hiddenCols.add(colIndex);
    else state.hiddenCols.delete(colIndex);
    state.gridApi?.setColumnsVisible(['col_' + colIndex], !hidden);
    updateButton();
}

function showAll(): void {
    const n = (state.data[0] ?? []).length;
    const ids: string[] = [];
    for (let c = 0; c < n; c++) ids.push('col_' + c);
    state.hiddenCols.clear();
    state.gridApi?.setColumnsVisible(ids, true);
    buildList();
    updateButton();
}

function buildList(): void {
    const list = document.getElementById('col-chooser-list');
    if (!list) return;
    list.innerHTML = '';
    const header = state.data[0] ?? [];
    for (let c = 0; c < header.length; c++) {
        const row = document.createElement('label');
        row.className = 'col-chooser-item';

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = !state.hiddenCols.has(c);
        const idx = c;
        cb.addEventListener('change', () => setColHidden(idx, !cb.checked));

        const span = document.createElement('span');
        span.className = 'col-chooser-label';
        const name = header[c] ?? '';
        span.textContent = name !== '' ? name : '(column ' + (c + 1) + ')';

        row.appendChild(cb);
        row.appendChild(span);
        list.appendChild(row);
    }
}

function updateButton(): void {
    document.getElementById('btn-columns')?.classList.toggle('btn-active', state.hiddenCols.size > 0);
}

function openChooser(): void {
    const pop = document.getElementById('col-chooser-popover');
    const btn = document.getElementById('btn-columns');
    if (!pop || !btn) return;
    buildList();
    pop.classList.remove('hidden');
    const r  = btn.getBoundingClientRect();
    const pw = pop.offsetWidth || 220;
    const vw = window.innerWidth;
    pop.style.top  = (r.bottom + 4) + 'px';
    pop.style.left = Math.max(4, Math.min(r.left, vw - pw - 4)) + 'px';
}

function closeChooser(): void {
    document.getElementById('col-chooser-popover')?.classList.add('hidden');
}

export function setupColumnChooser(): void {
    const btn = document.getElementById('btn-columns');
    btn?.addEventListener('click', (e) => {
        e.stopPropagation();
        const pop = document.getElementById('col-chooser-popover');
        if (pop?.classList.contains('hidden')) openChooser(); else closeChooser();
    });

    document.getElementById('col-chooser-showall')?.addEventListener('click', showAll);

    document.addEventListener('mousedown', (evt) => {
        const pop = document.getElementById('col-chooser-popover');
        if (!pop || pop.classList.contains('hidden')) return;
        const t = evt.target as Node;
        if (pop.contains(t)) return;
        if (btn?.contains(t)) return; // toggle button handles itself
        closeChooser();
    }, true);
}
