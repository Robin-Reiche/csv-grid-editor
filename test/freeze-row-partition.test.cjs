// Regression test for the Freeze row(s) body/pinned split (grid/refresh.ts →
// partitionFrozenRows). Frozen rows are tracked by their ARRAY REFERENCES in
// state.data, not by index, so the split must:
//   - pin exactly the frozen rows and keep every other row in the body,
//   - pin MULTIPLE rows and keep them in natural data order,
//   - FOLLOW those rows when earlier rows are deleted (their _origIndex shifts),
//   - drop just the rows that are gone (self-heal) and clear all when state.data
//     is replaced.
// A wrong split here would pin/duplicate the wrong row.
//
// Run after `npm run compile` (or `tsc -p ./`):  node test/freeze-row-partition.test.cjs

const assert = require('assert');
const { state } = require('../out/webview/state.js');
const { partitionFrozenRows } = require('../out/webview/grid/refresh.js');
const { frozenRowPositions, reanchorFrozenRows } = require('../out/webview/features/freeze-rows.js');

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

console.log('freeze row body/pinned partition (multi-row)');

test('no frozen rows → everything stays in the body', () => {
    state.data = makeData();
    state.frozenRowRefs = [];
    const { body, pinnedTop } = partitionFrozenRows(buildRowData(state.data));
    assert.strictEqual(pinnedTop.length, 0, 'nothing pinned');
    assert.strictEqual(body.length, 5, 'all 5 rows in body');
});

test('pins exactly the one frozen row, keeps the rest in the body', () => {
    state.data = makeData();
    state.frozenRowRefs = [state.data[3]]; // Carol (origIndex 3)
    const { body, pinnedTop } = partitionFrozenRows(buildRowData(state.data));
    assert.strictEqual(pinnedTop.length, 1, 'one pinned row');
    assert.strictEqual(pinnedTop[0].col_0, 'Carol', 'Carol is pinned');
    assert.strictEqual(body.length, 4, 'remaining 4 rows in body');
    assert.ok(!body.some(r => r.col_0 === 'Carol'), 'Carol is NOT duplicated in the body');
});

test('pins MULTIPLE frozen rows in FREEZE order (newest appended last)', () => {
    state.data = makeData();
    // Freeze Dan (4) first, then Bob (2). Bob has the lower data index but was
    // frozen later, so it must come AFTER Dan, not jump to the front.
    state.frozenRowRefs = [state.data[4], state.data[2]];
    const { body, pinnedTop } = partitionFrozenRows(buildRowData(state.data));
    assert.strictEqual(pinnedTop.length, 2, 'two pinned rows');
    assert.strictEqual(pinnedTop[0].col_0, 'Dan', 'freeze order: Dan first (frozen first)');
    assert.strictEqual(pinnedTop[1].col_0, 'Bob', 'then Bob (frozen later, appended at the end)');
    assert.strictEqual(body.length, 3, 'Alice, Carol, Eve remain in body');
    assert.deepStrictEqual(state.frozenRowRefs.map(r => r[0]), ['Dan', 'Bob'], 'ref list keeps freeze order');
});

test('freeze FOLLOWS the rows when an earlier row is deleted (origIndex shifts)', () => {
    state.data = makeData();
    const bob = state.data[2], dan = state.data[4];
    state.frozenRowRefs = [bob, dan];

    // Simulate deleteRows() removing Alice (row 1): surviving arrays keep their
    // references, so Bob/Dan are the SAME arrays, now shifted up by one.
    state.data = state.data.filter((_, i) => i !== 1);
    const { body, pinnedTop } = partitionFrozenRows(buildRowData(state.data));
    assert.strictEqual(pinnedTop.length, 2, 'still two pinned rows');
    assert.deepStrictEqual(pinnedTop.map(r => r.col_0), ['Bob', 'Dan'], 'still Bob and Dan, in order');
    assert.deepStrictEqual(state.frozenRowRefs, [bob, dan], 'frozenRowRefs still hold the same arrays');
});

test('self-heals only the deleted frozen row, keeps the others', () => {
    state.data = makeData();
    const bob = state.data[2], carol = state.data[3], dan = state.data[4];
    state.frozenRowRefs = [bob, carol, dan];

    state.data = state.data.filter(row => row !== carol); // delete Carol
    const { body, pinnedTop } = partitionFrozenRows(buildRowData(state.data));
    assert.strictEqual(pinnedTop.length, 2, 'Bob and Dan stay pinned');
    assert.deepStrictEqual(pinnedTop.map(r => r.col_0), ['Bob', 'Dan'], 'Carol dropped, order kept');
    assert.deepStrictEqual(state.frozenRowRefs, [bob, dan], 'only Carol removed from the ref list');
});

test('self-heals to none when state.data is replaced (paging / undo / re-parse)', () => {
    state.data = makeData();
    state.frozenRowRefs = [state.data[2], state.data[3]];

    state.data = makeData(); // brand-new arrays — the old references are gone
    const { body, pinnedTop } = partitionFrozenRows(buildRowData(state.data));
    assert.strictEqual(pinnedTop.length, 0, 'no stale pins after data replacement');
    assert.strictEqual(state.frozenRowRefs.length, 0, 'stale freezes cleared');
});

test('frozenRowPositions + reanchorFrozenRows survive a re-parse (delimiter / external)', () => {
    state.data = makeData();
    state.frozenRowRefs = [state.data[2], state.data[4]]; // Bob, Dan (freeze order)
    const pos = frozenRowPositions();
    assert.deepStrictEqual(pos, [2, 4], 'captures positions in freeze order');

    // Simulate a re-parse: brand-new arrays, same content at the same positions.
    state.data = makeData();
    reanchorFrozenRows(pos);
    const { pinnedTop } = partitionFrozenRows(buildRowData(state.data));
    assert.deepStrictEqual(pinnedTop.map(r => r.col_0), ['Bob', 'Dan'], 're-anchored to the re-parsed rows');
});

test('reanchorFrozenRows drops positions past a shorter re-parse', () => {
    state.data = makeData();
    state.frozenRowRefs = [state.data[2], state.data[5]]; // Bob, Eve
    const pos = frozenRowPositions(); // [2, 5]

    // Re-parse that lost the last two rows (external edit removed rows).
    state.data = makeData().slice(0, 4); // header + Alice, Bob, Carol
    reanchorFrozenRows(pos);
    const { pinnedTop } = partitionFrozenRows(buildRowData(state.data));
    assert.deepStrictEqual(pinnedTop.map(r => r.col_0), ['Bob'], 'Bob kept, Eve (gone) dropped');
});

if (failures) { console.error('\n' + failures + ' test(s) failed'); process.exit(1); }
console.log('\nAll tests passed');
