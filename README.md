# CSV Grid Editor

[![Version](https://vsmarketplacebadges.dev/version-short/RobinReiche.csv-grid-editor.svg?style=for-the-badge&label=Marketplace&color=007ACC)](https://marketplace.visualstudio.com/items?itemName=RobinReiche.csv-grid-editor)
[![Installs](https://vsmarketplacebadges.dev/installs-short/RobinReiche.csv-grid-editor.svg?style=for-the-badge&label=Installs&color=4EC9B0)](https://marketplace.visualstudio.com/items?itemName=RobinReiche.csv-grid-editor)
[![Rating](https://vsmarketplacebadges.dev/rating-short/RobinReiche.csv-grid-editor.svg?style=for-the-badge&label=Rating&color=E5BC4B)](https://marketplace.visualstudio.com/items?itemName=RobinReiche.csv-grid-editor&ssr=false#review-details)

A fast, feature-rich CSV/TSV editor for Visual Studio Code. Opens CSV files in a sortable, filterable, editable grid — right inside your editor, no external tools needed.

![Grid View](https://raw.githubusercontent.com/Robin-Reiche/csv-grid-editor/master/images/grid-view.png)

---

## Features

### Grid & Display
- **Interactive Grid** — Powered by AG Grid with alternating row colors and grid lines
- **Column Type Detection** — Each column header shows a type badge (Integer, Float, Text, Boolean, Date, DateTime, Time) inferred from the column's values; the type updates automatically whenever data is changed (cell edits, find & replace, undo/redo)
- **Sort & Filter** — Click any column header to sort; use the filter icon to search within columns; active filters shown in toolbar with a one-click clear button
- **Auto-Fit Columns** — Fit all columns to their content with one click; double-click a resize handle to auto-fit a single column
- **Column Resize** — Drag column borders to adjust width manually
- **Zoom** — Scale the entire grid from 60% to 200% using the toolbar buttons or keyboard shortcuts; zoom level shown in toolbar
- **Theme Integration** — Automatically adapts to your VS Code color theme (dark/light)

![Toolbar](https://raw.githubusercontent.com/Robin-Reiche/csv-grid-editor/master/images/toolbar.png)

### Editing
- **Inline Editing** — Double-click any cell to edit its value inline; changes are tracked and saved back to the file
- **Undo / Redo** — Full multi-step undo/redo stack (`Ctrl+Z` / `Ctrl+Y`)
- **Save / Save As** — Uses VS Code's native save mechanism; supports Save As to a new location

### Find & Replace
- **Find & Replace bar** (`Ctrl+F` / `Ctrl+H` / toolbar icon) — Always shows find and replace together in one bar
- **Search** — Matches are highlighted across all visible cells; a counter shows the current position (e.g. `3 / 47`)
- **Case-Sensitive Toggle** — Enable exact case matching with the `Aa` button
- **Navigation** — Jump between matches with toolbar buttons, `Enter` (next), or `Shift+Enter` (previous)
- **Replace** — Replace the current match or all matches at once; only the matched substring is replaced, leaving the rest of the cell value intact; integrates with the undo stack

### Copy & Export
- **Cell Copy** — Click a cell to focus it, then `Ctrl+C` copies its full value to the clipboard
- **Row Copy** — Click a row number in the index column to select the entire row; a blue highlight spans all visible columns so you can track it while scrolling horizontally. `Ctrl+C` or right-click → Copy copies all values as tab-separated values (TSV). Click the same row number again to deselect.
- **Select & Copy Mode** — Click the selection icon in the toolbar to enter a dedicated selection view:
  - All visible rows are displayed — no row count limit
  - Mirrors the active filter, sort order, column visibility, and column order from the grid
  - Select entire columns, entire rows, or a rectangular cell range
  - `Shift+click` to extend selection; `Ctrl+A` to select all
  - Copy as TSV with one click — pastes directly into Excel or Google Sheets
  - Toggle whether column headers are included in the copy
  - Copy only the header row with the separate **Copy headers** button
- **Export CSV** — Export the current filtered/sorted view as a CSV file via the native VS Code save dialog

![Select & Copy Mode](https://raw.githubusercontent.com/Robin-Reiche/csv-grid-editor/master/images/select-copy-mode.png)

### Delimiter
- **Auto-Detection** — Automatically detects commas, semicolons, and tabs on open; `.tsv` files always use tab
- **Manual Override** — Click the delimiter badge in the toolbar to change the delimiter on the fly (comma `,`, semicolon `;`, tab, pipe `|`); the grid re-parses the file immediately

### Column Freeze
- **Freeze / Unfreeze** — Right-click any column header to pin it to the left side of the grid; right-click again to unfreeze

### Sort & Filter

![Filter View](https://raw.githubusercontent.com/Robin-Reiche/csv-grid-editor/master/images/filter-view.png)

Click any column header to sort ascending/descending. Use the filter icon in the column header to open a per-column filter panel. Active filters are shown in the toolbar — click the **Filters** badge to clear them all at once.

### Column Profile
- Click the graph icon in the toolbar to open the **Column Profile** panel
- Shows an **overview table** across all columns: type, fill rate, null %, distinct value count, and min/max summary
- Click any row in the overview table to jump to its detail card
- Each column gets a **detail card** with statistics based on its detected type:
  - **Integer / Float** — min, max, mean, median, standard deviation, unique count
  - **String** — min / max / average length, top 5 most frequent values with frequency bars
  - **Boolean** — true/false count and percentage, with a visual bar chart
  - **Date / DateTime** — earliest date, latest date, range in days
  - All types show: total rows, unique count, null count, fill %
- **Dockable** — Dock the panel to the right (default), left, or bottom of the grid
- **Resizable** — Drag the panel border to adjust its size
- **Zoom-aware** — Panel text and spacing scale proportionally with the grid's zoom level (60–200%)
- **Live Updates** — The panel re-renders automatically when column types change due to data edits

![Column Profile](https://raw.githubusercontent.com/Robin-Reiche/csv-grid-editor/master/images/column-profile.png)

### Theme Integration

The extension automatically adapts to your VS Code color theme — no configuration required.

| Dark Theme | Light Theme |
|:---:|:---:|
| ![Dark Theme](https://raw.githubusercontent.com/Robin-Reiche/csv-grid-editor/master/images/grid-view.png) | ![Light Theme](https://raw.githubusercontent.com/Robin-Reiche/csv-grid-editor/master/images/theme-light.png) |

### Large File Support
Opening a file larger than **10 MB** shows a Quick Pick with these options:

| Option | Description |
|--------|-------------|
| Open Full File | Load all data into the grid (may be slow for very large files) |
| Show Head | Preview the first 1,000 rows |
| Show Tail | Preview the last 1,000 rows |
| Open as Plain Text | Fast read-only raw text view |
| Paged View | Browse in 500-row pages *(only shown for files > 50 MB)* |

- **Head / Tail previews** show a banner with the total row count and how many rows are displayed
- **Paged View** — A pagination bar (first / previous / next / last) lets you navigate pages efficiently without loading the entire file into memory; editing is disabled in this mode
- **Plain Text View** — Displays the raw file content in a monospace editor-style view without any grid features

### Auto-Reload
When a file is open in full (non-preview) mode, the editor watches the file on disk and **automatically reloads** the grid when the file is modified externally.

---

## Supported File Types

| Extension | Default Delimiter |
|-----------|-------------------|
| `.csv` | Auto-detected (`,` `;` `\t`) |
| `.tsv` | Tab |

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Z` | Undo |
| `Ctrl+Y` | Redo |
| `Ctrl+Shift+Z` | Redo (alternative) |
| `Ctrl+C` | Copy focused cell value or selected row |
| `Ctrl+A` | Select all *(in Select & Copy Mode)* |
| `Ctrl++` / `Ctrl+=` | Zoom in |
| `Ctrl+-` | Zoom out |
| `Ctrl+F` / `Ctrl+H` | Open Find & Replace bar |
| `Enter` | Next match *(in Find bar)* |
| `Shift+Enter` | Previous match *(in Find bar)* |
| `Esc` | Close Find bar |

> On macOS, `Ctrl` is replaced by `⌘`.

---

## Usage

1. Open any `.csv` or `.tsv` file in VS Code — the grid opens automatically
2. For files larger than 10 MB, choose how you want to open the file from the Quick Pick
3. Use the toolbar for auto-fit, zoom, find, export, column profile, and select mode
4. Double-click any cell to edit; use `Ctrl+Z` to undo
5. Save with the standard VS Code save command (`Ctrl+S`)

---

## Contact

**Robin Reiche**

[![LinkedIn](https://img.shields.io/badge/LinkedIn-0A66C2?style=for-the-badge&logo=linkedin&logoColor=white)](https://www.linkedin.com/in/robin-reiche/)
[![Email](https://img.shields.io/badge/Email-EA4335?style=for-the-badge&logo=gmail&logoColor=white)](mailto:robin.reiche.dev@gmail.com)

---

## License

[MIT](LICENSE)
