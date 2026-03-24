# CSV Grid Editor

A fast, lightweight CSV/TSV editor for Visual Studio Code. Opens CSV files in a sortable, filterable grid — similar to Excel — right inside your editor.

![Grid View](https://raw.githubusercontent.com/Robin-Reiche/csv-grid-editor/master/images/grid-view.png)

## Features

- **Grid View** — Interactive grid with alternating row colors, horizontal and vertical grid lines
- **Auto-Fit Columns** — One click to fit all columns to their content (headers and values are never truncated)
- **Zoom** — Scale the entire grid from 60% to 200% with toolbar buttons or `Ctrl++` / `Ctrl+-`
- **Sort & Filter** — Click column headers to sort, use the filter icon to search within columns
- **Inline Editing** — Double-click any cell to edit, changes are saved back to the file
- **Undo / Redo** — Full undo/redo support (`Ctrl+Z` / `Ctrl+Y`)
- **Delimiter Detection** — Automatically detects commas, semicolons, and tabs
- **Column Resize** — Drag column borders or double-click the resize handle to auto-fit a single column
- **Theme Integration** — Adapts to your VS Code color theme

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

## Contact

**Robin Reiche**

[![LinkedIn](https://img.shields.io/badge/LinkedIn-0A66C2?style=for-the-badge&logo=linkedin&logoColor=white)](https://www.linkedin.com/in/robin-reiche/)
[![Email](https://img.shields.io/badge/Email-EA4335?style=for-the-badge&logo=gmail&logoColor=white)](mailto:robin.reiche.dev@gmail.com)

## License

[MIT](LICENSE)
