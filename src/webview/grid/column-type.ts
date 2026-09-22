import { state } from '../state';
import type { CsvRow, ColType } from '../types';
import { BOOL_PAIRS, boolPairIndex } from '../utils/bool-values';

export function getColumnType(bodyRows: CsvRow[], colIndex: number): ColType {
    const sampleSize = Math.min(bodyRows.length, 100);
    let numCount = 0, intCount = 0, dateCount = 0, datetimeCount = 0,
        timeCount = 0, nonEmpty = 0;
    // Counted per true/false pair, not as one pool of boolean-ish words: a
    // column is only boolean when almost all of it speaks the SAME pair. A file
    // that mixes 'yes' and 't' at random is not a column of answers, and a
    // single stray 'y' in free text must not drag the whole column in.
    const boolPairCounts = BOOL_PAIRS.map(() => 0);
    const dateRe     = /^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/;
    const datetimeRe = /^\d{4}[-/]\d{1,2}[-/]\d{1,2}[ T]\d{2}:\d{2}/;
    const timeRe     = /^\d{1,2}:\d{2}(:\d{2})?$/;

    for (let r = 0; r < sampleSize; r++) {
        const val = bodyRows[r]?.[colIndex] != null ? String(bodyRows[r][colIndex]).trim() : '';
        if (!val) continue;
        nonEmpty++;
        const num = Number(val);
        if (!isNaN(num) && val !== '') {
            numCount++;
            if (Number.isInteger(num)) intCount++;
        }
        if (datetimeRe.test(val)) datetimeCount++;
        else if (dateRe.test(val)) dateCount++;
        else if (timeRe.test(val)) timeCount++;
        const boolPair = boolPairIndex(val);
        if (boolPair >= 0) boolPairCounts[boolPair]++;
    }

    if (nonEmpty === 0) return 'string';
    const r = nonEmpty;
    if (datetimeCount / r > 0.8) return 'datetime';
    if (dateCount     / r > 0.8) return 'date';
    if (timeCount     / r > 0.8) return 'time';
    // numCount guard: a column of 1 and 0 stays numeric, because ones and zeros
    // are just as likely to be counts as answers.
    if (Math.max(...boolPairCounts) / r > 0.8 && numCount / r < 0.5) return 'boolean';
    if (numCount      / r > 0.8) return intCount === numCount ? 'integer' : 'float';
    return 'string';
}

// ── dynamic re-evaluation after mutations ─────────────────────────────────────

function applyHeaderClass(colId: string, type: ColType): void {
    const cell = document.querySelector<HTMLElement>(`.ag-header-cell[col-id="${colId}"]`);
    if (!cell) return;
    Array.from(cell.classList)
        .filter(c => c.startsWith('col-type-'))
        .forEach(c => cell.classList.remove(c));
    cell.classList.add('col-type-' + type);
}

let typeRecomputeTimer: ReturnType<typeof setTimeout> | null = null;

export function scheduleRecomputeColTypes(): void {
    if (typeRecomputeTimer !== null) clearTimeout(typeRecomputeTimer);
    typeRecomputeTimer = setTimeout(recomputeColTypes, 200);
}

export function recomputeColTypes(): void {
    typeRecomputeTimer = null;
    if (!state.data || state.data.length < 2) return;
    const bodyRows = state.data.slice(1);
    const numCols  = state.data[0]?.length ?? 0;
    const changed: string[] = [];
    for (let c = 0; c < numCols; c++) {
        const newType = getColumnType(bodyRows, c);
        if (newType !== state.colTypes[c]) {
            state.colTypes[c] = newType;
            applyHeaderClass('col_' + c, newType);
            changed.push('col_' + c);
        }
    }
    if (changed.length === 0) return;
    // A cell can be DRAWN from its column's type and not only from its own
    // value: a true/false column is drawn as checkboxes when that mode is on
    // (features/bool-checkbox.ts). refreshGrid drops the types and has them
    // worked out again afterwards, so without this the cells would keep
    // whatever they were drawn as while the type was unknown - after an undo,
    // the words instead of the boxes.
    state.gridApi?.refreshCells({ columns: changed, force: true });
    document.dispatchEvent(new CustomEvent('csv-col-types-changed'));
}
