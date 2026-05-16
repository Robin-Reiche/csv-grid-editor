import { state } from '../state';
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

export function computeProfile(): ColProfile[] {
    if (!state.data || state.data.length < 2) return [];
    const headerRow = state.data[0];
    const bodyRows  = state.data.slice(1);
    const profiles: ColProfile[] = [];

    for (let c = 0; c < headerRow.length; c++) {
        const ct = (state.colTypes[c] || 'string') as ColType;
        const values: string[] = [];
        let nullCount = 0;
        bodyRows.forEach(row => {
            const v = row?.[c] != null ? String(row[c]).trim() : '';
            if (v === '') nullCount++; else values.push(v);
        });
        const total = bodyRows.length;
        const p: ColProfile = {
            name: headerRow[c] || `(col ${c + 1})`, type: ct,
            total, nullCount, nullPct: total > 0 ? nullCount / total * 100 : 0,
            uniqueCount: new Set(values).size
        };

        if (ct === 'integer' || ct === 'float') {
            const nums = values.map(Number).filter(n => !isNaN(n));
            if (nums.length) {
                nums.sort((a, b) => a - b);
                p.min  = nums[0]; p.max = nums[nums.length - 1];
                p.mean = nums.reduce((s, n) => s + n, 0) / nums.length;
                p.median = nums.length % 2 === 0
                    ? (nums[nums.length / 2 - 1] + nums[nums.length / 2]) / 2
                    : nums[Math.floor(nums.length / 2)];
                const variance = nums.reduce((s, n) => s + Math.pow(n - p.mean!, 2), 0) / nums.length;
                p.stdDev = Math.sqrt(variance);

            }
        } else if (ct === 'string') {
            const lens = values.map(v => v.length);
            if (lens.length) {
                p.minLen = Math.min(...lens);
                p.maxLen = Math.max(...lens);
                p.avgLen = lens.reduce((s, l) => s + l, 0) / lens.length;
            }
            const freq: Record<string, number> = {};
            values.forEach(v => { freq[v] = (freq[v] || 0) + 1; });
            p.topValues = (Object.entries(freq) as [string, number][])
                .sort((a, b) => b[1] - a[1]).slice(0, 5);
        } else if (ct === 'boolean') {
            const T: Record<string, number> = { 'true':1,'yes':1,'1':1,'t':1,'y':1 };
            const F: Record<string, number> = { 'false':1,'no':1,'0':1,'f':1,'n':1 };
            let tc = 0, fc = 0;
            values.forEach(v => {
                const lo = v.toLowerCase();
                if (T[lo]) tc++; else if (F[lo]) fc++;
            });
            p.trueCount = tc; p.falseCount = fc;
        } else if (ct === 'date' || ct === 'datetime') {
            const dates = values.map(v => new Date(v)).filter(d => !isNaN(d.getTime()));
            if (dates.length) {
                dates.sort((a, b) => a.getTime() - b.getTime());
                p.minDate   = dates[0].toISOString().slice(0, 10);
                p.maxDate   = dates[dates.length - 1].toISOString().slice(0, 10);
                p.rangeDays = Math.round((dates[dates.length - 1].getTime() - dates[0].getTime()) / 86400000);
            }
        }
        profiles.push(p);
    }
    return profiles;
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
    } else if (p.type === 'string') {
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
    }
    return card;
}

export function makeOverviewTable(profiles: ColProfile[]): HTMLElement {
    const wrap = document.createElement('div'); wrap.className = 'profile-overview';
    const titleEl = document.createElement('div'); titleEl.className = 'profile-overview-title';
    titleEl.textContent = 'Overview \u2014 ' + profiles.length + ' columns';
    wrap.appendChild(titleEl);

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
        { label: 'DIST',      right: true  },
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
    return wrap;
}

export function renderProfile(): void {
    const scroll = document.getElementById('profile-scroll')!;
    scroll.innerHTML = '<div style="padding:6px 0;font-size:12px;opacity:0.5;">Computing\u2026</div>';
    setTimeout(() => {
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
            scroll.appendChild(card);
        });
    }, 0);
}

type DockSide = 'right' | 'bottom' | 'left';

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
            const newH = Math.max(80, Math.min(startSize + (startPos - e.clientY), window.innerHeight - 120));
            panel.style.height = newH + 'px';
        } else if (dock === 'right') {
            const newW = Math.max(180, Math.min(startSize + (startPos - e.clientX), window.innerWidth - 250));
            panel.style.width = newW + 'px';
        } else {
            const newW = Math.max(180, Math.min(startSize + (e.clientX - startPos), window.innerWidth - 250));
            panel.style.width = newW + 'px';
        }
    });

    document.addEventListener('mouseup', () => {
        if (!dragging) return;
        dragging = false;
        handle.classList.remove('resizing');
        document.body.style.userSelect = '';
        document.body.style.cursor     = '';
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
    document.getElementById('btn-profile')?.addEventListener('click', toggleProfile);
    document.getElementById('btn-profile-close')?.addEventListener('click', () => {
        state.profileOpen = true;
        toggleProfile();
    });
    document.querySelectorAll<HTMLElement>('.profile-dock-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.dataset.dock) applyDock(btn.dataset.dock as DockSide);
        });
    });
    setupResizeHandle();
    document.addEventListener('csv-col-types-changed', () => {
        if (state.profileOpen) renderProfile();
    });
}
