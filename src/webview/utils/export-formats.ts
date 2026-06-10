import type { ColType } from '../types';

// ── Export format converters ─────────────────────────────────────────────────
// Pure string-matrix → text converters behind the toolbar Export menu (JSON,
// JSON Lines, Markdown table). Kept free of DOM/grid access so they are unit-
// testable in plain Node (see test/export-formats.test.cjs); features/export.ts
// gathers the current grid view (filter/sort applied) and feeds it in here.

// JSON object keys come from the header row, which the user can rename or leave
// blank — keys must still be non-empty and unique or rows would silently lose
// fields (JSON.stringify keeps only the last duplicate key).
export function uniqueKeys(headers: string[]): string[] {
    const used = new Set<string>();
    return headers.map((h, i) => {
        const base = (h ?? '').trim() || `column_${i + 1}`;
        let key = base;
        for (let n = 2; used.has(key); n++) key = `${base}_${n}`;
        used.add(key);
        return key;
    });
}

// Matches plain decimals only — no leading zeros ("007" is an ID, not a number)
// and no exponent/hex/Infinity forms, so coercion never changes what the value
// reads as. Trailing-zero forms like "2.50" are allowed: 2.5 is numerically
// identical, only formatting is lost.
const SAFE_NUMBER_RE = /^-?(0|[1-9]\d*)(\.\d+)?$/;

// Converts one cell for JSON output. Column type comes from the grid's own
// detection (>80% of sampled values must match), but coercion is re-checked
// per value — a stray "n/a" inside an integer column must stay a string, not
// become NaN/null. Typed columns emit null for empty cells (an empty string is
// not a valid number or boolean); string columns keep '' since blank text is
// meaningful.
export function coerceValue(raw: string, type: ColType): string | number | boolean | null {
    if (type === 'string') return raw;
    const t = raw.trim();
    if (t === '') return null;
    if (type === 'integer' || type === 'float') {
        if (SAFE_NUMBER_RE.test(t)) {
            const n = Number(t);
            // Integers past 2^53 would silently round (e.g. long numeric IDs) —
            // keep those as strings.
            if (t.indexOf('.') >= 0 || Number.isSafeInteger(n)) return n;
        }
        return raw;
    }
    if (type === 'boolean') {
        const lower = t.toLowerCase();
        if (lower === 'true')  return true;
        if (lower === 'false') return false;
        return raw; // "yes"/"no" etc. pass through unchanged
    }
    return raw; // date / datetime / time stay strings
}

function toObjects(
    headers: string[],
    rows: string[][],
    types: ColType[]
): Record<string, string | number | boolean | null>[] {
    const keys = uniqueKeys(headers);
    return rows.map(row => {
        const obj: Record<string, string | number | boolean | null> = {};
        for (let c = 0; c < keys.length; c++) {
            obj[keys[c]] = coerceValue(row[c] ?? '', types[c] ?? 'string');
        }
        return obj;
    });
}

// JSON — array of objects, pretty-printed with 2-space indent.
export function toJson(headers: string[], rows: string[][], types: ColType[]): string {
    return JSON.stringify(toObjects(headers, rows, types), null, 2) + '\n';
}

// JSON Lines (NDJSON) — one compact object per line.
export function toJsonLines(headers: string[], rows: string[][], types: ColType[]): string {
    return toObjects(headers, rows, types).map(o => JSON.stringify(o)).join('\n') + '\n';
}

// A raw pipe would end the table cell; literal newlines would end the table row.
function escapeMarkdownCell(value: string): string {
    return value.replace(/\|/g, '\\|').replace(/\r\n|\r|\n/g, '<br>');
}

// Markdown table — GitHub-flavored pipe table. Numeric columns get right-aligned
// separators (---:) so figures line up the way a reader expects.
export function toMarkdownTable(headers: string[], rows: string[][], types: ColType[]): string {
    const numCols = headers.length;
    const sep = headers.map((_, c) => {
        const t = types[c] ?? 'string';
        return (t === 'integer' || t === 'float') ? '---:' : '---';
    });
    const line = (cells: string[]): string =>
        '| ' + cells.map(escapeMarkdownCell).join(' | ') + ' |';
    const out = [line(headers), '| ' + sep.join(' | ') + ' |'];
    for (const row of rows) {
        const cells: string[] = [];
        for (let c = 0; c < numCols; c++) cells.push(row[c] ?? '');
        out.push(line(cells));
    }
    return out.join('\n') + '\n';
}
