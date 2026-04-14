import { state, getNumCols } from '../state';
import { showLoader, hideLoader } from '../utils/loader';
import { buildGrid } from '../grid/builder';

export function measureTextWidths(): { colId: string; width: number }[] {
    const { data, colTypes } = state;
    const headerRow = data[0];
    const bodyRows  = data.slice(1);
    const numCols   = getNumCols(data);

    const scale   = state.ZOOM_STEPS[state.zoomIndex] / 100;
    const cellPad = Math.round(6 * scale) * 2;

    // Read ALL text-affecting CSS properties from a live grid cell so that the
    // probe and canvas ranking account for font-size, letter-spacing, etc.
    // Cells inside .ag-theme-alpine-dark can have letter-spacing set by AG Grid's
    // own bundled CSS or the VS Code webview base styles — properties we cannot
    // know statically. Reading them here makes the measurement self-correcting.
    let fontFamily    = '"Segoe UI", sans-serif';
    let fontSize      = Math.round(13 * scale);
    let letterSpacing = 0;   // px, added after each glyph
    let wordSpacing   = '';  // CSS string
    // Use the CSS descendant combinator (.ag-cell .ag-cell-value) so we get a
    // real data cell, not the row-index cell which has BOTH classes on the same
    // element (an element cannot be its own descendant, so the query skips it).
    // The row-index cell typically uses the VS Code font size (12.6 px) while
    // data cells use AG Grid's --ag-font-size (usually 14 px), causing the probe
    // to under-measure long strings by ~11 % when the wrong cell is sampled.
    const sampleEl = document.querySelector<HTMLElement>('.ag-cell .ag-cell-value')
                  ?? document.querySelector<HTMLElement>('.ag-cell-value')
                  ?? document.querySelector<HTMLElement>('.ag-cell');
    if (sampleEl) {
        const cs = getComputedStyle(sampleEl);
        if (cs.fontFamily?.trim())                fontFamily    = cs.fontFamily;
        const fs = parseFloat(cs.fontSize);
        if (fs > 0)                               fontSize      = fs;
        const ls = parseFloat(cs.letterSpacing);  // 'normal' → NaN → keeps 0
        if (!isNaN(ls))                           letterSpacing = ls;
        if (cs.wordSpacing && cs.wordSpacing !== 'normal') wordSpacing = cs.wordSpacing;
    }
    console.log(`[AutoFit-fonts] sampleEl="${sampleEl?.className ?? 'NULL'}" fontFamily="${fontFamily}" fontSize=${fontSize}px letterSpacing=${letterSpacing}px wordSpacing="${wordSpacing}"`);
    // ── Extra diagnostic: check actual data-cell font (col_1, not row-index) ──
    const dcDiag = document.querySelector<HTMLElement>('.ag-cell:not(.row-index-cell)[col-id]')
                ?? document.querySelector<HTMLElement>('[col-id="col_1"]');
    if (dcDiag) {
        const dcs = getComputedStyle(dcDiag);
        console.log(`[AutoFit-datacell] col="${dcDiag.getAttribute('col-id')}" class="${dcDiag.className.substring(0,80)}" fontSize=${dcs.fontSize} fontWeight=${dcs.fontWeight}`);
    } else {
        console.log('[AutoFit-datacell] no data cell found in DOM');
    }


    // Extra space added on top of the measured text width.
    //   cell:   cell padding + border + rendering buffer
    //   header: cell padding + sort icon (~16px) + resize handle (~8px) + buffer
    const CELL_EXTRA   = cellPad + 20;
    const HEADER_EXTRA = cellPad + 44;

    // How many of the widest cell values to DOM-measure per column.
    // Canvas is used for a fast O(n) pre-scan; only the top-N candidates
    // are then measured with offsetWidth for pixel-perfect browser accuracy.
    // This correctly handles Unicode characters (accents, symbols, CJK, …)
    // that canvas.measureText may under- or overestimate.
    //
    // TOP_N = 50 so that columns where many values have nearly identical
    // canvas widths (e.g. fixed-format URLs like Spotify track links) still
    // include the outliers that contain visually wide glyphs (W, Q, Y, …).
    const TOP_N = 50;

    // ── Phase 1: fast canvas pre-scan ────────────────────────────────────────
    // Purpose: identify the top-N widest values per column cheaply.
    // We do NOT rely on canvas widths for the final column size — they are
    // only used to rank candidates so Phase 2 knows which values to measure.
    const canvas = document.createElement('canvas');
    const ctx    = canvas.getContext('2d')!;
    ctx.font = `400 ${fontSize}px ${fontFamily}`;

    const topCandidates: string[][] = [];
    for (let c = 0; c < numCols; c++) {
        const top: { val: string; w: number }[] = [];
        let minTopW = 0;
        for (let r = 0; r < bodyRows.length; r++) {
            const val = bodyRows[r]?.[c] != null ? String(bodyRows[r][c]) : '';
            if (!val) continue;
            // Use bounding-box extents when available — more accurate than
            // advance-width (.width) for glyphs that extend beyond their
            // advance box (W, Q, Y, italic chars, …).
            const m = ctx.measureText(val);
            const canvasW = (m.actualBoundingBoxLeft !== undefined && m.actualBoundingBoxRight !== undefined
                && (Math.abs(m.actualBoundingBoxLeft) + m.actualBoundingBoxRight) > 0)
                ? Math.abs(m.actualBoundingBoxLeft) + m.actualBoundingBoxRight
                : m.width;
            // Canvas measureText ignores CSS letter-spacing. Add it manually so
            // long strings with many characters rank correctly against shorter
            // strings that happen to use wide glyphs.
            const w = letterSpacing > 0 ? canvasW + (val.length - 1) * letterSpacing : canvasW;
            if (top.length < TOP_N || w > minTopW) {
                top.push({ val, w });
                if (top.length > TOP_N) {
                    let minIdx = 0;
                    for (let i = 1; i < top.length; i++) if (top[i].w < top[minIdx].w) minIdx = i;
                    top.splice(minIdx, 1);
                }
                minTopW = top.length === TOP_N ? top.reduce((m, t) => Math.min(m, t.w), Infinity) : 0;
            }
        }
        // Deduplicate (same string may appear in multiple rows)
        const deduped = [...new Set(top.map(t => t.val))];
        topCandidates.push(deduped);

        // ── Diagnostic: track whether the LONGEST "I'll Be There" made the cut ──
        {
            let beV = '';
            for (let r = 0; r < bodyRows.length; r++) {
                const v = bodyRows[r]?.[c] != null ? String(bodyRows[r][c]) : '';
                if (v.includes("I'll Be There") && v.length > beV.length) beV = v;
            }
            if (beV) {
                const inTop = deduped.includes(beV);
                const m2 = ctx.measureText(beV);
                const cw2 = (m2.actualBoundingBoxLeft !== undefined && m2.actualBoundingBoxRight !== undefined
                    && (Math.abs(m2.actualBoundingBoxLeft) + m2.actualBoundingBoxRight) > 0)
                    ? Math.abs(m2.actualBoundingBoxLeft) + m2.actualBoundingBoxRight : m2.width;
                const w2 = letterSpacing > 0 ? cw2 + (beV.length - 1) * letterSpacing : cw2;
                const topMin = top.length > 0 ? top.reduce((mn, t) => Math.min(mn, t.w), Infinity) : 0;
                console.log(`[AutoFit-rank] col_${c} "I'll Be There..."(len=${beV.length}) canvasScore=${w2.toFixed(1)} inTop50=${inTop} top50min=${topMin.toFixed(1)}`);
            }
        }
    }

    // ── Phase 2: exact DOM measurement ───────────────────────────────────────
    // The probe lives INSIDE .ag-theme-alpine-dark so it automatically inherits
    // any CSS custom properties or cascade values that affect text rendering
    // inside the grid. All known text-affecting properties are also set
    // explicitly (from the live-cell read above) so the probe matches cells
    // as closely as possible even when no live cell is available.
    const probeParent = document.querySelector<HTMLElement>('.ag-root-wrapper')
                     ?? document.querySelector<HTMLElement>('.ag-theme-alpine-dark')
                     ?? document.getElementById('grid-container')
                     ?? document.body;
    const probe = document.createElement('span');
    probe.style.position      = 'fixed';
    // Keep probe within the visible viewport (top:0 left:0) so Chromium uses
    // the same DirectWrite natural-mode text path as on-screen cells.
    // Off-screen positions (-9999px) trigger GDI-compatible integer rounding
    // per glyph, which for long strings (170+ chars) causes ~11% cumulative error.
    probe.style.top           = '0';
    probe.style.left          = '0';
    probe.style.opacity       = '0';
    probe.style.pointerEvents = 'none';
    probe.style.zIndex        = '-9999';
    probe.style.whiteSpace    = 'nowrap';
    probe.style.fontFamily    = fontFamily;
    probe.style.fontSize      = fontSize + 'px';
    if (letterSpacing !== 0) probe.style.letterSpacing = letterSpacing + 'px';
    if (wordSpacing)         probe.style.wordSpacing   = wordSpacing;
    probeParent.appendChild(probe);

    // ── Calibration ───────────────────────────────────────────────────────────
    // In some environments (Windows 125% DPI, Electron font hinting, …) the
    // probe consistently measures text narrower than what the grid actually
    // renders. We detect this by comparing probe.offsetWidth to the exact
    // visual text width (Range.getBoundingClientRect) of currently visible,
    // non-truncated cells, then apply the correction factor to every column.
    let calibFactor = 1.0;
    {
        const samples: number[] = [];
        document.querySelectorAll<HTMLElement>('.ag-cell[col-id]').forEach(cell => {
            if (cell.scrollWidth > cell.offsetWidth) return; // skip truncated
            // Handle both structures: nested (.ag-cell > .ag-cell-value) and
            // combined (.ag-cell.ag-cell-value on one element, e.g. row-index).
            const textEl: HTMLElement = cell.querySelector<HTMLElement>('.ag-cell-value') ?? cell;
            const text = textEl.textContent?.trim() ?? '';
            if (text.length < 8) return; // skip trivially short values
            // Find the first non-empty text node (works even with nested spans)
            const findTextNode = (node: Node): Text | null => {
                for (const child of Array.from(node.childNodes)) {
                    if (child.nodeType === Node.TEXT_NODE && (child as Text).data.trim()) return child as Text;
                    const found = findTextNode(child);
                    if (found) return found;
                }
                return null;
            };
            const textNode = findTextNode(textEl);
            if (!textNode) return;
            const range = document.createRange();
            range.selectNode(textNode);
            const rangeW = range.getBoundingClientRect().width;
            if (rangeW < 10) return;
            probe.style.fontWeight = getComputedStyle(textEl).fontWeight || '400';
            probe.textContent = text;
            const probeW = probe.offsetWidth;
            if (probeW < 10) return;
            samples.push(rangeW / probeW);
        });
        if (samples.length >= 3) {
            const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
            // Clamp to a sensible range to avoid extreme corrections from outliers
            calibFactor = Math.min(1.5, Math.max(0.95, avg));
        }
        console.log(`[AutoFit-calib] factor=${calibFactor.toFixed(4)} from ${samples.length} cells`);
    }

    // Badge widths (bold ~9px label inside the column header)
    const badgeFontSize = Math.round(9 * scale);
    const TYPE_BADGE_TEXT: Record<string, string> = {
        integer: '123', float: '1.0', string: 'abc',
        boolean: 'T/F', date: 'date', datetime: 'dt', time: 'time'
    };
    const badgeWidthCache: Record<string, number> = {};
    probe.style.fontSize   = badgeFontSize + 'px';
    probe.style.fontWeight = '700';
    for (const key in TYPE_BADGE_TEXT) {
        probe.textContent = TYPE_BADGE_TEXT[key];
        badgeWidthCache[key] = probe.offsetWidth + 13; // 8px badge padding + 5px margin
    }

    const colState: { colId: string; width: number }[] = [];
    for (let c = 0; c < numCols; c++) {
        // Header: bold, measure exactly
        probe.style.fontSize   = fontSize + 'px';
        probe.style.fontWeight = '600';
        probe.textContent      = headerRow?.[c] ?? '';
        const badgePx = badgeWidthCache[colTypes[c]] ?? badgeWidthCache['string'];
        const headerW = probe.offsetWidth + HEADER_EXTRA + badgePx;

        // Cells: measure the top-N candidates (calibFactor corrects systematic
        // probe under-measurement detected against actual rendered cells above)
        probe.style.fontWeight = '400';
        let maxBodyW = 0;
        for (const val of topCandidates[c]) {
            probe.textContent = val;
            const w = Math.ceil(probe.offsetWidth * calibFactor) + CELL_EXTRA;
            if (w > maxBodyW) maxBodyW = w;
        }

        const finalW = Math.max(60, Math.ceil(Math.max(headerW, maxBodyW)));
        console.log(
            `[AutoFit-A] col_${c} "${headerRow?.[c]}" → ${finalW}px` +
            ` (headerW=${Math.ceil(headerW)}, maxBodyW=${Math.ceil(maxBodyW)})` +
            ` top1="${(topCandidates[c][0] ?? '').substring(0, 60)}"`
        );

        // ── Diagnostic: force-measure the LONGEST "I'll Be There" via probe ──
        {
            let beV = '';
            for (let r = 0; r < bodyRows.length; r++) {
                const v = bodyRows[r]?.[c] != null ? String(bodyRows[r][c]) : '';
                if (v.includes("I'll Be There") && v.length > beV.length) beV = v;
            }
            if (beV) {
                const inTop = topCandidates[c].includes(beV);
                probe.style.fontWeight = '400';
                probe.textContent = beV;
                const rawProbeW = probe.offsetWidth;
                const calibW = Math.ceil(rawProbeW * calibFactor);
                const needed = calibW + CELL_EXTRA;
                console.log(`[AutoFit-probe] col_${c} "I'll Be There..."(len=${beV.length}) inTop50=${inTop} rawProbe=${rawProbeW} calibrated=${calibW} needed=${needed} colWidth=${finalW} ok=${needed <= finalW}`);
            }
        }

        colState.push({ colId: 'col_' + c, width: finalW });
    }

    probeParent.removeChild(probe);
    return colState;
}

export function toggleAutoFit(): void {
    if (!state.gridApi) return;
    if (!state.isAutoFitted) {
        if (state.autoFitCache && state.autoFitCacheZoom === state.zoomIndex) {
            state.gridApi.applyColumnState({ state: state.autoFitCache });
            state.isAutoFitted = true;
            return;
        }
        showLoader('Fitting columns\u2026');

        // ── Step 0 → Step 1 → Step 2 (sequential, each nested in previous) ─────
        //
        // Step 0: expand all columns to 3000 px so visible cells are never
        //   truncated when the calibration probe runs in Step 1.
        // Step 1: measureTextWidths() — canvas ranking, DOM probe with calib.
        // Step 2: Phase B scrollWidth check on now-visible cells.
        //
        // Each step waits 2 rAFs for AG Grid to flush DOM writes before the
        // next step reads cell dimensions.

        requestAnimationFrame(() => requestAnimationFrame(() => {
            // Step 0: pre-expand
            const numCols = getNumCols(state.data);
            const expandedState = Array.from({ length: numCols }, (_, i) => ({ colId: `col_${i}`, width: 3000 }));
            state.gridApi!.applyColumnState({ state: expandedState });

            requestAnimationFrame(() => requestAnimationFrame(() => {
                // Step 1: measure + apply Phase A widths
                let phaseAWidths: { colId: string; width: number }[] = [];
                try {
                    phaseAWidths = measureTextWidths();
                    state.gridApi!.applyColumnState({ state: phaseAWidths });
                } catch (err) {
                    console.error('[AutoFit Phase A]', err);
                    hideLoader();
                    return;
                }

                requestAnimationFrame(() => requestAnimationFrame(() => {
                    // Step 2: Phase B — verify visible cells, correct any that are
                    // still truncated (scrollWidth > offsetWidth after Phase A).
                    try {
                        const scale         = state.ZOOM_STEPS[state.zoomIndex] / 100;
                        const cellPadSingle = Math.round(6 * scale);

                        let corrected = false;
                        const finalState = phaseAWidths.map(({ colId, width }) => {
                            let maxNeeded = 0;
                            document.querySelectorAll<HTMLElement>(`.ag-cell[col-id="${colId}"]`)
                                .forEach(cell => {
                                    if (cell.scrollWidth > cell.offsetWidth) {
                                        const needed = cell.scrollWidth + cellPadSingle + 12;
                                        if (needed > maxNeeded) maxNeeded = needed;
                                    }
                                });
                            if (maxNeeded > width) {
                                corrected = true;
                                return { colId, width: maxNeeded };
                            }
                            return { colId, width };
                        });

                        if (corrected) {
                            const fixes = finalState.filter((f, i) => f.width !== phaseAWidths[i]?.width);
                            console.log('[AutoFit-B] corrections:', fixes.map(f => `${f.colId}=${f.width}px`).join(', '));
                            state.gridApi!.applyColumnState({ state: finalState });
                        } else {
                            console.log('[AutoFit-B] no corrections needed (all visible cells fit)');
                        }

                        state.autoFitCache     = finalState;
                        state.autoFitCacheZoom = state.zoomIndex;
                        state.isAutoFitted     = true;
                    } catch (err) {
                        console.error('[AutoFit verify]', err);
                        state.autoFitCache     = phaseAWidths;
                        state.autoFitCacheZoom = state.zoomIndex;
                        state.isAutoFitted     = true;
                    }
                    hideLoader();
                }));
            }));
        }));
    } else {
        buildGrid();
        state.isAutoFitted = false;
    }
}

export function setupAutoFit(): void {
    document.getElementById('btn-autofit')?.addEventListener('click', toggleAutoFit);
    document.getElementById('btn-clear-filters')?.addEventListener('click', () => {
        state.gridApi?.setFilterModel(null);
    });
}
