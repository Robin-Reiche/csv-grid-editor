import { state, getNumCols, emptyTableKind } from '../state';
import { insertRowsIntoData, insertColumnsIntoData } from '../grid/mutations';
import { buildGrid } from '../grid/builder';
import { refreshGrid, focusCell, revealAddedRow } from '../grid/refresh';
import { recomputeColTypes } from '../grid/column-type';
import { pushUndo, notifyChange } from './undo-redo';

// ── Empty table (issue #40) ───────────────────────────────────────────────────
// A new, empty CSV could not be filled in at all, and one with only a header
// could not get its first row. Every way of adding was anchored to something
// already there: insert-row needs a row to insert next to, the row menu needs a
// cell to right-click, Ctrl+Enter needs a focused cell and the column menu needs
// a header. With nothing there, none of them had anywhere to start.
//
// The empty grid now offers the missing piece itself, in the spot where the
// rows would be: "Add column" when there are no columns, "Add row" when there is
// a header and nothing under it. Both are ordinary undo steps.

// The panel shown in place of the rows. In the read-only preview it keeps the
// message and drops the button, since nothing can be added there.
function emptyPanel(message: string, label: string, onClick: () => void): HTMLElement {
    const panel = document.createElement('div');
    panel.className = 'empty-state';

    const text = document.createElement('div');
    text.textContent = message;
    panel.appendChild(text);

    if (!IS_PREVIEW) {
        const btn = document.createElement('button');
        btn.className = 'goto-btn goto-btn-primary';
        btn.innerHTML = '<i class="codicon codicon-add"></i>';
        btn.appendChild(document.createTextNode(label));
        btn.addEventListener('click', onClick);
        panel.appendChild(btn);
    }
    return panel;
}

// AG Grid's "no rows" overlay, taken over for the one case it cannot help with.
// A table with a header and no rows gets the Add row panel. Every other empty
// view (a filter that matches nothing, "show only duplicates" with none found,
// the only row frozen into the band above) still has rows in the file and keeps
// AG Grid's own text, reproduced here exactly.
export class NoRowsOverlay {
    private gui!: HTMLElement;

    init(): void {
        if (emptyTableKind(state.data) === 'no-rows') {
            this.gui = emptyPanel('This table has no rows yet.', 'Add row', addFirstRow);
            return;
        }
        const span = document.createElement('span');
        span.className = 'ag-overlay-no-rows-center';
        span.textContent = 'No Rows To Show';
        this.gui = span;
    }

    getGui(): HTMLElement {
        return this.gui;
    }
}

// With no columns there is no grid to put an overlay on, so the panel takes the
// grid's place. buildGrid calls this instead of building one.
export function renderNoColumns(container: HTMLElement): void {
    container.innerHTML = '';
    const page = document.createElement('div');
    page.className = 'empty-state-page';
    page.appendChild(emptyPanel('This table has no columns yet.', 'Add column', addFirstColumn));
    container.appendChild(page);
}

export function addFirstColumn(): void {
    if (IS_PREVIEW || emptyTableKind(state.data) !== 'no-columns') return;
    pushUndo();
    // An empty file has no header row to put the column in, so it gets one. A
    // table that lost all its columns keeps its rows and each gains the new
    // cell. The header name starts blank, the same as Insert column leaves it.
    state.data = state.data.length ? insertColumnsIntoData(state.data, 0, 1) : [['']];
    state.isAutoFitted = false;
    state.autoFitCache = null;
    buildGrid();
    notifyChange();
}

export function addFirstRow(): void {
    if (IS_PREVIEW || emptyTableKind(state.data) !== 'no-rows') return;
    pushUndo();
    state.data = insertRowsIntoData(state.data, 1, 1, getNumCols(state.data));
    state.isAutoFitted = false;
    state.autoFitCache = null;
    refreshGrid();
    // A filter set before the last row was deleted is still on and would hide
    // the new row, the same as a row inserted next to another.
    const row = revealAddedRow(1);
    recomputeColTypes();
    notifyChange();

    // Land in the first cell of the new row, so typing fills it straight away.
    // The first displayed column, not col_0, which may be hidden.
    const first = (state.gridApi?.getAllDisplayedColumns?.() ?? [])
        .find((c: any) => c.getColId() !== 'row-index');
    focusCell(row, first ? first.getColId() : 'col_0');
}
