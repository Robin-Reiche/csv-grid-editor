import { state, getNumCols } from '../state';

/**
 * Column color mode. A toolbar toggle that gives every data column a distinct,
 * theme-adaptive background tint (header stronger, body fainter) so columns are
 * easy to tell apart, similar to Rainbow CSV but readable on any VS Code theme.
 *
 * How the colors work (see also media/webview.css → "Column Color Mode"):
 *  - Each column gets one hue via golden-angle rotation (137.5°), which keeps
 *    adjacent columns far apart on the wheel for any column count, even after a
 *    column is inserted or deleted. Only the per-column hue is injected here as
 *    a CSS variable (--cm-h) on that column's cells via their stable AG Grid
 *    `col-id`; the lightness, chroma and alpha live in CSS and adapt to the
 *    active theme (light / dark / high-contrast).
 *  - The tint is a translucent overlay (color-mix in OKLCH) painted over the
 *    real row background, so the theme's own foreground text keeps its contrast
 *    and frozen rows, selection, find matches and duplicate highlights — all of
 *    which are !important and higher in the cascade — keep painting clearly on
 *    top. The row-number gutter (col-id "row-index") is never tinted.
 *
 * The toggle is persisted globally (VS Code globalState) exactly like zoom, so
 * it is remembered across every CSV file and every session.
 */

const HUE_STYLE_ID = 'cm-col-hues';
// 360 * (1 - 1/phi). Irrational vs 360°, so successive hues land in the largest
// remaining gap and never visibly repeat.
const GOLDEN_ANGLE = 137.50776405003785;
// Start offset so column 0 isn't pure red.
const START_HUE = 25;

function persistColorMode(): void {
    vscodeApi.postMessage({ type: 'colorModeChanged', colorMode: state.colorMode });
}

function updateButton(): void {
    document.getElementById('btn-colormode')?.classList.toggle('btn-active', state.colorMode);
}

// Toggles the `cm-on` class on the grid container (which gates all tint CSS) and,
// when on, (re)generates the per-column hue rules for the current column count.
// Safe to call before the grid has data (numCols 0 → empty rule set, class only).
// Called on setup, on toggle, and at the end of every buildGrid (column add/delete,
// delimiter change, paging) so freshly built columns pick up their hue.
export function applyColorMode(): void {
    const container = document.getElementById('grid-container');
    if (!container) return;
    container.classList.toggle('cm-on', state.colorMode);

    let styleEl = document.getElementById(HUE_STYLE_ID) as HTMLStyleElement | null;
    if (!state.colorMode) {
        styleEl?.remove();
        return;
    }
    if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = HUE_STYLE_ID;
        document.head.appendChild(styleEl);
    }
    const numCols = getNumCols(state.data);
    let css = '';
    for (let c = 0; c < numCols; c++) {
        const hue = ((START_HUE + c * GOLDEN_ANGLE) % 360).toFixed(2);
        css += `#grid-container.cm-on [col-id="col_${c}"]{--cm-h:${hue};}`;
    }
    styleEl.textContent = css;
}

function toggleColorMode(): void {
    state.colorMode = !state.colorMode;
    updateButton();
    applyColorMode();
    persistColorMode();
}

export function setupColorMode(): void {
    state.colorMode = !!INITIAL_COLOR_MODE;
    updateButton();
    applyColorMode();
    document.getElementById('btn-colormode')?.addEventListener('click', toggleColorMode);
}
