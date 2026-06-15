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
