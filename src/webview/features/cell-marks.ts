import { state } from '../state';

/**
 * Two display switches from the settings menu that work per cell, as AG Grid
 * cell classes. Both only add a class, so neither touches a value.
 *
 *  - Align numbers to the right: the cells of an integer or decimal column line
 *    up on their last digit, the way a spreadsheet shows them, so magnitudes
 *    can be compared down the column.
 *  - Mark empty cells: a cell with nothing in it, or nothing but spaces, gets a
 *    faint hatch, so the gaps in a column stand out instead of looking like
 *    the space between two values.
 *
 * They are cellClassRules rather than cellClass, because AG Grid re-evaluates
 * rules on every refreshCells. Switching one of them in the menu, or a column
 * changing type after an edit, only has to redraw the cells.
 */

function colIndexOf(p: any): number {
    const field = p?.colDef?.field;
    if (typeof field !== 'string' || field.indexOf('col_') !== 0) return -1;
    const c = parseInt(field.slice(4), 10);
    return isNaN(c) ? -1 : c;
}

export function getCellMarkClassRules(): Record<string, (p: any) => boolean> {
    return {
        'csv-num-cell': (p: any) => {
            if (!state.settings.alignNumbers) return false;
            const t = state.colTypes[colIndexOf(p)];
            return t === 'integer' || t === 'float';
        },
        'csv-empty-cell': (p: any) =>
            state.settings.markEmpty
            && colIndexOf(p) >= 0
            && String(p.value ?? '').trim() === '',
    };
}
