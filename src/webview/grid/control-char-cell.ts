import { hasControlChars, splitControlChars } from '../utils/control-chars';

// ── Cell renderer: labelled control characters ───────────────────────────────
// Draws the value with each control character replaced by a chip showing its
// ASCII abbreviation. Display only — the stored value is untouched.
//
// Built by hand instead of returned as an HTML string: AG Grid inserts a string
// result with innerHTML, which would execute markup coming from the file.
//
// refresh() returns true so AG Grid reuses this element rather than recreating
// it. A recreated element breaks double-click-to-edit: range selection
// force-refreshes cells on mousedown, and if the element the first click hit is
// gone by the second, the browser fires no dblclick at all.

function paint(host: HTMLElement, value: string): void {
    host.textContent = '';

    // The overwhelmingly common case: no control characters, one text node.
    if (!hasControlChars(value)) {
        host.textContent = value;
        return;
    }

    for (const seg of splitControlChars(value)) {
        if (seg.type === 'text') {
            host.appendChild(document.createTextNode(seg.text));
            continue;
        }
        const chip = document.createElement('span');
        chip.className   = 'csv-ctrl-char';
        chip.textContent = seg.abbr;
        chip.title       = seg.label;
        host.appendChild(chip);
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
