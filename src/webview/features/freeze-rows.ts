import { state } from '../state';
import { refreshGrid } from '../grid/refresh';

// ── Freeze row ──────────────────────────────────────────────────────────────
// Pins a single data row to the top of the grid (AG Grid pinnedTopRowData) so it
// stays visible as an always-on reference while the body scrolls, sorts and
// filters. Only ONE row can be frozen at a time. Like the existing freeze-column
// feature this is purely in-memory view state — it is not persisted across
// reload.
//
// The frozen row is tracked by its array reference within state.data (see
// state.frozenRowRef). The body/pinned split itself lives in partitionFrozenRows
// (grid/refresh.ts) and runs inside both buildGrid() and refreshGrid(); these
// functions only flip the reference and ask the grid to re-partition.
//
// `origIndex` is a row's position in state.data, which equals the `_origIndex`
// carried on every grid row (state.data[0] is the header).

export function freezeRow(origIndex: number): void {
    const row = state.data[origIndex];
    if (!row) return;
    state.frozenRowRef = row;
    refreshGrid();
}

export function unfreezeRow(): void {
    if (state.frozenRowRef === null) return;
    state.frozenRowRef = null;
    refreshGrid();
}

export function isRowFrozen(origIndex: number): boolean {
    return state.frozenRowRef !== null && state.data[origIndex] === state.frozenRowRef;
}
