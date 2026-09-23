import { state } from '../state';
import { buildGrid } from '../grid/builder';
import { hideLoader } from '../utils/loader';
import { readText } from '../messaging';
import { rowsInFile } from './header-row';

export function requestPage(pageNum: number): void {
    vscodeApi.postMessage({ type: 'requestPage', pageNumber: pageNum });
}

// The paged view's banner: the page on display and how many rows the whole
// file has.
export function updatePageBanner(): void {
    const previewEl = document.getElementById('preview-text');
    if (!previewEl || !IS_CHUNKED) return;
    previewEl.textContent = `Page ${(state.currentPage + 1).toLocaleString()} of ${state.totalPages.toLocaleString()}, `
        + `${rowsInFile().toLocaleString()} rows in total (read-only preview)`;
}

export function handlePageData(msg: { pageNumber: number; totalPages: number; text: string }): void {
    state.currentPage = msg.pageNumber;
    state.totalPages  = msg.totalPages;

    const pi   = document.getElementById('page-info');
    if (pi) pi.textContent = 'Page ' + (msg.pageNumber + 1) + ' / ' + msg.totalPages;

    // Head and tail say how much of the file is on screen, the paged view used to
    // say nothing at all: the banner rendered empty because only those two modes
    // ever filled it.
    updatePageBanner();

    const btnPrev  = document.getElementById('btn-page-prev')  as HTMLButtonElement | null;
    const btnFirst = document.getElementById('btn-page-first') as HTMLButtonElement | null;
    const btnNext  = document.getElementById('btn-page-next')  as HTMLButtonElement | null;
    const btnLast  = document.getElementById('btn-page-last')  as HTMLButtonElement | null;

    if (btnPrev)  btnPrev.disabled  = msg.pageNumber === 0;
    if (btnFirst) btnFirst.disabled = msg.pageNumber === 0;
    if (btnNext)  btnNext.disabled  = msg.pageNumber >= msg.totalPages - 1;
    if (btnLast)  btnLast.disabled  = msg.pageNumber >= msg.totalPages - 1;

    // Switching the delimiter by hand re-splits this text (features/delimiter.ts),
    // so it has to be the page on display. It used to keep whatever the first page
    // held, which sent you back to page 1 while the bar still said page 6 (#34).
    readText(msg.text);
    buildGrid();
    hideLoader();
}

export function setupPagination(): void {
    if (!IS_CHUNKED) return;
    document.getElementById('pagination-bar')?.classList.remove('hidden');

    document.getElementById('btn-page-first')?.addEventListener('click', () => requestPage(0));
    document.getElementById('btn-page-prev')?.addEventListener('click',  () => { if (state.currentPage > 0) requestPage(state.currentPage - 1); });
    document.getElementById('btn-page-next')?.addEventListener('click',  () => requestPage(state.currentPage + 1));
    document.getElementById('btn-page-last')?.addEventListener('click',  () => requestPage(-1));
}
