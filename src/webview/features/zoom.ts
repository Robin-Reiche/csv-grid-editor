import { state } from '../state';

// ── Zoom ─────────────────────────────────────────────────────────────────────
// Zoom scales the DATA only — row height, header height, cell font and cell
// padding — the way the editor's own font-size zoom does. The chrome around the
// grid (toolbar, footer, profile panel) keeps its size at every zoom level.
// Scaling the toolbar too was not just visually wrong: every step re-laid out
// the toolbar, so the zoom buttons slid out from under the pointer and a second
// click landed on a neighbouring button.

const BASE_ROW_HEIGHT     = 24;
const BASE_HEADER_HEIGHT  = 26;
const BASE_FONT_SIZE      = 13;
const BASE_CELL_PADDING   = 6;

// The step the percentage label resets to when clicked. Looked up rather than
// hard-coded so it keeps following ZOOM_STEPS if the steps are ever changed,
// and returns -1 if 100% is no longer one of them, which switches the reset off
// instead of jumping to some arbitrary step.
function resetZoomIndex(): number {
    return state.ZOOM_STEPS.indexOf(100);
}

export function applyZoom(): void {
    const pct   = state.ZOOM_STEPS[state.zoomIndex];
    const scale = pct / 100;
    const container = document.getElementById('grid-container')!;

    container.style.setProperty('--ag-row-height',               Math.round(BASE_ROW_HEIGHT    * scale) + 'px');
    container.style.setProperty('--ag-header-height',            Math.round(BASE_HEADER_HEIGHT * scale) + 'px');
    container.style.setProperty('--ag-font-size',                Math.round(BASE_FONT_SIZE     * scale) + 'px');
    container.style.setProperty('--ag-cell-horizontal-padding',  Math.round(BASE_CELL_PADDING  * scale) + 'px');

    // Only the text changes — the label keeps its fixed font-size and min-width,
    // so "60%" → "100%" cannot nudge the zoom-in button sideways either.
    const zoomLabel = document.getElementById('zoom-level');
    if (zoomLabel) {
        zoomLabel.textContent = pct + '%';
        // Clicking the percentage returns to 100%. The pointer and the tooltip
        // only appear while that would do something: at 100% there is nothing to
        // reset, so the label stays a plain readout.
        const canReset = resetZoomIndex() >= 0 && state.zoomIndex !== resetZoomIndex();
        zoomLabel.classList.toggle('resettable', canReset);
        if (canReset) zoomLabel.title = 'Reset zoom to 100%';
        else zoomLabel.removeAttribute('title');
    }

    state.autoFitCache = null;

    if (state.gridApi) {
        state.gridApi.resetRowHeights();
        state.gridApi.refreshHeader();
    }
}

function persistZoom(): void {
    vscodeApi.postMessage({ type: 'zoomChanged', zoomIndex: state.zoomIndex });
}

export function zoomIn(): void {
    if (state.zoomIndex < state.ZOOM_STEPS.length - 1) {
        state.zoomIndex++;
        applyZoom();
        persistZoom();
    }
}

export function zoomOut(): void {
    if (state.zoomIndex > 0) {
        state.zoomIndex--;
        applyZoom();
        persistZoom();
    }
}

export function resetZoom(): void {
    const target = resetZoomIndex();
    if (target < 0 || state.zoomIndex === target) return;
    state.zoomIndex = target;
    applyZoom();
    persistZoom();
}

export function setupZoom(): void {
    document.getElementById('btn-zoom-in')?.addEventListener('click',  zoomIn);
    document.getElementById('btn-zoom-out')?.addEventListener('click', zoomOut);
    // The percentage between the two buttons is the reset. applyZoom() decides
    // whether it currently looks clickable; resetZoom() is a no-op at 100%.
    document.getElementById('zoom-level')?.addEventListener('click', resetZoom);
}
