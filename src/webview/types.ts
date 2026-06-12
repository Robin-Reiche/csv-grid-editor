export type CsvRow = string[];

// One undo/redo entry. Bundles the data clone with the freeze state so undo/redo
// restores frozen rows and columns too. Freezes are stored by POSITION because the
// data is deep-cloned (new row arrays), which would otherwise leave the reference-
// based frozenRowRefs pointing at orphaned objects after a restore.
export interface UndoSnapshot {
    data: CsvRow[];
    frozenRowIdx: number[];
    pinnedCols: number[];
}

export type ColType =
    | 'integer'
    | 'float'
    | 'string'
    | 'boolean'
    | 'date'
    | 'datetime'
    | 'time';

export interface ColProfile {
    name: string;
    type: ColType;
    total: number;
    nullCount: number;
    nullPct: number;
    uniqueCount: number;
    // numeric
    min?: number;
    max?: number;
    mean?: number;
    median?: number;
    stdDev?: number;
    // string
    minLen?: number;
    maxLen?: number;
    avgLen?: number;
    topValues?: [string, number][];
    // boolean
    trueCount?: number;
    falseCount?: number;
    // date
    minDate?: string;
    maxDate?: string;
    rangeDays?: number;
}

export interface FindMatch {
    // Display position (post sort/filter) — drives highlighting and navigation.
    rowIndex: number;
    // The row's _origIndex (its position in state.data), captured at search time
    // so replace writes hit the correct row even under an active sort/filter.
    origIndex: number;
    colField: string;
}
