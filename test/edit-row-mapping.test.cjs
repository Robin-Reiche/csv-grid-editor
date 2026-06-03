// Regression test for the "edit lands on the wrong row under filter/sort" bug.
//
// Reproduces the exact user scenario: filter transactions to "mieki", sort by
// date descending, then edit the date of the top visible row. The edit must
// land on THAT row in state.data — not on row 1 of the unfiltered original.
//
// Run after `npm run compile` (or `tsc -p ./`):  node test/edit-row-mapping.test.cjs

const assert = require('assert');
const { dataRowIndexForNode } = require('../out/webview/grid/row-mapping.js');

let failures = 0;
function test(name, fn) {
    try { fn(); console.log('  ✓ ' + name); }
    catch (e) { failures++; console.error('  ✗ ' + name + '\n      ' + e.message); }
}

// ── Scenario fixture ──────────────────────────────────────────────────────────
// Mirrors the user's transactions.csv shape. state.data[0] is the header.
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

// Build rowData exactly like builder.ts: bodyRows = state.data.slice(1),
// _origIndex = i + 1.
function buildRowData(data) {
    return data.slice(1).map((row, i) => ({ _origIndex: i + 1, col_0: row[0], col_1: row[1] }));
}

// Produce the displayed nodes after filter("mieki") + sort(date desc), each with
// the DISPLAY rowIndex AG Grid would assign (0-based, post sort/filter).
function displayedNodesFilterMiekiSortDateDesc(rowData) {
    return rowData
        .filter(r => r.col_0 === 'mieki')
        .sort((a, b) => b.col_1.localeCompare(a.col_1)) // date desc
        .map((data, displayIndex) => ({ rowIndex: displayIndex, data }));
}

// Simulate onCellValueChanged: map node -> data row, then write the new value.
function applyEdit(data, node, colIndex, newValue) {
    const dataIndex = dataRowIndexForNode(node);
    while (data[dataIndex].length <= colIndex) data[dataIndex].push('');
    data[dataIndex][colIndex] = newValue;
}

console.log('edit row mapping under filter + sort');

test('editing top filtered+sorted row updates THAT row, not row 1', () => {
    const data = makeState();
    const nodes = displayedNodesFilterMiekiSortDateDesc(buildRowData(data));

    // Top visible row after "mieki" filter + date-desc sort is mieki/2024-05-09,
    // which is state.data index 4. Edit its date (col 1).
    const topNode = nodes[0];
    assert.strictEqual(topNode.data.col_1, '2024-05-09', 'fixture: top row is 2024-05-09');

    applyEdit(data, topNode, 1, '2024-12-31');

    assert.strictEqual(data[4][1], '2024-12-31', 'edited mieki row should change');
    assert.strictEqual(data[1][1], '2024-01-01', 'anna (row 1) must NOT change');
});

test('editing affects all columns of the correct row, not row 1', () => {
    const data = makeState();
    const nodes = displayedNodesFilterMiekiSortDateDesc(buildRowData(data));

    applyEdit(data, nodes[0], 0, 'EDITED'); // edit the name column

    assert.strictEqual(data[4][0], 'EDITED', 'name of edited mieki row should change');
    assert.strictEqual(data[1][0], 'anna', 'anna (row 1) name must NOT change');
});

test('default unsorted/unfiltered view still maps correctly', () => {
    const data = makeState();
    const rowData = buildRowData(data);
    // Default view: display order == data order.
    const nodes = rowData.map((d, i) => ({ rowIndex: i, data: d }));

    applyEdit(data, nodes[2], 1, '1999-09-09'); // 3rd visible row -> state.data[3] (bob)

    assert.strictEqual(data[3][1], '1999-09-09', 'bob row should change');
});

if (failures) { console.error('\n' + failures + ' test(s) failed'); process.exit(1); }
console.log('\nAll tests passed');
