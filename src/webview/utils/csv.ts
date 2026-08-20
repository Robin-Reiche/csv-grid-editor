import type { CsvRow } from '../types';

export function parseCsv(text: string, delimiter: string, trimFields: boolean = true): CsvRow[] {
    const rows: CsvRow[] = [];
    let row: string[] = [];
    let field = '';
    let inQuotes = false;
    // Trimming used to take line breaks with it, because a break is whitespace
    // too: a value typed with a trailing empty line was written to the file
    // correctly and came back a line shorter (issue #31). Only horizontal
    // whitespace goes now, so the padding people want gone still goes and the
    // line structure of a multi-line value survives.
    const finalize = (s: string) => trimFields ? s.replace(/^[^\S\r\n]+|[^\S\r\n]+$/g, '') : s;

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
        } else if (ch === '"') {
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
    if (row.some(f => f !== '')) rows.push(row);
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
