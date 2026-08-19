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
        assert.strictEqual(await countRecords(file), expected.length);
    });

    await test('a missing trailing newline does not change the total', async () => {
        assert.strictEqual(await countRecords(noNewline), expected.length);
    });

    await test('head and tail agree on the total', async () => {
        const tail = await readTailRecords(file, 3);
        assert.strictEqual(tail.totalRecordCount, await countRecords(file));
    });

    // ── head ────────────────────────────────────────────────────────────────

    await test('head returns whole records', async () => {
        const rows = parseCsv(await readFirstRecords(file, 4), ',');
        assert.deepStrictEqual(rows, expected.slice(0, 4));
    });

    await test('head stops on a record boundary even mid-quote', async () => {
        const rows = parseCsv(await readFirstRecords(file, 3), ',');
        assert.strictEqual(rows.length, 3);
        assert.strictEqual(rows[2][2], 'two\nlines');
    });

    await test('head asked for more records than the file holds returns all of them', async () => {
        assert.deepStrictEqual(parseCsv(await readFirstRecords(file, 999), ','), expected);
    });

    // ── tail ────────────────────────────────────────────────────────────────

    await test('tail returns the header plus the last records', async () => {
        const { content } = await readTailRecords(file, 3);
        assert.deepStrictEqual(parseCsv(content, ','), [expected[0], ...expected.slice(-3)]);
    });

    await test('tail works without a trailing newline', async () => {
        const { content, totalRecordCount } = await readTailRecords(noNewline, 2);
        assert.strictEqual(totalRecordCount, expected.length);
        assert.deepStrictEqual(parseCsv(content, ','), [expected[0], ...expected.slice(-2)]);
    });

    await test('tail asked for more records than the file holds returns all of them', async () => {
        const { content } = await readTailRecords(file, 999);
        assert.deepStrictEqual(parseCsv(content, ','), expected);
    });

    // ── paged view ──────────────────────────────────────────────────────────

    await test('pages cover every data record exactly once, in order', async () => {
        const index = await buildPageIndex(file, 2);
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
        const index = await buildPageIndex(file, 1);
        const rows = parseCsv(await readPage(file, index, 1), ',');
        assert.deepStrictEqual(rows[1], expected[2]);
    });

    await test('the last record without a trailing newline still gets a page', async () => {
        const index = await buildPageIndex(noNewline, 2);
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
        assert.strictEqual(await countRecords(boundary), want.length);
        assert.deepStrictEqual(parseCsv(await readFirstRecords(boundary, want.length), ','), want);
        const { content, totalRecordCount } = await readTailRecords(boundary, 2);
        assert.strictEqual(totalRecordCount, want.length);
        assert.deepStrictEqual(parseCsv(content, ','), [want[0], ...want.slice(-2)]);
        const index = await buildPageIndex(boundary, 1);
        const seen = [];
        for (let p = 0; p < index.offsets.length; p++) {
            seen.push(...dataRows(parseCsv(await readPage(boundary, index, p), ',')));
        }
        assert.deepStrictEqual(seen, dataRows(want));
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
