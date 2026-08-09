import { hasControlChars, splitControlChars } from '../utils/control-chars';

// ── Cell renderer: labelled control characters ───────────────────────────────
// Draws the cell value, with any control character replaced by a small chip
// carrying its ASCII abbreviation and a tooltip with the full name. The
// underlying value is untouched — this is display only, so editing, copy,
// find/replace, save and export all still see the original character.
//
// The element is built with DOM calls rather than returned as an HTML string:
// AG Grid assigns a string result with innerHTML, which would let a cell
// containing markup (`<img onerror=...>`) run inside the webview.

export function controlCharCellRenderer(params: any): HTMLElement {
    const value = params.value == null ? '' : String(params.value);
    const host  = document.createElement('span');

    // The overwhelmingly common case: no control characters, one text node.
    if (!hasControlChars(value)) {
        host.textContent = value;
        return host;
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
    return host;
}
