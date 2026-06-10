import { state } from '../state';
import type { ColType } from '../types';
import { toJson, toJsonLines, toMarkdownTable } from '../utils/export-formats';

// ── Export menu ──────────────────────────────────────────────────────────────
// The toolbar Export button opens a small dropdown (JSON / JSON Lines /
// Markdown table). Every format exports the CURRENT VIEW: active filters and
// sort order are applied, columns appear in their current (possibly reordered)
// order with their current (possibly renamed) headers. Hidden columns are still
// included — the column chooser is documented as a view aid (see README). A
// frozen reference row is exported first, matching where the user sees it.
// Saving the file itself already writes CSV, so there is no CSV entry here.

type ExportFormat = 'json' | 'jsonl' | 'md';

const FORMAT_EXT: Record<ExportFormat, string> = {
    json: '.json',
    jsonl: '.jsonl',
    md: '.md',
};

function collectView(): { headers: string[]; rows: string[][]; types: ColType[] } {
    const colDefs = (state.gridApi.getColumnDefs() as any[])
        .filter(c => c.colId !== 'row-index' && (c.field ?? c.colId));
    const fields  = colDefs.map(c => String(c.field ?? c.colId));
    const headers = colDefs.map(c => String(c.headerName ?? ''));
    const types   = fields.map(f => {
        const ci = parseInt(f.replace('col_', ''), 10);
        return (state.colTypes[ci] ?? 'string') as ColType;
    });

    const rows: string[][] = [];
    const pushRow = (data: any): void => {
        if (!data) return;
        rows.push(fields.map(f => (data[f] != null ? String(data[f]) : '')));
    };
    // Pinned (frozen) reference row first — it sits above the body on screen.
    const pinnedCount = state.gridApi.getPinnedTopRowCount?.() ?? 0;
    for (let i = 0; i < pinnedCount; i++) pushRow(state.gridApi.getPinnedTopRow(i)?.data);
    state.gridApi.forEachNodeAfterFilterAndSort((node: any) => pushRow(node.data));

    return { headers, rows, types };
}

function runExport(format: ExportFormat): void {
    if (!state.gridApi) return;
    const { headers, rows, types } = collectView();

    let text: string;
    if (format === 'json')       text = toJson(headers, rows, types);
    else if (format === 'jsonl') text = toJsonLines(headers, rows, types);
    else                         text = toMarkdownTable(headers, rows, types);

    const base = FILENAME ? FILENAME.replace(/\.[^.]+$/, '') : 'export';
    const name = (base || 'export') + '_export' + FORMAT_EXT[format];
    vscodeApi.postMessage({ type: 'export', text, filename: name });
}

export function setupExport(): void {
    const btn      = document.getElementById('btn-export');
    const dropdown = document.getElementById('export-dropdown') as HTMLElement | null;
    if (!btn || !dropdown) return;

    btn.addEventListener('click', e => {
        e.stopPropagation();
        const r = btn.getBoundingClientRect();
        dropdown.style.top = (r.bottom + 2) + 'px';
        dropdown.classList.toggle('hidden');
        // Clamp after unhiding — offsetWidth is 0 while display:none.
        const w = dropdown.offsetWidth || 140;
        dropdown.style.left = Math.max(4, Math.min(r.left, window.innerWidth - w - 4)) + 'px';
    });

    document.querySelectorAll<HTMLElement>('.export-option').forEach(opt => {
        opt.addEventListener('click', () => {
            dropdown.classList.add('hidden');
            runExport((opt.dataset.format ?? 'json') as ExportFormat);
        });
    });

    document.addEventListener('click', () => dropdown.classList.add('hidden'));
}
