import { state } from './state';
import { undo, redo } from './features/undo-redo';
import { zoomIn, zoomOut } from './features/zoom';
import { openFindBar } from './features/find-replace';

function writeToClipboard(text: string): void {
    if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text);
    } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0;';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
    }
}

export function setupKeyboard(): void {
    document.addEventListener('keydown', e => {
        // Single-cell copy. Multi-cell range copy is handled in capture phase by
        // range-select.ts, which stops propagation before this listener runs.
        if ((e.ctrlKey || e.metaKey) && e.key === 'c' && !state.isCellEditing) {
            if (state.gridApi
                    && state.focusedCellColId !== null
                    && state.focusedCellColId !== 'row-index'
                    && state.focusedCellRowIndex !== null) {
                const rowNode = state.gridApi.getDisplayedRowAtIndex(state.focusedCellRowIndex);
                if (rowNode?.data) {
                    const val = rowNode.data[state.focusedCellColId];
                    writeToClipboard(val != null ? String(val) : '');
                    e.preventDefault();
                }
            }
        }

        if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { undo(); e.preventDefault(); }
        if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { redo(); e.preventDefault(); }
        if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '=')) { zoomIn();  e.preventDefault(); }
        if ((e.ctrlKey || e.metaKey) && e.key === '-') { zoomOut(); e.preventDefault(); }
        if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'h') && !state.isCellEditing) { e.preventDefault(); openFindBar(); }
    });
}
