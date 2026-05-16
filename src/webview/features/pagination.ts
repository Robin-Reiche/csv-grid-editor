import { state } from '../state';
import { parseCsv } from '../utils/csv';
import { buildGrid } from '../grid/builder';
import { hideLoader } from '../utils/loader';

export function requestPage(pageNum: number): void {
    vscodeApi.postMessage({ type: 'requestPage', pageNumber: pageNum });
}

export function handlePageData(msg: { pageNumber: number; totalPages: number; text: string }): void {
    state.currentPage = msg.pageNumber;

    const pi   = document.getElementById('page-info');
    if (pi) pi.textContent = 'Page ' + (msg.pageNumber + 1) + ' / ' + msg.totalPages;

    const btnPrev  = document.getElementById('btn-page-prev')  as HTMLButtonElement | null;
    const btnFirst = document.getElementById('btn-page-first') as HTMLButtonElement | null;
    const btnNext  = document.getElementById('btn-page-next')  as HTMLButtonElement | null;
    const btnLast  = document.getElementById('btn-page-last')  as HTMLButtonElement | null;

    if (btnPrev)  btnPrev.disabled  = msg.pageNumber === 0;
    if (btnFirst) btnFirst.disabled = msg.pageNumber === 0;
    if (btnNext)  btnNext.disabled  = msg.pageNumber >= msg.totalPages - 1;
    if (btnLast)  btnLast.disabled  = msg.pageNumber >= msg.totalPages - 1;

    state.data = parseCsv(msg.text, state.currentDelimiter);
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
