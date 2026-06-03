// Resolves an AG Grid row node to its row position within state.data.
//
// state.data[0] is the header, so data rows live at index 1..N. When rowData is
// built (see builder.ts / refresh.ts) every row object carries `_origIndex`,
// the 1-based position of that row within state.data. Unlike `node.rowIndex`
// (the DISPLAY position, which changes under sort/filter) `_origIndex` rides
// along with the row, so it is the correct key for writing edits back to the
// source-of-truth array.
export interface RowNodeLike {
    rowIndex?: number | null;
    data?: { _origIndex?: number } | null;
}

export function dataRowIndexForNode(node: RowNodeLike): number {
    const origIndex = node.data?._origIndex;
    // Data rows always carry _origIndex; fall back to the display index only for
    // unexpected nodes so a missing key can never silently write NaN.
    return origIndex != null ? origIndex : (node.rowIndex ?? 0) + 1;
}

// Find/replace stores both a display rowIndex (for highlight + navigation) and
// the row's _origIndex (captured at search time). The data write must use the
// captured origIndex — rowIndex points at the wrong state.data row under an
// active sort or filter, exactly like the cell-edit path above.
export interface FindMatchLike {
    rowIndex: number;
    origIndex?: number;
}

export function dataRowIndexForFindMatch(m: FindMatchLike): number {
    return m.origIndex != null ? m.origIndex : m.rowIndex + 1;
}
