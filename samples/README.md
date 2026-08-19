# Sample data

Small, synthetic CSV files for trying out the extension and reproducing
issues. None of this is real data. Open any file with **CSV Grid Editor** to
see the feature it is built around.

| File | Rows | What it shows |
|------|------|---------------|
| `sample-300-rows.csv` | 300 | A plain, flat table. Good first look: sorting, filtering, column stats and pagination. |
| `simulation_timeseries.csv` | 240 | Three header rows (group, signal, unit). Freeze multiple rows so the header context stays visible while you scroll down. |
| `sales_panel_wide.csv` | 96 | Two header rows over a wide layout, plus three identifier columns. Freeze rows and columns together so you never lose which row or quarter you are on. |
| `multiline.csv` | 5 | Cells with line breaks inside them, both LF and CRLF, one of them next to a comma and a quote. Toggle **Wrap cell text** in the toolbar, and edit a cell with Alt+Enter. |

The multi-row and multi-column freeze cases come from issue #9, the multi-line
cells from issue #29.
