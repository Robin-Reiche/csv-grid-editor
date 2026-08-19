# Changelog

All notable changes to CSV Grid Editor are documented here.

## [1.17.1] - 2026-08-19

### Fixed
- **A line break stays recognisable while wrapping** - With the wrap toggle on there was no way to tell whether a line ended because the value contains a line break or because it ran into the edge of the column. The `↵` chip is now drawn in both modes, so a break with a chip in front of it comes from the data and one without comes from the column. Reported by [@JeppeKlitgaard](https://github.com/JeppeKlitgaard) in [#29](https://github.com/Robin-Reiche/csv-grid-editor/issues/29), who builds tables by hand and wraps them to read the full text. The toggle is called **Wrap cell text** now, which is what it always did.
- **Copying a single multi-line cell** - `Ctrl+C` on one cell put the raw value on the clipboard, so a cell with a line break arrived in Excel as three separate cells and pasting it back into the grid produced three rows. It is quoted now, the same way copying a selected range has always done it. Ordinary values are unchanged.
- **Auto-fit makes room for the chips** - Auto-fit measured the raw value while the grid draws a chip for every control character and, since 1.17.0, for every line break. A chip is several times wider than the character it replaces, and a line break even collapses to a single space when it is measured as text, so a column with such a value came out too narrow and the value it was fitted to still ended in an ellipsis. The measurement now builds the cell exactly the way the grid draws it. Cells with chips are also kept out of the calibration step, where their mixed content skewed the correction factor for every column.

## [1.17.0] - 2026-08-14

### Added
- **Line breaks inside a cell** - A cell can now be given a line break while editing, with `Alt+Enter` like in Excel, or with `Shift+Enter` or `Ctrl+Enter` ([#29](https://github.com/Robin-Reiche/csv-grid-editor/issues/29)). The cell editor is a text box that grows with the value instead of a single-line field, and `Enter` still commits, so editing a normal value feels exactly as it did. Reading and writing such a file always worked, the quoted multi-line field is part of the CSV standard, there was just no way to type one.
- **Multi-line cells are visible** - A row is one line tall, which used to make a line break inside a cell invisible: "Hamburg\nGermany" looked the same as "Hamburg Germany". Every break now shows as a small `↵` chip, and hovering it says whether it is LF or CRLF. Display only, the value keeps the original characters.
- **Wrap multi-line cells** - A new toolbar toggle next to the color-columns button. With it on, cells break at their line breaks and each row grows to fit its tallest cell. It stays off by default because measuring every row costs time on large files, and the setting is remembered across files and sessions like zoom and column colors.

### Known limitation
- The three large-file modes for files over 10 MB (**Show Head**, **Show Tail**, **Paged View**) split the file on line breaks without looking at quotes, so a cell containing one is torn apart there. Those modes are read-only previews, **Open Full File** is not affected. Tracked as [#32](https://github.com/Robin-Reiche/csv-grid-editor/issues/32).

## [1.16.0] - 2026-08-13

### Fixed
- **The grid reloads when a script regenerates the file** - Auto-reload only reacted to a file being rewritten in place. A script that regenerates its output by deleting the file, or the whole output folder, and writing it fresh went unnoticed, so the grid kept showing the old data until you closed the tab and opened it again (reported in [#25](https://github.com/Robin-Reiche/csv-grid-editor/issues/25)). That kind of rewrite reaches the editor as a delete followed by a create, not as a change, and only the change was being handled. Both now trigger the reload, so a regenerated CSV shows up on its own.

### Added
- **CSV Grid: Reload from Disk** - A command in the Command Palette that pulls in the file on disk on demand. Worth knowing: **File: Revert File** cannot do this. VS Code only forwards a revert to an editor when the document has unsaved changes, so on a file you only changed on disk it does nothing at all, which is easy to mistake for a broken editor. The new command has no such condition and tells you when there was nothing to pull in.

Thanks to [@GiacomoEV](https://github.com/GiacomoEV) for the report and for patiently answering the follow-up questions that pinned this down.

## [1.15.1] - 2026-08-11

### Fixed
- **XML export parses everywhere, including headers with rare CJK** - A column header holding a character above U+FFFF, the range Mathematical letters and CJK Extension B live in, produced an element name that Python's standard library, PHP and Perl refuse to read. The newest edition of XML 1.0 allows such a name and libxml2 accepts one, but expat implements the older rule and rejects the tag wherever the character sits. Those characters are now replaced with an underscore like every other character that is not legal in an element name, so the file opens in any parser. Headers that stay inside the BMP ("Größe", "中文") are untouched. Shipped with the XML export in 1.15.0.

## [1.15.0] - 2026-08-11

### Added
- **Export as XML** - The Export menu has a fourth format next to JSON, JSON Lines and Markdown ([#26](https://github.com/Robin-Reiche/csv-grid-editor/pull/26)). It writes the current view as one `<row>` element per row with one child element per column, for the systems that still speak XML. Column headers become element names, and because XML names are far stricter than JSON keys, anything illegal in one (spaces, punctuation, a leading digit) is replaced so the output always parses, with headers that collapse onto the same name still kept apart. Cell text is written exactly as it reads, so a leading zero or a trailing decimal zero survives. Control characters are the one thing that cannot come along: XML 1.0 has no way to represent them, so they are dropped. The other three formats keep them.
- **Control characters say what they are** - A control character inside a cell value has no glyph in the UI font, so the grid drew an anonymous box and there was no way to tell which character it was without exporting the file ([#28](https://github.com/Robin-Reiche/csv-grid-editor/pull/28)). Machine-generated CSVs use these as in-value separators and exports from older systems leave stray bytes behind, so the box turns up more often than you would expect. They now show as a small chip carrying the ASCII abbreviation, with the full name on hover (`U+001D GROUP SEPARATOR`). Display only, so the value itself is untouched and editing, copy, find and replace and save all keep the original character.

### Fixed
- **Zoom scales the grid, not the toolbar** - Zooming scaled the toolbar, footer and column profile panel along with the data ([#27](https://github.com/Robin-Reiche/csv-grid-editor/pull/27)). That was worse than cosmetic: every step re-laid out the toolbar, so the zoom buttons slid sideways under the pointer and a second click landed on the neighbouring button. Zooming twice in a row was a coin flip. Zoom now changes only the row height, header height, cell font and cell padding, the way the editor's own font-size zoom behaves, and everything around the grid keeps its size at every level.

Thanks to [@yukina3230](https://github.com/yukina3230) who contributed all three changes in this release.

## [1.14.0] - 2026-08-03

### Changed
- **Unfreeze has its own icon** - **Freeze** and **Unfreeze** sat under each other in the context menu with almost the same pin icon, so nothing about the picture told you which one undid the other. Unfreeze now uses a pin with a slash across it, in **Unfreeze column**, **Unfreeze all columns**, **Unfreeze row** and **Unfreeze all rows** ([#24](https://github.com/Robin-Reiche/csv-grid-editor/pull/24)). The icon font is bundled with the extension, so this came with an update of the codicon set it ships.

Thanks to [@yukina3230](https://github.com/yukina3230) for the change.

## [1.13.1] - 2026-06-25

### Fixed
- **The grid works offline now** - The grid library (AG Grid) was loaded from a CDN, so on a machine without internet the editor was stuck on "Loading…" and never showed the data (reported in [#23](https://github.com/Robin-Reiche/csv-grid-editor/issues/23)). It is now bundled with the extension and loaded locally, so opening a CSV no longer needs a network connection. This also helps anyone behind a strict firewall or where the CDN is blocked. And it means the extension no longer reaches out to a third party every time you open a file.

Thanks to [@leohao6762](https://github.com/leohao6762) for reporting it.

## [1.13.0] - 2026-06-19

### Added
- **Escape closes the open menu or popup** - Pressing `Esc` now dismisses whichever menu, dropdown or popover is open: the column and row context menus, the Export and Delimiter dropdowns, the column chooser, Go to row, the rename popover and the per-column filter panel ([#22](https://github.com/Robin-Reiche/csv-grid-editor/pull/22)). It only steps in when a popup is actually open, so `Esc` still cancels a cell edit as before.

### Changed
- **Tri-state "Select all" in the column chooser and the value filter** - The **Show / hide columns** menu and the per-column value filter each used to have two buttons (Show all / Hide all, Select All / Deselect All). Both are now a single tri-state **Select all** master checkbox that ticks when everything is selected, shows a dash when only some is and carries a `checked / total` count, the familiar spreadsheet control (requested in [#19](https://github.com/Robin-Reiche/csv-grid-editor/issues/19)). When you type in the search box it scopes to the matches and relabels to **Select all matches**, so the count stays honest while a search is active ([#20](https://github.com/Robin-Reiche/csv-grid-editor/pull/20), [#21](https://github.com/Robin-Reiche/csv-grid-editor/pull/21)).

Thanks to [@yukina3230](https://github.com/yukina3230) who contributed all three changes in this release.

## [1.12.0] - 2026-06-16

### Added
- **Search and Hide all in the column chooser** - The **Show / hide columns** menu now has a search box that filters the column list by name, plus a **Hide all** button next to the existing **Show all** (requested in [#18](https://github.com/Robin-Reiche/csv-grid-editor/issues/18)). On a wide file the flow becomes: Hide all, then type to find the few columns you want and check them, instead of unchecking dozens one by one.

### Changed
- **Export now leaves out hidden columns** - Exporting to JSON, JSON Lines or Markdown used to still include columns you had hidden in the column chooser. It now exports only the visible columns, which matches how copy already behaved, so the output is exactly what you see (follow-up to [#18](https://github.com/Robin-Reiche/csv-grid-editor/issues/18)).

## [1.11.1] - 2026-06-15

### Fixed
- **An open menu or dropdown now closes when you open another** - The context menus, the Export and Delimiter dropdowns, the column chooser, Go to row and the rename popover are now mutually exclusive: opening one closes any other that is still open (reported in [#15](https://github.com/Robin-Reiche/csv-grid-editor/issues/15)). A central coordinator routes every opener through a single close step. The 1.11.0 release fixed the popup positioning but not this staying-open behaviour.

## [1.11.0] - 2026-06-15

### Added
- **Column color mode** - A new toolbar toggle gives every data column its own theme-aware background tint, so wide tables are easier to scan and columns are easy to tell apart (requested in [#16](https://github.com/Robin-Reiche/csv-grid-editor/issues/16)). Each column gets a distinct hue spread by golden-angle rotation, so adjacent columns stay far apart on the color wheel even after you insert or delete one. The tint is a translucent overlay that adapts to light, dark and high-contrast themes and never fights the text, and existing highlights (range selection, find matches, duplicates and frozen rows) keep painting clearly on top. The toggle is remembered across files and sessions, like zoom.
- **Select all from the corner** - Click the top-left corner of the grid to select every cell at once, the same as a spreadsheet ([#12](https://github.com/Robin-Reiche/csv-grid-editor/pull/12)).
- **Unfreeze all** - Clear every frozen row and column in one action instead of unfreezing them one at a time ([#14](https://github.com/Robin-Reiche/csv-grid-editor/pull/14)).

### Changed
- **Menu icons use Codicons** - Context-menu and dropdown icons were emoji that rendered differently on each platform. They now use VS Code's Codicon set, so they match the rest of the editor and look the same everywhere ([#11](https://github.com/Robin-Reiche/csv-grid-editor/pull/11)).

### Fixed
- **Menus and popups behave correctly** - An open menu or dropdown stayed open when you opened another, and the context menu and rename popup could land in the wrong spot. Opening a menu now closes any other, and popups line up with the cell or header they belong to (reported in [#15](https://github.com/Robin-Reiche/csv-grid-editor/issues/15)).

## [1.10.1] - 2026-06-13

### Changed
- **Rename a column from the right-click menu only** - Removed double-click-to-rename on a column header. A single click already sorts the column, so quickly clicking to toggle the sort direction was sometimes read as a double-click and opened the rename popup by mistake (reported in [#10](https://github.com/Robin-Reiche/csv-grid-editor/issues/10)). Renaming stays available via right-click → **Rename column**.

## [1.10.0] - 2026-06-12

### Added
- **Freeze multiple rows** - You can now pin more than one row to the top at once, which makes multi-line headers (a group row plus a unit row, for example) stay readable while you scroll (requested in [#9](https://github.com/Robin-Reiche/csv-grid-editor/issues/9)). Select several rows (drag or `Shift`+click the `#` gutter) and choose **Freeze N rows**, or keep adding rows one at a time, freezing is additive and the rows stay in the order you froze them. Right-click a pinned row to **Unfreeze** just that one, or **Unfreeze all rows**. This also covers the multi-level-header use case from [#8](https://github.com/Robin-Reiche/csv-grid-editor/issues/8) without changing the CSV.
- **Freeze multiple columns at once** - `Shift`+click several column headers and choose **Freeze N columns** to pin them all in one go, the companion to multi-row freeze.

### Fixed
- **Freezes were lost during normal editing** - Frozen rows and columns are now preserved across deleting and inserting rows or columns, undo and redo, saving, and changing the delimiter, and frozen rows survive an external reload. Previously any of these could silently clear the freeze because the grid rebuild or re-parse lost track of the pinned rows and columns.

## [1.9.0] - 2026-06-12

### Added
- **Insert and delete multiple rows or columns** - Select several rows (drag or `Shift`+click the `#` gutter) or several columns (`Shift`+click the headers), then right-click to insert or delete all of them at once. Inserting adds as many rows or columns as you selected and lands them at the selection edge, the same as Excel and Google Sheets (requested in [#7](https://github.com/Robin-Reiche/csv-grid-editor/issues/7)). Single-row and single-column insert and delete still work as before when nothing is selected. Non-contiguous `Ctrl`/`Cmd` selection is intentionally out of scope for now.
- **Enter moves to the next cell** - After editing a cell, pressing `Enter` commits the change and moves the selection one row down in the same column, so you can type down a column without reaching for the mouse (requested in [#6](https://github.com/Robin-Reiche/csv-grid-editor/issues/6)).

### Fixed
- **Grid jumped to the top after deleting a row or pasting** - Deleting a row, pasting a value or inserting a row scrolled the grid back to the first row and lost your place in large files. The grid now keeps its scroll position across these edits, and undo and redo, by giving rows a stable identity so AG Grid updates them in place instead of rebuilding the whole grid (reported in [#5](https://github.com/Robin-Reiche/csv-grid-editor/issues/5)).
- **Counters and Column Profile went stale after structural edits** - The "rows × columns" and "records" counts in the toolbar and status bar did not update after deleting or inserting rows or columns, and the Column Profile panel kept showing pre-edit values. Both now refresh after every delete, insert, paste and undo, honouring any active filter.

## [1.8.0] - 2026-06-10

### Added
- **Export as JSON, JSON Lines and Markdown table** - The Export button now opens a small menu with three formats (requested in [#4](https://github.com/Robin-Reiche/csv-grid-editor/issues/4)). Every format exports the current view: filters, sort order, renamed headers and column order are all applied, and a frozen reference row is exported first. JSON exports an array of objects with the column headers as keys. Numbers and booleans come out typed, but never lossily: IDs with leading zeros, numbers too large for JSON and stray text in numeric columns stay strings, and empty cells in typed columns become `null`. JSON Lines writes one compact object per line for streaming tools. Markdown writes a GitHub-flavored table with right-aligned numeric columns, ready to paste into a README or issue.

### Removed
- **Export as CSV** - Removed because saving the file already writes CSV. The export menu now focuses on converting to other formats.

## [1.7.3] - 2026-06-09

### Changed
- **Marketplace listing and discoverability** - Expanded the search keywords and switched the second category to Data Science, rewrote the displayName and description to lead with what the extension does, and added homepage, bugs, Q&A, gallery banner and pricing metadata. No functional changes to the editor.
- **README** - Reworked for clarity and search with a keyword-first intro, a Contents list, Why / Who it is for / Quick start sections, an honest How it compares table, an FAQ, two short demo GIFs and clearer image alt text.

## [1.7.2] - 2026-06-08

### Fixed
- **README badges** - The Version / Installs / Rating badges were broken because their provider is not on the Marketplace's allowed badge-host list (and shields.io has retired its Marketplace badges). Switched to `badgen.net`, which is allow-listed and serves live data.

## [1.7.1] - 2026-06-08

### Added
- **Sponsor / support links** - A **Sponsor** button (GitHub Sponsors) now appears on the extension page, and the README has a Support section linking GitHub Sponsors and Ko-fi for anyone who would like to support development. Entirely optional.

## [1.7.0] - 2026-06-08

### Added
- **Rename columns** - Double-click a column header, or right-click it → **Rename column**, to rename it. The new name is written to the CSV header row and is fully undoable; column widths, sort and freeze state are preserved.
- **Show / hide columns** - A new toolbar button opens a column chooser: a checklist of every column with checkboxes to hide or show individual columns, plus **Show all** to reset. Hidden columns persist across paged-view page changes. Export still includes all columns.

## [1.6.1] - 2026-06-08

### Added
- **Freeze row** - Right-click any row and choose **Freeze row** to pin it to the top of the grid as an always-visible reference while you scroll, sort and filter the rest of the data; right-click the pinned row and choose **Unfreeze row** to release it. One row can be frozen at a time. Like Freeze column it is a view aid (also available in read-only previews) and is not persisted across reload. A 📌 marker on the pinned row's `#` cell shows its original row number, so it never reads as a duplicate of the body row that renumbers into its place. A frozen row stays visible regardless of any active column filter, and the feature is mutually exclusive with the duplicate-rows view.
- **Freeze markers** - Frozen columns now show a 📌 marker before the column name, matching the frozen-row marker, so pinned columns and rows are easy to spot at a glance.

## [1.5.5] - 2026-06-03

### Fixed
- **Cell edits landed on the wrong row under an active sort or filter** - Editing a cell while the grid was filtered and/or sorted wrote the new value to the wrong row in the underlying CSV (the row at the same *display* position in the unfiltered/unsorted data), corrupting data silently. The edit handler now maps the edited row back to its source position via `_origIndex` instead of the display row index. The default unsorted/unfiltered view was unaffected.
- **Find & Replace had the same wrong-row bug** - Replace / Replace All wrote substitutions to the wrong rows whenever a sort or filter was active. Matches now capture the row's `_origIndex` at search time so replacements always hit the correct row.
- Added regression tests for both index-mapping paths (`test/`).

## [1.5.4] - 2026-05-27

### Fixed
- **Large-file picker cancellation** - Dismissing the "How would you like to open this file?" picker for large CSVs left the editor tab in a broken state and surfaced a `Canceled: Canceled` entry in the Output log; clicking the file again would surface the cached error instead of re-showing the picker. `openCustomDocument` now returns a sentinel "cancelled" document instead of throwing `CancellationError`, and the matching tab is closed via the `tabGroups` API on the next microtask. `resolveCustomEditor` returns early for the sentinel without touching the webview, avoiding the `OverlayWebview has been disposed` race that an immediate panel-dispose would otherwise trigger. The picker also no longer dismisses on accidental focus loss (use `Esc` to cancel explicitly).

## [1.5.0] - 2026-05-16

### Added
- **Inline range selection** - Excel-style cell selection directly in the grid. Click and drag to select a rectangular range, drag the row-number (`#`) column to select whole rows, or right-click a column header → **Select column**. `Shift`+click and `Shift`+arrow keys extend the selection; `Ctrl+A` selects everything. `Ctrl+C` copies the selection as tab-separated values; right-click → **Copy with header** to include column headers. `Delete` / `Backspace` clears the selected cells. The status bar shows the selection size plus live Count / Sum / Avg / Min / Max.
- **Paste** - paste tab- or comma-separated clipboard data straight into the grid, starting at the focused cell. Integrates with the undo stack.
- **AND / OR filter conditions** - each condition in a column filter can now be joined with AND *or* OR (previously AND-only). Click the operator pill between two conditions to toggle it; AND binds tighter than OR.

### Changed
- **Unified iconography** - every icon (column headers, toolbar, profile panel, banners) now comes from a single VS Code Codicon family, replacing the previous mix of hand-drawn SVG, Unicode glyphs and emoji. Header sort and filter glyphs are sized and centred consistently.
- A column's filter funnel now fills solid white while a filter is active on that column, making filtered columns easy to spot.

### Removed
- The standalone **Select & Copy** mode (a separate read-only view), superseded by the inline range selection above.

## [1.3.4] - 2026-05-05

### Fixed
- **Critical:** Webview CSS and codicon font were missing from the published package because `media/` was gitignored in its entirety. The CI build only generated `media/webview.js` via esbuild, so the static stylesheet and codicon assets were never produced, leaving the grid unstyled in the Marketplace install. `media/webview.css` is now tracked, and a new `copy-codicons` build step copies `codicon.css` / `codicon.ttf` from `node_modules/@vscode/codicons` on every compile.

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
- **Go to Row** - New toolbar button (and `Ctrl+G` / `Cmd+G` shortcut) opens a popover where you can type any row number and jump directly to it. The target row briefly flashes blue to confirm navigation. Disabled in Paged View.
- **Duplicate Row Detection** - New toolbar button scans every row and highlights duplicates with an amber tint. A banner reports the number of duplicate rows and how many groups they form.
  - **Show only duplicates** - Filters the grid to duplicates only, sorts matching rows next to each other, and switches the `#` column to show the original CSV line number of each row so you can locate them in the source file.
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
