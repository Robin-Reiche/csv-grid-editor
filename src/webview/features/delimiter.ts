import { state } from '../state';
import { buildGrid } from '../grid/builder';
import { readText, refreshFindInPlace } from '../messaging';
import { frozenRowPositions, reanchorFrozenRows } from './freeze-rows';
import { closeAllPopups } from './popups';
import { resetDuplicatesState } from './duplicates';

export function updateDelimiterBadge(delimiter: string): void {
    const badge = document.getElementById('delim-badge');
    if (badge) badge.textContent = 'Delim: ' + (delimiter === '\t' ? 'TAB' : delimiter);
}

export function setupDelimiterBadge(): void {
    const badge    = document.getElementById('delim-badge');
    const dropdown = document.getElementById('delim-dropdown');
    if (!badge || !dropdown) return;

    badge.addEventListener('click', e => {
        e.stopPropagation();
        const wasOpen = !dropdown.classList.contains('hidden');
        closeAllPopups();
        if (wasOpen) return;
        const r = badge.getBoundingClientRect();
        (dropdown as HTMLElement).style.left = r.left + 'px';
        (dropdown as HTMLElement).style.top  = (r.bottom + 2) + 'px';
        dropdown.classList.remove('hidden');
    });

    document.querySelectorAll<HTMLElement>('.delim-option').forEach(opt => {
        opt.addEventListener('click', () => {
            const raw = opt.dataset.delim ?? ',';
            state.currentDelimiter = raw === '\\t' ? '\t' : raw;
            updateDelimiterBadge(state.currentDelimiter);
            dropdown.classList.add('hidden');
            // A different delimiter re-splits the same lines into different columns,
            // so the rows are the same rows at the same positions — re-anchor the
            // frozen rows across the re-parse instead of losing them.
            const frozen = frozenRowPositions();
            readText(state.rawCsvText);
            reanchorFrozenRows(frozen);
            state.hiddenCols.clear(); // re-parse may change the column set — drop index-based hide state
            state.autoFitCache = null;
            state.colTypes = [];
            buildGrid();
            // The duplicate search looked at the rows as they were split before,
            // so its results no longer fit. Leaving "Show only duplicates" later
            // would put back its snapshot of those old rows. A switch writes
            // nothing, so notifyChange, which ends the view after every edit,
            // never runs here.
            resetDuplicatesState();
            // The find matches were found in the columns as they were split
            // before. Replace on one of them changed nothing and still sent
            // the file.
            refreshFindInPlace();
        });
    });

    document.addEventListener('click', () => dropdown.classList.add('hidden'));
}
