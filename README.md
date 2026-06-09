# CSV Grid Editor

[![Version](https://badgen.net/vs-marketplace/v/RobinReiche.csv-grid-editor)](https://marketplace.visualstudio.com/items?itemName=RobinReiche.csv-grid-editor)
[![Installs](https://badgen.net/vs-marketplace/i/RobinReiche.csv-grid-editor)](https://marketplace.visualstudio.com/items?itemName=RobinReiche.csv-grid-editor)
[![Rating](https://badgen.net/vs-marketplace/rating/RobinReiche.csv-grid-editor)](https://marketplace.visualstudio.com/items?itemName=RobinReiche.csv-grid-editor&ssr=false#review-details)

A fast, feature-rich CSV/TSV editor for Visual Studio Code. Opens CSV files in a sortable, filterable, editable grid — right inside your editor, no external tools needed.

![CSV Grid Editor: open, view and edit CSV and TSV files in a grid inside VS Code](https://raw.githubusercontent.com/Robin-Reiche/csv-grid-editor/master/images/social-preview.png)

![CSV Grid Editor in action: opening a CSV as a grid and exploring it with the column profile panel](https://raw.githubusercontent.com/Robin-Reiche/csv-grid-editor/master/images/demo.gif)

---

## Contents

- [Why CSV Grid Editor](#why-csv-grid-editor)
- [Who it is for](#who-it-is-for)
- [Quick start](#quick-start)
- [Features](#features)
- [How it compares](#how-it-compares)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [FAQ](#faq)

---

## Why CSV Grid Editor

- Read messy CSVs without counting commas, every column lines up in a real grid
- Edit and save right in VS Code, no need to launch Excel or a separate app
- Copy any range straight into Excel or Google Sheets as tab-separated values
- Understand a column at a glance with built-in stats like median, null percent and distinct counts
- Stay fast on big files with head, tail and paged views for 50 MB and beyond

## Who it is for

- Data analysts eyeballing exports and query results
- Developers editing fixtures, seed data and test CSVs
- Anyone who opens a CSV and does not want to launch a spreadsheet app

## Quick start

1. Install **CSV Grid Editor** from the Marketplace
2. Open any `.csv` or `.tsv` file, it opens as a grid automatically
3. Double-click a cell to edit, then save with `Ctrl+S`

For files larger than 10 MB you get a quick menu to open the full file, preview the head or tail, browse in pages or open as plain text.

---

## Features

![CSV file shown as an editable grid in Visual Studio Code with column type badges and sort and filter controls](https://raw.githubusercontent.com/Robin-Reiche/csv-grid-editor/master/images/grid-view.png)

### Grid & Display
- **Interactive Grid** - Powered by AG Grid with alternating row colors and grid lines
- **Column Type Detection** - Each column header shows a type badge (Integer, Float, Text, Boolean, Date, DateTime, Time) inferred from the column's values. The type updates automatically whenever the data changes, whether from cell edits, find and replace or undo and redo.
- **Sort & Filter** - Click any column header to sort. Use the filter icon to search within a column. Active filters show in the toolbar with a one-click clear button.
- **Auto-Fit Columns** - Fit all columns to their content with one click. Double-click a resize handle to auto-fit a single column.
- **Column Resize** - Drag column borders to adjust width manually
- **Zoom** - Scale the whole grid from 60% to 200% with the toolbar buttons or keyboard shortcuts. The zoom level shows in the toolbar.
- **Theme Integration** - Automatically adapts to your VS Code color theme (dark or light)

![CSV Grid Editor toolbar with auto-fit, zoom, find and replace, export and column profile buttons](https://raw.githubusercontent.com/Robin-Reiche/csv-grid-editor/master/images/toolbar.png)

### Editing
- **Inline Editing** - Double-click any cell to edit its value inline. Changes are tracked and saved back to the file.
- **Undo / Redo** - Full multi-step undo and redo stack (`Ctrl+Z` / `Ctrl+Y`)
- **Save / Save As** - Uses VS Code's native save mechanism and supports Save As to a new location

### Find & Replace
- **Find & Replace bar** (`Ctrl+F` / `Ctrl+H` / toolbar icon) - Always shows find and replace together in one bar
- **Search** - Matches are highlighted across all visible cells. A counter shows the current position (for example `3 / 47`).
- **Case-Sensitive Toggle** - Enable exact case matching with the `Aa` button
- **Navigation** - Jump between matches with the toolbar buttons, `Enter` (next) or `Shift+Enter` (previous)
- **Replace** - Replace the current match or all matches at once. Only the matched substring is replaced, leaving the rest of the cell value intact, and it integrates with the undo stack.

### Copy & Export
- **Cell Copy** - Click a cell to focus it, then `Ctrl+C` copies its full value to the clipboard
- **Range Selection** - Excel-style selection directly in the grid:
  - Click and drag to select a rectangular cell range
  - Click and drag the row-number (`#`) column to select whole rows
  - Right-click a column header → **Select column** to select a whole column
  - `Shift+click` and `Shift`+arrow keys extend the selection, `Ctrl+A` selects everything
  - `Ctrl+C` copies the selection as tab-separated values (TSV) that paste straight into Excel or Google Sheets
  - Right-click → **Copy with header** to include the column headers in the copy
  - `Delete` / `Backspace` clears every cell in the selection
  - The status bar shows the selection size plus live `Count / Sum / Avg / Min / Max`
- **Export CSV** - Export the current filtered and sorted view as a CSV file via the native VS Code save dialog

### Delimiter
- **Auto-Detection** - Automatically detects commas, semicolons and tabs on open. `.tsv` files always use tab.
- **Manual Override** - Click the delimiter badge in the toolbar to change the delimiter on the fly (comma `,`, semicolon `;`, tab, pipe `|`). The grid re-parses the file immediately.

### Column Freeze
- **Freeze / Unfreeze** - Right-click any column header to pin it to the left side of the grid, right-click again to unfreeze. Frozen columns show a 📌 marker before the column name.

### Row Freeze
- **Freeze / Unfreeze** - Right-click any row and choose **Freeze row** to pin it to the top of the grid as an always-visible reference while you scroll, sort and filter. Right-click the pinned row to unfreeze. One row can be frozen at a time. A 📌 marker on the pinned row shows its original row number, and the row stays visible regardless of any active filter.

### Rename Columns
- **Rename** - Double-click a column header (or right-click it → **Rename column**) to rename it. The new name is written to the CSV header row and is fully undoable.

### Show / Hide Columns
- **Column chooser** - Click the checklist icon in the toolbar to open a list of all columns with checkboxes. Uncheck a column to hide it, re-check to show it, or **Show all** to reset. A view aid, hidden columns are still included on export.

### Sort & Filter

![Browsing and sorting a CSV file in the CSV Grid Editor grid](https://raw.githubusercontent.com/Robin-Reiche/csv-grid-editor/master/images/demo-2.gif)

![Per-column filter panel open in CSV Grid Editor with active filters shown in the toolbar](https://raw.githubusercontent.com/Robin-Reiche/csv-grid-editor/master/images/filter-view.png)

Click any column header to sort ascending or descending. Use the filter icon in the column header to open a per-column filter panel. Active filters are shown in the toolbar, click the **Filters** badge to clear them all at once.

### Column Profile
- Click the graph icon in the toolbar to open the **Column Profile** panel
- Shows an **overview table** across all columns: type, fill rate, null %, distinct value count and min/max summary
- Click any row in the overview table to jump to its detail card
- Each column gets a **detail card** with statistics based on its detected type:
  - **Integer / Float** - min, max, mean, median, standard deviation, unique count
  - **String** - min, max and average length, top 5 most frequent values with frequency bars
  - **Boolean** - true/false count and percentage, with a visual bar chart
  - **Date / DateTime** - earliest date, latest date, range in days
  - All types show total rows, unique count, null count and fill %
- **Dockable** - Dock the panel to the right (default), left or bottom of the grid
- **Resizable** - Drag the panel border to adjust its size
- **Zoom-aware** - Panel text and spacing scale with the grid's zoom level (60 to 200%)
- **Live Updates** - The panel re-renders automatically when column types change due to data edits

![Column Profile panel showing min, max, mean, median, null percent and distinct counts for a CSV column](https://raw.githubusercontent.com/Robin-Reiche/csv-grid-editor/master/images/column-profile.png)

### Theme Integration

The extension automatically adapts to your VS Code color theme, no configuration required.

| Dark Theme | Light Theme |
|:---:|:---:|
| ![CSV Grid Editor showing a CSV file in a dark VS Code theme](https://raw.githubusercontent.com/Robin-Reiche/csv-grid-editor/master/images/grid-view.png) | ![CSV Grid Editor showing a CSV file in a light VS Code theme](https://raw.githubusercontent.com/Robin-Reiche/csv-grid-editor/master/images/theme-light.png) |

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
- **Paged View** - A pagination bar (first / previous / next / last) lets you navigate pages efficiently without loading the entire file into memory. Editing is disabled in this mode.
- **Plain Text View** - Displays the raw file content in a monospace editor-style view without any grid features

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
| `Ctrl+C` | Copy focused cell or selected range (TSV) |
| `Ctrl+A` | Select all cells |
| `Shift`+arrows | Extend the selection |
| `Delete` / `Backspace` | Clear the selected cells |
| `Ctrl++` / `Ctrl+=` | Zoom in |
| `Ctrl+-` | Zoom out |
| `Ctrl+F` / `Ctrl+H` | Open Find & Replace bar |
| `Enter` | Next match *(in Find bar)* |
| `Shift+Enter` | Previous match *(in Find bar)* |
| `Esc` | Close Find bar |

> On macOS, `Ctrl` is replaced by `⌘`.

---

## How it compares

A quick honest look at the common ways people open CSV files in VS Code.

| Capability | Plain text view | Rainbow CSV | Edit csv | CSV Grid Editor |
|---|:---:|:---:|:---:|:---:|
| Opens as an interactive grid | no | no | yes | yes |
| Edit cells inline and save back | no | no | yes | yes |
| Sort and filter from the column header | no | query only | sort only | yes |
| Column profiling (median, null %, distinct) | no | no | basic stats | yes |
| Freeze rows and columns | no | header only | yes | yes |
| Large files (head, tail, paged 50 MB+) | raw text | workaround | no | yes |
| Excel-style range copy as TSV | no | no | not documented | yes |

> Checked June 2026 from each extension's Marketplace page, README and changelog. Rainbow CSV and Edit csv are both excellent tools, this table just shows where CSV Grid Editor puts its focus.

---

## FAQ

### How do I open a CSV file in VS Code?
Install CSV Grid Editor and open any `.csv` or `.tsv` file. It opens straight into the grid, no command or setup needed. If another editor is set as the default, right-click the file and choose **Open With** then **CSV Grid Editor**.

### How do I edit a CSV file in VS Code without Excel?
Double-click any cell to edit it inline, then save with `Ctrl+S`. Changes are written back to the file and you can undo with `Ctrl+Z`. You never have to leave the editor or open a spreadsheet app.

### Can I copy and paste between this grid and Excel or Google Sheets?
Yes. Select a range with click and drag, press `Ctrl+C`, and the cells are copied as tab-separated values that paste cleanly into Excel or Google Sheets. Right-click then **Copy with header** to include the column names.

### Does it work with semicolon, tab or pipe delimited files?
Yes. The delimiter is auto-detected on open (comma, semicolon, tab), and `.tsv` files always use tab. You can also switch the delimiter by hand from the toolbar to comma, semicolon, tab or pipe.

### Will it handle large CSV files?
Yes. Files over 10 MB show a quick menu to open the full file, preview just the head or tail, browse in pages or open as plain text. Paged view lets you move through very large files without loading everything into memory.

---

## ❤️ Support This Project

If CSV Grid Editor saves you time, you can support its continued development, completely optional and always appreciated:

[![Sponsor on GitHub](https://img.shields.io/badge/Sponsor-GitHub-EA4AAA?style=for-the-badge&logo=githubsponsors&logoColor=white)](https://github.com/sponsors/Robin-Reiche)
[![Ko-fi](https://img.shields.io/badge/Buy%20me%20a%20coffee-Ko--fi-FF5E5B?style=for-the-badge&logo=ko-fi&logoColor=white)](https://ko-fi.com/robinreiche)

---

## Contact

**Robin Reiche**

[![LinkedIn](https://img.shields.io/badge/LinkedIn-0A66C2?style=for-the-badge&logo=linkedin&logoColor=white)](https://www.linkedin.com/in/robin-reiche/)
[![Email](https://img.shields.io/badge/Email-EA4335?style=for-the-badge&logo=gmail&logoColor=white)](mailto:robin.reiche.dev@gmail.com)

---

## License

[MIT](LICENSE)
