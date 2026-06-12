// Pure data transforms for row / column deletion.
//
// Deliberately free of DOM, AG Grid and module state so the index-shift-sensitive
// logic can be unit-tested in isolation (see test/delete-mutations.test.cjs).
// state.data[0] is the header row; data rows live at index 1..N. Columns span the
// header and every body row, so a column delete removes that index from ALL rows.

// Removes every column in `colIndices` from every row in one pass. Collecting the
// indices into a Set first is what makes multi-delete correct: deleting columns
// one after another would shift the remaining indices and drop the wrong columns.
export function deleteColumnsFromData(data: string[][], colIndices: Iterable<number>): string[][] {
    const drop = new Set<number>();
    for (const c of colIndices) if (Number.isInteger(c) && c >= 0) drop.add(c);
    if (drop.size === 0) return data;
    return data.map(row => row.filter((_, i) => !drop.has(i)));
}

// Removes the rows at the given 1-based state.data positions (origIndices), never
// the header at index 0. Same Set-first reasoning as columns: filtering against
// the full set avoids the shifting-index trap of sequential splices.
export function deleteRowsFromData(data: string[][], origIndices: Iterable<number>): string[][] {
    const drop = new Set<number>();
    for (const i of origIndices) if (Number.isInteger(i) && i >= 1) drop.add(i);
    if (drop.size === 0) return data;
    return data.filter((_, i) => i === 0 || !drop.has(i));
}

// Inserts `count` blank rows (each `numCols` wide) at data index `atIndex`.
// Returns a new outer array but keeps the existing row-array references (slice is
// shallow), so the frozen-row reference and AG Grid's positional ids still line
// up. Matching spreadsheet behaviour: when N rows are selected, N are inserted.
export function insertRowsIntoData(data: string[][], atIndex: number, count: number, numCols: number): string[][] {
    if (count < 1) return data;
    const blanks = Array.from({ length: count }, () => Array<string>(numCols).fill(''));
    const out = data.slice();
    out.splice(atIndex, 0, ...blanks);
    return out;
}

// Inserts `count` blank columns at column index `atIndex` in every row (header
// included). Rebuilds each row array. Spreadsheet behaviour: N selected columns
// → N inserted.
export function insertColumnsIntoData(data: string[][], atIndex: number, count: number): string[][] {
    if (count < 1) return data;
    return data.map(row => {
        const copy = row.slice();
        copy.splice(atIndex, 0, ...Array<string>(count).fill(''));
        return copy;
    });
}

// Re-maps a set of column (or row) indices after some indices are deleted: dropped
// indices are removed, and each surviving index shifts down by how many deleted
// indices sat before it. Used to keep frozen-column tracking correct across a
// multi-column delete.
export function shiftIndicesAfterDelete(indices: Iterable<number>, deleted: Iterable<number>): Set<number> {
    const del = deleted instanceof Set ? deleted : new Set(deleted);
    const out = new Set<number>();
    for (const i of indices) {
        if (del.has(i)) continue;
        let shift = 0;
        for (const d of del) if (d < i) shift++;
        out.add(i - shift);
    }
    return out;
}

// Re-maps a set of indices after `count` columns (or rows) are inserted at `at`:
// indices at or after the insertion point shift up by `count`.
export function shiftIndicesAfterInsert(indices: Iterable<number>, at: number, count: number): Set<number> {
    const out = new Set<number>();
    for (const i of indices) out.add(i >= at ? i + count : i);
    return out;
}
