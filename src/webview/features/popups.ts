import { state } from '../state';

// ── Central popup coordinator (issue #15) ─────────────────────────────────────
// The grid has several transient popups: the column and row context menus, the
// Export and Delimiter dropdowns, the column-chooser and go-to-row popovers and
// the rename popover. They should be mutually exclusive — opening or triggering
// one closes the others. Each hides via the shared `.hidden` class. Persistent
// panels (the find/replace bar, the column profile) are deliberately excluded.
//
// Before this, every opener called e.stopPropagation() on its own click so the
// document-level dismiss listener would not immediately close it again. That same
// stopPropagation also kept the click from reaching every OTHER popup's document
// dismiss listener, so opening one popup left the others stuck open. Routing each
// opener through closeAllPopups() fixes that in one place.
const POPUP_IDS = [
    'col-context-menu',
    'row-context-menu',
    'export-dropdown',
    'delim-dropdown',
    'col-chooser-popover',
    'goto-popover',
    'rename-popover',
];

// Hide every popup except the one about to be shown (pass its id as `except` to
// avoid a redundant hide-then-show of the same element).
export function closeAllPopups(except?: string): void {
    for (const id of POPUP_IDS) {
        if (id === except) continue;
        document.getElementById(id)?.classList.add('hidden');
    }
}

// Checks if any coordinated popup is currently visible.
// This ensures the global Esc handler only consumes the keystroke when
// there is actually a popup to dismiss, leaving Esc free for standard
// tasks (like canceling a cell edit).
export function isAnyPopupOpen(): boolean {
    return POPUP_IDS.some(id => {
        const el = document.getElementById(id);
        return el != null && !el.classList.contains('hidden');
    });
}

// Sets up a global Esc key listener to dismiss all popups (wired once at startup).
// - Uses the capture phase (true) to intercept the event before AG Grid consumes it.
// - Does NOT call stopPropagation to allow input-focused popups (rename, go-to-row)
//   to run their own focus-bound Escape handlers and state cleanup.
//   Other popups (context menus, dropdowns) are simply hidden by closeAllPopups().
export function setupPopups(): void {
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;

        // AG Grid's filter panel lives outside POPUP_IDS (it has no fixed id).
        // Detect it in the DOM and let AG Grid close it.
        const agOpen = document.querySelector('.ag-popup .ag-menu, .ag-popup .ag-filter');
        if (agOpen) {
            (state.gridApi as any)?.hidePopupMenu?.();
            e.preventDefault();
            return;
        }

        if (!isAnyPopupOpen()) return;
        closeAllPopups();
        e.preventDefault();
    }, true);
}
