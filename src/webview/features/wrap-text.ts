import { state } from '../state';

/**
 * Wrap cell text. A toolbar toggle for how a value that does not fit its column
 * is drawn (issue #29):
 *
 *  - OFF (default): every row keeps the fixed row height and a value too wide
 *    for its column is clipped, as it always was.
 *  - ON: the value wraps and the row grows to fit its tallest cell (AG Grid
 *    `wrapText` + `autoHeight`). It breaks both at the line breaks the value
 *    really contains and wherever a line is wider than the column.
 *
 * Wrapping at the column edge as well is deliberate: the author of #29 builds
 * tables by hand, few rows with a lot of text each, and wants to see all of it.
 * What made that ambiguous was telling a real line break apart from a wrap, and
 * that is solved in the renderer instead: the chip for a line break is drawn in
 * both modes (grid/control-char-cell.ts), so a break with a chip in front of it
 * comes from the data and one without comes from the column edge.
 *
 * Off by default on purpose. `autoHeight` measures every rendered row, which
 * costs on large files, and a variable row height contradicts the fixed
 * --ag-row-height the zoom steps set (features/zoom.ts) — so this is a mode the
 * user asks for, not something the file forces on them.
 *
 * The toggle is persisted globally (VS Code globalState) exactly like zoom and
 * color mode, so it is remembered across every CSV file and every session.
 */

function persistWrapText(): void {
    vscodeApi.postMessage({ type: 'wrapTextChanged', wrapText: state.wrapText });
}

function updateButton(): void {
    document.getElementById('btn-wraptext')?.classList.toggle('btn-active', state.wrapText);
}

// Pushes the current mode onto the live column defs. buildGrid() sets the same
// two flags from state.wrapText when it builds columns from scratch, so the mode
// survives a rebuild (column insert/delete, delimiter change, paging) — this
// path only exists so toggling does not need a rebuild, which would drop column
// widths, sort and freeze.
export function applyWrapText(): void {
    updateButton();
    const api = state.gridApi;
    if (!api) return;

    const defs = api.getColumnDefs() as any[] | undefined;
    if (defs) {
        for (const d of defs) {
            if (typeof d.field === 'string' && d.field.indexOf('col_') === 0) {
                d.wrapText   = state.wrapText;
                d.autoHeight = state.wrapText;
            }
        }
        api.setGridOption('columnDefs', defs);
    }

    api.refreshCells({ force: true });
    // Turning autoHeight off leaves the measured heights behind; the rows only
    // go back to the fixed --ag-row-height when they are reset explicitly.
    if (!state.wrapText) api.resetRowHeights();
}

function toggleWrapText(): void {
    state.wrapText = !state.wrapText;
    // A wrapped column needs a different width than a single-line one, so the
    // cached auto-fit result no longer describes this view.
    state.autoFitCache = null;
    state.isAutoFitted = false;
    applyWrapText();
    persistWrapText();
}

export function setupWrapText(): void {
    state.wrapText = !!INITIAL_WRAP_TEXT;
    updateButton();
    document.getElementById('btn-wraptext')?.addEventListener('click', toggleWrapText);
}
