// Regression guard for issue #34 (Paged View always parsed with a comma).
// The delimiter is detected from the text the provider has just read, and the
// paged view has none: its pages are served on demand, so detection looked at
// an empty string, found no separator to count and fell back to the comma.
// A semicolon file over 50 MB therefore opened as one column per row. The page
// index has already read the header line, so that is what detection gets now.
//
// The provider pulls in the vscode module, which only exists inside the editor,
// so it is stubbed here. Nothing in this test needs it: the module body only
// declares classes, and the delimiter detection never touches `this`.
//
// Run after `tsc -p ./`:  node test/paged-view-delimiter.test.cjs

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const load = Module._load;
Module._load = function (request, ...rest) {
    if (request === 'vscode') return {};
    return load.call(this, request, ...rest);
};

const { buildPageIndex, readPage } = require('../out/largeFileReader.js');
const { parseCsv } = require('../out/webview/utils/csv.js');
const { CsvEditorProvider } = require('../out/csvEditorProvider.js');
const detectDelimiter = CsvEditorProvider.prototype.detectDelimiter;

let failures = 0;
async function test(name, fn) {
    try { await fn(); console.log('  ✓ ' + name); }
    catch (e) { failures++; console.error('  ✗ ' + name + '\n      ' + e.message); }
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csv-grid-delim-'));
function fixture(name, text) {
    const file = path.join(tmpDir, name);
    fs.writeFileSync(file, text, 'utf8');
    return file;
}

const SEMI = 'id;city;note\n1;Hamburg;"zwei\nZeilen"\n2;Wien;plain\n3;Köln;last\n';
const TAB  = 'id\tcity\tnote\n1\tHamburg\tplain\n';

async function main() {
    console.log('the paged view detects the real delimiter (issue #34)');

    const semi = fixture('semicolon.csv', SEMI);

    await test('an empty text is what made it fall back to the comma', () => {
        assert.strictEqual(detectDelimiter.call(null, 'big.csv', ''), ',');
    });

    await test('the page index hands over the header line to detect from', async () => {
        const index = await buildPageIndex(semi, 2);
        assert.strictEqual(index.headerLine, 'id;city;note');
        assert.strictEqual(detectDelimiter.call(null, 'big.csv', index.headerLine), ';');
    });

    await test('a page then splits into the columns the file really has', async () => {
        const index = await buildPageIndex(semi, 2);
        const delimiter = detectDelimiter.call(null, semi, index.headerLine);
        const rows = parseCsv(await readPage(semi, index, 0), delimiter);
        assert.deepStrictEqual(rows[0], ['id', 'city', 'note']);
        assert.deepStrictEqual(rows[1], ['1', 'Hamburg', 'zwei\nZeilen']);
    });

    await test('a tsv is still decided by its extension, not by the header', async () => {
        const tsv = fixture('tabs.tsv', TAB);
        const index = await buildPageIndex(tsv, 2);
        assert.strictEqual(detectDelimiter.call(null, tsv, index.headerLine), '\t');
    });

    await test('the provider feeds the header line in, not the empty content', () => {
        const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'csvEditorProvider.ts'), 'utf8');
        assert.ok(/detectDelimiter\(uri\.fsPath, pageIndex \? pageIndex\.headerLine : content\)/.test(src),
            'detection is no longer fed the page index header, the paged view is back to guessing comma');
    });

    await test('a delimiter switch re-splits the page on display', () => {
        const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'webview', 'features', 'pagination.ts'), 'utf8');
        assert.ok(/state\.rawCsvText = msg\.text;/.test(src),
            'the page text is not kept, switching the delimiter would jump back to page 1');
    });

    console.log('');
    if (failures) {
        console.error(failures + ' paged-view delimiter test(s) failed');
        process.exit(1);
    }
    console.log('All tests passed');
}

main()
    .catch(err => { console.error(err); process.exit(1); })
    .finally(() => fs.rmSync(tmpDir, { recursive: true, force: true }));
