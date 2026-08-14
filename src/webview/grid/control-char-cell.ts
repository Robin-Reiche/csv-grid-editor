import { hasControlChars, splitControlChars } from '../utils/control-chars';
import { state } from '../state';

// ── Cell renderer: labelled control characters ───────────────────────────────
// Draws the value with each control character replaced by a chip showing its
// ASCII abbreviation. Display only — the stored value is untouched.
//
// A line break gets the same treatment while wrapping is off, because the row is
// one fixed-height line then and the break would otherwise be invisible. With
// wrapping on the cell renders the break for real, so no chip is drawn.
//
// Built by hand instead of returned as an HTML string: AG Grid inserts a string
// result with innerHTML, which would execute markup coming from the file.
//
// refresh() returns true so AG Grid reuses this element rather than recreating
// it. A recreated element breaks double-click-to-edit: range selection
// force-refreshes cells on mousedown, and if the element the first click hit is
// gone by the second, the browser fires no dblclick at all.

function paint(host: HTMLElement, value: string, markNewlines: boolean): void {
    host.textContent = '';

    // The overwhelmingly common case: no control characters, one text node.
    if (!hasControlChars(value, markNewlines)) {
        host.textContent = value;
        return;
    }

    for (const seg of splitControlChars(value, markNewlines)) {
        if (seg.type === 'text') {
            host.appendChild(document.createTextNode(seg.text));
            continue;
        }
        const chip = document.createElement('span');
        chip.className   = seg.newline ? 'csv-ctrl-char csv-ctrl-char--nl' : 'csv-ctrl-char';
        chip.textContent = seg.abbr;
        chip.title       = seg.label;
        host.appendChild(chip);
    }
}

const valueOf = (params: any): string => params.value == null ? '' : String(params.value);

export class ControlCharCellRenderer {
    private eGui!: HTMLSpanElement;
    private value = '';
    private markNewlines = false;

    init(params: any): void {
        this.eGui = document.createElement('span');
        this.value = valueOf(params);
        this.markNewlines = !state.wrapText;
        paint(this.eGui, this.value, this.markNewlines);
    }

    getGui(): HTMLElement {
        return this.eGui;
    }

    refresh(params: any): boolean {
        const next = valueOf(params);
        const nextMark = !state.wrapText;
        // Unchanged value AND unchanged wrap mode → leave the DOM alone, for the
        // same reason.
        if (next !== this.value || nextMark !== this.markNewlines) {
            this.value = next;
            this.markNewlines = nextMark;
            paint(this.eGui, next, nextMark);
        }
        return true;
    }
}
