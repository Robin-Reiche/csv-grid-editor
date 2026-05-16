/**
 * Detects the active VS Code color theme and applies the matching AG Grid
 * theme class to the grid container.  Also watches for live theme changes
 * so switching themes in VS Code updates the grid without a reload.
 */

export function isDarkTheme(): boolean {
    const cls = document.body.classList;
    return cls.contains('vscode-dark') ||
           cls.contains('vscode-high-contrast');
}

export function applyGridTheme(): void {
    const container = document.getElementById('grid-container');
    if (!container) return;
    container.className = isDarkTheme() ? 'ag-theme-alpine-dark' : 'ag-theme-alpine';
}

export function setupTheme(): void {
    applyGridTheme();
    // VS Code sets / updates `class` on <body> when the user changes themes
    new MutationObserver(applyGridTheme).observe(document.body, {
        attributes: true,
        attributeFilter: ['class'],
    });
}
