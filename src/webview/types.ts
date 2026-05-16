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
    rowIndex: number;
    colField: string;
}
