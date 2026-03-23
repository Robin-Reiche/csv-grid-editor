import * as vscode from 'vscode';

export function getWebviewContent(
    _webview: vscode.Webview,
    _extensionUri: vscode.Uri,
    csvText: string,
    delimiter: string
): string {
    const nonce = getNonce();

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
            font-family: var(--vscode-font-family, "Segoe UI", sans-serif);
            background: var(--vscode-editor-background, #1e1e1e);
            color: var(--vscode-editor-foreground, #d4d4d4);
            overflow: hidden;
            height: 100vh;
            display: flex;
            flex-direction: column;
            font-size: var(--vscode-font-size, 13px);
        }

        /* ── Toolbar ── */
        .toolbar {
            display: flex;
            align-items: center;
            gap: 2px;
            padding: 2px 8px;
            background: var(--vscode-editor-background, #1e1e1e);
            border-bottom: 1px solid var(--vscode-panel-border, #2d2d2d);
            flex-shrink: 0;
            height: 28px;
        }

        .toolbar button {
            background: transparent;
            border: 1px solid transparent;
            color: var(--vscode-editor-foreground, #ccc);
            cursor: pointer;
            padding: 2px 5px;
            border-radius: 3px;
            font-size: 14px;
            line-height: 1;
            display: flex;
            align-items: center;
        }

        .toolbar button:hover:not(:disabled) {
            background: var(--vscode-toolbar-hoverBackground, rgba(255,255,255,0.1));
        }

        .toolbar button:disabled {
            opacity: 0.3;
            cursor: default;
        }

        .toolbar .separator {
            width: 1px;
            height: 14px;
            background: var(--vscode-panel-border, #555);
            margin: 0 3px;
        }

        .toolbar .info {
            margin-left: auto;
            opacity: 0.5;
            font-size: 11px;
        }

        /* ── Grid container ── */
        #grid-container {
            flex: 1;
            overflow: hidden;
        }

        /* ── AG Grid Theme Override (GrapeCity-style) ── */
        .ag-theme-alpine-dark,
        .ag-theme-alpine {
            --ag-font-family: var(--vscode-font-family, "Segoe UI", sans-serif);
            --ag-font-size: var(--vscode-font-size, 13px);
            --ag-row-height: 24px;
            --ag-header-height: 26px;
            --ag-cell-horizontal-padding: 6px;
            --ag-grid-size: 2px;
            --ag-icon-size: 12px;
            --ag-wrapper-border: 1px solid var(--vscode-tree-indentGuidesStroke, #585858);
            --ag-border-color: var(--vscode-tree-indentGuidesStroke, #585858);
            --ag-row-border-color: var(--vscode-tree-indentGuidesStroke, #585858);
        }

        .ag-theme-alpine-dark {
            --ag-background-color: var(--vscode-editor-background, #1e1e1e);
            --ag-header-background-color: var(--vscode-editorGroupHeader-tabsBackground, #252526);
            --ag-header-foreground-color: var(--vscode-editor-foreground, #cccccc);
            --ag-odd-row-background-color: var(--vscode-sideBar-background, #252526);
            --ag-row-hover-color: var(--vscode-list-hoverBackground, #2a2d2e);
            --ag-selected-row-background-color: var(--vscode-list-activeSelectionBackground, #094771);
            --ag-range-selection-background-color: var(--vscode-list-inactiveSelectionBackground, #37373d);
            --ag-foreground-color: var(--vscode-editor-foreground, #d4d4d4);
            --ag-input-focus-border-color: var(--vscode-focusBorder, #007fd4);
        }

        /* Force header background via direct CSS (more reliable than CSS vars) */
        .ag-theme-alpine-dark .ag-header {
            background-color: var(--vscode-editorGroupHeader-tabsBackground, #252526) !important;
            color: var(--vscode-editor-foreground, #cccccc) !important;
        }

        /* Alternating row colors (GrapeCity style) */
        .ag-theme-alpine-dark .ag-row-odd {
            background-color: var(--vscode-sideBar-background, #252526) !important;
        }
        .ag-theme-alpine-dark .ag-row-even {
            background-color: var(--vscode-editor-background, #1e1e1e) !important;
        }

        /* Grid lines on body cells (vertical + horizontal) */
        .ag-theme-alpine-dark .ag-cell {
            border-right: 1px solid var(--vscode-tree-indentGuidesStroke, #585858) !important;
        }
        .ag-theme-alpine-dark .ag-row {
            border-bottom: 1px solid var(--vscode-tree-indentGuidesStroke, #585858) !important;
        }

        /* Vertical grid lines + bold on header cells */
        .ag-theme-alpine-dark .ag-header-cell {
            font-weight: 600 !important;
            border-right: 1px solid var(--vscode-tree-indentGuidesStroke, #585858) !important;
        }
        /* Prevent descender clipping (g, y, p, q) in header text */
        .ag-theme-alpine-dark .ag-header-cell-text {
            overflow: visible !important;
            line-height: normal !important;
        }
        .ag-theme-alpine-dark .ag-header-cell-label {
            overflow: visible !important;
        }

        /* Selection */
        .ag-theme-alpine-dark .ag-cell.ag-cell-focus {
            border-color: var(--vscode-focusBorder, #007fd4) !important;
        }


        /* ── Footer ── */
        .footer {
            display: flex;
            align-items: center;
            padding: 0 8px;
            background: var(--vscode-sideBar-background, #252526);
            border-top: 1px solid var(--vscode-tree-indentGuidesStroke, #585858);
            flex-shrink: 0;
            height: 22px;
            font-size: 11px;
        }

        .footer .status {
            margin-left: auto;
            opacity: 0.6;
        }
    </style>
</head>
<body>
    <div class="toolbar">
        <button id="btn-undo" title="Undo (Ctrl+Z)" disabled>&#x21A9;</button>
        <button id="btn-redo" title="Redo (Ctrl+Y)" disabled>&#x21AA;</button>
        <div class="separator"></div>
        <button id="btn-autofit" title="Auto-fit column widths">&#x2194;</button>
        <div class="separator"></div>
        <button id="btn-zoom-out" title="Decrease size (Ctrl+-)">&#x2212;</button>
        <span id="zoom-level" style="font-size:11px;min-width:28px;text-align:center;opacity:0.6;">100%</span>
        <button id="btn-zoom-in" title="Increase size (Ctrl++)">&#x2B;</button>
        <div class="separator"></div>
        <span class="info" id="info"></span>
    </div>

    <div id="grid-container" class="ag-theme-alpine-dark"></div>

    <div class="footer">
        <span class="status" id="status"></span>
    </div>

    <script src="https://cdn.jsdelivr.net/npm/ag-grid-community@32.3.3/dist/ag-grid-community.min.js"></script>

    <script nonce="${nonce}">
        const vscodeApi = acquireVsCodeApi();

        // ── CSV Parser ──
        function parseCsv(text, delimiter) {
            const rows = [];
            let row = [];
            let field = '';
            let inQuotes = false;

            for (let i = 0; i < text.length; i++) {
                const ch = text[i];
                if (inQuotes) {
                    if (ch === '"') {
                        if (i + 1 < text.length && text[i + 1] === '"') {
                            field += '"';
                            i++;
                        } else {
                            inQuotes = false;
                        }
                    } else {
                        field += ch;
                    }
                } else if (ch === '"') {
                    inQuotes = true;
                } else if (ch === delimiter) {
                    row.push(field.trim());
                    field = '';
                } else if (ch === '\\r') {
                    // skip
                } else if (ch === '\\n') {
                    row.push(field.trim());
                    if (row.length > 0) rows.push(row);
                    row = [];
                    field = '';
                } else {
                    field += ch;
                }
            }
            row.push(field.trim());
            if (row.some(f => f !== '')) rows.push(row);
            return rows;
        }

        function toCsv(rows, delimiter) {
            return rows.map(row =>
                row.map(cell => {
                    const s = String(cell);
                    if (s.includes(delimiter) || s.includes('"') || s.includes('\\n') || s.includes('\\r')) {
                        return '"' + s.replace(/"/g, '""') + '"';
                    }
                    return s;
                }).join(delimiter)
            ).join('\\n');
        }

        // Column letter helper (0=A, 1=B, ..., 25=Z, 26=AA)
        function colLetter(i) {
            let s = '';
            let n = i;
            while (n >= 0) {
                s = String.fromCharCode(65 + (n % 26)) + s;
                n = Math.floor(n / 26) - 1;
            }
            return s;
        }

        // ── State ──
        let currentDelimiter = "${escapedDelimiter}";
        let data = parseCsv(\`${escapedCsv}\`, currentDelimiter);
        let undoStack = [];
        let redoStack = [];
        let gridApi = null;

        function snapshot() {
            return JSON.parse(JSON.stringify(data));
        }

        function pushUndo() {
            undoStack.push(snapshot());
            redoStack = [];
            updateButtons();
        }

        function undo() {
            if (undoStack.length === 0) return;
            redoStack.push(snapshot());
            data = undoStack.pop();
            refreshGrid();
            notifyChange();
            updateButtons();
        }

        function redo() {
            if (redoStack.length === 0) return;
            undoStack.push(snapshot());
            data = redoStack.pop();
            refreshGrid();
            notifyChange();
            updateButtons();
        }

        function updateButtons() {
            document.getElementById('btn-undo').disabled = undoStack.length === 0;
            document.getElementById('btn-redo').disabled = redoStack.length === 0;
        }

        function getNumCols(rows) {
            var max = 0;
            for (var i = 0; i < rows.length; i++) {
                if (rows[i].length > max) max = rows[i].length;
            }
            return max;
        }

        document.getElementById('btn-undo').addEventListener('click', undo);
        document.getElementById('btn-redo').addEventListener('click', redo);

        // ── Zoom / Scaling ──
        const ZOOM_STEPS = [60, 70, 80, 90, 100, 110, 125, 150, 175, 200];
        let zoomIndex = 4; // 100%
        const BASE_ROW_HEIGHT = 24;
        const BASE_HEADER_HEIGHT = 26;
        const BASE_FONT_SIZE = 13;
        const BASE_CELL_PADDING = 6;

        function applyZoom() {
            var pct = ZOOM_STEPS[zoomIndex];
            var scale = pct / 100;
            var container = document.getElementById('grid-container');

            var rowH = Math.round(BASE_ROW_HEIGHT * scale);
            var headerH = Math.round(BASE_HEADER_HEIGHT * scale);
            var fontSize = Math.round(BASE_FONT_SIZE * scale);
            var cellPad = Math.round(BASE_CELL_PADDING * scale);

            container.style.setProperty('--ag-row-height', rowH + 'px');
            container.style.setProperty('--ag-header-height', headerH + 'px');
            container.style.setProperty('--ag-font-size', fontSize + 'px');
            container.style.setProperty('--ag-cell-horizontal-padding', cellPad + 'px');

            document.getElementById('zoom-level').textContent = pct + '%';

            // Refresh grid to apply new row heights
            if (gridApi) {
                gridApi.resetRowHeights();
                gridApi.refreshHeader();
            }
        }

        function zoomIn() {
            if (zoomIndex < ZOOM_STEPS.length - 1) {
                zoomIndex++;
                applyZoom();
            }
        }

        function zoomOut() {
            if (zoomIndex > 0) {
                zoomIndex--;
                applyZoom();
            }
        }

        document.getElementById('btn-zoom-in').addEventListener('click', zoomIn);
        document.getElementById('btn-zoom-out').addEventListener('click', zoomOut);

        let isAutoFitted = false;
        const DEFAULT_COL_WIDTH = 130;

        function measureTextWidths(data) {
            var headerRow = data[0];
            var bodyRows = data.slice(1);
            var numCols = getNumCols(data);

            // Read actual cell/header padding from the DOM
            var sampleCell = document.querySelector('.ag-cell');
            var sampleHeader = document.querySelector('.ag-header-cell');
            var cellPadLR = 12; // default: 6px each side
            var headerPadLR = 12;
            if (sampleCell) {
                var scs = getComputedStyle(sampleCell);
                cellPadLR = parseFloat(scs.paddingLeft) + parseFloat(scs.paddingRight);
            }
            if (sampleHeader) {
                var shs = getComputedStyle(sampleHeader);
                headerPadLR = parseFloat(shs.paddingLeft) + parseFloat(shs.paddingRight);
            }
            // Extra buffer: border (1px) + canvas measureText imprecision (~8px) + sort icon for header (~18px)
            var cellExtra = cellPadLR + 10;
            var headerExtra = headerPadLR + 26;

            // Read font from actual rendered AG Grid elements
            var sampleCellText = document.querySelector('.ag-cell-value');
            var sampleHeaderText = document.querySelector('.ag-header-cell-text');

            var cellFontSize = '13px';
            var cellFontFamily = '"Segoe UI", sans-serif';
            var cellFontWeight = '400';
            if (sampleCellText) {
                var cs = getComputedStyle(sampleCellText);
                cellFontSize = cs.fontSize;
                cellFontFamily = cs.fontFamily;
                cellFontWeight = cs.fontWeight;
            } else if (sampleCell) {
                var cs2 = getComputedStyle(sampleCell);
                cellFontSize = cs2.fontSize;
                cellFontFamily = cs2.fontFamily;
                cellFontWeight = cs2.fontWeight;
            }

            var headerFontSize = cellFontSize;
            var headerFontFamily = cellFontFamily;
            var headerFontWeight = '600';
            if (sampleHeaderText) {
                var hs = getComputedStyle(sampleHeaderText);
                headerFontSize = hs.fontSize;
                headerFontFamily = hs.fontFamily;
                headerFontWeight = hs.fontWeight || '600';
            }

            var canvas = document.createElement('canvas');
            var ctx = canvas.getContext('2d');
            var headerFontStr = headerFontWeight + ' ' + headerFontSize + ' ' + headerFontFamily;
            var cellFontStr = cellFontWeight + ' ' + cellFontSize + ' ' + cellFontFamily;

            var colState = [];
            for (var c = 0; c < numCols; c++) {
                // Measure header text
                ctx.font = headerFontStr;
                var headerW = ctx.measureText(headerRow[c] || '').width + headerExtra;

                // Measure all body rows
                ctx.font = cellFontStr;
                var maxBodyW = 0;
                for (var r = 0; r < bodyRows.length; r++) {
                    var val = (bodyRows[r] && bodyRows[r][c]) ? String(bodyRows[r][c]) : '';
                    var w = ctx.measureText(val).width + cellExtra;
                    if (w > maxBodyW) maxBodyW = w;
                }

                // Column width = whichever is wider: header or longest body value
                var finalW = headerW > maxBodyW ? headerW : maxBodyW;
                colState.push({ colId: 'col_' + c, width: Math.ceil(finalW) });
            }

            return colState;
        }

        function toggleAutoFit() {
            if (!gridApi) return;

            try {
                if (!isAutoFitted) {
                    var colState = measureTextWidths(data);
                    gridApi.applyColumnState({ state: colState });
                } else {
                    buildGrid();
                }
                isAutoFitted = !isAutoFitted;
            } catch (err) {
                console.error('[AutoFit] ERROR:', err);
            }
        }

        document.getElementById('btn-autofit').addEventListener('click', toggleAutoFit);

        function notifyChange() {
            vscodeApi.postMessage({ type: 'edit', text: toCsv(data, currentDelimiter) });
        }

        // ── Build AG Grid ──
        function buildGrid() {
            if (!data || data.length === 0) return;

            // First row is the header
            const headerRow = data[0];
            const bodyRows = data.slice(1);
            const numCols = getNumCols(data);

            const columnDefs = [];

            // Detect which columns are numeric (sample up to 100 rows)
            function isColumnNumeric(colIndex) {
                var sampleSize = Math.min(bodyRows.length, 100);
                var numCount = 0;
                var nonEmpty = 0;
                for (var r = 0; r < sampleSize; r++) {
                    var val = bodyRows[r] && bodyRows[r][colIndex] ? bodyRows[r][colIndex] : '';
                    if (val === '') continue;
                    nonEmpty++;
                    if (!isNaN(Number(val))) numCount++;
                }
                return nonEmpty > 0 && numCount / nonEmpty > 0.8;
            }

            for (let c = 0; c < numCols; c++) {
                const headerName = headerRow[c] !== undefined
                    ? headerRow[c]
                    : '';
                const colDef = {
                    headerName: headerName,
                    field: 'col_' + c,
                    minWidth: 60,
                    editable: true,
                    sortable: true,
                    filter: true,
                    resizable: true,
                    suppressMovable: false,
                };
                if (isColumnNumeric(c)) {
                    colDef.comparator = function(a, b) {
                        var numA = a === '' || a == null ? -Infinity : Number(a);
                        var numB = b === '' || b == null ? -Infinity : Number(b);
                        return numA - numB;
                    };
                }
                columnDefs.push(colDef);
            }

            // Convert body data to row objects (skip header row)
            const rowData = bodyRows.map((row, r) => {
                const obj = {};
                for (let c = 0; c < numCols; c++) {
                    obj['col_' + c] = row[c] !== undefined ? row[c] : '';
                }
                return obj;
            });

            const container = document.getElementById('grid-container');
            container.innerHTML = '';

            const gridOptions = {
                columnDefs: columnDefs,
                rowData: rowData,
                defaultColDef: {
                    flex: 0,
                    width: 130,
                    editable: true,
                    sortable: true,
                    filter: true,
                    resizable: true,
                },
                animateRows: false,
                enableCellTextSelection: true,
                suppressFieldDotNotation: true,
                singleClickEdit: false,
                stopEditingWhenCellsLoseFocus: true,
                undoRedoCellEditing: false,
                onCellValueChanged: function(event) {
                    const dataIndex = event.node.rowIndex + 1; // +1 because row 0 in data is header
                    const colField = event.colDef.field;
                    if (!colField) return;

                    const colIndex = parseInt(colField.replace('col_', ''));

                    pushUndo();
                    while (data[dataIndex].length <= colIndex) data[dataIndex].push('');
                    data[dataIndex][colIndex] = event.newValue != null ? String(event.newValue) : '';
                    notifyChange();
                },
            };

            gridApi = agGrid.createGrid(container, gridOptions);

            // Double-click on column resize handle to auto-fit (like Excel)
            container.addEventListener('dblclick', function(e) {
                const target = e.target;
                if (target && target.classList && target.classList.contains('ag-header-cell-resize')) {
                    const headerCell = target.closest('.ag-header-cell');
                    if (headerCell) {
                        const colId = headerCell.getAttribute('col-id');
                        if (colId) {
                            gridApi.autoSizeColumns([colId]);
                        }
                    }
                }
            });

            // Update info
            const rowCount = bodyRows.length;
            document.getElementById('info').textContent = rowCount + ' rows \\u00D7 ' + numCols + ' columns';
            document.getElementById('status').textContent = rowCount + ' records';
        }

        function refreshGrid() {
            if (!gridApi) return;

            const numCols = getNumCols(data);
            const bodyRows = data.slice(1);
            const rowData = bodyRows.map((row) => {
                const obj = {};
                for (let c = 0; c < numCols; c++) {
                    obj['col_' + c] = row[c] !== undefined ? row[c] : '';
                }
                return obj;
            });

            gridApi.setGridOption('rowData', rowData);
        }

        // Keyboard shortcuts
        document.addEventListener('keydown', function(e) {
            if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
                undo();
                e.preventDefault();
            }
            if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
                redo();
                e.preventDefault();
            }
            // Ctrl+Plus / Ctrl+= to zoom in, Ctrl+Minus to zoom out
            if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '=')) {
                zoomIn();
                e.preventDefault();
            }
            if ((e.ctrlKey || e.metaKey) && e.key === '-') {
                zoomOut();
                e.preventDefault();
            }
        });

        // Handle external updates
        window.addEventListener('message', function(event) {
            const msg = event.data;
            if (msg.type === 'update') {
                data = parseCsv(msg.text, msg.delimiter);
                refreshGrid();
            }
        });

        // Initial render
        applyZoom(); // Set consistent sizing before grid builds
        buildGrid();
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
