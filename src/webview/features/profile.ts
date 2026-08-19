import { state } from '../state';
import { histogram, downsample } from '../utils/histogram';
import type { ColProfile, ColType } from '../types';

const BADGE_TEXT: Record<string, string> = {
    integer: '123', float: '1.0', string: 'abc',
    boolean: 'T/F', date: 'date', datetime: 'dt', time: 'time'
};

function fmtNum(n: number | undefined, dec?: number): string {
    if (n == null || isNaN(n)) return '\u2014';
    if (dec !== undefined) return (+n.toFixed(dec)).toLocaleString(undefined, { maximumFractionDigits: dec });
    return Number.isInteger(n) ? n.toLocaleString() : (+n.toFixed(4)).toLocaleString();
}

function fmtPct(n: number): string {
    if (!n) return '0%';
    return n < 0.1 ? '<0.1%' : n.toFixed(1) + '%';
}

// The value a cell contributes to the profile. The parser hands out strings
// already, so String() is a call paid once per cell for nothing, and trim() only
// has work when there is whitespace at an end. Checking the two end characters
// first is most of what makes this affordable on a wide file: on a 116k x 48
// sheet that is 5.6 million cells per pass.
function tidy(raw: unknown): string {
    if (typeof raw !== 'string') return raw == null ? '' : String(raw).trim();
    const len = raw.length;
    if (len === 0) return '';
    return (raw.charCodeAt(0) <= 32 || raw.charCodeAt(len - 1) <= 32) ? raw.trim() : raw;
}

export function computeProfile(): ColProfile[] {
    if (!state.data || state.data.length < 2) return [];
    const headerRow = state.data[0];
    const bodyRows  = state.data.slice(1);
    const total     = bodyRows.length;
    const profiles: ColProfile[] = [];

    for (let c = 0; c < headerRow.length; c++) {
        const ct = (state.colTypes[c] || 'string') as ColType;
        const numeric  = ct === 'integer' || ct === 'float';
        const temporal = ct === 'date' || ct === 'datetime';

        // A column that has an axis, numbers or points in time, is summarised
        // straight off a typed array of that axis and never materialises a
        // string array at all. Everything else keeps its values as strings,
        // because length, frequency and the true/false split are string work.
        const axis = (numeric || temporal) ? new Float64Array(total) : null;
        const values: string[] = [];
        // Non-empty values that do not sit on the axis, e.g. an "N/A" in a
        // column that is numeric for the other 90%. Only allocated when one
        // actually turns up, which on a clean file is never.
        let offAxis: Set<string> | null = null;
        let k = 0, sum = 0, nullCount = 0;

        for (let r = 0; r < total; r++) {
            const row = bodyRows[r];
            const v = row != null ? tidy(row[c]) : '';
            if (v === '') { nullCount++; continue; }
            if (axis) {
                const x = numeric ? +v : Date.parse(v);
                if (x === x) { axis[k++] = x; sum += x; }   // x === x rejects NaN
                else (offAxis || (offAxis = new Set())).add(v);
            } else {
                values.push(v);
            }
        }

        const p: ColProfile = {
            name: headerRow[c] || `(col ${c + 1})`, type: ct,
            total, nullCount, nullPct: total > 0 ? nullCount / total * 100 : 0,
            uniqueCount: 0
        };

        if (axis) {
            const vals = axis.subarray(0, k);
            // The native sort on a typed array, no JS comparator called per
            // comparison. This is also what makes the distinct count a scan
            // over neighbours instead of a hash set over every value.
            vals.sort();
            let distinct = 0;
            for (let i = 0; i < k; i++) if (i === 0 || vals[i] !== vals[i - 1]) distinct++;
            p.uniqueCount = distinct + (offAxis ? offAxis.size : 0);

            if (k && numeric) {
                p.min    = vals[0];
                p.max    = vals[k - 1];
                p.mean   = sum / k;
                p.median = k % 2 === 0 ? (vals[k / 2 - 1] + vals[k / 2]) / 2 : vals[k >> 1];
                let sq = 0;
                for (let i = 0; i < k; i++) { const d = vals[i] - p.mean; sq += d * d; }
                p.stdDev = Math.sqrt(sq / k);
                p.histogram = histogram(vals);
                p.histKind  = 'number';
            } else if (k) {
                p.minDate   = new Date(vals[0]).toISOString().slice(0, 10);
                p.maxDate   = new Date(vals[k - 1]).toISOString().slice(0, 10);
                p.rangeDays = Math.round((vals[k - 1] - vals[0]) / 86400000);
                p.histogram = histogram(vals);
                p.histKind  = 'date';
            }
        } else {
            p.uniqueCount = new Set(values).size;

            if (ct === 'string' || ct === 'time') {
                if (ct === 'string' && values.length) {
                    // A plain loop, not Math.min(...lens): spreading a six-figure
                    // array into an argument list is what blows the stack.
                    let minLen = Infinity, maxLen = 0, sumLen = 0;
                    for (let i = 0; i < values.length; i++) {
                        const l = values[i].length;
                        if (l < minLen) minLen = l;
                        if (l > maxLen) maxLen = l;
                        sumLen += l;
                    }
                    p.minLen = minLen; p.maxLen = maxLen; p.avgLen = sumLen / values.length;
                }
                const freq = new Map<string, number>();
                for (let i = 0; i < values.length; i++) {
                    const v = values[i];
                    freq.set(v, (freq.get(v) || 0) + 1);
                }
                p.topValues = Array.from(freq.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);
            } else if (ct === 'boolean') {
                const T: Record<string, number> = { 'true':1,'yes':1,'1':1,'t':1,'y':1 };
                const F: Record<string, number> = { 'false':1,'no':1,'0':1,'f':1,'n':1 };
                let tc = 0, fc = 0;
                for (let i = 0; i < values.length; i++) {
                    const lo = values[i].toLowerCase();
                    if (T[lo]) tc++; else if (F[lo]) fc++;
                }
                p.trueCount = tc; p.falseCount = fc;
            }
        }
        profiles.push(p);
    }
    return profiles;
}

// ── Distribution (issue #33) ─────────────────────────────────────────────────
// One <div> per bar, height scaled against the fullest bar. A bar that holds
// anything at all keeps a visible sliver via CSS min-height, otherwise the thin
// tail of a skewed column sinks into the baseline and the whole shape reads as a
// single spike, which is the one thing the panel is supposed to show.

function fmtBinBound(v: number, kind: 'number' | 'date'): string {
    if (kind === 'date') return new Date(v).toISOString().slice(0, 10);
    if (Number.isInteger(v)) return v.toLocaleString();
    const abs = Math.abs(v);
    const dec = abs >= 100 ? 1 : abs >= 1 ? 2 : 4;
    return fmtNum(v, dec);
}

// How many bars the overview thumbnail can hold. At 44px wide with a 1px gap
// between them, more than this and the bars have no pixel left each.
const MINI_BARS = 15;

function makeBars(counts: number[], mini: boolean, titleFor?: (i: number) => string): HTMLElement | null {
    if (!counts.length) return null;
    const maxCnt = counts.reduce((m, c) => c > m ? c : m, 0);
    if (maxCnt <= 0) return null;

    const wrap = document.createElement('div');
    wrap.className = mini ? 'ov-spark' : 'profile-hist';
    counts.forEach((cnt, i) => {
        const bar = document.createElement('div');
        bar.className = mini ? 'ov-spark-bar' : 'profile-hist-bar';
        if (cnt === 0) bar.classList.add(mini ? 'ov-spark-bar--empty' : 'profile-hist-bar--empty');
        bar.style.height = (cnt / maxCnt * 100) + '%';
        if (titleFor) bar.title = titleFor(i);
        wrap.appendChild(bar);
    });
    return wrap;
}

// The full chart under a numeric or date card, with the range written below it.
function makeDistBlock(p: ColProfile): HTMLElement | null {
    const bins = p.histogram;
    if (!bins?.length) return null;
    const kind  = p.histKind ?? 'number';
    const total = bins.reduce((sum, b) => sum + b.count, 0);
    const chart = makeBars(bins.map(b => b.count), false, i => {
        const b = bins[i];
        return `${fmtBinBound(b.lo, kind)} to ${fmtBinBound(b.hi, kind)}\n`
             + `${b.count.toLocaleString()} rows (${fmtPct(total > 0 ? b.count / total * 100 : 0)})`;
    });
    if (!chart) return null;

    const block = document.createElement('div');
    const lbl = document.createElement('div'); lbl.className = 'profile-top-values-label';
    lbl.textContent = 'Distribution'; block.appendChild(lbl);
    block.appendChild(chart);

    const axis = document.createElement('div'); axis.className = 'profile-hist-axis';
    const lo = document.createElement('span'); lo.textContent = fmtBinBound(bins[0].lo, kind);
    const hi = document.createElement('span'); hi.textContent = fmtBinBound(bins[bins.length - 1].hi, kind);
    axis.appendChild(lo); axis.appendChild(hi);
    block.appendChild(axis);
    return block;
}

// The thumbnail in the overview row. Binned values where the column has an axis
// to bin, frequency of the most common values where it does not.
function makeSparkline(p: ColProfile): HTMLElement | null {
    if (p.histogram?.length) {
        const kind = p.histKind ?? 'number';
        const bars = makeBars(downsample(p.histogram.map(b => b.count), MINI_BARS), true);
        if (bars) bars.title = `${p.histogram.length} bins, `
            + `${fmtBinBound(p.histogram[0].lo, kind)} to ${fmtBinBound(p.histogram[p.histogram.length - 1].hi, kind)}`;
        return bars;
    }
    if (p.type === 'boolean') {
        const bars = makeBars([p.trueCount ?? 0, p.falseCount ?? 0], true);
        if (bars) bars.title = `True ${(p.trueCount ?? 0).toLocaleString()}, false ${(p.falseCount ?? 0).toLocaleString()}`;
        return bars;
    }
    if (p.topValues?.length) {
        const bars = makeBars(p.topValues.map(tv => tv[1]), true);
        if (bars) bars.title = 'Top ' + p.topValues.length + ' values by frequency';
        return bars;
    }
    return null;
}

function stat(label: string, value: string): HTMLElement {
    const d = document.createElement('div'); d.className = 'profile-stat';
    const l = document.createElement('div'); l.className = 'profile-stat-label'; l.textContent = label;
    const v = document.createElement('div'); v.className = 'profile-stat-value'; v.textContent = value; v.title = value;
    d.appendChild(l); d.appendChild(v); return d;
}

export function makeProfileCard(p: ColProfile): HTMLElement {
    const card = document.createElement('div');
    card.className = 'profile-card';

    const hdr = document.createElement('div'); hdr.className = 'profile-card-header';
    const badge = document.createElement('span');
    badge.className = 'profile-type-badge type-' + p.type;
    badge.textContent = BADGE_TEXT[p.type] ?? 'abc';
    const nameEl = document.createElement('span');
    nameEl.className = 'profile-col-name'; nameEl.textContent = p.name; nameEl.title = p.name;
    hdr.appendChild(badge); hdr.appendChild(nameEl);
    card.appendChild(hdr);

    const ov = document.createElement('div'); ov.className = 'profile-stat-grid';
    ov.appendChild(stat('Rows',   p.total.toLocaleString()));
    ov.appendChild(stat('Unique', p.uniqueCount.toLocaleString()));
    ov.appendChild(stat('Nulls',  p.nullCount.toLocaleString()));
    ov.appendChild(stat('Fill %', fmtPct(100 - p.nullPct)));
    card.appendChild(ov);

    if (p.nullCount > 0) {
        const track = document.createElement('div'); track.className = 'profile-null-bar-track';
        const fill  = document.createElement('div'); fill.className  = 'profile-null-bar-fill';
        fill.style.width = p.nullPct + '%'; track.appendChild(fill); card.appendChild(track);
    }
    const hr = document.createElement('hr'); hr.className = 'profile-divider'; card.appendChild(hr);

    if ((p.type === 'integer' || p.type === 'float') && p.min != null) {
        const isF = p.type === 'float';
        const ng = document.createElement('div'); ng.className = 'profile-stat-grid';
        ng.appendChild(stat('Min',    fmtNum(p.min,    isF ? 4 : 0)));
        ng.appendChild(stat('Max',    fmtNum(p.max,    isF ? 4 : 0)));
        ng.appendChild(stat('Mean',   fmtNum(p.mean,   2)));
        ng.appendChild(stat('Median', fmtNum(p.median, isF ? 2 : 0)));
        ng.appendChild(stat('Std Dev',fmtNum(p.stdDev, 2)));
        ng.appendChild(stat('Unique', p.uniqueCount.toLocaleString()));
        card.appendChild(ng);
        const dist = makeDistBlock(p);
        if (dist) card.appendChild(dist);
    } else if (p.type === 'string' || p.type === 'time') {
        const sg = document.createElement('div'); sg.className = 'profile-stat-grid';
        if (p.minLen != null) {
            sg.appendChild(stat('Min len', p.minLen.toLocaleString()));
            sg.appendChild(stat('Max len', p.maxLen!.toLocaleString()));
            sg.appendChild(stat('Avg len', fmtNum(p.avgLen, 1)));
        }
        card.appendChild(sg);
        if (p.topValues?.length) {
            const tvl = document.createElement('div'); tvl.className = 'profile-top-values-label'; tvl.textContent = 'Top Values';
            card.appendChild(tvl);
            const maxCnt = p.topValues[0][1];
            p.topValues.forEach(([val, cnt]) => {
                const row = document.createElement('div'); row.className = 'profile-top-val';
                const txt = document.createElement('span'); txt.className = 'profile-top-val-text'; txt.textContent = val; txt.title = val;
                const bw  = document.createElement('div'); bw.className  = 'profile-top-val-bar-wrap';
                const bf  = document.createElement('div'); bf.className  = 'profile-top-val-bar';
                bf.style.width = (cnt / maxCnt * 100) + '%'; bw.appendChild(bf);
                const ce  = document.createElement('span'); ce.className = 'profile-top-val-count'; ce.textContent = cnt.toLocaleString();
                row.appendChild(txt); row.appendChild(bw); row.appendChild(ce); card.appendChild(row);
            });
        }
    } else if (p.type === 'boolean') {
        const boolTotal = (p.trueCount ?? 0) + (p.falseCount ?? 0);
        const bg = document.createElement('div'); bg.className = 'profile-stat-grid';
        bg.appendChild(stat('True',  `${p.trueCount?.toLocaleString()} (${fmtPct(boolTotal > 0 ? (p.trueCount ?? 0) / boolTotal * 100 : 0)})`));
        bg.appendChild(stat('False', `${p.falseCount?.toLocaleString()} (${fmtPct(boolTotal > 0 ? (p.falseCount ?? 0) / boolTotal * 100 : 0)})`));
        card.appendChild(bg);
        if (boolTotal > 0) {
            const bb  = document.createElement('div'); bb.className  = 'profile-bool-bar';
            const bt  = document.createElement('div'); bt.className  = 'profile-bool-true';  bt.style.width  = ((p.trueCount  ?? 0) / boolTotal * 100) + '%';
            const bf2 = document.createElement('div'); bf2.className = 'profile-bool-false'; bf2.style.width = ((p.falseCount ?? 0) / boolTotal * 100) + '%';
            bb.appendChild(bt); bb.appendChild(bf2); card.appendChild(bb);
            const leg = document.createElement('div'); leg.className = 'profile-bool-legend';
            ['True', 'False'].forEach((lbl, i) => {
                const li  = document.createElement('div'); li.className  = 'profile-bool-legend-item';
                const dot = document.createElement('div'); dot.className = 'profile-bool-dot';
                dot.style.background = i === 0 ? 'rgba(78,201,176,0.7)' : 'rgba(244,135,113,0.7)';
                const lt = document.createElement('span'); lt.textContent = lbl; lt.style.opacity = '0.7';
                li.appendChild(dot); li.appendChild(lt); leg.appendChild(li);
            });
            card.appendChild(leg);
        }
    } else if (p.type === 'date' || p.type === 'datetime') {
        const dg = document.createElement('div'); dg.className = 'profile-stat-grid';
        if (p.minDate) {
            dg.appendChild(stat('Earliest', p.minDate));
            dg.appendChild(stat('Latest',   p.maxDate!));
            dg.appendChild(stat('Range',    p.rangeDays!.toLocaleString() + ' days'));
        }
        card.appendChild(dg);
        const dist = makeDistBlock(p);
        if (dist) card.appendChild(dist);
    }
    return card;
}

// ── Column name filter ───────────────────────────────────────────────────────
// The query lives at module level, not in the input, so a re-render triggered by
// a data change (an edit, a paste, an undo) does not throw away what was typed.
// Filtering hides rows and cards rather than rebuilding them, and the zebra
// striping is re-applied over the visible rows only, because :nth-child would
// keep counting the hidden ones and the stripes would go ragged.

let profileFilter   = '';
let profileColCount = 0;

function applyProfileFilter(): void {
    const q = profileFilter.trim().toLowerCase();
    let shown = 0;

    document.querySelectorAll<HTMLElement>('.profile-ov-row').forEach(row => {
        const hit = !q || (row.dataset.colName || '').indexOf(q) >= 0;
        row.classList.toggle('profile-filtered-out', !hit);
        if (hit) {
            row.classList.toggle('ov-alt', shown % 2 === 1);
            shown++;
        } else {
            row.classList.remove('ov-alt');
        }
    });

    document.querySelectorAll<HTMLElement>('.profile-card').forEach(card => {
        const hit = !q || (card.dataset.colName || '').indexOf(q) >= 0;
        card.classList.toggle('profile-filtered-out', !hit);
    });

    const label = document.getElementById('profile-ov-title');
    if (label) {
        label.textContent = q
            ? `Overview, ${shown} of ${profileColCount} columns`
            : `Overview, ${profileColCount} columns`;
    }
    const empty = document.getElementById('profile-ov-empty');
    if (empty) empty.style.display = (q && shown === 0) ? 'block' : 'none';
}

export function makeOverviewTable(profiles: ColProfile[]): HTMLElement {
    profileColCount = profiles.length;

    const wrap = document.createElement('div'); wrap.className = 'profile-overview';

    const head = document.createElement('div'); head.className = 'profile-ov-head';
    const titleEl = document.createElement('div');
    titleEl.className = 'profile-overview-title';
    titleEl.id = 'profile-ov-title';
    titleEl.textContent = 'Overview, ' + profiles.length + ' columns';

    const search = document.createElement('input');
    search.type        = 'search';
    search.className   = 'profile-ov-search';
    search.placeholder = 'Filter columns';
    search.title       = 'Show only columns whose name contains this text';
    search.value       = profileFilter;
    search.addEventListener('input', () => {
        profileFilter = search.value;
        applyProfileFilter();
    });
    search.addEventListener('keydown', e => {
        if (e.key === 'Escape' && search.value !== '') {
            search.value   = '';
            profileFilter  = '';
            applyProfileFilter();
            e.stopPropagation();
        }
    });

    head.appendChild(titleEl); head.appendChild(search);
    wrap.appendChild(head);

    const scrollWrap = document.createElement('div'); scrollWrap.className = 'profile-ov-scroll';
    const tbl  = document.createElement('table');  tbl.className  = 'profile-ov-table';
    const thead = document.createElement('thead');
    const htr   = document.createElement('tr');

    [
        { label: '#',         right: false },
        { label: 'COLUMN',    right: false },
        { label: 'TYPE',      right: false },
        { label: 'FILL',      right: true  },
        { label: 'NULL%',     right: true  },
        { label: 'UNIQUE',    right: true  },
        { label: 'DIST',      right: false },
        { label: 'MIN / MAX', right: false },
    ].forEach(col => {
        const th = document.createElement('th');
        th.textContent = col.label;
        if (col.right) th.className = 'ov-th-r';
        htr.appendChild(th);
    });
    thead.appendChild(htr); tbl.appendChild(thead);

    const tbody = document.createElement('tbody');
    profiles.forEach((p, i) => {
        const tr = document.createElement('tr'); tr.className = 'profile-ov-row';
        tr.dataset.colName = p.name.toLowerCase();
        tr.title = 'Click to jump to detail card';
        tr.addEventListener('click', () => {
            document.getElementById('profile-card-' + i)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        });

        const tdI = document.createElement('td'); tdI.textContent = String(i + 1); tr.appendChild(tdI);

        const tdC = document.createElement('td');
        const ns  = document.createElement('span'); ns.className = 'ov-col-name'; ns.textContent = p.name; ns.title = p.name;
        tdC.appendChild(ns); tr.appendChild(tdC);

        const tdT = document.createElement('td');
        const bdg = document.createElement('span'); bdg.className = 'profile-type-badge type-' + p.type;
        bdg.textContent = BADGE_TEXT[p.type] ?? 'abc'; tdT.appendChild(bdg); tr.appendChild(tdT);

        const tdF = document.createElement('td'); tdF.className = 'ov-r';
        tdF.textContent = (p.total - p.nullCount).toLocaleString(); tr.appendChild(tdF);

        const tdN    = document.createElement('td');
        const nullCl = document.createElement('div'); nullCl.className = 'ov-null-cell';
        if (p.nullCount > 0) {
            const track = document.createElement('div'); track.className = 'ov-null-bar-track';
            const fill  = document.createElement('div'); fill.className  = 'ov-null-bar-fill';
            fill.style.width = p.nullPct + '%'; track.appendChild(fill); nullCl.appendChild(track);
        }
        const pctS = document.createElement('span');
        pctS.style.cssText = 'min-width:24px;text-align:right;'; pctS.textContent = fmtPct(p.nullPct);
        nullCl.appendChild(pctS); tdN.appendChild(nullCl); tr.appendChild(tdN);

        const tdD = document.createElement('td'); tdD.className = 'ov-r';
        tdD.textContent = p.uniqueCount.toLocaleString(); tr.appendChild(tdD);

        const tdS = document.createElement('td'); tdS.className = 'ov-spark-cell';
        const spark = makeSparkline(p);
        if (spark) tdS.appendChild(spark);
        tr.appendChild(tdS);

        const tdMM  = document.createElement('td');
        const mmSpan = document.createElement('span'); mmSpan.className = 'ov-minmax';
        let mmText = '';
        if (p.type === 'integer'  && p.min != null) mmText = fmtNum(p.min, 0) + ' \u2013 ' + fmtNum(p.max, 0);
        else if (p.type === 'float' && p.min != null) mmText = fmtNum(p.min, 2) + ' \u2013 ' + fmtNum(p.max, 2);
        else if ((p.type === 'date' || p.type === 'datetime') && p.minDate) mmText = p.minDate + ' \u2013 ' + p.maxDate;
        else if (p.type === 'string' && p.minLen != null) mmText = 'len ' + p.minLen + '\u2013' + p.maxLen;
        else if (p.type === 'boolean') mmText = 'T / F';
        mmSpan.textContent = mmText; mmSpan.title = mmText; tdMM.appendChild(mmSpan); tr.appendChild(tdMM);
        tbody.appendChild(tr);
    });
    tbl.appendChild(tbody); scrollWrap.appendChild(tbl); wrap.appendChild(scrollWrap);

    const empty = document.createElement('div');
    empty.className = 'profile-ov-empty';
    empty.id = 'profile-ov-empty';
    empty.textContent = 'No column matches';
    empty.style.display = 'none';
    wrap.appendChild(empty);

    return wrap;
}

let profileRenderTimer: ReturnType<typeof setTimeout> | null = null;

export function renderProfile(): void {
    const scroll = document.getElementById('profile-scroll');
    if (!scroll) return;
    // Debounce: a single mutation can trigger this from both notifyChange and the
    // col-types-changed event; coalesce them so the heavier compute runs once.
    if (profileRenderTimer !== null) clearTimeout(profileRenderTimer);
    scroll.innerHTML = '<div style="padding:6px 0;font-size:12px;opacity:0.5;">Computing\u2026</div>';
    profileRenderTimer = setTimeout(() => {
        profileRenderTimer = null;
        scroll.innerHTML = '';
        const profiles = computeProfile();
        if (!profiles.length) {
            scroll.innerHTML = '<div style="padding:6px 0;font-size:12px;opacity:0.5;">No data loaded</div>';
            return;
        }
        scroll.appendChild(makeOverviewTable(profiles));
        profiles.forEach((p, i) => {
            const card = makeProfileCard(p);
            card.id = 'profile-card-' + i;
            card.dataset.colName = p.name.toLowerCase();
            scroll.appendChild(card);
        });
        applyProfileFilter();
    }, 0);
}

// Re-renders the profile panel only if it is currently open. Called from the data
// mutation path (notifyChange) and grid rebuilds (buildGrid) so the stats, column
// set, and row counts never go stale after an edit/insert/delete/paste/undo.
export function refreshProfileIfOpen(): void {
    if (state.profileOpen) renderProfile();
}

type DockSide = 'right' | 'bottom' | 'left';

// Panel size limits. Shared by the drag and by restoring a saved size, so a size
// dragged out on a wide window cannot squeeze the grid away on a narrow one.
const MIN_PANEL_W  = 180;
const MIN_PANEL_H  = 80;
const KEEP_GRID_W  = 250;
const KEEP_GRID_H  = 120;

function clampPanel(dock: DockSide, px: number): number {
    return dock === 'bottom'
        ? Math.max(MIN_PANEL_H, Math.min(px, window.innerHeight - KEEP_GRID_H))
        : Math.max(MIN_PANEL_W, Math.min(px, window.innerWidth  - KEEP_GRID_W));
}

function persistProfileLayout(): void {
    vscodeApi.postMessage({
        type:   'profileLayoutChanged',
        dock:   state.profileDock,
        width:  state.profileWidth,
        height: state.profileHeight
    });
}

function applyDock(dock: DockSide): void {
    state.profileDock = dock;
    const contentRow = document.getElementById('content-row')!;
    const panel      = document.getElementById('profile-panel')!;

    contentRow.classList.remove('profile-dock-left', 'profile-dock-bottom');
    if (dock === 'left')   contentRow.classList.add('profile-dock-left');
    if (dock === 'bottom') contentRow.classList.add('profile-dock-bottom');

    // Reset the non-relevant dimension so CSS default takes over
    if (dock === 'bottom') panel.style.width  = '';
    else                   panel.style.height = '';

    // Restore the size this dock was last dragged to. 0 means never resized, in
    // which case the CSS default stays.
    if (dock === 'bottom') {
        panel.style.height = state.profileHeight ? clampPanel(dock, state.profileHeight) + 'px' : '';
    } else {
        panel.style.width  = state.profileWidth  ? clampPanel(dock, state.profileWidth)  + 'px' : '';
    }

    document.querySelectorAll<HTMLElement>('.profile-dock-btn').forEach(btn => {
        btn.classList.toggle('profile-dock-btn--active', btn.dataset.dock === dock);
    });
}

function setupResizeHandle(): void {
    const handle = document.getElementById('profile-resize-handle');
    const panel  = document.getElementById('profile-panel');
    if (!handle || !panel) return;

    let dragging  = false;
    let startPos  = 0;
    let startSize = 0;

    handle.addEventListener('mousedown', e => {
        dragging  = true;
        handle.classList.add('resizing');
        const dock = state.profileDock as DockSide;
        startPos   = dock === 'bottom' ? e.clientY : e.clientX;
        startSize  = dock === 'bottom' ? panel.offsetHeight : panel.offsetWidth;
        document.body.style.userSelect = 'none';
        document.body.style.cursor     = dock === 'bottom' ? 'row-resize' : 'col-resize';
        e.preventDefault();
    });

    document.addEventListener('mousemove', e => {
        if (!dragging) return;
        const dock = state.profileDock as DockSide;
        if (dock === 'bottom') {
            state.profileHeight = clampPanel(dock, startSize + (startPos - e.clientY));
            panel.style.height  = state.profileHeight + 'px';
        } else {
            const delta = dock === 'right' ? startPos - e.clientX : e.clientX - startPos;
            state.profileWidth = clampPanel(dock, startSize + delta);
            panel.style.width  = state.profileWidth + 'px';
        }
    });

    document.addEventListener('mouseup', () => {
        if (!dragging) return;
        dragging = false;
        handle.classList.remove('resizing');
        document.body.style.userSelect = '';
        document.body.style.cursor     = '';
        // Once per drag, not per mousemove.
        persistProfileLayout();
    });
}

export function toggleProfile(): void {
    state.profileOpen = !state.profileOpen;
    document.getElementById('profile-panel')?.classList.toggle('open', state.profileOpen);
    document.getElementById('btn-profile')?.classList.toggle('btn-active', state.profileOpen);
    if (state.profileOpen) {
        applyDock(state.profileDock as DockSide);
        renderProfile();
    } else {
        document.getElementById('content-row')?.classList.remove('profile-dock-left', 'profile-dock-bottom');
    }
}

export function setupProfile(): void {
    const saved = INITIAL_PROFILE_LAYOUT;
    if (saved) {
        if (saved.dock === 'left' || saved.dock === 'right' || saved.dock === 'bottom') {
            state.profileDock = saved.dock;
        }
        state.profileWidth  = saved.width  > 0 ? saved.width  : 0;
        state.profileHeight = saved.height > 0 ? saved.height : 0;
    }
    document.getElementById('btn-profile')?.addEventListener('click', toggleProfile);
    document.getElementById('btn-profile-close')?.addEventListener('click', () => {
        state.profileOpen = true;
        toggleProfile();
    });
    document.querySelectorAll<HTMLElement>('.profile-dock-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (!btn.dataset.dock) return;
            applyDock(btn.dataset.dock as DockSide);
            persistProfileLayout();
        });
    });
    setupResizeHandle();
    document.addEventListener('csv-col-types-changed', () => {
        if (state.profileOpen) renderProfile();
    });
}
