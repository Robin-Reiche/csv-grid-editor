import { state } from '../state';
import { pushUndo, notifyChange } from './undo-redo';
import { scheduleRecomputeColTypes } from '../grid/column-type';

// ── helpers ───────────────────────────────────────────────────────────────────

function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isCaseSensitive(): boolean {
    return document.getElementById('find-case-btn')?.classList.contains('find-case-btn--active') ?? false;
}

// ── cell class rules (called by AG Grid on every cell render) ─────────────────

export function getFindCellClassRules(): Record<string, (p: any) => boolean> {
    return {
        'cell-find-match': (p: any) =>
            state.findMatches.some(m => m.rowIndex === p.rowIndex && m.colField === p.column.getColId()),
        'cell-find-active': (p: any) =>
            state.findMatchIndex >= 0 &&
            !!state.findMatches[state.findMatchIndex] &&
            state.findMatches[state.findMatchIndex].rowIndex === p.rowIndex &&
            state.findMatches[state.findMatchIndex].colField === p.column.getColId(),
    };
}

// ── selective refresh — only touch rows that gained / lost match status ───────

function refreshRows(rowIndices: Set<number>): void {
    if (!state.gridApi || rowIndices.size === 0) return;
    const nodes = Array.from(rowIndices)
        .map(ri => state.gridApi.getDisplayedRowAtIndex(ri))
        .filter(Boolean);
    if (nodes.length) state.gridApi.refreshCells({ rowNodes: nodes, force: true });
}

// ── core search (runs after debounce) ─────────────────────────────────────────

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function execFind(): void {
    debounceTimer = null;
    if (!state.gridApi) return;

    const needle  = (document.getElementById('find-input') as HTMLInputElement).value;
    const cs      = isCaseSensitive();
    const countEl = document.getElementById('find-count')!;

    const prevRows = new Set(state.findMatches.map(m => m.rowIndex));
    state.findMatches    = [];
    state.findMatchIndex = -1;

    if (!needle) {
        countEl.textContent = '';
        refreshRows(prevRows);
        return;
    }

    // Cache column list once — calling getColumnDefs() inside forEachNode is expensive
    const cols = (state.gridApi.getColumnDefs() as any[])
        .filter(col => col.colId !== 'row-index' && col.field);

    const lowerNeedle = cs ? '' : needle.toLowerCase();

    state.gridApi.forEachNodeAfterFilterAndSort((node: any) => {
        for (const col of cols) {
            const raw = node.data[col.field];
            if (raw == null) continue;
            const val = cs ? String(raw) : String(raw).toLowerCase();
            if (val.includes(cs ? needle : lowerNeedle)) {
                state.findMatches.push({ rowIndex: node.rowIndex, colField: col.field });
            }
        }
    });

    if (state.findMatches.length) state.findMatchIndex = 0;
    countEl.textContent = state.findMatches.length
        ? (state.findMatchIndex + 1) + ' / ' + state.findMatches.length
        : '0 matches';

    if (state.findMatchIndex >= 0) {
        state.gridApi.ensureIndexVisible(state.findMatches[0].rowIndex, 'middle');
    }

    const newRows = new Set(state.findMatches.map(m => m.rowIndex));
    refreshRows(new Set([...prevRows, ...newRows]));
}

// Public: debounced version used by input events
export function runFind(): void {
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(execFind, 120);
}

// ── navigation ────────────────────────────────────────────────────────────────

export function navigateFind(dir: 1 | -1): void {
    if (!state.findMatches.length) return;
    const prevRow = state.findMatchIndex >= 0 ? state.findMatches[state.findMatchIndex].rowIndex : -1;
    state.findMatchIndex = (state.findMatchIndex + dir + state.findMatches.length) % state.findMatches.length;
    const nextRow = state.findMatches[state.findMatchIndex].rowIndex;

    state.gridApi?.ensureIndexVisible(nextRow, 'middle');
    const countEl = document.getElementById('find-count');
    if (countEl) countEl.textContent = (state.findMatchIndex + 1) + ' / ' + state.findMatches.length;

    // Only refresh the two rows whose active-highlight status changed
    refreshRows(new Set([prevRow, nextRow].filter(r => r >= 0)));
}

// ── open / close ──────────────────────────────────────────────────────────────

export function openFindBar(): void {
    document.getElementById('find-bar')?.classList.remove('hidden');
    (document.getElementById('find-input') as HTMLInputElement | null)?.focus();
}

export function closeFindBar(): void {
    document.getElementById('find-bar')?.classList.add('hidden');
    if (debounceTimer !== null) { clearTimeout(debounceTimer); debounceTimer = null; }
    const prevRows = new Set(state.findMatches.map(m => m.rowIndex));
    state.findMatches    = [];
    state.findMatchIndex = -1;
    refreshRows(prevRows);
}

// ── replace ───────────────────────────────────────────────────────────────────

function replaceOne(): void {
    if (state.findMatchIndex < 0 || IS_PREVIEW) return;
    const needle = (document.getElementById('find-input') as HTMLInputElement).value;
    const repl   = (document.getElementById('replace-input') as HTMLInputElement).value;
    const cs     = isCaseSensitive();
    const m      = state.findMatches[state.findMatchIndex];
    const colIdx = parseInt(m.colField.replace('col_', ''));
    const oldVal = String(state.data[m.rowIndex + 1][colIdx] ?? '');
    // Replace only the FIRST occurrence of needle within the cell value
    const newVal = oldVal.replace(
        new RegExp(escapeRegExp(needle), cs ? '' : 'i'),
        repl
    );
    pushUndo();
    state.data[m.rowIndex + 1][colIdx] = newVal;
    notifyChange();
    scheduleRecomputeColTypes();
    execFind();
}

function replaceAll(): void {
    if (!state.findMatches.length || IS_PREVIEW) return;
    const needle = (document.getElementById('find-input') as HTMLInputElement).value;
    const repl   = (document.getElementById('replace-input') as HTMLInputElement).value;
    const cs     = isCaseSensitive();
    // Global regex — replaces ALL occurrences within each matching cell
    const regex  = new RegExp(escapeRegExp(needle), cs ? 'g' : 'gi');
    pushUndo();
    state.findMatches.forEach(m => {
        const colIdx = parseInt(m.colField.replace('col_', ''));
        const oldVal = String(state.data[m.rowIndex + 1][colIdx] ?? '');
        state.data[m.rowIndex + 1][colIdx] = oldVal.replace(regex, repl);
    });
    notifyChange();
    scheduleRecomputeColTypes();
    execFind();
}

// ── setup ─────────────────────────────────────────────────────────────────────

export function setupFindReplace(): void {
    const fi = document.getElementById('find-input') as HTMLInputElement | null;
    if (fi) {
        fi.addEventListener('input', runFind);
        fi.addEventListener('keydown', e => {
            if (e.key === 'Enter')  { e.preventDefault(); navigateFind(e.shiftKey ? -1 : 1); }
            if (e.key === 'Escape') closeFindBar();
        });
    }

    const caseBtn = document.getElementById('find-case-btn');
    caseBtn?.addEventListener('click', () => {
        caseBtn.classList.toggle('find-case-btn--active');
        execFind();
    });

    document.getElementById('btn-find-replace')?.addEventListener('click', openFindBar);
    document.getElementById('find-prev')?.addEventListener('click',   () => navigateFind(-1));
    document.getElementById('find-next')?.addEventListener('click',   () => navigateFind(1));
    document.getElementById('find-close')?.addEventListener('click',  closeFindBar);
    document.getElementById('replace-one')?.addEventListener('click', replaceOne);
    document.getElementById('replace-all')?.addEventListener('click', replaceAll);

    document.getElementById('replace-input')
        ?.addEventListener('keydown', e => { if (e.key === 'Escape') closeFindBar(); });
}
