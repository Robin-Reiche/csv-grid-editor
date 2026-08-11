import type { ColType } from '../types';

// ── Export format converters ─────────────────────────────────────────────────
// Pure string-matrix → text converters behind the toolbar Export menu (JSON,
// JSON Lines, Markdown table, XML). Kept free of DOM/grid access so they are
// unit-testable in plain Node (see test/export-formats.test.cjs);
// features/export.ts gathers the current grid view (filter/sort applied) and
// feeds it in here.

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

// ── XML ──────────────────────────────────────────────────────────────────────

// XML element names are far stricter than JSON keys: a header like "Total (€)"
// or "1st year" is not a legal name, so every character outside the XML Name
// production is replaced with '_' and a name that cannot start a Name gets an
// '_' prefix. Letters and digits are matched by Unicode class, so non-ASCII
// headers ("Họ tên", "Größe") stay readable instead of collapsing into '______'.
const XML_NAME_START = /[:_\p{L}]/u;
const XML_NAME_CHAR  = /[-.:_\p{L}\p{N}\p{M}]/u;

function sanitizeXmlName(raw: string, index: number): string {
    const trimmed = (raw ?? '').trim();
    let name = '';
    for (const ch of trimmed) name += XML_NAME_CHAR.test(ch) ? ch : '_';
    if (name === '') return `column_${index + 1}`;
    // A name may not start with a digit, '-' or '.', and any name beginning
    // with "xml" is reserved by the spec — an underscore fixes both without
    // throwing away the header text.
    if (!XML_NAME_START.test(name[0]) || /^xml/i.test(name)) name = '_' + name;
    return name;
}

// Sanitizing can collapse two distinct headers onto one name ("a b" and "a-b"
// both become "a_b"), so uniqueness is applied AFTER sanitizing — otherwise two
// columns would share an element name and a reader could not tell them apart.
export function xmlTagNames(headers: string[]): string[] {
    const used = new Set<string>();
    return headers.map((h, i) => {
        const base = sanitizeXmlName(h, i);
        let name = base;
        for (let n = 2; used.has(name); n++) name = `${base}_${n}`;
        used.add(name);
        return name;
    });
}

// The XML 1.0 Char production: tab/LF/CR plus the printable ranges, with the
// surrogate block and the two non-characters at the end of the BMP excluded.
function isXmlChar(cp: number): boolean {
    return cp === 0x09 || cp === 0x0a || cp === 0x0d
        || (cp >= 0x20    && cp <= 0xd7ff)
        || (cp >= 0xe000  && cp <= 0xfffd)
        || (cp >= 0x10000 && cp <= 0x10ffff);
}

// Characters outside that production (stray C0 control bytes, lone surrogates)
// cannot appear in a document at all — not even as a numeric character
// reference — so they are dropped rather than escaped.
function stripInvalidXmlChars(value: string): string {
    let out = '';
    // Iterating by code point keeps astral characters (emoji, rare CJK) intact;
    // a lone surrogate arrives on its own and fails isXmlChar, so it is dropped.
    for (const ch of value) if (isXmlChar(ch.codePointAt(0)!)) out += ch;
    return out;
}

// CR is escaped because a parser would otherwise normalise it to LF and
// silently change the value; LF and tab are left as-is so multi-line cells stay
// readable.
export function escapeXmlText(value: string): string {
    return stripInvalidXmlChars(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\r/g, '&#13;');
}

// XML — one <row> element per row, one child element per column, 2-space
// indented like the JSON output. Cell text is written verbatim (XML has no
// number type, so coercing "2.50" into 2.5 would only lose formatting); the
// column type is used solely to decide emptiness: an empty cell in a typed
// column is the counterpart of JSON's null and becomes a self-closing <age/>,
// while an empty cell in a string column stays an empty <name></name>.
export function toXml(headers: string[], rows: string[][], types: ColType[]): string {
    const tags = xmlTagNames(headers);
    const out = ['<?xml version="1.0" encoding="UTF-8"?>', '<rows>'];
    for (const row of rows) {
        out.push('  <row>');
        for (let c = 0; c < tags.length; c++) {
            const raw  = row[c] ?? '';
            const type = types[c] ?? 'string';
            if (raw.trim() === '' && type !== 'string') out.push(`    <${tags[c]}/>`);
            else out.push(`    <${tags[c]}>${escapeXmlText(raw)}</${tags[c]}>`);
        }
        out.push('  </row>');
    }
    out.push('</rows>');
    return out.join('\n') + '\n';
}
