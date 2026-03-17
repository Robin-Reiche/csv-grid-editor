import * as vscode from 'vscode';

export function getWebviewContent(
    webview: vscode.Webview,
    extensionUri: vscode.Uri,
    csvText: string,
    delimiter: string
): string {
    const nonce = getNonce();

    // Escape for embedding in JS string
    const escapedCsv = csvText
        .replace(/\\/g, '\\\\')
        .replace(/`/g, '\\`')
        .replace(/\$/g, '\\$');

    const escapedDelimiter = delimiter
        .replace(/\\/g, '\\\\')
        .replace(/\t/, '\\t');

    return /*html*/ `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>CSV Viewer</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }

        body {
            font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, sans-serif);
            background: var(--vscode-editor-background, #1e1e1e);
            color: var(--vscode-editor-foreground, #d4d4d4);
            overflow: hidden;
            height: 100vh;
            display: flex;
            flex-direction: column;
        }

        .toolbar {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 6px 12px;
            background: var(--vscode-editorGroupHeader-tabsBackground, #252526);
            border-bottom: 1px solid var(--vscode-panel-border, #2d2d2d);
            font-size: 12px;
            flex-shrink: 0;
        }

        .toolbar input {
            padding: 3px 8px;
            border: 1px solid var(--vscode-input-border, #3c3c3c);
            background: var(--vscode-input-background, #3c3c3c);
            color: var(--vscode-input-foreground, #d4d4d4);
            border-radius: 3px;
            font-size: 12px;
            outline: none;
            width: 220px;
        }

        .toolbar input:focus {
            border-color: var(--vscode-focusBorder, #007fd4);
        }

        .info {
            margin-left: auto;
            opacity: 0.7;
        }

        #grid-container {
            flex: 1;
            overflow: hidden;
        }

        /* AG Grid theme overrides for VS Code */
        .ag-theme-alpine-dark {
            --ag-background-color: var(--vscode-editor-background, #1e1e1e);
            --ag-header-background-color: var(--vscode-editorGroupHeader-tabsBackground, #252526);
            --ag-odd-row-background-color: transparent;
            --ag-row-hover-color: var(--vscode-list-hoverBackground, #2a2d2e);
            --ag-selected-row-background-color: var(--vscode-list-activeSelectionBackground, #094771);
            --ag-foreground-color: var(--vscode-editor-foreground, #d4d4d4);
            --ag-header-foreground-color: var(--vscode-editor-foreground, #d4d4d4);
            --ag-border-color: var(--vscode-panel-border, #2d2d2d);
            --ag-font-family: var(--vscode-editor-font-family, monospace);
            --ag-font-size: 13px;
        }

        .ag-theme-alpine-auto {
            --ag-font-family: var(--vscode-editor-font-family, monospace);
            --ag-font-size: 13px;
        }
    </style>
</head>
<body>
    <div class="toolbar">
        <input type="text" id="search" placeholder="Search..." />
        <span class="info" id="info"></span>
    </div>
    <div id="grid-container"></div>

    <!-- AG Grid Community from CDN -->
    <script src="https://cdn.jsdelivr.net/npm/ag-grid-community@33.1.1/dist/ag-grid-community.min.js"></script>

    <script nonce="${nonce}">
        // Simple CSV parser (handles quoted fields, newlines in quotes)
        function parseCsv(text, delimiter) {
            const rows = [];
            let row = [];
            let field = '';
            let inQuotes = false;
            let i = 0;

            while (i < text.length) {
                const ch = text[i];

                if (inQuotes) {
                    if (ch === '"') {
                        if (i + 1 < text.length && text[i + 1] === '"') {
                            field += '"';
                            i += 2;
                        } else {
                            inQuotes = false;
                            i++;
                        }
                    } else {
                        field += ch;
                        i++;
                    }
                } else {
                    if (ch === '"') {
                        inQuotes = true;
                        i++;
                    } else if (ch === delimiter) {
                        row.push(field.trim());
                        field = '';
                        i++;
                    } else if (ch === '\\r' && i + 1 < text.length && text[i + 1] === '\\n') {
                        row.push(field.trim());
                        if (row.some(f => f !== '')) rows.push(row);
                        row = [];
                        field = '';
                        i += 2;
                    } else if (ch === '\\n') {
                        row.push(field.trim());
                        if (row.some(f => f !== '')) rows.push(row);
                        row = [];
                        field = '';
                        i++;
                    } else {
                        field += ch;
                        i++;
                    }
                }
            }

            // Last field/row
            if (field || row.length > 0) {
                row.push(field.trim());
                if (row.some(f => f !== '')) rows.push(row);
            }

            return rows;
        }

        function buildGrid(csvText, delimiter) {
            const rows = parseCsv(csvText, delimiter);
            if (rows.length === 0) return;

            const headers = rows[0];
            const data = rows.slice(1);

            const columnDefs = headers.map((h, i) => ({
                field: 'col_' + i,
                headerName: h || ('Column ' + (i + 1)),
                sortable: true,
                filter: true,
                resizable: true,
                minWidth: 80,
            }));

            const rowData = data.map(row => {
                const obj = {};
                headers.forEach((_, i) => {
                    obj['col_' + i] = row[i] || '';
                });
                return obj;
            });

            // Detect theme
            const isDark = document.body.classList.contains('vscode-dark') ||
                           document.body.classList.contains('vscode-high-contrast') ||
                           getComputedStyle(document.body).getPropertyValue('--vscode-editor-background').trim().match(/^#[0-3]/);

            const gridContainer = document.getElementById('grid-container');
            gridContainer.innerHTML = '';
            gridContainer.className = isDark ? 'ag-theme-alpine-dark' : 'ag-theme-alpine-auto';
            gridContainer.style.height = (window.innerHeight - gridContainer.getBoundingClientRect().top) + 'px';

            const gridOptions = {
                columnDefs,
                rowData,
                defaultColDef: {
                    flex: 1,
                    minWidth: 100,
                },
                animateRows: false,
                rowSelection: 'multiple',
                enableCellTextSelection: true,
            };

            const api = agGrid.createGrid(gridContainer, gridOptions);

            // Search
            document.getElementById('search').addEventListener('input', (e) => {
                api.setGridOption('quickFilterText', e.target.value);
            });

            // Info
            document.getElementById('info').textContent =
                data.length + ' rows × ' + headers.length + ' columns';

            // Resize
            window.addEventListener('resize', () => {
                gridContainer.style.height = (window.innerHeight - gridContainer.getBoundingClientRect().top) + 'px';
            });

            return api;
        }

        // Initial render
        let gridApi = buildGrid(\`${escapedCsv}\`, "${escapedDelimiter}");

        // Handle updates from extension
        window.addEventListener('message', (event) => {
            const msg = event.data;
            if (msg.type === 'update') {
                gridApi = buildGrid(msg.text, msg.delimiter);
            }
        });
    </script>
</body>
</html>`;
}

function getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
