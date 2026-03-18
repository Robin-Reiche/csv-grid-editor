# CSV Viewer

A fast, lightweight CSV/TSV viewer for Visual Studio Code. Opens CSV files in a sortable, filterable grid — similar to Excel — right inside your editor.

## Features

- **Grid View** — CSV data displayed in an interactive AG Grid table
- **Auto-Fit Columns** — One click to fit all columns to their content width
- **Zoom** — Scale the grid from 60% to 200% with `+` / `-` buttons or `Ctrl++` / `Ctrl+-`
- **Sort & Filter** — Click column headers to sort, use the filter icon to search within columns
- **Inline Editing** — Double-click any cell to edit, changes are saved back to the CSV file
- **Undo / Redo** — Full undo/redo support with `Ctrl+Z` / `Ctrl+Y`
- **Delimiter Detection** — Automatically detects commas, semicolons, and tabs
- **TSV Support** — `.tsv` files are recognized automatically
- **Theme Integration** — Adapts to your VS Code color theme (dark themes)
- **Column Resize** — Drag column borders or double-click to auto-fit a single column

## Supported File Types

| Extension | Delimiter |
|-----------|-----------|
| `.csv`    | Auto-detected (`,` `;` `\t`) |
| `.tsv`    | Tab |

## Usage

1. Open any `.csv` or `.tsv` file in VS Code
2. The file opens automatically in the grid viewer
3. Use the toolbar buttons for auto-fit, zoom, undo/redo

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Z` | Undo |
| `Ctrl+Y` | Redo |
| `Ctrl++` | Zoom in |
| `Ctrl+-` | Zoom out |

## License

[MIT](LICENSE)
