import { hasControlChars, splitControlChars } from '../utils/control-chars';

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
        // wrapping off the cell is nowrap, where this collapses to one space.
        if (seg.newline) host.appendChild(document.createTextNode('\n'));
    }
}

const valueOf = (params: any): string => params.value == null ? '' : String(params.value);

export class ControlCharCellRenderer {
    private eGui!: HTMLSpanElement;
    private value = '';

    init(params: any): void {
        this.eGui = document.createElement('span');
        this.value = valueOf(params);
        paint(this.eGui, this.value);
    }

    getGui(): HTMLElement {
        return this.eGui;
    }

    refresh(params: any): boolean {
        const next = valueOf(params);
        // Unchanged value → leave the DOM alone, for the same reason.
        if (next !== this.value) {
            this.value = next;
            paint(this.eGui, next);
        }
        return true;
    }
}
