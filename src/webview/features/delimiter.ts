import { state } from '../state';
import { parseCsv } from '../utils/csv';
import { buildGrid } from '../grid/builder';

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
        const r = badge.getBoundingClientRect();
        (dropdown as HTMLElement).style.left = r.left + 'px';
        (dropdown as HTMLElement).style.top  = (r.bottom + 2) + 'px';
        dropdown.classList.toggle('hidden');
    });

    document.querySelectorAll<HTMLElement>('.delim-option').forEach(opt => {
        opt.addEventListener('click', () => {
            const raw = opt.dataset.delim ?? ',';
            state.currentDelimiter = raw === '\\t' ? '\t' : raw;
            updateDelimiterBadge(state.currentDelimiter);
            dropdown.classList.add('hidden');
            state.data = parseCsv(state.rawCsvText, state.currentDelimiter);
            state.autoFitCache = null;
            state.colTypes = [];
            buildGrid();
        });
    });

    document.addEventListener('click', () => dropdown.classList.add('hidden'));
}
