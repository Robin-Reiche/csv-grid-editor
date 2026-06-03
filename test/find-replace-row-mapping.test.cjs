// Regression test for "Find & Replace writes to the wrong row under filter/sort".
//
// Same root cause as the cell-edit bug: a FindMatch built from a displayed node
// must carry the row's _origIndex, and the replace write must use it — not the
// display rowIndex, which points at the wrong state.data row once sorted/filtered.
//
// Run after `npm run compile` (or `tsc -p ./`):  node test/find-replace-row-mapping.test.cjs

const assert = require('assert');
const { dataRowIndexForFindMatch } = require('../out/webview/grid/row-mapping.js');

let failures = 0;
function test(name, fn) {
    try { fn(); console.log('  ✓ ' + name); }
    catch (e) { failures++; console.error('  ✗ ' + name + '\n      ' + e.message); }
}

function makeState() {
    return [
        ['name', 'date'],          // 0  header
        ['anna', '2024-01-01'],    // 1
        ['mieki', '2024-03-05'],   // 2
        ['bob', '2024-02-02'],     // 3
        ['mieki', '2024-05-09'],   // 4
        ['mieki', '2024-04-07'],   // 5
    ];
}

function buildRowData(data) {
    return data.slice(1).map((row, i) => ({ _origIndex: i + 1, col_0: row[0], col_1: row[1] }));
}

// Mirror execFind under filter("mieki") + sort(date desc): collect matches for a
// needle in display order. Each match carries the DISPLAY rowIndex and the row's
// _origIndex — exactly what the fixed execFind stores.
function findMatches(data, needle, colField) {
    const ci = parseInt(colField.replace('col_', ''), 10);
    return buildRowData(data)
        .filter(r => r.col_0 === 'mieki')
        .sort((a, b) => b.col_1.localeCompare(a.col_1)) // date desc
        .map((d, displayIndex) => ({ d, displayIndex }))
        .filter(({ d }) => String(d['col_' + ci]).includes(needle))
        .map(({ d, displayIndex }) => ({ rowIndex: displayIndex, origIndex: d._origIndex, colField }));
}

// Simulate replaceOne's data write.
function replaceOne(data, m, replaced) {
    const colIdx = parseInt(m.colField.replace('col_', ''), 10);
    const dataIndex = dataRowIndexForFindMatch(m);
    data[dataIndex][colIdx] = replaced;
}

console.log('find & replace row mapping under filter + sort');

test('replace on top filtered+sorted match updates THAT row, not row 1', () => {
    const data = makeState();
    // Search "2024" in the date column; top match (date desc) is 2024-05-09 -> row 4.
    const matches = findMatches(data, '2024', 'col_1');
    const top = matches[0];
    assert.strictEqual(top.origIndex, 4, 'fixture: top match is state.data row 4');

    replaceOne(data, top, '1999-09-09');

    assert.strictEqual(data[4][1], '1999-09-09', 'edited mieki row should change');
    assert.strictEqual(data[1][1], '2024-01-01', 'anna (row 1) must NOT change');
});

test('replaceAll over filtered+sorted matches hits exactly the matched rows', () => {
    const data = makeState();
    const matches = findMatches(data, 'mieki', 'col_0'); // all 3 mieki rows
    matches.forEach(m => replaceOne(data, m, 'MIEKI'));

    assert.strictEqual(data[2][0], 'MIEKI');
    assert.strictEqual(data[4][0], 'MIEKI');
    assert.strictEqual(data[5][0], 'MIEKI');
    assert.strictEqual(data[1][0], 'anna', 'anna must NOT change');
    assert.strictEqual(data[3][0], 'bob', 'bob must NOT change');
});

if (failures) { console.error('\n' + failures + ' test(s) failed'); process.exit(1); }
console.log('\nAll tests passed');
