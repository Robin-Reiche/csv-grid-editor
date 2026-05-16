import * as vscode from 'vscode';

export function getWebviewContent(
    webview: vscode.Webview,
    extensionUri: vscode.Uri,
    delimiter: string,
    isPreview: boolean = false,
    previewMode: string = 'full',
    totalLineCount: number = 0,
    fileName: string = '',
    isChunked: boolean = false,
    isMac: boolean = false,
    zoomIndex: number = 4
): string {
    const nonce = getNonce();
    const mod   = isMac ? '⌘' : 'Ctrl+';

    if (previewMode === 'plaintext') {
        return /*html*/ `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>CSV Plain Text</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: var(--vscode-editor-font-family, monospace);
            font-size: var(--vscode-editor-font-size, 13px);
            background: var(--vscode-editor-background, #1e1e1e);
            color: var(--vscode-editor-foreground, #d4d4d4);
            height: 100vh;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }
        .banner {
            flex-shrink: 0;
            padding: 3px 12px;
            background: var(--vscode-editorWarning-foreground, #cca700);
            color: #000;
            font-size: 11px;
            font-family: var(--vscode-font-family, sans-serif);
        }
        #content {
            flex: 1;
            overflow: auto;
            padding: 12px 16px;
            white-space: pre;
            tab-size: 4;
        }
    </style>
</head>
<body>
    <div class="banner">Plain text view — read-only</div>
    <pre id="content">Loading…</pre>
    <script nonce="${nonce}">
        const vscodeApi = acquireVsCodeApi();
        window.addEventListener('message', function(event) {
            if (event.data.type === 'init') {
                document.getElementById('content').textContent = event.data.text;
            }
        });
        vscodeApi.postMessage({ type: 'ready' });
    </script>
</body>
</html>`;
    }

    const cssUri        = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'webview.css'));
    const codiconCssUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'codicon.css'));
    const scriptUri     = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'webview.js'));

    const escapedDelimiter = delimiter
        .replace(/\\/g, '\\\\')
        .replace(/\t/, '\\t');

    return /*html*/ `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}' https://cdn.jsdelivr.net; style-src ${webview.cspSource} https://cdn.jsdelivr.net 'unsafe-inline'; font-src ${webview.cspSource} https://cdn.jsdelivr.net; img-src ${webview.cspSource} https://cdn.jsdelivr.net data:;">
    <title>CSV Viewer</title>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/ag-grid-community@32.3.3/styles/ag-grid.css">
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/ag-grid-community@32.3.3/styles/ag-theme-alpine.css">
    <link rel="stylesheet" href="${codiconCssUri}">
    <link rel="stylesheet" href="${cssUri}">
</head>
<body>
    <!-- Loading overlay -->
    <div class="loading-overlay" id="loading-overlay">
        <div class="loading-spinner"></div>
        <div class="loading-label" id="loading-label">Loading…</div>
        <div class="loading-bar-track"><div class="loading-bar-fill"></div></div>
    </div>

    <!-- Preview banner -->
    ${isPreview ? `<div class="preview-banner"><span class="preview-icon"><i class="codicon codicon-eye"></i></span><span id="preview-text"></span></div>` : ''}

    <!-- Toolbar -->
    <div class="toolbar">
        <button id="btn-undo"    title="Undo (${mod}Z)"  disabled ${isPreview ? 'style="display:none;"' : ''}><i class="codicon codicon-discard"></i></button>
        <button id="btn-redo"    title="Redo (${mod}Y)"  disabled ${isPreview ? 'style="display:none;"' : ''}><i class="codicon codicon-redo"></i></button>
        <div    class="separator"                                 ${isPreview ? 'style="display:none;"' : ''}></div>
        <button id="btn-autofit" title="Auto-fit column widths"><i class="codicon codicon-arrow-both"></i></button>
        <div    class="separator"></div>
        <button id="btn-clear-filters" title="Clear all filters" style="display:none;"><i class="codicon codicon-filter-filled"></i><span class="filter-clear-label">Clear</span></button>
        <div    class="separator" id="sep-filters" style="display:none;"></div>
        <button id="btn-zoom-out" title="Decrease size (${mod}-)"><i class="codicon codicon-zoom-out"></i></button>
        <span   id="zoom-level"  style="font-size:11px;min-width:28px;text-align:center;opacity:0.6;">100%</span>
        <button id="btn-zoom-in"  title="Increase size (${mod}+)"><i class="codicon codicon-zoom-in"></i></button>
        <div    class="separator"></div>
        <button id="btn-profile"       title="Column Profile"><i class="codicon codicon-graph"></i></button>
        <div    class="separator"></div>
        <button id="btn-find-replace"  title="Find &amp; Replace (${mod}F)"><i class="codicon codicon-search"></i></button>
        <div    class="separator"></div>
        <button id="btn-go-to-row"     title="Go to row (${mod}G)${isChunked ? ' — disabled in Paged View' : ''}"${isChunked ? ' disabled' : ''}><i class="codicon codicon-list-ordered"></i></button>
        <button id="btn-duplicates"    title="Find duplicate rows${isChunked ? ' — disabled in Paged View' : ''}"${isChunked ? ' disabled' : ''}><i class="codicon codicon-files"></i></button>
        <div    class="separator"></div>
        <button id="btn-export"        title="Export CSV" class="text-btn"${isPreview ? ' style="display:none;"' : ''}><i class="codicon codicon-export"></i> Export</button>
        <div    class="separator"></div>
        <span   id="delim-badge" class="delim-badge" title="Click to change delimiter">Delim: ,</span>
        <span   class="info" id="info"></span>
    </div>

    <!-- Delimiter dropdown [F2] -->
    <div id="delim-dropdown" class="delim-dropdown hidden">
        <div class="delim-option" data-delim=",">,&nbsp;&nbsp; Comma</div>
        <div class="delim-option" data-delim=";">;&nbsp;&nbsp; Semicolon</div>
        <div class="delim-option" data-delim="\\t">&#x21E5;&nbsp; Tab</div>
        <div class="delim-option" data-delim="|">|&nbsp;&nbsp; Pipe</div>
    </div>

    <!-- Go to Row popover -->
    <div id="goto-popover" class="goto-popover hidden">
        <label class="goto-label" for="goto-input">Go to row</label>
        <div class="goto-input-row">
            <input id="goto-input" type="number" min="1" step="1" placeholder="1" inputmode="numeric">
            <span id="goto-hint" class="goto-hint">of 0</span>
        </div>
        <div class="goto-actions">
            <button id="goto-cancel" class="goto-btn goto-btn-secondary">Cancel</button>
            <button id="goto-go"     class="goto-btn goto-btn-primary">Go</button>
        </div>
        <div id="goto-error" class="goto-error" style="display:none;"></div>
    </div>

    <!-- Duplicate banner -->
    <div id="dup-banner" class="dup-banner hidden">
        <span class="dup-banner-icon"><i class="codicon codicon-files"></i></span>
        <span id="dup-banner-text" class="dup-banner-text"></span>
        <button id="dup-only-toggle" class="dup-banner-btn">Show only duplicates</button>
        <button id="dup-dismiss"     class="dup-banner-btn dup-banner-btn-secondary">Dismiss</button>
    </div>

    <!-- Find & Replace bar -->
    <div id="find-bar" class="find-bar hidden">
        <span class="find-section-label">Find</span>
        <input  id="find-input"    class="find-input" type="text" placeholder="Search…" spellcheck="false">
        <button id="find-case-btn" class="find-case-btn" title="Match case">Aa</button>
        <button id="find-prev"     class="find-btn" title="Previous match (Shift+Enter)"><i class="codicon codicon-arrow-up"></i></button>
        <button id="find-next"     class="find-btn" title="Next match (Enter)"><i class="codicon codicon-arrow-down"></i></button>
        <span   id="find-count"    class="find-count"></span>
        <div    class="find-sep"></div>
        <span class="find-section-label">Replace</span>
        <input  id="replace-input" class="find-input" type="text" placeholder="Replace with…" spellcheck="false">
        <button id="replace-one"   class="find-btn find-action-btn" title="Replace current"${isPreview ? ' disabled' : ''}>Replace</button>
        <button id="replace-all"   class="find-btn find-action-btn" title="Replace all"${isPreview ? ' disabled' : ''}>All</button>
        <button id="find-close"    class="find-close" title="Close (Esc)"><i class="codicon codicon-close"></i></button>
    </div>

    <!-- Main content -->
    <div id="content-row">
        <div id="grid-container" class="ag-theme-alpine-dark"></div>

        <div id="profile-panel">
            <div class="profile-resize-handle" id="profile-resize-handle"></div>
            <div class="profile-panel-header">
                <span class="profile-panel-title">Column Profile</span>
                <div class="profile-dock-btns">
                    <button class="profile-dock-btn" data-dock="left"   title="Dock left"><i class="codicon codicon-layout-sidebar-left"></i></button>
                    <button class="profile-dock-btn" data-dock="bottom" title="Dock bottom"><i class="codicon codicon-layout-panel"></i></button>
                    <button class="profile-dock-btn profile-dock-btn--active" data-dock="right"  title="Dock right"><i class="codicon codicon-layout-sidebar-right"></i></button>
                </div>
                <button class="profile-panel-close" id="btn-profile-close" title="Close"><i class="codicon codicon-close"></i></button>
            </div>
            <div class="profile-scroll" id="profile-scroll"></div>
        </div>
    </div><!-- /#content-row -->

    <!-- Column context menu [F5] -->
    <div id="col-context-menu" class="col-context-menu hidden">
        <div id="col-ctx-insert-left"  class="col-ctx-item"${isPreview ? ' style="display:none;"' : ''}>&#x2B05;&#xFE0F; Insert column left</div>
        <div id="col-ctx-insert-right" class="col-ctx-item"${isPreview ? ' style="display:none;"' : ''}>&#x27A1;&#xFE0F; Insert column right</div>
        <div class="col-ctx-separator"${isPreview ? ' style="display:none;"' : ''}></div>
        <div id="col-ctx-select"   class="col-ctx-item">&#x2630; Select column</div>
        <div class="col-ctx-separator"></div>
        <div id="col-ctx-freeze"   class="col-ctx-item">&#x1F4CC; Freeze column</div>
        <div id="col-ctx-unfreeze" class="col-ctx-item" style="display:none;">&#x1F4CC; Unfreeze column</div>
        <div class="col-ctx-separator"${isPreview ? ' style="display:none;"' : ''}></div>
        <div id="col-ctx-delete"   class="col-ctx-item danger"${isPreview ? ' style="display:none;"' : ''}>&#x2715; Delete column</div>
    </div>

    <!-- Row context menu -->
    <div id="row-context-menu" class="row-context-menu hidden">
        <div id="row-ctx-delete" class="row-ctx-item danger">&#x2715; Delete row</div>
    </div>

    <!-- Pagination bar [F7] -->
    <div id="pagination-bar" class="pagination-bar hidden">
        <button id="btn-page-first" class="page-btn" title="First page"  disabled>&#x21E4;</button>
        <button id="btn-page-prev"  class="page-btn" title="Previous page" disabled>&#x25C4;</button>
        <span   id="page-info"      class="page-info">Page 1 / 1</span>
        <button id="btn-page-next"  class="page-btn" title="Next page">&#x25BA;</button>
        <button id="btn-page-last"  class="page-btn" title="Last page">&#x21E5;</button>
    </div>

    <!-- Footer -->
    <div class="footer">
        <span class="sel-stats" id="sel-stats"></span>
        <span class="status" id="status"></span>
    </div>

    <!-- AG Grid -->
    <script nonce="${nonce}" src="https://cdn.jsdelivr.net/npm/ag-grid-community@32.3.3/dist/ag-grid-community.min.js"></script>

    <!-- Injected globals (must run before webview.js) -->
    <script nonce="${nonce}">
        const vscodeApi      = acquireVsCodeApi();
        const IS_PREVIEW     = ${isPreview ? 'true' : 'false'};
        const PREVIEW_MODE   = '${previewMode}';
        const TOTAL_LINE_COUNT = ${totalLineCount};
        const DELIMITER      = '${escapedDelimiter}';
        const FILENAME       = '${fileName.replace(/'/g, "\\'")}';
        const IS_CHUNKED          = ${isChunked ? 'true' : 'false'};
        const INITIAL_ZOOM_INDEX  = ${zoomIndex};
    </script>

    <!-- Bundled webview logic -->
    <script nonce="${nonce}" src="${scriptUri}"></script>
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
