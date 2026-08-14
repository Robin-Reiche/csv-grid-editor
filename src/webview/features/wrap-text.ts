import { state } from '../state';

/**
 * Wrap multi-line cells. A toolbar toggle for how a cell that contains a line
 * break is drawn (issue #29):
 *
 *  - OFF (default): every row keeps the fixed row height, and the cell renderer
 *    draws each line break as a small chip (grid/control-char-cell.ts) so the
 *    value still reads as multi-line without the row growing.
 *  - ON: cells break at their line breaks and each row grows to fit its tallest
 *    cell (AG Grid `wrapText` + `autoHeight`).
 *
 * Off by default on purpose. `autoHeight` measures every rendered row, which
 * costs on large files, and a variable row height contradicts the fixed
 * --ag-row-height the zoom steps set (features/zoom.ts) — so this is a mode the
 * user asks for, not something a single multi-line cell forces on the file.
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

    // The chip is drawn only while wrapping is off, so every cell has to repaint
    // in both directions.
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
