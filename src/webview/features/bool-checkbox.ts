import { state } from '../state';
import { readBool, flipBoolValue } from '../utils/bool-values';

/**
 * Checkboxes for true/false columns (issue #41).
 *
 * Display only. The file keeps its own words: a box is drawn over the value,
 * the value itself is never rewritten to fit the box. Switching the mode on or
 * off touches nothing but what is on screen, so a file opened, looked at and
 * closed again comes out byte for byte the way it went in.
 *
 * A click is the one thing that does change a value, and it is an edit like
 * typing one: it goes through the grid's normal edit path, so it lands in the
 * undo stack and in the save exactly as a typed value would. What it writes is
 * the opposite word from the SAME pair the cell already used, in the same case
 * and with the same padding (utils/bool-values.ts). "YES" becomes "NO", never
 * "false".
 *
 * A cell only gets a box when its value is one of the known words. Empty cells
 * and anything else the column happens to hold keep their text, because a box
 * has no way to show them and hiding them would be worse than not drawing one.
 * Off by default, switched on in the settings menu (features/settings-menu.ts).
 */

// The data-column index behind an AG Grid cell, or -1 for the '#' gutter.
function colIndexOf(params: any): number {
    const field = params?.colDef?.field;
    if (typeof field !== 'string' || field.indexOf('col_') !== 0) return -1;
    const c = parseInt(field.slice(4), 10);
    return isNaN(c) ? -1 : c;
}

// What this cell should draw: true or false for a box, null for plain text.
export function boolCellState(params: any): boolean | null {
    if (!state.boolCheckboxes) return null;
    const c = colIndexOf(params);
    if (c < 0 || state.colTypes[c] !== 'boolean') return null;
    return readBool(params?.value == null ? '' : String(params.value));
}

// Draws the box. `onToggle` is called for a plain click on it; the renderer
// passes one that reads its CURRENT params, so a box that outlives a sort or a
// row shuffle still edits the row it is sitting on.
export function paintBoolCheckbox(
    host: HTMLElement,
    value: string,
    checked: boolean,
    onToggle: (() => void) | null,
): void {
    host.textContent = '';
    const box = document.createElement('span');
    box.className = 'csv-bool-box' + (checked ? ' csv-bool-box--on' : '');
    // The word the box stands for stays reachable: on hover for everyone, and
    // as the accessible name for a screen reader, which would otherwise be told
    // nothing at all about a cell drawn as a shape.
    box.setAttribute('role', 'img');
    box.setAttribute('aria-label', value);
    box.title = value;
    if (checked) {
        const tick = document.createElement('i');
        tick.className = 'codicon codicon-check';
        box.appendChild(tick);
    }

    if (onToggle) {
        box.classList.add('csv-bool-box--clickable');
        box.addEventListener('click', (e) => {
            e.stopPropagation();
            // The second click of a double-click would otherwise undo the first.
            if (e.detail > 1) return;
            onToggle();
        });
        // Double-clicking the box must not also open the text editor on top of
        // it. The rest of the cell still does, which is how a value the box
        // cannot express gets typed in.
        box.addEventListener('dblclick', (e) => { e.stopPropagation(); });
    }

    host.appendChild(box);
}

// Writes the flipped value through AG Grid's own edit path (onCellValueChanged
// in grid/builder.ts), which is what puts it in state.data, on the undo stack
// and into the save. Nothing here writes to the data directly.
export function toggleBoolCell(params: any): void {
    const value = params?.value == null ? '' : String(params.value);
    const next  = flipBoolValue(value);
    if (next == null) return;
    const colId = params.column?.getColId?.();
    if (!colId) return;
    params.node?.setDataValue(colId, next);
}

// Redraws the visible cells after the mode is switched. refreshCells only
// re-renders, it does not touch a single value.
export function applyBoolCheckboxes(): void {
    state.gridApi?.refreshCells({ force: true });
}
