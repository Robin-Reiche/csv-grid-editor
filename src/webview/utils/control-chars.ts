// ── Control characters inside cell values ────────────────────────────────────
// CSV cells legitimately carry C0 control characters: machine-generated data
// uses them as in-value separators, and exports from legacy systems leave stray
// bytes behind. None of them have a glyph in the UI font, so the grid used to
// draw an anonymous tofu box — alarming, and useless for telling WHICH
// character it is. Splitting the value here lets the grid draw a labelled chip
// instead, the same idea as VS Code's renderControlCharacters.
//
// Pure module — no DOM, no AG Grid — so it is unit-testable in plain Node
// (see test/control-chars.test.cjs).

// Abbreviation plus the name the character is actually known by. For
// U+001C..U+001F those are the ASCII names (FILE/GROUP/RECORD/UNIT SEPARATOR)
// people recognise, not Unicode's own far less recognisable "INFORMATION
// SEPARATOR FOUR..ONE".
const CONTROL_NAMES: Record<number, [string, string]> = {
    0x00: ['NUL', 'NULL'],
    0x01: ['SOH', 'START OF HEADING'],
    0x02: ['STX', 'START OF TEXT'],
    0x03: ['ETX', 'END OF TEXT'],
    0x04: ['EOT', 'END OF TRANSMISSION'],
    0x05: ['ENQ', 'ENQUIRY'],
    0x06: ['ACK', 'ACKNOWLEDGE'],
    0x07: ['BEL', 'BELL'],
    0x08: ['BS',  'BACKSPACE'],
    0x0b: ['VT',  'LINE TABULATION'],
    0x0c: ['FF',  'FORM FEED'],
    0x0e: ['SO',  'SHIFT OUT'],
    0x0f: ['SI',  'SHIFT IN'],
    0x10: ['DLE', 'DATA LINK ESCAPE'],
    0x11: ['DC1', 'DEVICE CONTROL ONE'],
    0x12: ['DC2', 'DEVICE CONTROL TWO'],
    0x13: ['DC3', 'DEVICE CONTROL THREE'],
    0x14: ['DC4', 'DEVICE CONTROL FOUR'],
    0x15: ['NAK', 'NEGATIVE ACKNOWLEDGE'],
    0x16: ['SYN', 'SYNCHRONOUS IDLE'],
    0x17: ['ETB', 'END OF TRANSMISSION BLOCK'],
    0x18: ['CAN', 'CANCEL'],
    0x19: ['EM',  'END OF MEDIUM'],
    0x1a: ['SUB', 'SUBSTITUTE'],
    0x1b: ['ESC', 'ESCAPE'],
    0x1c: ['FS',  'FILE SEPARATOR'],
    0x1d: ['GS',  'GROUP SEPARATOR'],
    0x1e: ['RS',  'RECORD SEPARATOR'],
    0x1f: ['US',  'UNIT SEPARATOR'],
    0x7f: ['DEL', 'DELETE'],
};

// Tab, LF and CR are deliberately NOT marked here. They are ordinary whitespace
// inside a quoted field — parseCsv keeps them verbatim. Line breaks do get a
// chip of their own when the caller asks for it, see below, but on their own
// terms: one chip per break, not one per character.
export function isMarkedControlChar(code: number): boolean {
    if (code === 0x09 || code === 0x0a || code === 0x0d) return false;
    return code < 0x20 || code === 0x7f;
}

// ── Line breaks ──────────────────────────────────────────────────────────────
// A line break inside a quoted field is legitimate CSV content, not a stray
// byte, so it is never a "control character" in the sense above. But the grid
// draws each row on one fixed-height line, which makes the break invisible:
// "a\nb" and "a b" look identical. So when wrapping is off (the default), the
// callers below ask for line breaks to be marked too — with their own chip, so
// the cell at least reads as multi-line (issue #29). CRLF gets ONE chip: it is
// a single break, not two.
const NEWLINE_ABBR = '↵';
const NEWLINE_LABELS: Record<string, string> = {
    '\n':   'U+000A LINE FEED',
    '\r':   'U+000D CARRIAGE RETURN',
    '\r\n': 'U+000D U+000A CARRIAGE RETURN + LINE FEED',
};

export function hasControlChars(value: string, markNewlines: boolean = false): boolean {
    for (let i = 0; i < value.length; i++) {
        const code = value.charCodeAt(i);
        if (markNewlines && (code === 0x0a || code === 0x0d)) return true;
        if (isMarkedControlChar(code)) return true;
    }
    return false;
}

export type CellSegment =
    | { type: 'text';    text: string }
    | { type: 'control'; abbr: string; label: string; newline?: boolean };

function labelFor(code: number): { abbr: string; label: string } {
    const hex   = 'U+' + code.toString(16).toUpperCase().padStart(4, '0');
    const known = CONTROL_NAMES[code];
    // Every code isMarkedControlChar accepts is in the table; the fallback only
    // guards against the two drifting apart.
    return known
        ? { abbr: known[0], label: hex + ' ' + known[1] }
        : { abbr: hex.slice(2), label: hex };
}

// Splits a cell value into runs of ordinary text and single control characters,
// in order. Concatenating the text runs and the source characters reproduces the
// input exactly — nothing is dropped, the grid only draws the pieces differently.
// With markNewlines, a line break becomes a segment of its own on the same
// terms (CRLF as one segment, since it is one break).
export function splitControlChars(value: string, markNewlines: boolean = false): CellSegment[] {
    const out: CellSegment[] = [];
    let text = '';
    const flush = (): void => { if (text !== '') { out.push({ type: 'text', text }); text = ''; } };

    for (let i = 0; i < value.length; i++) {
        const ch = value[i];
        if (markNewlines && (ch === '\n' || ch === '\r')) {
            const seq = ch === '\r' && value[i + 1] === '\n' ? '\r\n' : ch;
            i += seq.length - 1;
            flush();
            out.push({ type: 'control', abbr: NEWLINE_ABBR, label: NEWLINE_LABELS[seq], newline: true });
            continue;
        }
        const code = value.charCodeAt(i);
        if (!isMarkedControlChar(code)) { text += ch; continue; }
        flush();
        out.push({ type: 'control', ...labelFor(code) });
    }
    flush();
    return out;
}
