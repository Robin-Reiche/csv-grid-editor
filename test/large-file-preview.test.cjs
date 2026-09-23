// Regression guard for issue #32 (large-file preview modes miscount rows and
// split multi-line cells). Show Head, Show Tail and Paged View used to cut the
// file on every \n without tracking quotes, so a cell containing a line break
// was read as several rows: the counts came out too high, head and tail even
// disagreed by one, and wherever a cut landed inside a quoted field the quotes
// stopped pairing up and every row after it was parsed into the wrong columns.
//
// The reference in every check below is parseCsv over the whole file, which is
// what Open Full File puts in the grid. A preview is only correct when it shows
// exactly the records that path would show, and counts exactly as many.
//
// Run after `tsc -p ./`:  node test/large-file-preview.test.cjs

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { parseCsv } = require('../out/webview/utils/csv.js');
const {
    readFirstRecords,
    countRecords,
    readTailRecords,
    buildPageIndex,
    readPage
} = require('../out/largeFileReader.js');

let failures = 0;
async function test(name, fn) {
    try { await fn(); console.log('  ✓ ' + name); }
    catch (e) { failures++; console.error('  ✗ ' + name + '\n      ' + e.message); }
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csv-grid-preview-'));
function fixture(name, text) {
    const file = path.join(tmpDir, name);
    fs.writeFileSync(file, text, 'utf8');
    return file;
}

// Every kind of cut that used to go wrong: a line break inside a quoted field,
// a CRLF inside one, an escaped quote, a blank line inside a value, and a
// multi-byte character so byte offsets cannot quietly land mid-character.
const RECORDS = [
    'id,city,note',
    '1,Hamburg,plain',
    '2,"Berlin, Mitte","two\nlines"',
    '3,"Köln","he said ""hi"" then\nleft"',
    '4,"München","crlf\r\ninside"',
    '5,"Wien","blank\n\nline"',
    '6,Zürich,last'
];
const TEXT = RECORDS.join('\n') + '\n';

// The 64 KB read chunks are the other half of the problem: quote state has to
// survive a chunk boundary, including a "" pair split across two chunks.
const CHUNK = 64 * 1024;
function boundaryText() {
    const header = 'id,note\n';
    const marker = '9,"say ""ok"" now\nand more"\n';
    const qq = marker.indexOf('""');
    const fillerLen = CHUNK - 1 - qq - header.length;   // puts the "" pair astride the boundary
    const pad = fillerLen - 5;                          // filler record is 8,"<pad>"\n
    assert.ok(pad > 0, 'filler does not fit');
    const filler = '8,"' + 'x'.repeat(pad) + '"\n';
    assert.strictEqual(header.length + filler.length + qq, CHUNK - 1);
    return header + filler + marker + '10,"tail\nvalue"\n11,plain\n';
}

const dataRows = rows => rows.slice(1);

async function main() {
    console.log('large-file preview modes (issue #32)');

    const file      = fixture('multiline.csv', TEXT);
    const noNewline = fixture('no-trailing-newline.csv', TEXT.slice(0, -1));
    const boundary  = fixture('chunk-boundary.csv', boundaryText());
    const expected  = parseCsv(TEXT, ',');

    await test('the fixture really is the case that used to break', () => {
        assert.ok(TEXT.split('\n').length - 1 > expected.length,
            'fixture has no multi-line records, the test would prove nothing');
    });

    // ── counting ────────────────────────────────────────────────────────────

    await test('the total counts records, not lines', async () => {
        assert.strictEqual(await countRecords(file, ','), expected.length);
    });

    await test('a missing trailing newline does not change the total', async () => {
        assert.strictEqual(await countRecords(noNewline, ','), expected.length);
    });

    await test('head and tail agree on the total', async () => {
        const tail = await readTailRecords(file, 3, ',');
        assert.strictEqual(tail.totalRecordCount, await countRecords(file, ','));
    });

    // ── head ────────────────────────────────────────────────────────────────

    await test('head returns whole records', async () => {
        const rows = parseCsv(await readFirstRecords(file, 4, ','), ',');
        assert.deepStrictEqual(rows, expected.slice(0, 4));
    });

    await test('head stops on a record boundary even mid-quote', async () => {
        const rows = parseCsv(await readFirstRecords(file, 3, ','), ',');
        assert.strictEqual(rows.length, 3);
        assert.strictEqual(rows[2][2], 'two\nlines');
    });

    await test('head asked for more records than the file holds returns all of them', async () => {
        assert.deepStrictEqual(parseCsv(await readFirstRecords(file, 999, ','), ','), expected);
    });

    // ── tail ────────────────────────────────────────────────────────────────

    await test('tail returns the header plus the last records', async () => {
        const { content } = await readTailRecords(file, 3, ',');
        assert.deepStrictEqual(parseCsv(content, ','), [expected[0], ...expected.slice(-3)]);
    });

    await test('tail works without a trailing newline', async () => {
        const { content, totalRecordCount } = await readTailRecords(noNewline, 2, ',');
        assert.strictEqual(totalRecordCount, expected.length);
        assert.deepStrictEqual(parseCsv(content, ','), [expected[0], ...expected.slice(-2)]);
    });

    await test('tail asked for more records than the file holds returns all of them', async () => {
        const { content } = await readTailRecords(file, 999, ',');
        assert.deepStrictEqual(parseCsv(content, ','), expected);
    });

    // ── paged view ──────────────────────────────────────────────────────────

    await test('pages cover every data record exactly once, in order', async () => {
        const index = await buildPageIndex(file, 2, ',');
        assert.strictEqual(index.totalRows, expected.length - 1);
        const seen = [];
        for (let p = 0; p < index.offsets.length; p++) {
            const rows = parseCsv(await readPage(file, index, p), ',');
            assert.deepStrictEqual(rows[0], expected[0], 'page ' + p + ' lost its header');
            assert.ok(rows.length - 1 <= 2, 'page ' + p + ' holds more rows than the page size');
            seen.push(...dataRows(rows));
        }
        assert.deepStrictEqual(seen, dataRows(expected));
    });

    await test('a page never cuts a multi-line value in half', async () => {
        const index = await buildPageIndex(file, 1, ',');
        const rows = parseCsv(await readPage(file, index, 1), ',');
        assert.deepStrictEqual(rows[1], expected[2]);
    });

    await test('the last record without a trailing newline still gets a page', async () => {
        const index = await buildPageIndex(noNewline, 2, ',');
        assert.strictEqual(index.totalRows, expected.length - 1);
        const seen = [];
        for (let p = 0; p < index.offsets.length; p++) {
            seen.push(...dataRows(parseCsv(await readPage(noNewline, index, p), ',')));
        }
        assert.deepStrictEqual(seen, dataRows(expected));
    });

    // ── 64 KB chunk boundaries ──────────────────────────────────────────────

    await test('quote state survives a chunk boundary, including a split "" pair', async () => {
        const text = fs.readFileSync(boundary, 'utf8');
        const want = parseCsv(text, ',');
        assert.strictEqual(await countRecords(boundary, ','), want.length);
        assert.deepStrictEqual(parseCsv(await readFirstRecords(boundary, want.length, ','), ','), want);
        const { content, totalRecordCount } = await readTailRecords(boundary, 2, ',');
        assert.strictEqual(totalRecordCount, want.length);
        assert.deepStrictEqual(parseCsv(content, ','), [want[0], ...want.slice(-2)]);
        const index = await buildPageIndex(boundary, 1, ',');
        const seen = [];
        for (let p = 0; p < index.offsets.length; p++) {
            seen.push(...dataRows(parseCsv(await readPage(boundary, index, p), ',')));
        }
        assert.deepStrictEqual(seen, dataRows(want));
    });

    // ── a quote inside a value ──────────────────────────────────────────────

    // The grid reads a " only at the start of a field as an opening quote, so
    // 5" disk is plain text. The scanner used to open a quoted section at any
    // quote. On such a file the counts and pages stopped matching the grid.
    // A quote after a space behind the delimiter still opens a field, in both.
    await test('inch marks and a space before a quote split records the way the grid does', async () => {
        const lines = ['size;n;note'];
        for (let i = 0; i < 9; i++) lines.push(i + '" disk;' + i + '; "a;b\nc"');
        const text = lines.join('\n') + '\n';
        const inch = fixture('inch-marks.csv', text);
        const want = parseCsv(text, ';');
        assert.strictEqual(want.length, 10, 'the fixture no longer parses to ten records');
        assert.strictEqual(await countRecords(inch, ';'), want.length);
        assert.deepStrictEqual(parseCsv(await readFirstRecords(inch, 4, ';'), ';'), want.slice(0, 4));
        const { content, totalRecordCount } = await readTailRecords(inch, 2, ';');
        assert.strictEqual(totalRecordCount, want.length);
        assert.deepStrictEqual(parseCsv(content, ';'), [want[0], ...want.slice(-2)]);
        const index = await buildPageIndex(inch, 3, ';');
        assert.strictEqual(index.totalRows, want.length - 1);
        const seen = [];
        for (let p = 0; p < index.offsets.length; p++) {
            const rows = parseCsv(await readPage(inch, index, p), ';');
            assert.ok(rows.length - 1 <= 3, 'page ' + p + ' holds more rows than the page size');
            seen.push(...dataRows(rows));
        }
        assert.deepStrictEqual(seen, dataRows(want));
    });

    // A field of only spaces may open a quote. Spaces written inside quotes are
    // still only spaces. The scanner counted them as content, so after " " and
    // a space the next quote reopened a field in the grid but not in the
    // scanner. The counts came apart from there.
    await test('a quote after a quoted space reopens the field in both', async () => {
        const text = 'h\n" " "x\ny",z\nw,v\n';
        const spaced = fixture('quoted-space.csv', text);
        const want = parseCsv(text, ',');
        assert.strictEqual(want.length, 3, 'the fixture no longer parses to three records');
        assert.strictEqual(await countRecords(spaced, ','), want.length);
        assert.deepStrictEqual(parseCsv(await readFirstRecords(spaced, 2, ','), ','), want.slice(0, 2));
    });

    // ── a byte order mark ───────────────────────────────────────────────────

    // Excel writes UTF-8 CSV with a byte order mark. Open Full File leaves it
    // out of the text (TextDecoder does), so the previews have to leave it out
    // too. Otherwise the first header name starts with U+FEFF. These checks
    // parse the way the grid does (messaging.ts), which keeps a U+FEFF where
    // the default parse would trim it off. The mark also sits in front of a
    // quote that opens the first field. The grid reads that quote as opening
    // it, so the scanner has to as well.
    const gridParse = text => parseCsv(text, ',', false, true);

    await test('the previews leave a byte order mark out of the text', async () => {
        const text = 'id,name\n1,a\n2,b\n3,c\n';
        const bom = fixture('bom.csv', '\ufeff' + text);
        const want = gridParse(text);
        const head = await readFirstRecords(bom, 2, ',');
        assert.deepStrictEqual(gridParse(head), want.slice(0, 2), 'head: ' + JSON.stringify(head));
        const { content } = await readTailRecords(bom, 1, ',');
        assert.deepStrictEqual(gridParse(content), [want[0], want[3]], 'tail: ' + JSON.stringify(content));
        const index = await buildPageIndex(bom, 2, ',');
        const page = await readPage(bom, index, 1);
        assert.deepStrictEqual(gridParse(page), [want[0], want[3]], 'page: ' + JSON.stringify(page));
        const single = fixture('bom-one-line.csv', '\ufeffid,name');
        const whole = (await readTailRecords(single, 1, ',')).content;
        assert.strictEqual(whole, 'id,name', 'tail of a file without a line break: ' + JSON.stringify(whole));
    });

    await test('a quote after the byte order mark opens the first field', async () => {
        const text = '"first\nheader",b\n1,2\n3,4\n';
        const bom = fixture('bom-quoted.csv', '\ufeff' + text);
        const want = gridParse(text);
        assert.strictEqual(want.length, 3, 'the fixture no longer parses to three records');
        assert.strictEqual(await countRecords(bom, ','), want.length);
        assert.deepStrictEqual(gridParse(await readFirstRecords(bom, 2, ',')), want.slice(0, 2));
        const { content, totalRecordCount } = await readTailRecords(bom, 1, ',');
        assert.strictEqual(totalRecordCount, want.length);
        assert.deepStrictEqual(gridParse(content), [want[0], want[2]]);
        const index = await buildPageIndex(bom, 1, ',');
        assert.strictEqual(index.totalRows, want.length - 1);
        assert.deepStrictEqual(gridParse(await readPage(bom, index, 0)), want.slice(0, 2));
    });

    await test('the provider detects the delimiter before it scans', async () => {
        const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'csvEditorProvider.ts'), 'utf8');
        assert.ok(/scanDelimiter = this\.detectDelimiter\(filePath, await readFirstLine\(filePath\)\)/.test(src),
            'the scanners are no longer told the file\'s delimiter');
        const { readFirstLine } = require('../out/largeFileReader.js');
        assert.strictEqual(await readFirstLine(file), 'id,city,note');
    });

    // Excel's plain "CSV" is Windows-1252. Open Full File reads a file that is
    // not valid UTF-8 that way (src/encoding.ts). The previews have to show
    // the same text rather than U+FFFD for every umlaut.
    await test('a Windows-1252 file reads the same in every preview', async () => {
        const { readPreviewEncoding } = require('../out/largeFileReader.js');
        const text = 'id;city\n1;Köln\n2;"München\nOst"\n3;Zürich\n';
        const ansi = path.join(tmpDir, 'ansi.csv');
        fs.writeFileSync(ansi, Buffer.from(text, 'latin1'));
        const want = parseCsv(text, ';');
        assert.strictEqual(await readPreviewEncoding(ansi), 'windows1252');
        assert.strictEqual(await readPreviewEncoding(file), 'utf8', 'a UTF-8 file was taken for Windows-1252');
        assert.strictEqual(await readFirstRecords(ansi, 10, ';', 'windows1252'), text);
        const { content } = await readTailRecords(ansi, 2, ';', 'windows1252');
        assert.deepStrictEqual(parseCsv(content, ';'), [want[0], ...want.slice(-2)]);
        const index = await buildPageIndex(ansi, 2, ';', 'windows1252');
        assert.deepStrictEqual(parseCsv(await readPage(ansi, index, 1), ';'), [want[0], want[3]]);
    });

    await test('a UTF-8 file cut in the middle of a character is still UTF-8', async () => {
        // The encoding is taken from the first 64 KB, which can end half way
        // through a character.
        const { readPreviewEncoding } = require('../out/largeFileReader.js');
        const head = 'id,note\n' + 'x'.repeat(CHUNK - 9) + 'ö\n';
        assert.strictEqual(Buffer.byteLength(head.slice(0, -2)), CHUNK - 1, 'the ö does not straddle the 64 KB mark');
        const cut = fixture('utf8-cut.csv', head + '1,Köln\n');
        assert.strictEqual(await readPreviewEncoding(cut), 'utf8');
    });

    // ── line endings ────────────────────────────────────────────────────────

    // A classic Mac file ends its rows with a lone CR. The grid reads it that
    // way (rowsEndWithCr in webview/utils/csv.ts), the scanner ended records
    // only at LF. Head and tail read the whole file as one record, the count
    // was 1 and the paged view glued every row into the header. The files
    // below put a row break astride the 64 KB chunk boundary. They also hold a
    // value with a line break of its own, in quotes, the way Mac Excel writes
    // one.
    const EOLS = { LF: '\n', CRLF: '\r\n', 'CR CR LF': '\r\r\n', CR: '\r' };
    function eolText(eol, breakAt, rows = 3000) {
        let text = ['id,name,note', '1,"two\nlines",a', '2,"say ""hi""' + eol + 'then",b'].join(eol) + eol;
        // A filler row whose line break starts at byte `breakAt`.
        const pad = breakAt - Buffer.byteLength(text) - '3,,c'.length;
        assert.ok(pad > 0, 'filler does not fit');
        text += '3,' + 'x'.repeat(pad) + ',c' + eol;
        for (let i = 4; i < rows; i++) text += `${i},name ${i},${i % 7 ? 'plain' : '"q' + eol + 'v"'}` + eol;
        return text;
    }

    for (const [name, eol] of Object.entries(EOLS)) {
        for (const breakAt of [CHUNK - 2, CHUNK - 1, CHUNK]) {
            await test(`${name} rows split the way the grid splits them, with a break at byte ${breakAt}`, async () => {
                const { readFirstLine } = require('../out/largeFileReader.js');
                const text = eolText(eol, breakAt);
                const f = fixture(`eol-${name.replace(/ /g, '')}-${breakAt}.csv`, text);
                const want = gridParse(text);
                assert.strictEqual(want.length, 3000, 'the fixture no longer parses to 3000 records');
                assert.strictEqual(await readFirstLine(f), 'id,name,note', 'the first line');
                assert.strictEqual(await countRecords(f, ','), want.length, 'the total');
                const head = await readFirstRecords(f, 1001, ',');
                assert.ok(text.startsWith(head) && head.length < text.length, `head read ${head.length} of ${text.length} characters`);
                assert.deepStrictEqual(gridParse(head), want.slice(0, 1001), 'head');
                const { content, totalRecordCount } = await readTailRecords(f, 1000, ',');
                assert.strictEqual(totalRecordCount, want.length, 'the total of tail');
                assert.deepStrictEqual(gridParse(content), [want[0], ...want.slice(-1000)], 'tail');
                const index = await buildPageIndex(f, 500, ',');
                assert.strictEqual(index.headerLine, 'id,name,note', 'the header line');
                assert.strictEqual(index.totalRows, want.length - 1, 'the rows of the paged view');
                assert.strictEqual(index.offsets.length, Math.ceil((want.length - 1) / 500), 'the pages');
                const seen = [];
                for (let p = 0; p < index.offsets.length; p++) {
                    const rows = gridParse(await readPage(f, index, p));
                    assert.deepStrictEqual(rows[0], want[0], 'page ' + p + ' lost its header');
                    assert.ok(rows.length - 1 <= 500, 'page ' + p + ' holds ' + (rows.length - 1) + ' rows');
                    seen.push(...dataRows(rows));
                }
                assert.deepStrictEqual(seen, dataRows(want), 'the pages');
            });
        }
    }

    // The scanners learn how rows end from the start of the file. A first line
    // longer than that start whose CR is its last byte is no Mac file: the LF
    // follows right behind it.
    for (const eol of ['\r\n', '\r\r\n']) {
        await test(`a ${JSON.stringify(eol)} header longer than 64 KB is not read as a Mac file`, async () => {
            const header = 'id,' + 'h'.repeat(CHUNK - 3 - (eol.length - 1)) + eol;
            assert.strictEqual(header.indexOf('\n'), CHUNK, 'the LF does not sit right behind the first 64 KB');
            const text = header + '1,a' + eol + '2,b' + eol;
            const f = fixture('long-header-' + eol.length + '.csv', text);
            const want = gridParse(text);
            assert.strictEqual(await countRecords(f, ','), want.length);
            const { content } = await readTailRecords(f, 1, ',');
            assert.deepStrictEqual(gridParse(content), [want[0], want[2]]);
        });
    }

    // ── wiring ──────────────────────────────────────────────────────────────

    await test('the paged view hands its record total to the banner', () => {
        const root = path.join(__dirname, '..');
        const provider = fs.readFileSync(path.join(root, 'src', 'csvEditorProvider.ts'), 'utf8');
        assert.ok(/totalLineCount = pageIndex\.totalRows \+ 1;/.test(provider),
            'the paged view no longer passes its row total on, the banner would read 0');
        const pagination = fs.readFileSync(path.join(root, 'src', 'webview', 'features', 'pagination.ts'), 'utf8');
        assert.ok(/preview-text/.test(pagination),
            'nothing fills the preview banner in the paged view any more');
    });

    console.log('');
    if (failures) {
        console.error(failures + ' large-file preview test(s) failed');
        process.exit(1);
    }
}

main()
    .catch(err => { console.error(err); process.exit(1); })
    .finally(() => fs.rmSync(tmpDir, { recursive: true, force: true }));
