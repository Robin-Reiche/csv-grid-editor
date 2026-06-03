export type CsvRow = string[];

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
