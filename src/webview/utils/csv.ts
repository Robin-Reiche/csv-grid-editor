import type { CsvRow } from '../types';

// Spaces and tabs at either end of a value. Line breaks are left alone: they are
// whitespace too, but a value typed with a trailing empty line has to keep it
// (issue #31).
export function trimPadding(s: string): string {
    return s.replace(/^[^\S\r\n]+|[^\S\r\n]+$/g, '');
}

// The characters the parser looks at, as char codes.
const QUOTE = 34;
const LF    = 10;
const CR    = 13;
const SPACE = 32;
const TAB   = 9;

// Whether the rows of the text end with a lone CR, the way a classic Mac file
// ends them. That takes no LF outside a quoted value anywhere and a CR there.
// Otherwise an LF ends a row together with the CRs right in front of it. Any
// other CR is then a character of the value it sits in. parseCsv and
// detectLineFormat both ask this first, so they agree on where rows end. The
// quotes are tracked the way parseCsv tracks them in a Mac file: a CR starts
// a new field there, so a quote right after it opens a quoted value. Mac Excel
// writes a value with a line break like that, an LF in quotes at a row start.
function rowsEndWithCr(text: string, delimiter: string): boolean {
    // Text without a single LF only needs a CR. For every other file the scan
    // below stops at the first LF outside quotes, most often in the first line.
    if (text.indexOf('\n') < 0) return text.indexOf('\r') >= 0;
    const delim = delimiter.length === 1 ? delimiter.charCodeAt(0) : -1;
    let inQuotes = false;
    let padOnly = true;
    let cr = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text.charCodeAt(i);
        if (inQuotes) {
            if (ch === QUOTE) {
                if (text.charCodeAt(i + 1) === QUOTE) { padOnly = false; i++; }
                else inQuotes = false;
            } else if (ch !== SPACE && ch !== TAB) {
                padOnly = false;
            }
        } else if (ch === QUOTE && padOnly) {
            inQuotes = true;
        } else if (ch === delim) {
            padOnly = true;
        } else if (ch === LF) {
            return false;
        } else if (ch === CR) {
            cr = true;
            padOnly = true;
        } else if (ch !== SPACE && ch !== TAB) {
            padOnly = false;
        }
    }
    return cr;
}

// trimFields defaults to true for the callers that want clean values out of a
// string, such as the tests. The grid itself reads files with it off: a value
// is kept exactly as the file has it, spaces included, and the settings menu
// decides whether the spaces are SHOWN (grid/control-char-cell.ts). Trimming at
// read time meant the first edit anywhere wrote the whole file back without
// them.
//
// fromFile is set only by the callers that read a file. It decides one thing,
// whether a last line of only spaces is dropped, see the end of the function.
// Paste reads the clipboard through here too and leaves it off.
//
// Each value is cut out of the text with slice, in one piece wherever it can
// be. Only a quoted section splits it into pieces that are joined.
// Built one character at a time, a value stayed a chain with a link per
// character inside V8. Nothing flattened it once the grid stopped trimming what
// it reads. A file with a long text column then took 5 to 14 times the memory
// and a 227 MB file crashed the webview before it showed anything.
export function parseCsv(text: string, delimiter: string, trimFields: boolean = true, fromFile: boolean = false): CsvRow[] {
    const rows: CsvRow[] = [];
    const n = text.length;
    // The delimiter is one character. Compared as a char code, a longer one
    // matches nothing, the way it matched nothing as a string.
    const delim = delimiter.length === 1 ? delimiter.charCodeAt(0) : -1;
    const crRows = rowsEndWithCr(text, delimiter);
    let row: string[] = [];
    // The value so far is `field` followed by the text from `start` up to
    // where the scan is. `field` holds the pieces a quoted section has
    // already cut off. It stays empty for most values.
    let field = '';
    let start = 0;
    // Whether the value so far holds only spaces and tabs, which is what
    // decides whether a quote opens a quoted section. A CR counts as padding
    // here, the way it does in largeFileReader.ts.
    let padOnly = true;
    // Whether a quoted field has turned up on the current line. Only the last
    // line needs it, see the blank line rule below.
    let lineQuoted = false;
    const finalize = (s: string) => trimFields ? trimPadding(s) : s;

    for (let i = 0; i < n; i++) {
        const ch = text.charCodeAt(i);
        if (ch === QUOTE && padOnly) {
            // A quote opens a quoted field only as the field's first character,
            // spaces and tabs before it aside. Further in it is part of the
            // value, as in 5" disk: read as an opening quote it swallowed the
            // delimiters and line breaks after it and merged the rest of the file
            // into one cell. Excel and Python's csv read it the same way. The
            // padding is allowed because hand-written files put a space after
            // the comma, as in name, "Smith, John". That value has always
            // been read as one quoted field. The value is also blank right
            // after a quoted "" closes, but a quote there would have made it an
            // escaped "" inside the field, so this cannot reopen one by mistake.
            // largeFileReader.ts makes the same call byte by byte and has to
            // stay in step with this one, as does detectLineFormat below.
            lineQuoted = true;
            // The padding in front stays part of the value.
            field += text.slice(start, i);
            // Inside quotes "" is a literal quote and a single " closes the
            // section. Without a closing quote the section runs to the end.
            let close = -1;
            let escaped = false;
            for (let from = i + 1; ;) {
                const q = text.indexOf('"', from);
                if (q < 0) break;
                if (text.charCodeAt(q + 1) === QUOTE) { escaped = true; from = q + 2; continue; }
                close = q;
                break;
            }
            let quoted = close < 0 ? text.slice(i + 1) : text.slice(i + 1, close);
            if (escaped) quoted = quoted.replace(/""/g, '"');
            field += quoted;
            if (!/^[ \t]*$/.test(quoted)) padOnly = false;
            if (close < 0) { start = n; break; }
            i = close;
            start = close + 1;
        } else if (ch === delim) {
            row.push(finalize(field + text.slice(start, i)));
            field = '';
            start = i + 1;
            padOnly = true;
        } else if (ch === LF || (ch === CR && crRows)) {
            // The CRs right in front of an LF belong to the break. That is
            // CRLF or the CR CR LF Python's csv module writes on Windows. In a
            // file whose rows end with a lone CR that CR is the break. An LF
            // straight after it belongs to it. Any other CR is part of the
            // value. It used to be dropped, which lost a byte from a row
            // nobody touched and read a whole Mac file as one row.
            let end = i;
            if (ch === LF) {
                while (end > start && text.charCodeAt(end - 1) === CR) end--;
            } else if (text.charCodeAt(i + 1) === LF) {
                i++;
            }
            row.push(finalize(field + text.slice(start, end)));
            rows.push(row);
            row = [];
            field = '';
            start = i + 1;
            padOnly = true;
            lineQuoted = false;
        } else if (padOnly && ch !== SPACE && ch !== TAB && ch !== CR) {
            padOnly = false;
        }
    }
    row.push(finalize(field + text.slice(start)));
    // A last line with nothing in it is a trailing blank line, not a row, and is
    // dropped. Except when it is the only line and holds a delimiter: that is a
    // header of unnamed columns, ",,,," is five of them. Dropping it opened the
    // file as an empty table and lost every column the moment it was read back.
    // In a file a last line of only spaces or tabs counts as blank too. The grid
    // reads with trimming off. That turned such a line, often left behind by an
    // editor, into an extra row that looked empty. Spaces someone wrote in
    // quotes, as in "   ", are a value and keep their row. On the clipboard the
    // spaces are what the user copied: dropping them made a paste of spaces do
    // nothing and skipped the last row of a pasted block.
    const blank = (f: string) => f === '' || (fromFile && !lineQuoted && trimPadding(f) === '');
    if (row.some(f => !blank(f)) || (rows.length === 0 && row.length > 1)) rows.push(row);
    return rows;
}

// How a file ends its rows: the line break it puts between two rows and
// whether one follows the last row too. The grid writes the whole file on every
// edit, so without this the first edit would rewrite every line of a CRLF file
// and take the break off the end of the file. CR CR LF is what Python's csv
// module writes on Windows. A lone CR ends the rows of a classic Mac file.
export type LineFormat = { eol: '\n' | '\r\n' | '\r\r\n' | '\r'; finalNewline: boolean };

// Reads the line format from the text parseCsv is about to split into rows. It
// counts only the breaks that end a row, so it tracks quotes exactly the way
// parseCsv does and has to stay in step with it. A break inside a quoted value
// belongs to the value and is written back as it is, CRLF or LF (issue #31).
// A file that mixes them gets the one most of its rows end with, so the
// fewest bytes change on the next edit. A tie goes to LF, then to CRLF.
//
// Text with no row break at all says nothing about its line ending. It keeps
// the one of `previous` when there is one: a CRLF file trimmed to a single
// line and read again stays CRLF, so a row added later does not bring LF into
// it. Without `previous` it gets LF.
export function detectLineFormat(text: string, delimiter: string, previous?: LineFormat): LineFormat {
    const crRows = rowsEndWithCr(text, delimiter);
    let lf = 0;
    let crlf = 0;
    let crcrlf = 0;
    let cr = 0;
    let inQuotes = false;
    // Whether the field so far holds only spaces and tabs. That is all parseCsv
    // looks at to decide whether a quote opens a quoted field.
    let blank = true;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inQuotes) {
            if (ch === '"') {
                if (i + 1 < text.length && text[i + 1] === '"') {
                    blank = false;
                    i++;
                } else {
                    inQuotes = false;
                }
            } else if (ch !== ' ' && ch !== '\t') {
                blank = false;
            }
        } else if (ch === '"' && blank) {
            inQuotes = true;
        } else if (ch === delimiter) {
            blank = true;
        } else if (crRows && (ch === '\r' || ch === '\n')) {
            // Every break ends a row of a Mac file, a CRLF counted once, the
            // way parseCsv splits it.
            cr++;
            if (ch === '\r' && text[i + 1] === '\n') i++;
            blank = true;
        } else if (ch === '\n') {
            // The CRs right before this break are outside quotes as well. A
            // quote that closed in between would sit between them.
            if (text[i - 1] !== '\r') lf++;
            else if (text[i - 2] !== '\r') crlf++;
            else crcrlf++;
            blank = true;
        } else if (ch !== '\r' && ch !== ' ' && ch !== '\t') {
            blank = false;
        }
    }
    let eol: LineFormat['eol'];
    if (lf + crlf + crcrlf + cr === 0) eol = previous ? previous.eol : '\n';
    else if (cr > 0) eol = '\r';
    else if (crcrlf > crlf && crcrlf > lf) eol = '\r\r\n';
    else eol = crlf > lf ? '\r\n' : '\n';
    const last = text[text.length - 1];
    return { eol, finalNewline: !inQuotes && (last === '\n' || (crRows && last === '\r')) };
}

// Whether parseCsv would drop this row as a trailing blank line when it is the
// last line of a file with no line break after it. Quotes would keep it then.
// That is a row of spaces and empty values with at least one space in it. A
// row of empty values alone is dropped with or without quotes. The only line
// of a file is kept anyway once it has a delimiter, see parseCsv.
function readsAsBlankLine(row: CsvRow, onlyRow: boolean): boolean {
    if (onlyRow && row.length > 1) return false;
    let spaces = false;
    for (const cell of row) {
        const s = String(cell);
        if (s === '') continue;
        if (trimPadding(s) !== '') return false;
        spaces = true;
    }
    return spaces;
}

// Without a line format the rows are joined with LF and nothing follows the
// last one. The clipboard wants exactly that. The grid writes the file with
// the format it was read with (state.lineFormat).
//
// A value with a CR is always quoted. Other programs read a lone CR as a line
// break and would split the row there. So does parseCsv in a file whose rows
// end with one. A value that has a CR in quotes in the file keeps them, so a
// row nobody touched keeps its bytes. parseCsv keeps a stray CR outside quotes
// in its value, so such a value gains quotes on the first edit and loses
// nothing.
export function toCsv(rows: CsvRow[], delimiter: string, format?: LineFormat): string {
    const eol = format ? format.eol : '\n';
    // An empty table stays empty. A lone break would read back as a blank row.
    const finalNewline = !!format && format.finalNewline && rows.length > 0;
    const last = rows.length - 1;
    // Spaces in the last row of a file are kept in quotes when nothing follows
    // it and the row would otherwise be read as a trailing blank line. That row
    // can only hold them because they were quoted in the file or typed in.
    // Written bare, the next read after an edit dropped the row.
    const quoteLastSpaces = !!format && !finalNewline && last >= 0 && readsAsBlankLine(rows[last], last === 0);
    const text = rows.map((row, r) =>
        row.map(cell => {
            const s = String(cell);
            let quote = s.includes(delimiter) || s.includes('"') || s.includes('\n') || s.includes('\r');
            if (!quote && quoteLastSpaces && r === last) quote = s !== '';
            return quote ? '"' + s.replace(/"/g, '""') + '"' : s;
        }).join(delimiter)
    ).join(eol);
    return finalNewline ? text + eol : text;
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
