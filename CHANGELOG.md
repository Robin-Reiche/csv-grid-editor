# Changelog

All notable changes to CSV Grid Editor are documented here.

## [1.3.4] - 2026-05-05

### Fixed
- **Critical:** Webview CSS and codicon font were missing from the published package because `media/` was gitignored in its entirety. The CI build only generated `media/webview.js` via esbuild — the static stylesheet and codicon assets were never produced, leaving the grid unstyled in the Marketplace install. `media/webview.css` is now tracked, and a new `copy-codicons` build step copies `codicon.css` / `codicon.ttf` from `node_modules/@vscode/codicons` on every compile.

## [1.3.3] - 2026-05-03

### Fixed
- Marketplace publish workflow: switched the badge URLs from `.svg` to `.png` because `vsce` rejects SVG images from non-allowlisted hosts and was failing the publish step.
- Workflow now invokes `npx @vscode/vsce` instead of the deprecated `npx vsce` to clear the rename deprecation warning.

## [1.3.2] - 2026-05-03

### Fixed
- README: Marketplace badges now display real version, install count, and rating instead of the literal "Retired Badge" text. The previous shields.io endpoint relied on a Microsoft API that has been discontinued; switched to vsmarketplacebadges.dev which queries the live Marketplace gallery.

## [1.3.1] - 2026-05-03

### Changed
- README: Added Marketplace installs and rating badges alongside the existing version badge.

## [1.3.0] - 2026-05-03

### Added
- **Go to Row** — New toolbar button (and `Ctrl+G` / `Cmd+G` shortcut) opens a popover where you can type any row number and jump directly to it. The target row briefly flashes blue to confirm navigation. Disabled in Paged View.
- **Duplicate Row Detection** — New toolbar button scans every row and highlights duplicates with an amber tint. A banner reports the number of duplicate rows and how many groups they form.
  - **Show only duplicates** — Filters the grid to duplicates only, sorts matching rows next to each other, and switches the `#` column to show the original CSV line number of each row so you can locate them in the source file.
  - **Dismiss** restores the full table at any time.
  - Duplicate state is automatically cleared when you edit cells, undo/redo, delete rows/columns, or the file changes externally.
  - Disabled in Paged View.

## [1.2.2] - 2026-04-14

### Added
- Delete row and column support
- Freeze columns feature
- Zoom in/out for the grid

### Changed
- Webview refactored to modular TypeScript architecture
- Improved auto-fit column algorithm (3-phase sizing)
- Enhanced toolbar button styles

## [1.2.0] - 2025-10

### Added
- Undo/Redo support
- Find & Replace
- Export to CSV/TSV
- Pagination controls
- Profile/settings persistence
- Select & Copy support
- Theme integration (VS Code light/dark/high-contrast)
- Custom combined filter (checkbox + condition filter per column)

## [0.5.0] - 2025-03

### Added
- Delimiter auto-detection and manual override
- AG Grid Community integration for sortable, filterable grid

### Changed
- Version bump to 0.5.0, toolbar style improvements

## [0.3.0] - 2025-02

### Added
- Clear filters button
- Filter status indicator
- Numeric column detection for correct sort behavior

## [0.2.0] - 2025-01

### Added
- Extension icon
- Renamed to CSV Grid Editor

## [0.1.0] - 2024-12

### Added
- Initial public release
- CSV/TSV file viewer as VS Code custom editor
- Basic grid view with AG Grid
