import { state } from './state';
import { parseCsv } from './utils/csv';
import { applyZoom } from './features/zoom';
import { buildGrid } from './grid/builder';
import { refreshGrid } from './grid/refresh';
import { hideLoader } from './utils/loader';
import { updateDelimiterBadge } from './features/delimiter';
import { handlePageData } from './features/pagination';
import { resetDuplicatesState } from './features/duplicates';

function initWithData(text: string, delimiter: string): void {
    state.rawCsvText      = text;
    state.currentDelimiter = delimiter;
    state.data = parseCsv(text, delimiter);
    state.isAutoFitted     = false;
    state.autoFitCache     = null;
    state.autoFitCacheZoom = -1;
    state.zoomIndex        = Math.max(0, Math.min(INITIAL_ZOOM_INDEX, state.ZOOM_STEPS.length - 1));

    updateDelimiterBadge(delimiter);

    if (IS_PREVIEW) {
        const previewEl = document.getElementById('preview-text');
        if (previewEl) {
            const shownRows = state.data.length - 1;
            const totalRows = TOTAL_LINE_COUNT - 1;
            if (PREVIEW_MODE === 'head') {
                previewEl.textContent = `Showing first ${shownRows.toLocaleString()} of ${totalRows.toLocaleString()} rows (read-only preview)`;
            } else if (PREVIEW_MODE === 'tail') {
                previewEl.textContent = `Showing last ${shownRows.toLocaleString()} of ${totalRows.toLocaleString()} rows (read-only preview)`;
            }
        }
    }

    setTimeout(() => { applyZoom(); buildGrid(); hideLoader(); }, 0);
}

export function setupMessaging(): void {
    window.addEventListener('message', (event: MessageEvent) => {
        const msg = event.data;
        if (msg.type === 'init') {
            initWithData(msg.text, msg.delimiter);
        } else if (msg.type === 'update') {
            state.data = parseCsv(msg.text, msg.delimiter);
            // External file change → existing dup highlights now point at stale rows.
            resetDuplicatesState();
            refreshGrid();
        } else if (msg.type === 'pageData') {
            handlePageData(msg);
        }
    });
}
