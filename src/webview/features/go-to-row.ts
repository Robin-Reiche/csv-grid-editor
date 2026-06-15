import { state } from '../state';
import { closeAllPopups } from './popups';

// Brief flash applied to the target row to confirm navigation. We toggle a
// dynamic <style> tag matching .ag-row[row-index="N"] (same approach as the
// row-index highlight in builder.ts) so the highlight survives virtual scroll
// re-renders that AG Grid performs while jumping to the target row.
let flashTimer: ReturnType<typeof setTimeout> | null = null;

function flashRow(displayedRowIndex: number): void {
    let el = document.getElementById('_row-flash') as HTMLStyleElement | null;
    if (!el) {
        el = document.createElement('style');
        el.id = '_row-flash';
        document.head.appendChild(el);
    }
    el.textContent = `
#grid-container .ag-row[row-index="${displayedRowIndex}"] .ag-cell {
    animation: csv-row-flash 1.4s ease-out;
}`;
    if (flashTimer !== null) clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
        if (el) el.textContent = '';
        flashTimer = null;
    }, 1500);
}

function getDisplayedRowCount(): number {
    return state.gridApi?.getDisplayedRowCount?.() ?? 0;
}

function showError(msg: string): void {
    const err = document.getElementById('goto-error');
    if (err) {
        err.textContent = msg;
        err.style.display = '';
    }
}

function clearError(): void {
    const err = document.getElementById('goto-error');
    if (err) {
        err.textContent = '';
        err.style.display = 'none';
    }
}

function jumpToRow(): void {
    const input = document.getElementById('goto-input') as HTMLInputElement | null;
    if (!input || !state.gridApi) return;

    const raw = input.value.trim();
    if (raw === '') { showError('Enter a row number'); return; }

    const target = parseInt(raw, 10);
    if (!Number.isFinite(target) || target < 1) {
        showError('Row number must be 1 or greater');
        return;
    }

    const total = getDisplayedRowCount();
    if (total === 0) { showError('No rows to navigate'); return; }
    if (target > total) {
        showError('Only ' + total.toLocaleString() + ' row' + (total === 1 ? '' : 's') + ' available');
        return;
    }

    const displayedIndex = target - 1; // 1-based input → 0-based displayed index
    state.gridApi.ensureIndexVisible(displayedIndex, 'middle');

    // Defer the focus + flash one frame so AG Grid has rendered the target row
    // into the DOM after the scroll. Without this, setFocusedCell can race the
    // virtual-scroll render and silently drop the focus.
    requestAnimationFrame(() => {
        const cols = state.gridApi.getAllDisplayedColumns?.() as any[] | undefined;
        const firstDataCol = cols?.find(c => c.getColId?.() !== 'row-index');
        const colId = firstDataCol?.getColId?.() ?? 'col_0';
        try { state.gridApi.setFocusedCell(displayedIndex, colId); } catch {}
        flashRow(displayedIndex);
    });

    closePopover();
}

function openPopover(): void {
    const pop  = document.getElementById('goto-popover');
    const btn  = document.getElementById('btn-go-to-row');
    const input = document.getElementById('goto-input') as HTMLInputElement | null;
    const hint  = document.getElementById('goto-hint');
    if (!pop || !btn || !input) return;

    const total = getDisplayedRowCount();
    if (hint) hint.textContent = 'of ' + total.toLocaleString();
    input.max = String(Math.max(1, total));

    // Position below the toolbar button, clamped to viewport.
    const r  = btn.getBoundingClientRect();
    pop.classList.remove('hidden');
    const pw = pop.offsetWidth || 220;
    const vw = window.innerWidth;
    pop.style.top  = (r.bottom + 4) + 'px';
    pop.style.left = Math.max(4, Math.min(r.left, vw - pw - 4)) + 'px';

    clearError();
    input.value = '';
    setTimeout(() => input.focus(), 0);
}

function closePopover(): void {
    document.getElementById('goto-popover')?.classList.add('hidden');
    clearError();
}

export function setupGoToRow(): void {
    if (IS_CHUNKED) return; // Button is rendered disabled — wire nothing.

    const btn = document.getElementById('btn-go-to-row');
    btn?.addEventListener('click', e => {
        e.stopPropagation();
        const pop = document.getElementById('goto-popover');
        const wasOpen = pop != null && !pop.classList.contains('hidden');
        closeAllPopups();
        if (!wasOpen) openPopover();
    });

    document.getElementById('goto-go')?.addEventListener('click', jumpToRow);
    document.getElementById('goto-cancel')?.addEventListener('click', closePopover);

    const input = document.getElementById('goto-input') as HTMLInputElement | null;
    input?.addEventListener('keydown', e => {
        if (e.key === 'Enter')  { e.preventDefault(); jumpToRow(); }
        if (e.key === 'Escape') { e.preventDefault(); closePopover(); }
    });
    input?.addEventListener('input', clearError);

    // Click-outside dismiss — capture phase so we run before any nested handlers.
    document.addEventListener('mousedown', evt => {
        const pop = document.getElementById('goto-popover');
        if (!pop || pop.classList.contains('hidden')) return;
        const target = evt.target as Node;
        if (pop.contains(target)) return;
        if (btn?.contains(target)) return; // toggle button handles itself
        closePopover();
    }, true);

    // Ctrl/Cmd+G keyboard shortcut.
    document.addEventListener('keydown', e => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'g' && !state.isCellEditing) {
            e.preventDefault();
            const pop = document.getElementById('goto-popover');
            if (pop?.classList.contains('hidden')) openPopover();
            else closePopover();
        }
    });
}
