// Regression test for the Freeze row body/pinned split (grid/refresh.ts →
// partitionFrozenRows). The frozen row is tracked by its ARRAY REFERENCE in
// state.data, not by index, so the freeze must:
//   - pin exactly the frozen row and keep every other row in the body,
//   - FOLLOW that row when earlier rows are deleted (its _origIndex shifts),
//   - self-heal to "no freeze" when the row is gone or state.data is replaced.
// A wrong split here would pin/duplicate the wrong row — the same "wrong row"
// class of bug the v1.5.5 edit/find-replace tests guard against.
//
// Run after `npm run compile` (or `tsc -p ./`):  node test/freeze-row-partition.test.cjs

const assert = require('assert');
const { state } = require('../out/webview/state.js');
const { partitionFrozenRows } = require('../out/webview/grid/refresh.js');

let failures = 0;
function test(name, fn) {
    try { fn(); console.log('  ✓ ' + name); }
    catch (e) { failures++; console.error('  ✗ ' + name + '\n      ' + e.message); }
}

// state.data[0] is the header; data rows live at index 1..N and a row's index in
// state.data equals the _origIndex carried on its rowData object.
function makeData() {
    return [
        ['name', 'city'],        // 0  header
        ['Alice', 'Berlin'],     // 1
        ['Bob', 'Paris'],        // 2
        ['Carol', 'Madrid'],     // 3
        ['Dan', 'Lyon'],         // 4
        ['Eve', 'Rome'],         // 5
    ];
}

// Build rowData exactly like builder.ts / refresh.ts: bodyRows = data.slice(1),
// _origIndex = i + 1.
function buildRowData(data) {
    return data.slice(1).map((row, i) => ({ _origIndex: i + 1, col_0: row[0], col_1: row[1] }));
}

console.log('freeze row body/pinned partition');

test('no frozen row → everything stays in the body', () => {
    state.data = makeData();
    state.frozenRowRef = null;
    const { body, pinnedTop } = partitionFrozenRows(buildRowData(state.data));
    assert.strictEqual(pinnedTop.length, 0, 'nothing pinned');
    assert.strictEqual(body.length, 5, 'all 5 rows in body');
});

test('pins exactly the frozen row, keeps the rest in the body', () => {
    state.data = makeData();
    state.frozenRowRef = state.data[3]; // Carol (origIndex 3)
    const { body, pinnedTop } = partitionFrozenRows(buildRowData(state.data));
    assert.strictEqual(pinnedTop.length, 1, 'one pinned row');
    assert.strictEqual(pinnedTop[0].col_0, 'Carol', 'Carol is pinned');
    assert.strictEqual(pinnedTop[0]._origIndex, 3, 'pinned keeps origIndex 3');
    assert.strictEqual(body.length, 4, 'remaining 4 rows in body');
    assert.ok(!body.some(r => r.col_0 === 'Carol'), 'Carol is NOT duplicated in the body');
});

test('freeze FOLLOWS the row when an earlier row is deleted (origIndex shifts)', () => {
    state.data = makeData();
    const carol = state.data[3];
    state.frozenRowRef = carol; // freeze Carol while she is origIndex 3

    // Simulate deleteRows() removing Alice (row 1): surviving arrays keep their
    // references, so Carol is the SAME array, now at index 2.
    state.data = state.data.filter((_, i) => i !== 1);
    assert.strictEqual(state.data.indexOf(carol), 2, 'Carol shifted to origIndex 2');

    const { body, pinnedTop } = partitionFrozenRows(buildRowData(state.data));
    assert.strictEqual(pinnedTop.length, 1, 'still exactly one pinned row');
    assert.strictEqual(pinnedTop[0].col_0, 'Carol', 'still Carol, not whoever now sits at 3');
    assert.strictEqual(state.frozenRowRef, carol, 'frozenRowRef untouched');
});

test('self-heals when the frozen row itself is deleted', () => {
    state.data = makeData();
    const carol = state.data[3];
    state.frozenRowRef = carol;

    state.data = state.data.filter(row => row !== carol); // delete Carol
    const { body, pinnedTop } = partitionFrozenRows(buildRowData(state.data));
    assert.strictEqual(pinnedTop.length, 0, 'nothing pinned once the row is gone');
    assert.strictEqual(body.length, 4, 'the 4 remaining rows stay in body');
    assert.strictEqual(state.frozenRowRef, null, 'stale freeze cleared');
});

test('self-heals when state.data is replaced (paging / undo / re-parse)', () => {
    state.data = makeData();
    state.frozenRowRef = state.data[2];

    state.data = makeData(); // brand-new arrays — the old reference is gone
    const { body, pinnedTop } = partitionFrozenRows(buildRowData(state.data));
    assert.strictEqual(pinnedTop.length, 0, 'no stale pin after data replacement');
    assert.strictEqual(state.frozenRowRef, null, 'stale freeze cleared');
});

if (failures) { console.error('\n' + failures + ' test(s) failed'); process.exit(1); }
console.log('\nAll tests passed');
