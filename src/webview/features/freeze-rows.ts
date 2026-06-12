import { state } from '../state';
import { refreshGrid } from '../grid/refresh';

// ── Freeze rows ───────────────────────────────────────────────────────────────
// Pins one or more data rows to the top of the grid (AG Grid pinnedTopRowData) so
// they stay visible as always-on references while the body scrolls, sorts and
// filters. Useful for multi-line headers and for comparing distant rows. Like the
// freeze-column feature this is purely in-memory view state, not persisted across
// reload.
//
// Frozen rows are tracked by their array references within state.data (see
// state.frozenRowRefs). The body/pinned split lives in partitionFrozenRows
// (grid/refresh.ts) and runs inside both buildGrid() and refreshGrid(); those
// only edit the reference list and ask the grid to re-partition.
//
// `origIndex` is a row's position in state.data, which equals the `_origIndex`
// carried on every grid row (state.data[0] is the header).

export function freezeRows(origIndices: number[]): void {
    let added = false;
    for (const oi of origIndices) {
        const row = state.data[oi];
        if (row && !state.frozenRowRefs.includes(row)) {
            state.frozenRowRefs.push(row);
            added = true;
        }
    }
    if (added) refreshGrid();
}

export function freezeRow(origIndex: number): void {
    freezeRows([origIndex]);
}

export function unfreezeRows(origIndices: number[]): void {
    const drop = new Set(origIndices.map(oi => state.data[oi]).filter(Boolean));
    if (drop.size === 0) return;
    const before = state.frozenRowRefs.length;
    state.frozenRowRefs = state.frozenRowRefs.filter(r => !drop.has(r));
    if (state.frozenRowRefs.length !== before) refreshGrid();
}

export function unfreezeRow(origIndex: number): void {
    unfreezeRows([origIndex]);
}

export function unfreezeAllRows(): void {
    if (state.frozenRowRefs.length === 0) return;
    state.frozenRowRefs = [];
    refreshGrid();
}

export function isRowFrozen(origIndex: number): boolean {
    const row = state.data[origIndex];
    return row != null && state.frozenRowRefs.includes(row);
}

export function frozenRowCount(): number {
    return state.frozenRowRefs.length;
}

// Captures the current positions (state.data indices) of the frozen rows, in
// freeze order. Used to re-anchor freezes across an operation that REPLACES
// state.data with freshly parsed arrays of the SAME rows (delimiter change,
// external reload), where the reference-based tracking would otherwise go stale.
export function frozenRowPositions(): number[] {
    return state.frozenRowRefs.map(r => state.data.indexOf(r)).filter(i => i >= 0);
}

// Re-anchors the frozen rows to the current state.data at the given positions
// (from frozenRowPositions(), captured before the re-parse). Positions past the
// new row count are dropped. Freeze order is preserved.
export function reanchorFrozenRows(positions: number[]): void {
    state.frozenRowRefs = positions.map(i => state.data[i]).filter(Boolean) as string[][];
}
