import { state } from './state';
import { parseCsv, detectLineFormat } from './utils/csv';
import { applyZoom } from './features/zoom';
import { buildGrid, flushOpenEditor } from './grid/builder';
import { refreshGrid } from './grid/refresh';
import { hideLoader } from './utils/loader';
import { updateDelimiterBadge } from './features/delimiter';
import { handlePageData } from './features/pagination';
import { resetDuplicatesState } from './features/duplicates';
import { frozenRowPositions, reanchorFrozenRows } from './features/freeze-rows';
import { loadRows, rowsInFile } from './features/header-row';
import { updateSettingsButton } from './features/settings-menu';
import { closePlacedPopups } from './features/popups';
import { closeRenamePopover } from './features/rename-column';

// The preview banner of Show Head and Show Tail: how many of the file's rows
// are on screen. The paged view has its own (features/pagination.ts).
export function updatePreviewBanner(): void {
    const previewEl = document.getElementById('preview-text');
    if (!previewEl) return;
    const shownRows = state.data.length - 1;
    const totalRows = rowsInFile();
    if (PREVIEW_MODE === 'head') {
        previewEl.textContent = `Showing first ${shownRows.toLocaleString()} of ${totalRows.toLocaleString()} rows (read-only preview)`;
    } else if (PREVIEW_MODE === 'tail') {
        previewEl.textContent = `Showing last ${shownRows.toLocaleString()} of ${totalRows.toLocaleString()} rows (read-only preview)`;
    }
}

// Reads text into the grid's table, split with the delimiter on the badge:
// the file opened, an outside change, a page of the paged view or a delimiter
// switch (features/delimiter.ts). The text is kept for the next switch, which
// splits it again.
export function readText(text: string): void {
    // An open cell editor belongs to the rows that are about to go. With the
    // same columns the grid only swaps the rows. The editor then stayed open
    // at its row position, which showed another row by now. Enter wrote the
    // typed value into that row. buildGrid cancels an editor for the same
    // reason, but only a change of columns rebuilds the grid. What was typed
    // is dropped, since the file changed under it.
    if (state.isCellEditing) state.gridApi?.stopEditing(true);
    // The row menu, the column menu and the Rename popover act on the row or
    // column they were opened on, kept by its place. Left open, Delete row
    // took the row that had moved into that place, Delete column took its
    // neighbour and Rename wrote a header wider than the rows. They close
    // like the editor. A pending rename is given up.
    closePlacedPopups();
    closeRenamePopover();
    state.rawCsvText = text;
    // Untrimmed: the file's values exactly, see parseCsv.
    state.data = loadRows(parseCsv(text, state.currentDelimiter, false, true));
    // An outside change, a revert or another page can bring other line
    // endings. Which breaks end a row depends on where quoted values start.
    // That depends on the delimiter.
    state.lineFormat = detectLineFormat(text, state.currentDelimiter, state.lineFormat);
}

// firstRowIsHeader is what the extension remembers for this file. Only an
// explicit false turns the header off.
function initWithData(text: string, delimiter: string, firstRowIsHeader: boolean): void {
    state.currentDelimiter = delimiter;
    state.firstRowIsHeader = firstRowIsHeader;
    updateSettingsButton();
    readText(text);
    state.isAutoFitted     = false;
    state.autoFitCache     = null;
    state.autoFitCacheZoom = -1;
    state.zoomIndex        = Math.max(0, Math.min(INITIAL_ZOOM_INDEX, state.ZOOM_STEPS.length - 1));

    updateDelimiterBadge(delimiter);
    updatePreviewBanner();

    setTimeout(() => { applyZoom(); buildGrid(); hideLoader(); }, 0);
}

export function setupMessaging(): void {
    window.addEventListener('message', (event: MessageEvent) => {
        const msg = event.data;
        if (msg.type === 'init') {
            initWithData(msg.text, msg.delimiter, msg.firstRowIsHeader !== false);
        } else if (msg.type === 'update') {
            // External file change → re-parse. Re-anchor frozen rows by position so
            // they survive the reload (best effort: positions past the new row count
            // are dropped if the external edit removed rows).
            // Split with the delimiter on the badge, not the one the host found
            // when the file was opened. A delimiter picked by hand is the one the
            // grid shows and writes with, so the change has to be read with it
            // too. The text is kept for the next delimiter switch, which re-splits
            // it (features/delimiter.ts).
            const frozen = frozenRowPositions();
            readText(msg.text);
            reanchorFrozenRows(frozen);
            // Existing dup highlights now point at stale rows. Leaving the
            // "Show only duplicates" view already rebuilds the rows from
            // state.data, so a second rebuild would only cost time on big files.
            const rebuilt = state.dupShowOnly;
            resetDuplicatesState();
            // Either way the find bar searches again (refreshGrid).
            if (!rebuilt) refreshGrid();
        } else if (msg.type === 'pageData') {
            handlePageData(msg);
        } else if (msg.type === 'flush') {
            // A save asks for the value being typed in a cell. The grid
            // reports a committed value on a timer, so a cell committed just
            // before would already be closed with its edit not yet sent. The
            // answer waits until after that timer, so the edit goes first.
            setTimeout(() => {
                const text = flushOpenEditor();
                vscodeApi.postMessage(text === null ? { type: 'flushed' } : { type: 'flushed', text });
            }, 0);
        }
    });
}
