import { state } from './state';
import { parseCsv, detectLineFormat } from './utils/csv';
import { applyZoom } from './features/zoom';
import { buildGrid } from './grid/builder';
import { refreshGrid } from './grid/refresh';
import { hideLoader } from './utils/loader';
import { updateDelimiterBadge } from './features/delimiter';
import { handlePageData } from './features/pagination';
import { resetDuplicatesState } from './features/duplicates';
import { frozenRowPositions, reanchorFrozenRows } from './features/freeze-rows';
import { loadRows, rowsInFile } from './features/header-row';
import { updateSettingsButton } from './features/settings-menu';

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

// firstRowIsHeader is what the extension remembers for this file. Only an
// explicit false turns the header off.
function initWithData(text: string, delimiter: string, firstRowIsHeader: boolean): void {
    state.rawCsvText      = text;
    state.currentDelimiter = delimiter;
    state.firstRowIsHeader = firstRowIsHeader;
    updateSettingsButton();
    // Untrimmed: the file's values exactly, see parseCsv.
    state.data = loadRows(parseCsv(text, delimiter, false, true));
    state.lineFormat = detectLineFormat(text, delimiter);
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
            state.rawCsvText = msg.text;
            state.data = loadRows(parseCsv(msg.text, state.currentDelimiter, false, true));
            // An outside change or a revert can bring other line endings.
            state.lineFormat = detectLineFormat(msg.text, state.currentDelimiter);
            reanchorFrozenRows(frozen);
            // Existing dup highlights now point at stale rows. Leaving the
            // "Show only duplicates" view already rebuilds the rows from
            // state.data, so a second rebuild would only cost time on big files.
            const rebuilt = state.dupShowOnly;
            resetDuplicatesState();
            if (!rebuilt) refreshGrid();
        } else if (msg.type === 'pageData') {
            handlePageData(msg);
        }
    });
}
