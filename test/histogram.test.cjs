// Tests for the column value distribution (issue #33). The binning is the part
// worth pinning down, because everything the panel draws is a scaled copy of
// these counts. Four properties have to hold:
//   1. Nothing is lost or double-counted. The bin counts always sum to the
//      number of finite input values, including the maximum, which sits exactly
//      on the upper bound of the last bin.
//   2. The bins cover the data and nothing beyond it. First lo is the minimum,
//      last hi is the maximum.
//   3. The bin count adapts. Freedman-Diaconis on skewed data must produce more
//      than one bar, otherwise the panel shows a single spike and the whole
//      feature says nothing. It must also never exceed the number of distinct
//      values, so a 1-to-5 integer column gets five bars and not forty.
//   4. Degenerate input does not throw. Empty, single value, all identical,
//      Infinity.
//
// Run after `npm run compile` (or `tsc -p ./`):  node test/histogram.test.cjs

const assert = require('assert');
const { histogram, binCount, downsample } = require('../out/webview/utils/histogram.js');

let failures = 0;
function test(name, fn) {
    try { fn(); console.log('  ✓ ' + name); }
    catch (e) { failures++; console.error('  ✗ ' + name + '\n      ' + e.message); }
}

const asc = arr => arr.slice().sort((a, b) => a - b);
const sum = bins => bins.reduce((s, b) => s + b.count, 0);

console.log('column distribution');

// ── coverage and conservation ────────────────────────────────────────────────

test('every value lands in exactly one bin', () => {
    const vals = asc(Array.from({ length: 500 }, (_, i) => (i * 7919) % 1000));
    const bins = histogram(vals);
    assert.strictEqual(sum(bins), vals.length);
});

test('the bins span exactly min to max', () => {
    const bins = histogram(asc([3, 91, 12, 44, 7, 65, 28]));
    assert.strictEqual(bins[0].lo, 3);
    assert.strictEqual(bins[bins.length - 1].hi, 91);
});

test('the maximum lands in the last bin, not past it', () => {
    const vals = asc([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const bins = histogram(vals);
    assert.strictEqual(sum(bins), vals.length);
    assert.ok(bins[bins.length - 1].count > 0, 'last bin is empty, the max fell out of range');
});

test('bins are contiguous, no gap and no overlap', () => {
    const bins = histogram(asc(Array.from({ length: 200 }, (_, i) => i * 1.5)));
    for (let i = 1; i < bins.length; i++) {
        assert.ok(Math.abs(bins[i].lo - bins[i - 1].hi) < 1e-9,
            `gap between bin ${i - 1} and ${i}: ${bins[i - 1].hi} then ${bins[i].lo}`);
    }
});

// ── how many bins ────────────────────────────────────────────────────────────

test('a skewed column keeps its tail visible instead of collapsing to one bar', () => {
    // Reaction-time shaped: a dense cluster low down plus a long thin tail.
    const vals = asc([
        ...Array.from({ length: 400 }, (_, i) => 200 + (i % 120)),
        ...Array.from({ length: 20 },  (_, i) => 900 + i * 140),
    ]);
    const bins = histogram(vals);
    assert.ok(bins.length > 4, 'expected several bins, got ' + bins.length);
    assert.ok(bins.filter(b => b.count > 0).length > 2, 'the tail collapsed into the cluster');
    assert.strictEqual(sum(bins), vals.length);
});

test('never more bins than distinct values', () => {
    const vals = asc(Array.from({ length: 300 }, (_, i) => (i % 5) + 1));
    const bins = histogram(vals);
    assert.ok(bins.length <= 5, 'got ' + bins.length + ' bins for 5 distinct values');
    assert.strictEqual(sum(bins), vals.length);
});

test('the bin count stays inside the panel budget', () => {
    // A narrow IQR next to a huge range is what makes Freedman-Diaconis ask for
    // thousands of bins. The cap has to hold.
    const vals = asc([...Array.from({ length: 999 }, () => 1), 1e9]);
    assert.ok(binCount(vals) <= 40, 'binCount returned ' + binCount(vals));
    assert.ok(histogram(vals).length <= 40);
});

// ── degenerate input ─────────────────────────────────────────────────────────

test('no values means no bins', () => {
    assert.deepStrictEqual(histogram([]), []);
});

test('a single value gives one bin holding it', () => {
    const bins = histogram([42]);
    assert.strictEqual(bins.length, 1);
    assert.deepStrictEqual(bins[0], { lo: 42, hi: 42, count: 1 });
});

test('all values identical gives one bin, not a division by zero', () => {
    const bins = histogram([5, 5, 5, 5]);
    assert.strictEqual(bins.length, 1);
    assert.strictEqual(bins[0].count, 4);
    assert.ok(bins.every(b => Number.isFinite(b.lo) && Number.isFinite(b.hi)));
});

test('Infinity and NaN are dropped instead of flattening the range', () => {
    const bins = histogram([1, 2, 3, 4, 5, Infinity]);
    assert.strictEqual(sum(bins), 5);
    assert.strictEqual(bins[bins.length - 1].hi, 5);
    assert.strictEqual(sum(histogram([NaN, NaN])), 0);
});

test('negative values keep their order', () => {
    const bins = histogram(asc([-50, -20, -1, 0, 3]));
    assert.strictEqual(bins[0].lo, -50);
    assert.strictEqual(bins[bins.length - 1].hi, 3);
    assert.strictEqual(sum(bins), 5);
});

// ── dates are just epoch milliseconds ────────────────────────────────────────

test('date columns bin as epoch milliseconds', () => {
    const times = asc(['2024-01-01', '2024-04-01', '2024-07-01', '2024-12-31']
        .map(d => new Date(d).getTime()));
    const bins = histogram(times);
    assert.strictEqual(sum(bins), 4);
    assert.strictEqual(new Date(bins[0].lo).toISOString().slice(0, 10), '2024-01-01');
    assert.strictEqual(new Date(bins[bins.length - 1].hi).toISOString().slice(0, 10), '2024-12-31');
});

// ── the overview thumbnail ───────────────────────────────────────────────────
// A 44px cell cannot hold 40 bars plus their gaps. The flex row would refuse to
// shrink below its min-widths and spill into the next table column, so the bins
// are merged down first.

test('downsample keeps the total count', () => {
    const counts = [3, 9, 14, 22, 40, 31, 18, 9, 4, 2, 1];
    assert.strictEqual(downsample(counts, 4).reduce((s, c) => s + c, 0),
                       counts.reduce((s, c) => s + c, 0));
});

test('downsample returns at most the requested number of buckets', () => {
    assert.strictEqual(downsample(Array(40).fill(1), 15).length, 15);
    assert.strictEqual(downsample(Array(37).fill(1), 15).length, 15);
});

test('downsample leaves a short series alone', () => {
    assert.deepStrictEqual(downsample([5, 2], 15), [5, 2]);
    assert.deepStrictEqual(downsample([], 15), []);
});

test('downsample keeps the shape, the peak stays where it was', () => {
    // Rising then falling: the tallest bucket has to stay in the middle.
    const counts = [1, 2, 4, 8, 16, 32, 64, 32, 16, 8, 4, 2, 1, 1, 1, 1, 1, 1, 1, 1];
    const small  = downsample(counts, 5);
    const peak   = small.indexOf(Math.max(...small));
    assert.ok(peak === 1 || peak === 2, 'peak moved to bucket ' + peak);
});

test('downsample never drops a bucket on the floor', () => {
    // Every input bin has to be counted exactly once, no index skipped or reused.
    const counts = Array.from({ length: 40 }, (_, i) => i + 1);
    assert.strictEqual(downsample(counts, 15).reduce((s, c) => s + c, 0), 820);
});

console.log(failures === 0 ? '\nall distribution tests passed' : `\n${failures} test(s) failed`);
process.exit(failures === 0 ? 0 : 1);
