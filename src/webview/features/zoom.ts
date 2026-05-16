import { state } from '../state';

const BASE_ROW_HEIGHT     = 24;
const BASE_HEADER_HEIGHT  = 26;
const BASE_FONT_SIZE      = 13;
const BASE_CELL_PADDING   = 6;
const BASE_TOOLBAR_HEIGHT = 28;
const BASE_TOOLBAR_FONT   = 14;
const BASE_TOOLBAR_PAD    = 5;
const BASE_SEP_HEIGHT     = 14;
const BASE_INFO_FONT      = 11;
const BASE_FOOTER_HEIGHT  = 22;
const BASE_FOOTER_FONT    = 11;
const BASE_TEXT_BTN_FONT  = 11;
const BASE_PROFILE_FONT   = 12;

export function applyZoom(): void {
    const pct   = state.ZOOM_STEPS[state.zoomIndex];
    const scale = pct / 100;
    const container = document.getElementById('grid-container')!;

    container.style.setProperty('--ag-row-height',               Math.round(BASE_ROW_HEIGHT    * scale) + 'px');
    container.style.setProperty('--ag-header-height',            Math.round(BASE_HEADER_HEIGHT * scale) + 'px');
    container.style.setProperty('--ag-font-size',                Math.round(BASE_FONT_SIZE     * scale) + 'px');
    container.style.setProperty('--ag-cell-horizontal-padding',  Math.round(BASE_CELL_PADDING  * scale) + 'px');

    const toolbar = document.querySelector<HTMLElement>('.toolbar')!;
    toolbar.style.height   = Math.round(BASE_TOOLBAR_HEIGHT * scale) + 'px';
    toolbar.style.fontSize = Math.round(BASE_TOOLBAR_FONT   * scale) + 'px';

    toolbar.querySelectorAll<HTMLButtonElement>('button').forEach(btn => {
        btn.style.fontSize = Math.round(BASE_TOOLBAR_FONT * scale) + 'px';
        btn.style.padding  = '2px ' + Math.round(BASE_TOOLBAR_PAD * scale) + 'px';
    });

    const clearBtn = document.getElementById('btn-clear-filters');
    if (clearBtn) clearBtn.style.fontSize = Math.round(BASE_TEXT_BTN_FONT * scale) + 'px';

    toolbar.querySelectorAll<HTMLElement>('.separator').forEach(sep => {
        sep.style.height = Math.round(BASE_SEP_HEIGHT * scale) + 'px';
    });

    const info      = document.getElementById('info');
    const zoomLabel = document.getElementById('zoom-level');
    if (info)      info.style.fontSize      = Math.round(BASE_INFO_FONT   * scale) + 'px';
    if (zoomLabel) zoomLabel.style.fontSize = Math.round(BASE_INFO_FONT   * scale) + 'px';
    if (zoomLabel) zoomLabel.textContent    = pct + '%';

    const footer = document.querySelector<HTMLElement>('.footer');
    if (footer) {
        footer.style.height   = Math.round(BASE_FOOTER_HEIGHT * scale) + 'px';
        footer.style.fontSize = Math.round(BASE_FOOTER_FONT   * scale) + 'px';
    }

    const profilePanel = document.getElementById('profile-panel');
    if (profilePanel) profilePanel.style.fontSize = Math.round(BASE_PROFILE_FONT * scale) + 'px';

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

export function setupZoom(): void {
    document.getElementById('btn-zoom-in')?.addEventListener('click',  zoomIn);
    document.getElementById('btn-zoom-out')?.addEventListener('click', zoomOut);
}
