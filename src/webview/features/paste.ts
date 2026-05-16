import { state, getNumCols } from '../state';
import { parseCsv } from '../utils/csv';
import { pushUndo, notifyChange } from './undo-redo';
import { refreshGrid } from '../grid/refresh';
import { recomputeColTypes } from '../grid/column-type';

// Decide whether THIS paste event should be intercepted and routed into the
// grid. Returns false if the user is typing into a normal input (find bar,
// goto-row popover, replace input, etc.) — in that case the browser does its
// usual text paste and we stay out of the way.
function shouldHandlePaste(target: EventTarget | null): boolean {
    if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return false;
    }
    if (state.isCellEditing) return false;   // AG Grid's cell editor handles it
    if (IS_PREVIEW || IS_CHUNKED) return false;
    if (state.focusedCellRowIndex == null || state.focusedCellColId == null) return false;
    return true;
}

function pasteHandler(e: ClipboardEvent): void {
    if (!shouldHandlePaste(e.target)) return;
    if (!state.gridApi) return;

    const text = e.clipboardData?.getData('text/plain');
    if (!text) return;

    // Parse as TSV. parseCsv handles double-quote quoting and embedded newlines
    // correctly, and we pass trim=false so leading/trailing whitespace inside
    // pasted cells is preserved byte-for-byte.
    const block = parseCsv(text, '\t', false);
    if (block.length === 0) return;

    e.preventDefault();

    // Display-order list of original data-row indices (1-based) so we can walk
    // visible rows even under an active sort or filter.
    const displayedOrigRows: number[] = [];
    state.gridApi.forEachNodeAfterFilterAndSort((node: any) => {
        if (node.data?._origIndex != null) {
            displayedOrigRows.push(Number(node.data._origIndex));
        }
    });

    // Display-order list of data column indices. AG Grid allows drag-reordering
    // of columns so this can differ from the underlying state.data column order.
    // We want paste to flow visually — left-to-right as the user sees columns.
    const displayedDataCols = (state.gridApi.getAllDisplayedColumns() as any[])
        .map((c: any) => c.getColId() as string)
        .filter(id => id.startsWith('col_'))
        .map(id => parseInt(id.slice(4), 10));

    if (displayedDataCols.length === 0) return;

    // Anchor cell. row-index focus is treated as column 0 of that row so users
    // can paste a row right after clicking its row number.
    const startRowDisplayed = state.focusedCellRowIndex!;
    const startDisplayCol = state.focusedCellColId === 'row-index'
        ? 0
        : displayedDataCols.indexOf(parseInt(state.focusedCellColId!.slice(4), 10));
    if (startDisplayCol < 0) return;

    pushUndo();
    const numCols = getNumCols(state.data);

    for (let i = 0; i < block.length; i++) {
        const row = block[i];
        const targetDisplayRow = startRowDisplayed + i;

        let dataRowIndex: number;
        if (targetDisplayRow < displayedOrigRows.length) {
            dataRowIndex = displayedOrigRows[targetDisplayRow];
        } else {
            // Past the visible end — append a blank row to state.data so the
            // paste extends naturally (Excel-style auto-grow).
            state.data.push(Array<string>(numCols).fill(''));
            dataRowIndex = state.data.length - 1;
        }

        for (let j = 0; j < row.length; j++) {
            const targetDisplayCol = startDisplayCol + j;
            if (targetDisplayCol >= displayedDataCols.length) break; // overflow → clip
            const dataCol = displayedDataCols[targetDisplayCol];
            // Pad short rows so we can write at dataCol without index gaps.
            while (state.data[dataRowIndex].length <= dataCol) {
                state.data[dataRowIndex].push('');
            }
            state.data[dataRowIndex][dataCol] = row[j];
        }
    }

    state.isAutoFitted = false;
    state.autoFitCache = null;
    refreshGrid();
    recomputeColTypes();
    notifyChange();
}

export function setupPaste(): void {
    if (IS_PREVIEW || IS_CHUNKED) return;
    document.addEventListener('paste', pasteHandler);
}
