import type { CsvRow } from '../types';

// Spaces and tabs at either end of a value. Line breaks are left alone: they are
// whitespace too, but a value typed with a trailing empty line has to keep it
// (issue #31).
export function trimPadding(s: string): string {
    return s.replace(/^[^\S\r\n]+|[^\S\r\n]+$/g, '');
}

// trimFields defaults to true for the callers that want clean values out of a
// string, such as the tests. The grid itself reads files with it off: a value
// is kept exactly as the file has it, spaces included, and the settings menu
// decides whether the spaces are SHOWN (grid/control-char-cell.ts). Trimming at
// read time meant the first edit anywhere wrote the whole file back without
// them.
export function parseCsv(text: string, delimiter: string, trimFields: boolean = true): CsvRow[] {
    const rows: CsvRow[] = [];
    let row: string[] = [];
    let field = '';
    let inQuotes = false;
    const finalize = (s: string) => trimFields ? trimPadding(s) : s;

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inQuotes) {
            if (ch === '"') {
                if (i + 1 < text.length && text[i + 1] === '"') {
                    field += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                field += ch;
            }
        } else if (ch === '"' && field === '') {
            // A quote opens a quoted field only as the field's first character.
            // Further in it is part of the value, as in 5" disk: read as an
            // opening quote it swallowed the delimiters and line breaks after it
            // and merged the rest of the file into one cell. Excel and Python's
            // csv read it the same way. field is also empty right after a
            // quoted "" closes, but a quote there would have made it an escaped
            // "" inside the field, so this cannot reopen one by mistake.
            inQuotes = true;
        } else if (ch === delimiter) {
            row.push(finalize(field));
            field = '';
        } else if (ch === '\r') {
            // skip
        } else if (ch === '\n') {
            row.push(finalize(field));
            if (row.length > 0) rows.push(row);
            row = [];
            field = '';
        } else {
            field += ch;
        }
    }
    row.push(finalize(field));
    // A last line with nothing in it is a trailing blank line, not a row, and is
    // dropped. Except when it is the only line and holds a delimiter: that is a
    // header of unnamed columns, ",,,," is five of them. Dropping it opened the
    // file as an empty table and lost every column the moment it was read back.
    if (row.some(f => f !== '') || (rows.length === 0 && row.length > 1)) rows.push(row);
    return rows;
}

export function toCsv(rows: CsvRow[], delimiter: string): string {
    return rows.map(row =>
        row.map(cell => {
            const s = String(cell);
            if (s.includes(delimiter) || s.includes('"') || s.includes('\n') || s.includes('\r')) {
                return '"' + s.replace(/"/g, '""') + '"';
            }
            return s;
        }).join(delimiter)
    ).join('\n');
}

// TSV-quote a single cell — matches Excel's clipboard format. Wraps the value
// in double quotes (and doubles any internal quotes) iff it contains a tab,
// newline, carriage return, or quote character. Leaves all other values as-is
// so plain text round-trips byte-for-byte.
export function tsvCell(value: string): string {
    if (value.includes('\t') || value.includes('\n') || value.includes('\r') || value.includes('"')) {
        return '"' + value.replace(/"/g, '""') + '"';
    }
    return value;
}

// The clipboard formats a selection can be copied in.
export type ClipboardFormat = 'tsv' | 'csv';

// Serialize a rectangular block of cells for the clipboard.
//
// TSV stays the default (Ctrl+C, the plain "Copy" item): tabs are what Excel and
// Google Sheets read back as columns, and pasting a comma-separated block into
// them lands the whole row in one cell. CSV is the explicit choice, offered as
// its own context-menu item for pasting into anything that expects a real CSV -
// a file, a code snippet, a ticket. It is always comma-separated regardless of
// the delimiter the open file uses, because that is what the label promises.
//
// Both quote per RFC 4180, so a value carrying the separator, a double quote or
// a line break survives the round trip.
export function toClipboardBlock(rows: CsvRow[], format: ClipboardFormat): string {
    if (format === 'csv') return toCsv(rows, ',');
    return rows.map(row => row.map(cell => tsvCell(String(cell))).join('\t')).join('\n');
}

// A wrapped multi-line cell is only as wide as its longest LINE, not as wide as
// the whole value — auto-fit would otherwise size the column to every line laid
// end to end (features/auto-fit.ts). Longest is taken by character count, which
// is a ranking, not a measurement: the pixel width of the line this returns is
// measured properly afterwards, the same way single-line values are.
export function longestLine(value: string): string {
    if (value.indexOf('\n') < 0 && value.indexOf('\r') < 0) return value;
    let best = '';
    for (const line of value.split(/\r\n|\r|\n/)) {
        if (line.length > best.length) best = line;
    }
    return best;
}

export function colLetter(i: number): string {
    let s = '';
    let n = i;
    while (n >= 0) {
        s = String.fromCharCode(65 + (n % 26)) + s;
        n = Math.floor(n / 26) - 1;
    }
    return s;
}
