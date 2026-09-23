import { state } from '../state';
import { pushUndo, notifyChange } from './undo-redo';
import { scheduleRecomputeColTypes } from '../grid/column-type';
import { dataRowIndexForFindMatch } from '../grid/row-mapping';
import { focusCell } from '../grid/refresh';
import type { FindMatch } from '../types';

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

// The columns find looks in: the ones on screen, in screen order. A hidden
// column used to be searched too, so the counter included matches nobody could
// see and Replace All rewrote cells the user had put out of view.
function searchCols(): any[] {
    return (state.gridApi.getAllDisplayedColumns() as any[])
        .filter(c => c.getColId() !== 'row-index' && c.getColDef().field)
        .map(c => c.getColDef());
}

// `anchor` carries the position over from the last search. The new search
// lands on the anchor itself when `keep` is set and it is still a match,
// otherwise on the first match past it in screen order. A replace passes the
// cell it just changed, so the counter moves on instead of jumping back to the
// top or landing on the same cell again. Showing or hiding a column passes the
// active match with `keep`, so the position survives a change that did not
// touch it.
function execFind(anchor?: { rowIndex: number; origIndex?: number; colField: string }, keep = false): void {
    // A search that runs now makes a pending one pointless. Letting that one
    // fire later would throw away the position this one sets.
    if (debounceTimer !== null) clearTimeout(debounceTimer);
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

    // Cache column list once, reading it inside forEachNode is expensive
    const cols = searchCols();

    const lowerNeedle = cs ? '' : needle.toLowerCase();

    state.gridApi.forEachNodeAfterFilterAndSort((node: any) => {
        for (const col of cols) {
            const raw = node.data[col.field];
            if (raw == null) continue;
            const val = cs ? String(raw) : String(raw).toLowerCase();
            if (val.includes(cs ? needle : lowerNeedle)) {
                // Capture _origIndex now so a later replace writes to the right
                // state.data row even if the user changes sort/filter meanwhile.
                state.findMatches.push({
                    rowIndex: node.rowIndex,
                    origIndex: Number(node.data._origIndex),
                    colField: col.field,
                });
            }
        }
    });

    if (state.findMatches.length) {
        state.findMatchIndex = 0;
        if (anchor) {
            // The row the anchor is on now. A replace can put the rows in
            // another order, since it ends the "Show only duplicates" view,
            // which lists them by group. The display index the match was found
            // at may then belong to another row, so the row is looked up by its
            // place in the data. A row a filter hides has no display index and
            // keeps the old one.
            const anchorRow = anchor.origIndex != null
                ? state.gridApi.getRowNode(String(anchor.origIndex))?.rowIndex ?? anchor.rowIndex
                : anchor.rowIndex;
            const colPos = new Map<string, number>(cols.map((c, i) => [c.field, i]));
            const anchorCol = colPos.get(anchor.colField) ?? -1;
            const next = state.findMatches.findIndex(m => {
                const col = colPos.get(m.colField) ?? -1;
                return m.rowIndex > anchorRow
                    || (m.rowIndex === anchorRow && (keep ? col >= anchorCol : col > anchorCol));
            });
            if (next >= 0) state.findMatchIndex = next;
        }
    }
    countEl.textContent = state.findMatches.length
        ? (state.findMatchIndex + 1) + ' / ' + state.findMatches.length
        : '0 matches';

    if (state.findMatchIndex >= 0) {
        state.gridApi.ensureIndexVisible(state.findMatches[state.findMatchIndex].rowIndex, 'middle');
    }

    const newRows = new Set(state.findMatches.map(m => m.rowIndex));
    refreshRows(new Set([...prevRows, ...newRows]));
}

// Public: debounced version used by input events
export function runFind(): void {
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(execFind, 120);
}

// Public: the grid calls this when a column is shown or hidden. The matches
// depend on which columns are on screen, so without a fresh search the counter
// and Next/Prev kept a match in a column the user had just hidden. The active
// match stays active while its column is on screen, so hiding some other column
// does not send the user back to the first match.
export function refreshFindIfOpen(): void {
    if (document.getElementById('find-bar')?.classList.contains('hidden') ?? true) return;
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    execFind(state.findMatches[state.findMatchIndex], true);
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
    // The find input had the browser focus, so closing the bar would otherwise
    // leave it on nothing and the arrow keys dead until a cell was clicked.
    focusCell(state.focusedCellRowIndex, state.focusedCellColId);
}

// ── replace ───────────────────────────────────────────────────────────────────

// Rewrites one matched cell with `edit` and returns the grid row it lives on.
// The grid's row objects are copies of state.data, so the new value is written
// to both, otherwise the grid kept showing the old value and the next search
// found it again.
function replaceInCell(m: FindMatch, edit: (old: string) => string): any {
    const colIdx = parseInt(m.colField.replace('col_', ''));
    const dataIndex = dataRowIndexForFindMatch(m);
    const newVal = edit(String(state.data[dataIndex][colIdx] ?? ''));
    state.data[dataIndex][colIdx] = newVal;
    const node = state.gridApi?.getRowNode(String(dataIndex));
    if (node?.data && Number(node.data._origIndex) === dataIndex) {
        node.data[m.colField] = newVal;
        return node;
    }
    return null;
}

// A cell can hold the search text more than once. Replace used to take the
// first occurrence every time, so when the new text held the search text too, a
// later occurrence was never reached. `resume` remembers where the last Replace
// stopped: `key` names the cell, its new value and the search, `from` is the
// offset just past the inserted text. The next Replace on the same unchanged
// cell carries on from there.
let resume: { key: string; from: number } | null = null;

function replaceOne(): void {
    if (state.findMatchIndex < 0 || IS_PREVIEW) return;
    // The search still waits out its debounce, so the matches on hand belong
    // to what the find box held before. An emptied box would match the empty
    // string at the front of the cell and put the replacement there. Search
    // again first, the way Replace All does. The replacing waits for the next
    // press, once the user has seen what the new text matches.
    if (debounceTimer !== null) { execFind(state.findMatches[state.findMatchIndex], true); return; }
    const needle = (document.getElementById('find-input') as HTMLInputElement).value;
    const repl   = (document.getElementById('replace-input') as HTMLInputElement).value;
    const cs     = isCaseSensitive();
    const m      = state.findMatches[state.findMatchIndex];
    // The column was hidden since the search ran. Search again rather than
    // change a cell the user can no longer see.
    if (!searchCols().some(c => c.field === m.colField)) { execFind(); return; }
    const regex  = new RegExp(escapeRegExp(needle), cs ? 'g' : 'gi');
    const keyOf  = (val: string) => JSON.stringify([dataRowIndexForFindMatch(m), m.colField, needle, cs, val]);
    let more = false;
    pushUndo();
    // Replace one occurrence of needle within the cell value
    const node = replaceInCell(m, old => {
        regex.lastIndex = resume?.key === keyOf(old) ? resume.from : 0;
        let hit = regex.exec(old);
        if (!hit) { regex.lastIndex = 0; hit = regex.exec(old); }
        if (!hit) return old;
        // Spliced in by hand, so "$$" or "$&" goes in exactly as typed.
        const val = old.slice(0, hit.index) + repl + old.slice(hit.index + hit[0].length);
        const from = hit.index + repl.length;
        regex.lastIndex = from;
        more = regex.exec(val) !== null;
        resume = more ? { key: keyOf(val), from } : null;
        return val;
    });
    if (node) state.gridApi.refreshCells({ rowNodes: [node], force: true });
    notifyChange();
    scheduleRecomputeColTypes();
    // The counter stays on this cell while it holds more to replace.
    execFind(m, more);
}

function replaceAll(): void {
    if (!state.findMatches.length || IS_PREVIEW) return;
    const needle = (document.getElementById('find-input') as HTMLInputElement).value;
    const repl   = (document.getElementById('replace-input') as HTMLInputElement).value;
    const cs     = isCaseSensitive();
    // Search again first. The matches on hand may predate a column being
    // hidden or the last keystroke in the find box.
    execFind();
    if (!state.findMatches.length) return;
    // Global regex — replaces ALL occurrences within each matching cell
    const regex  = new RegExp(escapeRegExp(needle), cs ? 'g' : 'gi');
    pushUndo();
    const nodes: any[] = [];
    state.findMatches.forEach(m => {
        // The replacement comes back from a function so it is inserted exactly
        // as typed. Handed over as a plain string, "$$" became "$" and "$&"
        // pasted in the matched text.
        const node = replaceInCell(m, old => old.replace(regex, () => repl));
        if (node) nodes.push(node);
    });
    if (nodes.length) state.gridApi.refreshCells({ rowNodes: nodes, force: true });
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
