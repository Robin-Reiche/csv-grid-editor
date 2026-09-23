import { state } from '../state';
import { hasControlChars, splitControlChars } from '../utils/control-chars';
import { trimPadding } from '../utils/csv';
import { boolCellState, paintBoolCheckbox, toggleBoolCell } from '../features/bool-checkbox';

// What the grid SHOWS for a value, as opposed to what it holds. With "Hide
// spaces around values" on (the default, and what the grid always looked like)
// the padding a file puts around a value is left off the screen. The value
// keeps it, so the file is written back with it. Used for cells, column names
// and the auto-fit measurement, which all have to agree on what is drawn.
export function shownValue(value: string): string {
    return state.settings.trimDisplay ? trimPadding(value) : value;
}

// ── Cell renderer: labelled control characters ───────────────────────────────
// Draws the value with each control character replaced by a chip showing its
// ASCII abbreviation. Display only — the stored value is untouched.
//
// A line break gets the same treatment. With wrapping off it would otherwise be
// invisible, the row being one fixed-height line; with wrapping on the break is
// rendered for real, but so is a wrap at the column edge, and only the chip says
// which of the two you are looking at (asked for in issue #29).
//
// Built by hand instead of returned as an HTML string: AG Grid inserts a string
// result with innerHTML, which would execute markup coming from the file.
//
// refresh() returns true so AG Grid reuses this element rather than recreating
// it. A recreated element breaks double-click-to-edit: range selection
// force-refreshes cells on mousedown, and if the element the first click hit is
// gone by the second, the browser fires no dblclick at all.

// Exported because auto-fit measures with it (features/auto-fit.ts). A column
// has to be as wide as what is DRAWN, and a chip is much wider than the single
// character it stands for, so measuring the raw string undershoots.
export function paint(host: HTMLElement, value: string): void {
    host.textContent = '';

    // The overwhelmingly common case: no control characters, one text node.
    if (!hasControlChars(value, true)) {
        host.textContent = value;
        return;
    }

    for (const seg of splitControlChars(value, true)) {
        if (seg.type === 'text') {
            host.appendChild(document.createTextNode(seg.text));
            continue;
        }
        const chip = document.createElement('span');
        chip.className   = seg.newline ? 'csv-ctrl-char csv-ctrl-char--nl' : 'csv-ctrl-char';
        chip.textContent = seg.abbr;
        chip.title       = seg.label;
        host.appendChild(chip);
        // The chip REPLACES the character it stands for, so for a line break the
        // break itself has to go back in behind it. Without it the wrap mode has
        // nothing to break on (white-space: pre-wrap needs a real newline in the
        // text) and the value would run on to the column edge instead. With
        // wrapping off the row is one line high and the break is drawn as a
        // space. That is what nowrap made of a newline. A newline would be a
        // real break under the pre that shows the spaces around a value
        // (media/webview.css).
        if (seg.newline) host.appendChild(document.createTextNode(state.wrapText ? '\n' : ' '));
    }
}

const valueOf = (params: any): string => params.value == null ? '' : String(params.value);

export class ControlCharCellRenderer {
    private eGui!: HTMLSpanElement;
    private params: any = null;
    // What is currently drawn: the value plus how it is drawn. A cell in a
    // true/false column can be drawn as a box or as its text (issue #41). A
    // line break is drawn differently with wrapping on and off (paint).
    // Switching either mode changes this key without the value moving, so a
    // repaint is needed for a value that did not change.
    private painted: string | null = null;

    init(params: any): void {
        this.eGui = document.createElement('span');
        this.render(params);
    }

    getGui(): HTMLElement {
        return this.eGui;
    }

    refresh(params: any): boolean {
        this.render(params);
        return true;
    }

    private render(params: any): void {
        // Kept current on every refresh so a click on a box edits the row the
        // box is on NOW, not the one it was built for.
        this.params = params;
        const value   = valueOf(params);
        const checked = boolCellState(params);
        const shown   = shownValue(value);
        const key     = (checked === null ? 't' : checked ? '1' : '0') + (state.wrapText ? 'w' : '') + '\u0000' + shown;
        // Unchanged → leave the DOM alone, for the same reason.
        if (key === this.painted) return;
        this.painted = key;
        if (checked === null) {
            paint(this.eGui, shown);
        } else {
            paintBoolCheckbox(this.eGui, value, checked, IS_PREVIEW ? null : () => toggleBoolCell(this.params));
        }
    }
}
