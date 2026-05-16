import { state } from '../state';

export function setupExport(): void {
    document.getElementById('btn-export')?.addEventListener('click', () => {
        if (!state.gridApi) return;
        const colIds = (state.gridApi.getColumnDefs() as any[])
            .filter(c => c.colId !== 'row-index')
            .map(c => c.field ?? c.colId)
            .filter(Boolean);
        const csv  = state.gridApi.getDataAsCsv({ columnKeys: colIds });
        const name = FILENAME ? FILENAME.replace(/\.[^.]+$/, '_export.csv') : 'export.csv';
        vscodeApi.postMessage({ type: 'export', text: csv, filename: name });
    });
}
