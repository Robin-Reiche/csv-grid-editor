// Value distribution for a single column (issue #33). Deliberately free of DOM
// and state so it can be exercised from a plain Node test the way csv.ts is.

export interface HistBin {
    // [lo, hi). The last bin includes its upper bound so the maximum value has
    // somewhere to land.
    lo: number;
    hi: number;
    count: number;
}

// Upper limit on bins. Freedman-Diaconis can ask for thousands on a heavily
// skewed column, a narrow IQR divided into a long tail, and past this point the
// panel has no pixels left to draw them in anyway.
const MAX_BINS = 40;

function distinctCount(sorted: ArrayLike<number>, from: number, to: number): number {
    let d = 0;
    for (let i = from; i <= to; i++) {
        if (i === from || sorted[i] !== sorted[i - 1]) d++;
    }
    return d;
}

// Freedman-Diaconis bin width: 2 * IQR / n^(1/3). It sizes the bins from where
// the middle half of the values actually sit, which is what keeps the shape
// readable on skewed data. A fixed bin count would put nearly everything into
// one bar there. Falls back to Sturges when the IQR is zero, i.e. when more than
// half the values are identical and there is no spread to measure.
export function binCount(sorted: ArrayLike<number>, from: number = 0, to: number = sorted.length - 1): number {
    const n = to - from + 1;
    if (n < 2) return 1;
    const span = sorted[to] - sorted[from];
    if (span <= 0) return 1;

    const at    = (p: number): number => sorted[Math.min(to, from + Math.floor(p * n))];
    const iqr   = at(0.75) - at(0.25);
    const width = iqr > 0 ? 2 * iqr / Math.cbrt(n) : 0;
    const bins  = width > 0 ? Math.ceil(span / width) : Math.ceil(Math.log2(n)) + 1;

    // Never ask for more bins than there are distinct values: an integer column
    // holding 1 to 5 gets five bars, not forty slivers of which most are empty.
    return Math.max(1, Math.min(bins, MAX_BINS, distinctCount(sorted, from, to)));
}

// Bins an ASCENDING sequence of numbers. Takes an ArrayLike so a Float64Array
// can be passed straight through without a copy, which is what the profile does
// on large files. Non-finite entries are dropped rather than allowed to collapse
// the whole range: because the input is ascending they can only sit at the ends,
// so trimming the ends is enough and costs no allocation. An empty input yields
// no bins at all.
export function histogram(sorted: ArrayLike<number>): HistBin[] {
    let from = 0, to = sorted.length - 1;
    while (from <= to && !Number.isFinite(sorted[from])) from++;
    while (to >= from && !Number.isFinite(sorted[to]))   to--;
    if (to < from) return [];

    const min = sorted[from];
    const max = sorted[to];
    const k   = binCount(sorted, from, to);
    const width = (max - min) / k;

    const bins: HistBin[] = [];
    for (let i = 0; i < k; i++) {
        bins.push({
            lo: width > 0 ? min + i * width : min,
            hi: width > 0 ? min + (i + 1) * width : max,
            count: 0
        });
    }
    bins[k - 1].hi = max;

    for (let j = from; j <= to; j++) {
        const i = width > 0 ? Math.min(k - 1, Math.floor((sorted[j] - min) / width)) : 0;
        bins[i].count++;
    }
    return bins;
}

// Merges adjacent bins down to at most `max` buckets. The thumbnail in the
// overview row is around 44px wide, where forty bars cannot each keep a visible
// pixel plus a gap, and a flex row that cannot shrink that far overflows into
// the next table column instead. Resolution goes, the shape stays, which is the
// right trade at that size. Total count is preserved.
export function downsample(counts: number[], max: number): number[] {
    if (max < 1 || counts.length <= max) return counts.slice();
    const out: number[] = [];
    for (let i = 0; i < max; i++) {
        const lo = Math.floor(i * counts.length / max);
        const hi = Math.floor((i + 1) * counts.length / max);
        let sum = 0;
        for (let j = lo; j < hi; j++) sum += counts[j];
        out.push(sum);
    }
    return out;
}
