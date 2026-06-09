# Changelog

All notable changes to CSV Grid Editor are documented here.

## [1.7.3] - 2026-06-09

### Changed
- **Marketplace listing and discoverability** - Expanded the search keywords and switched the second category to Data Science, rewrote the displayName and description to lead with what the extension does, and added homepage, bugs, Q&A, gallery banner and pricing metadata. No functional changes to the editor.
- **README** - Reworked for clarity and search with a keyword-first intro, a Contents list, Why / Who it is for / Quick start sections, an honest How it compares table, an FAQ, two short demo GIFs and clearer image alt text.

## [1.7.2] - 2026-06-08

### Fixed
- **README badges** — The Version / Installs / Rating badges were broken because their provider is not on the Marketplace's allowed badge-host list (and shields.io has retired its Marketplace badges). Switched to `badgen.net`, which is allow-listed and serves live data.

## [1.7.1] - 2026-06-08

### Added
- **Sponsor / support links** — A **Sponsor** button (GitHub Sponsors) now appears on the extension page, and the README has a Support section linking GitHub Sponsors and Ko-fi for anyone who would like to support development. Entirely optional.

## [1.7.0] - 2026-06-08

### Added
- **Rename columns** — Double-click a column header, or right-click it → **Rename column**, to rename it. The new name is written to the CSV header row and is fully undoable; column widths, sort and freeze state are preserved.
- **Show / hide columns** — A new toolbar button opens a column chooser: a checklist of every column with checkboxes to hide or show individual columns, plus **Show all** to reset. Hidden columns persist across paged-view page changes. Export still includes all columns.

## [1.6.1] - 2026-06-08

### Added
- **Freeze row** — Right-click any row and choose **Freeze row** to pin it to the top of the grid as an always-visible reference while you scroll, sort and filter the rest of the data; right-click the pinned row and choose **Unfreeze row** to release it. One row can be frozen at a time. Like Freeze column it is a view aid (also available in read-only previews) and is not persisted across reload. A 📌 marker on the pinned row's `#` cell shows its original row number, so it never reads as a duplicate of the body row that renumbers into its place. A frozen row stays visible regardless of any active column filter, and the feature is mutually exclusive with the duplicate-rows view.
- **Freeze markers** — Frozen columns now show a 📌 marker before the column name, matching the frozen-row marker, so pinned columns and rows are easy to spot at a glance.

## [1.5.5] - 2026-06-03

### Fixed
- **Cell edits landed on the wrong row under an active sort or filter** — Editing a cell while the grid was filtered and/or sorted wrote the new value to the wrong row in the underlying CSV (the row at the same *display* position in the unfiltered/unsorted data), corrupting data silently. The edit handler now maps the edited row back to its source position via `_origIndex` instead of the display row index. The default unsorted/unfiltered view was unaffected.
- **Find & Replace had the same wrong-row bug** — Replace / Replace All wrote substitutions to the wrong rows whenever a sort or filter was active. Matches now capture the row's `_origIndex` at search time so replacements always hit the correct row.
- Added regression tests for both index-mapping paths (`test/`).

## [1.5.4] - 2026-05-27

### Fixed
- **Large-file picker cancellation** — Dismissing the "How would you like to open this file?" picker for large CSVs left the editor tab in a broken state and surfaced a `Canceled: Canceled` entry in the Output log; clicking the file again would surface the cached error instead of re-showing the picker. `openCustomDocument` now returns a sentinel "cancelled" document instead of throwing `CancellationError`, and the matching tab is closed via the `tabGroups` API on the next microtask. `resolveCustomEditor` returns early for the sentinel without touching the webview, avoiding the `OverlayWebview has been disposed` race that an immediate panel-dispose would otherwise trigger. The picker also no longer dismisses on accidental focus loss (use `Esc` to cancel explicitly).

## [1.5.0] - 2026-05-16

### Added
- **Inline range selection** — Excel-style cell selection directly in the grid. Click and drag to select a rectangular range, drag the row-number (`#`) column to select whole rows, or right-click a column header → **Select column**. `Shift`+click and `Shift`+arrow keys extend the selection; `Ctrl+A` selects everything. `Ctrl+C` copies the selection as tab-separated values; right-click → **Copy with header** to include column headers. `Delete` / `Backspace` clears the selected cells. The status bar shows the selection size plus live Count / Sum / Avg / Min / Max.
- **Paste** — paste tab- or comma-separated clipboard data straight into the grid, starting at the focused cell. Integrates with the undo stack.
- **AND / OR filter conditions** — each condition in a column filter can now be joined with AND *or* OR (previously AND-only). Click the operator pill between two conditions to toggle it; AND binds tighter than OR.

### Changed
- **Unified iconography** — every icon (column headers, toolbar, profile panel, banners) now comes from a single VS Code Codicon family, replacing the previous mix of hand-drawn SVG, Unicode glyphs and emoji. Header sort and filter glyphs are sized and centred consistently.
- A column's filter funnel now fills solid white while a filter is active on that column, making filtered columns easy to spot.

### Removed
- The standalone **Select & Copy** mode (a separate read-only view) — superseded by the inline range selection above.

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
