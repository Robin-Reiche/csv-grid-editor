// Tests for computeProfile, the numbers the Column Profile panel shows. The
// function was rewritten for speed on wide files (a 116k x 48 sheet is 5.6
// million cells per pass), and everything below is what that rewrite must not
// change:
//   1. Null and fill counting. A cell is null when it is empty after trimming,
//      and only then.
//   2. The numeric summary. Min, max, mean, median and standard deviation come
//      off a Float64Array sorted natively now instead of a number[] sorted with
//      a comparator, which has to give the same answers.
//   3. Distinct counting. Columns with an axis count distinct values ON that
//      axis, so "1.0" and "1.00" are one number, while a value that is not on
//      the axis at all still counts once. Every other type counts distinct
//      strings.
//   4. Strings survive their own path: length stats without spreading a large
//      array into an argument list, and top values by frequency.
//
// Run after `npm run compile` (or `tsc -p ./`):  node test/column-profile.test.cjs

const assert = require('assert');
const { state } = require('../out/webview/state.js');
const { computeProfile } = require('../out/webview/features/profile.js');

let failures = 0;
function test(name, fn) {
    try { fn(); console.log('  ✓ ' + name); }
    catch (e) { failures++; console.error('  ✗ ' + name + '\n      ' + e.message); }
}

// Loads one column and returns its profile.
function profileCol(type, cells) {
    state.data = [['col'], ...cells.map(v => [v])];
    state.colTypes = [type];
    return computeProfile()[0];
}

console.log('column profile');

// ── nulls and fill ───────────────────────────────────────────────────────────

test('an empty or whitespace-only cell counts as null, nothing else does', () => {
    const p = profileCol('string', ['a', '', '   ', 'b', '\t', '0']);
    assert.strictEqual(p.total, 6);
    assert.strictEqual(p.nullCount, 3);
    assert.strictEqual(p.nullPct, 50);
});

test('values are trimmed before they are counted', () => {
    const p = profileCol('string', ['  x  ', 'x', 'x ']);
    assert.strictEqual(p.uniqueCount, 1);
    assert.strictEqual(p.maxLen, 1);
});

test('a short row does not throw and its missing cells are null', () => {
    state.data = [['a', 'b'], ['1', '2'], ['3']];
    state.colTypes = ['integer', 'integer'];
    const [, second] = computeProfile();
    assert.strictEqual(second.nullCount, 1);
    assert.strictEqual(second.total, 2);
});

// ── numeric summary ──────────────────────────────────────────────────────────

test('min, max, mean and standard deviation', () => {
    const p = profileCol('integer', ['2', '4', '4', '4', '5', '5', '7', '9']);
    assert.strictEqual(p.min, 2);
    assert.strictEqual(p.max, 9);
    assert.strictEqual(p.mean, 5);
    assert.strictEqual(p.stdDev, 2);          // the textbook population sigma
});

test('the median averages the middle pair on an even count', () => {
    assert.strictEqual(profileCol('integer', ['1', '2', '3', '4']).median, 2.5);
    assert.strictEqual(profileCol('integer', ['1', '2', '3']).median, 2);
});

test('values sort numerically, not as text', () => {
    // The bug a string sort would produce: max 9 instead of 100.
    const p = profileCol('integer', ['9', '100', '20']);
    assert.strictEqual(p.min, 9);
    assert.strictEqual(p.max, 100);
    assert.strictEqual(p.median, 20);
});

test('negative numbers and decimals keep their order', () => {
    const p = profileCol('float', ['-2.5', '0.5', '-10', '3.25']);
    assert.strictEqual(p.min, -10);
    assert.strictEqual(p.max, 3.25);
});

test('a numeric column gets a histogram, a string column does not', () => {
    assert.ok(profileCol('integer', ['1', '2', '3', '4', '5']).histogram.length >= 1);
    assert.strictEqual(profileCol('integer', ['1', '2', '3']).histKind, 'number');
    assert.strictEqual(profileCol('string', ['a', 'b']).histogram, undefined);
});

// ── distinct counting ────────────────────────────────────────────────────────

test('a numeric column counts distinct numbers, not distinct spellings', () => {
    assert.strictEqual(profileCol('float', ['1.0', '1.00', '1']).uniqueCount, 1);
    assert.strictEqual(profileCol('integer', ['1', '2', '2', '3']).uniqueCount, 3);
});

test('a value that is not a number still counts once', () => {
    // 'N/A' in an otherwise numeric column is not null and not on the axis.
    const p = profileCol('integer', ['1', '2', '2', 'N/A', 'N/A', 'missing']);
    assert.strictEqual(p.uniqueCount, 4);     // 1, 2, N/A, missing
    assert.strictEqual(p.nullCount, 0);
    assert.strictEqual(p.max, 2);             // and it stays out of the stats
});

test('a string column counts distinct strings, case included', () => {
    assert.strictEqual(profileCol('string', ['a', 'A', 'a']).uniqueCount, 2);
});

// ── strings ──────────────────────────────────────────────────────────────────

test('length stats ignore nulls', () => {
    const p = profileCol('string', ['ab', '', 'abcd', 'a']);
    assert.strictEqual(p.minLen, 1);
    assert.strictEqual(p.maxLen, 4);
    assert.strictEqual(p.avgLen, 7 / 3);
});

test('length stats survive a column too large to spread into an argument list', () => {
    // Math.min(...lens) throws a RangeError somewhere around here.
    const cells = new Array(200000).fill('xy');
    cells[0] = 'z';
    const p = profileCol('string', cells);
    assert.strictEqual(p.minLen, 1);
    assert.strictEqual(p.maxLen, 2);
});

test('top values are the five most frequent, most frequent first', () => {
    const p = profileCol('string', [
        'a','a','a','a', 'b','b','b', 'c','c', 'd','d', 'e', 'f'
    ]);
    assert.deepStrictEqual(p.topValues, [['a',4],['b',3],['c',2],['d',2],['e',1]]);
});

// ── other types ──────────────────────────────────────────────────────────────

test('boolean counts both spellings and ignores anything else', () => {
    const p = profileCol('boolean', ['true','TRUE','yes','1','false','no','0','maybe']);
    assert.strictEqual(p.trueCount, 4);
    assert.strictEqual(p.falseCount, 3);
});

test('a date column reports its range in days and bins over time', () => {
    const p = profileCol('date', ['2024-03-01', '2024-01-01', '2024-01-31']);
    assert.strictEqual(p.minDate, '2024-01-01');
    assert.strictEqual(p.maxDate, '2024-03-01');
    assert.strictEqual(p.rangeDays, 60);
    assert.strictEqual(p.histKind, 'date');
});

test('an unparseable date stays out of the range but is still counted', () => {
    const p = profileCol('date', ['2024-01-01', 'not a date', '2024-01-11']);
    assert.strictEqual(p.rangeDays, 10);
    assert.strictEqual(p.uniqueCount, 3);
});

test('a column with no rows at all yields no profiles', () => {
    state.data = [['a']];
    state.colTypes = ['string'];
    assert.deepStrictEqual(computeProfile(), []);
});

console.log(failures === 0 ? '\nall column profile tests passed' : `\n${failures} test(s) failed`);
process.exit(failures === 0 ? 0 : 1);
