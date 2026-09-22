// Runs the real webview in headless Chrome, so a test can click through the
// grid the way a person would and check what ends up on screen and in the file.
//
// The page is the one the extension serves (getWebviewContent), with three
// things swapped for a browser tab: the VS Code API becomes a stub that records
// every message the grid sends, the script is bundled fresh from src/ so the
// test always runs the current code and never a stale media/webview.js, and the
// libraries are loaded straight out of node_modules, because the copies in
// media/ only exist after a full build.
//
// A test hands over a CSV, optionally the remembered settings, and an async
// function that runs in the page. That function gets the helpers below as `t`
// and reports with t.check(condition, message). Chrome runs the page on a
// virtual clock, so the waits in a test cost next to no real time.
//
// Needs Chrome. Found through CHROME_PATH or the usual install places. Without
// one the UI tests are skipped locally but fail in CI, where a skipped run would
// look exactly like a passing one.

const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'csv-grid-ui-'));

function findChrome() {
    const candidates = [
        process.env.CHROME_PATH,
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    ];
    return candidates.find(p => p && fs.existsSync(p)) || null;
}

let bundlePath = null;
function bundle() {
    if (bundlePath) return bundlePath;
    bundlePath = path.join(TMP, 'webview.js');
    require('esbuild').buildSync({
        entryPoints: [path.join(ROOT, 'src', 'webview', 'index.ts')],
        bundle: true, outfile: bundlePath, platform: 'browser', target: 'es2020', logLevel: 'silent',
    });
    return bundlePath;
}

// Where each file the page asks for really is. The key is what the page
// references (media/<name>), the value the file on disk.
function assetPath(name) {
    const map = {
        'webview.js':               bundle(),
        'ag-grid-community.min.js': path.join(ROOT, 'node_modules', 'ag-grid-community', 'dist', 'ag-grid-community.min.js'),
        'ag-grid.css':              path.join(ROOT, 'node_modules', 'ag-grid-community', 'styles', 'ag-grid.css'),
        'ag-theme-alpine.css':      path.join(ROOT, 'node_modules', 'ag-grid-community', 'styles', 'ag-theme-alpine.css'),
        'codicon.css':              path.join(ROOT, 'node_modules', '@vscode', 'codicons', 'dist', 'codicon.css'),
    };
    return map[name] || path.join(ROOT, 'media', name);
}

function loadWebviewModule() {
    const orig = Module._load;
    Module._load = function (req, ...rest) {
        if (req === 'vscode') {
            return { Uri: { joinPath: (_base, ...parts) => 'ASSET:' + parts[parts.length - 1] } };
        }
        return orig.call(this, req, ...rest);
    };
    try { return require(path.join(ROOT, 'out', 'webview.js')); }
    finally { Module._load = orig; }
}

// The helpers a test gets as `t`. Runs inside the page.
const PRELUDE = `
window.__sent = [];
window.__lines = [];
window.__t = {
  check(ok, msg) { window.__lines.push((ok ? 'PASS ' : 'FAIL ') + msg); },
  wait: ms => new Promise(r => setTimeout(r, ms)),
  async init(text, delimiter) {
    window.postMessage({ type: 'init', text, delimiter: delimiter || ',' }, '*');
    await this.wait(900);
  },
  // AG Grid draws one .ag-row per container (pinned left and centre), so a
  // row index matches several elements and only one holds a given column.
  cell(row, col) {
    for (const r of document.querySelectorAll('#grid-container .ag-row[row-index="' + row + '"]')) {
      const c = r.querySelector('.ag-cell[col-id="col_' + col + '"]');
      if (c) return c;
    }
    return null;
  },
  box(row, col) { const c = this.cell(row, col); return c && c.querySelector('.csv-bool-box'); },
  boxesIn(col) { return document.querySelectorAll('#grid-container .ag-cell[col-id="col_' + col + '"] .csv-bool-box').length; },
  header(col) { return document.querySelector('#grid-container .ag-header-cell[col-id="col_' + col + '"]'); },
  sent(type) { return window.__sent.filter(m => !type || m.type === type); },
  lastEdit() { const e = this.sent('edit'); return e.length ? e[e.length - 1].text : null; },
  // Focuses a cell the way a mouse click does: AG Grid moves its focus on
  // mousedown.
  async focusCell(row, col) {
    const c = this.cell(row, col);
    ['mousedown', 'mouseup', 'click'].forEach(ty => c.dispatchEvent(new MouseEvent(ty, { bubbles: true, button: 0 })));
    await this.wait(200);
  },
  focusedRow() {
    const c = document.querySelector('#grid-container .ag-cell-focus');
    return c ? Number(c.closest('.ag-row').getAttribute('row-index')) : null;
  },
  // Enter on the focused cell opens its editor, Enter in the editor commits.
  async pressEnter() {
    const target = document.querySelector('#grid-container textarea') || document.querySelector('#grid-container .ag-cell-focus');
    target.focus();
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
    await this.wait(250);
  },
  click(el, detail) { el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: detail || 1 })); },
  container() { return document.getElementById('grid-container'); },
  async openSettings() {
    const pop = document.getElementById('settings-popover');
    if (pop.classList.contains('hidden')) {
      document.getElementById('btn-settings').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await this.wait(100);
    }
    return pop;
  },
  settingBox(key) { return document.querySelector('#settings-list .settings-item[data-key="' + key + '"] input'); },
  async setSetting(key, on) {
    await this.openSettings();
    const cb = this.settingBox(key);
    if (!cb) { this.check(false, 'the menu has no entry for ' + key); return; }
    if (cb.checked !== on) cb.click();
    await this.wait(250);
  },
};
`;

// Builds the page for one test and runs it. Returns the lines the test
// reported, each starting with PASS or FAIL.
function runPage({ csv, delimiter = ',', settings = {}, steps, budget = 30000 }) {
    const chrome = findChrome();
    if (!chrome) throw new Error('no Chrome found');

    const { getWebviewContent } = loadWebviewModule();
    const { readSettings } = require(path.join(ROOT, 'out', 'webview', 'settings.js'));
    let html = getWebviewContent(
        { asWebviewUri: u => u, cspSource: '*' }, ROOT, delimiter,
        false, 'full', 0, 'test.csv', false, false, 4, readSettings(settings), false,
    );
    html = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '');
    html = html.replace(/ASSET:([\w.-]+)/g, (_m, name) => 'file://' + assetPath(name).replace(/\\/g, '/'));
    html = html.replace('acquireVsCodeApi()',
        '({ postMessage: m => window.__sent.push(m), setState(){}, getState(){} })');
    // The prelude has to run before the bundle, which grabs the API on load.
    html = html.replace('<script', '<script>' + PRELUDE + '</script><script');
    html = html.replace('</body>', `<pre id="__log"></pre><script>
(async () => {
  try { await (${steps})(window.__t, ${JSON.stringify(csv)}); }
  catch (e) { window.__t.check(false, 'the test threw: ' + (e && e.message)); }
  document.getElementById('__log').textContent = window.__lines.join('\\n') + '\\nDONE';
})();
</script></body>`);

    const file = path.join(TMP, 'page-' + Math.random().toString(36).slice(2) + '.html');
    fs.writeFileSync(file, html);
    const dom = execFileSync(chrome, [
        '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
        '--window-size=1100,700', '--virtual-time-budget=' + budget, '--dump-dom',
        'file://' + file.replace(/\\/g, '/'),
    ], { encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });

    const m = dom.match(/<pre id="__log">([\s\S]*?)<\/pre>/);
    const text = m ? m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&') : '';
    if (!/\nDONE$|^DONE$/.test(text)) {
        return (text ? text.split('\n') : []).concat(['FAIL the page did not finish within its time budget']);
    }
    return text.split('\n').filter(l => l && l !== 'DONE');
}

// Runs a list of { name, csv, settings, steps } scenarios and prints the result
// in the same format as the other test files. Exits the process.
function runSuite(title, scenarios) {
    console.log(title);
    if (!findChrome()) {
        if (process.env.CI) {
            console.error('  ✗ no Chrome found, and in CI the UI tests must run');
            process.exit(1);
        }
        console.log('  - skipped: no Chrome found (set CHROME_PATH to run these)');
        process.exit(0);
    }
    let failures = 0;
    for (const s of scenarios) {
        let lines;
        try { lines = runPage(s); }
        catch (e) { lines = ['FAIL could not run the page: ' + e.message]; }
        for (const l of lines) {
            const ok = l.startsWith('PASS ');
            if (!ok) failures++;
            const msg = s.name + ': ' + l.replace(/^(PASS|FAIL) /, '');
            if (ok) console.log('  ✓ ' + msg);
            else console.error('  ✗ ' + msg);
        }
        if (lines.length === 0) { failures++; console.error('  ✗ ' + s.name + ': reported nothing'); }
    }
    fs.rmSync(TMP, { recursive: true, force: true });
    console.log(failures === 0 ? '\nAll ' + title + ' tests passed.' : `\n${failures} test(s) failed.`);
    process.exit(failures === 0 ? 0 : 1);
}

module.exports = { runSuite, runPage, findChrome };
