import * as fs from 'fs';
import { decodeUtf8KeepingStrays, decodeWindows1252, startsAsUtf8 } from './encoding';
import { firstLineOf } from './webview/utils/csv';

// The encodings a preview reads, see readPreviewEncoding. utf8bom is UTF-8
// behind a byte order mark, whose stray bytes read as Windows-1252.
export type PreviewEncoding = 'utf8' | 'utf8bom' | 'windows1252';

export interface RowPageIndex {
    offsets: number[];   // byte offset of the first byte of each page's first data record
    totalRows: number;
    headerLine: string;  // the header record without its line break
    headerBreak: string; // that line break, which readPage puts back in front of a page
    encoding: PreviewEncoding;   // what readPage decodes the pages as
}

const QUOTE = 0x22;
const LF    = 0x0A;
const CR    = 0x0D;
const SPACE = 0x20;
const TAB   = 0x09;

// Excel starts a UTF-8 file with a byte order mark. Open Full File decodes the
// file with TextDecoder, which leaves the mark out of the text, so the readers
// here leave it out too. Kept, it would show up as U+FEFF in front of the
// first header name and hide a quote that opens the first field.
function bomLength(buf: Buffer): number {
    return buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF ? 3 : 0;
}

// Decodes bytes that were read from `start` on. Only the very start of the
// file can hold the mark.
function decode(buf: Buffer, start: number, encoding: PreviewEncoding): string {
    if (encoding === 'windows1252') return decodeWindows1252(buf);
    const body = start === 0 ? buf.subarray(bomLength(buf)) : buf;
    return encoding === 'utf8bom' ? decodeUtf8KeepingStrays(body) : body.toString('utf8');
}

// Open Full File reads a file that is not valid UTF-8 as Windows-1252, the way
// Excel writes plain "CSV" (see encoding.ts). A preview reads only part of the
// file, so it goes by the first 64 KB: UTF-8 unless they are not valid UTF-8.
// A file whose first invalid byte comes later still shows U+FFFD there. A
// preview cannot be saved, so that costs no data. A file that starts with the
// UTF-8 byte order mark is UTF-8 with only its stray bytes read as
// Windows-1252, the way Open Full File reads it, wherever those bytes are. A
// UTF-16 file cannot be previewed readably at all: the scanners below look for
// the line break and the quote as single bytes, which UTF-16 does not have.
export async function readPreviewEncoding(filePath: string): Promise<PreviewEncoding> {
    const start = await readRange(filePath, 0, 64 * 1024 - 1);
    if (bomLength(start)) return 'utf8bom';
    return startsAsUtf8(start) ? 'utf8' : 'windows1252';
}

// A CSV record is not a line: a quoted field may hold line breaks, so one record
// can span any number of them. Splitting the raw bytes on \n therefore counts
// too many rows and, wherever a split lands inside a quoted field, the quotes
// stop pairing up and everything after it is parsed into the wrong columns
// (issue #32). Every reader below walks the file through this scanner instead.
// It tracks quote state exactly the way the grid's parser does (see
// webview/utils/csv.ts): a " opens a quoted section only at the start of a
// field, spaces and tabs before it aside. Inside one "" is a literal quote and
// a single " closes it. \n ends a record. So does \r in a file whose rows end
// with a lone CR (see rowsEndWithCr below). A " further into a field is
// part of the value, as in 5" disk. Telling the two apart takes the delimiter,
// which is why every reader below asks for it. Scanning bytes rather than
// characters is safe because ", \n, \r and the delimiters the provider detects
// are ASCII and never appear inside a multi-byte UTF-8 sequence. Windows-1252
// has a single byte for every character.
class RecordScanner {
    private inQuotes = false;
    // Whether the current field holds anything but leading spaces or tabs,
    // which decides whether a " opens a quoted section or is just a character.
    private fieldHasContent = false;
    private readonly delimiter: number;

    constructor(delimiter: string, private readonly crRows: boolean) {
        this.delimiter = delimiter.charCodeAt(0);
    }
    // A " seen inside quotes whose meaning depends on the next byte, which can
    // sit in the next chunk: "" is a literal quote, anything else closes.
    private pendingQuote = false;

    // Every reader scans from the start of the file, so the first buffer is
    // the one that can begin with a byte order mark.
    private atStart = true;

    // Whether anything but whitespace has turned up since the last record end.
    // parseCsv only keeps a final record without a trailing newline when it
    // holds something, so this decides whether the file's tail counts as a row.
    // Whitespace is the whole test here: a tail that parses to nothing but empty
    // fields (",,," or '""') is still counted, which would take the delimiter
    // and a full parse to tell apart and is worth revisiting if it ever shows up
    // in a real file.
    public remainderHasContent = false;

    // Offsets, relative to `buf`, of the byte just past each record's line break.
    public ends(buf: Buffer): number[] {
        const out: number[] = [];
        // The mark is not part of the first field. A quote right behind it
        // opens that field, the way it does in the grid.
        let i = 0;
        if (this.atStart) {
            this.atStart = false;
            i = bomLength(buf);
        }
        for (; i < buf.length; i++) {
            const b = buf[i];
            if (b !== LF && b !== CR && b !== SPACE && b !== TAB) this.remainderHasContent = true;

            if (this.pendingQuote) {
                this.pendingQuote = false;
                if (b === QUOTE) {           // "": a literal quote, still inside
                    this.fieldHasContent = true;
                    continue;
                }
                this.inQuotes = false;       // the quote closed the field
            }

            if (this.inQuotes) {
                // Spaces inside quotes are still only spaces to the parser, so
                // after " " a quote may open the field again there too.
                if (b === QUOTE) this.pendingQuote = true;
                else if (b !== SPACE && b !== TAB) this.fieldHasContent = true;
            } else if (b === this.delimiter) {
                this.fieldHasContent = false;
            } else if (b === LF || (b === CR && this.crRows)) {
                out.push(i + 1);
                this.remainderHasContent = false;
                this.fieldHasContent = false;
            } else if (b === QUOTE && !this.fieldHasContent) {
                this.inQuotes = true;
            } else if (b !== SPACE && b !== TAB && b !== CR) {
                // Any other \r outside quotes is padding to the parser, the
                // way spaces are, so it does not decide how a quote reads.
                this.fieldHasContent = true;
            }
        }
        return out;
    }
}

// fs stream ranges are inclusive on both ends; `end` undefined reads to EOF.
async function readRange(filePath: string, start: number, end?: number): Promise<Buffer> {
    const opts: { start: number; end?: number } = { start };
    if (end !== undefined) opts.end = end;
    const chunks: Buffer[] = [];
    for await (const chunk of fs.createReadStream(filePath, opts)) {
        chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks);
}

// Whether the rows of the file end with a lone CR, the way a classic Mac file
// ends them. The grid decides that with rowsEndWithCr (webview/utils/csv.ts)
// and this has to stay in step with it: no LF outside a quoted value and a CR
// there. The quotes are tracked the way that function tracks them. It looks at
// the whole text. A preview must not read a file this large whole to find
// out, so the first 64 KB decide, the same bytes that decide its encoding. Any
// file whose rows end with LF shows one there, unless its first line is longer
// than that. When the start is cut short it can end in the middle of a line
// break, a CR whose LF comes right after it, so those last CRs do not count.
async function rowsEndWithCr(filePath: string, delimiter: string): Promise<boolean> {
    const size = 64 * 1024;
    const read = await readRange(filePath, 0, size);
    let end = Math.min(read.length, size);
    if (read.length > size) while (end > 0 && read[end - 1] === CR) end--;
    const buf = read.subarray(0, end);
    if (buf.indexOf(LF) < 0) return buf.indexOf(CR) >= 0;
    const delim = delimiter.charCodeAt(0);
    let inQuotes = false;
    let padOnly = true;
    let cr = false;
    for (let i = bomLength(buf); i < buf.length; i++) {
        const b = buf[i];
        if (inQuotes) {
            if (b === QUOTE) {
                if (buf[i + 1] === QUOTE) { padOnly = false; i++; }
                else inQuotes = false;
            } else if (b !== SPACE && b !== TAB) {
                padOnly = false;
            }
        } else if (b === QUOTE && padOnly) {
            inQuotes = true;
        } else if (b === delim) {
            padOnly = true;
        } else if (b === LF) {
            return false;
        } else if (b === CR) {
            cr = true;
            padOnly = true;
        } else if (b !== SPACE && b !== TAB) {
            padOnly = false;
        }
    }
    return cr;
}

async function scannerFor(filePath: string, delimiter: string): Promise<RecordScanner> {
    return new RecordScanner(delimiter, await rowsEndWithCr(filePath, delimiter));
}

// The file's first line, which is all the provider's delimiter detection looks
// at. The scanners need the delimiter before they start, so it is read on its
// own. Capped at 1 MB so a file without a single line break is not pulled into
// memory whole: a header that long still shows its delimiter well before that.
// The line ends at the first CR as well as at the first LF. A classic Mac file
// has no LF, so its separators were counted up to that cap.
export async function readFirstLine(filePath: string): Promise<string> {
    // Where the first line ends depends on the quotes and, in a classic Mac
    // file, on there being no LF outside them at all, so it is decided on a
    // prefix the way the provider decides it on a whole text (firstLineOf).
    // The prefix is capped: a header longer than 1 MB is cut there.
    // A byte order mark in front would keep a quote right behind it from
    // counting as the start of a field.
    const prefix = await readRange(filePath, 0, 1024 * 1024);
    return firstLineOf(prefix.toString('utf8').replace(/^\uFEFF/, ''));
}

// Head preview: the first `recordCount` records, header included.
export async function readFirstRecords(
    filePath: string,
    recordCount: number,
    delimiter: string,
    encoding: PreviewEncoding = 'utf8'
): Promise<string> {
    const scanner = await scannerFor(filePath, delimiter);
    const chunks: Buffer[] = [];
    let found = 0;

    for await (const chunk of fs.createReadStream(filePath, { highWaterMark: 64 * 1024 })) {
        const buf = chunk as Buffer;
        const ends = scanner.ends(buf);
        if (found + ends.length >= recordCount) {
            chunks.push(buf.subarray(0, ends[recordCount - found - 1]));
            break;
        }
        found += ends.length;
        chunks.push(buf);
    }

    return decode(Buffer.concat(chunks), 0, encoding);
}

// Total records in the file, header included — the number the preview banner
// compares against, and the same number Open Full File would put in the grid.
export async function countRecords(filePath: string, delimiter: string): Promise<number> {
    const scanner = await scannerFor(filePath, delimiter);
    let count = 0;
    for await (const chunk of fs.createReadStream(filePath, { highWaterMark: 64 * 1024 })) {
        count += scanner.ends(chunk as Buffer).length;
    }
    return count + (scanner.remainderHasContent ? 1 : 0);
}

// Tail preview: header plus the last `recordCount` records. One scan collects
// the record boundaries, a second read picks up only the two byte ranges that
// are actually shown, so the file never has to be held in memory.
export async function readTailRecords(
    filePath: string,
    recordCount: number,
    delimiter: string,
    encoding: PreviewEncoding = 'utf8'
): Promise<{ content: string; totalRecordCount: number }> {
    const scanner = await scannerFor(filePath, delimiter);
    // Start offsets of the records after the header. One slot more than asked
    // for: the last record end starts a record that may never materialise, and
    // that speculative entry must not overwrite one still needed.
    const capacity = recordCount + 1;
    const ring: number[] = new Array(capacity);
    let pushed = 0;
    let base = 0;
    let ended = 0;
    let headerEnd = -1;

    for await (const chunk of fs.createReadStream(filePath, { highWaterMark: 64 * 1024 })) {
        const buf = chunk as Buffer;
        for (const end of scanner.ends(buf)) {
            const abs = base + end;
            ended++;
            if (ended === 1) headerEnd = abs;
            // Every record ends where the next one begins.
            ring[pushed % capacity] = abs;
            pushed++;
        }
        base += buf.length;
    }

    // The last record end started a record that never materialised — the file
    // ends there, or only whitespace follows.
    if (!scanner.remainderHasContent && pushed > 0) pushed--;

    const totalRecordCount = ended + (scanner.remainderHasContent ? 1 : 0);
    if (headerEnd < 0) {
        // No record boundary at all: the whole file is one record.
        return { content: decode(await readRange(filePath, 0), 0, encoding), totalRecordCount };
    }

    const header = await readRange(filePath, 0, headerEnd - 1);
    const kept = Math.min(pushed, recordCount);
    if (kept === 0) {
        return { content: decode(header, 0, encoding), totalRecordCount };
    }

    const tail = await readRange(filePath, ring[(pushed - kept) % capacity]);
    return { content: decode(Buffer.concat([header, tail]), 0, encoding), totalRecordCount };
}

// ── F7: Chunked / Paged Mode ──

export async function buildPageIndex(
    filePath: string,
    pageSize: number,
    delimiter: string,
    encoding: PreviewEncoding = 'utf8'
): Promise<RowPageIndex> {
    const scanner = await scannerFor(filePath, delimiter);
    const offsets: number[] = [];
    let base = 0;
    let prevEnd = 0;        // start of the record the next end terminates
    let headerEnd = -1;
    let dataRows = 0;

    for await (const chunk of fs.createReadStream(filePath, { highWaterMark: 64 * 1024 })) {
        const buf = chunk as Buffer;
        for (const end of scanner.ends(buf)) {
            const start = prevEnd;
            prevEnd = base + end;
            if (headerEnd < 0) {
                headerEnd = prevEnd;
                continue;
            }
            if (dataRows % pageSize === 0) offsets.push(start);
            dataRows++;
        }
        base += buf.length;
    }

    // A last record without a trailing newline still belongs on its page.
    if (scanner.remainderHasContent) {
        if (headerEnd < 0) {
            headerEnd = base;
        } else {
            if (dataRows % pageSize === 0) offsets.push(prevEnd);
            dataRows++;
        }
    }

    if (offsets.length === 0) offsets.push(headerEnd < 0 ? 0 : headerEnd);

    // The header's line break is an LF with the CRs in front of it or the
    // lone CR of a Mac file. A page goes behind the header with that very
    // break. Joined with an LF, a page of a Mac file read as a file whose
    // rows end with LF. The grid put every row of it into the header.
    const header = headerEnd < 0 ? '' : decode(await readRange(filePath, 0, headerEnd - 1), 0, encoding);
    const headerBreak = /\r*\n$|\r+$/.exec(header)?.[0] ?? '';
    const headerLine = header.slice(0, header.length - headerBreak.length);

    return { offsets, totalRows: dataRows, headerLine, headerBreak, encoding };
}

export async function readPage(filePath: string, index: RowPageIndex, pageNum: number): Promise<string> {
    const startOffset = index.offsets[pageNum];
    const endOffset   = index.offsets[pageNum + 1]; // undefined = read to EOF
    const buf = await readRange(filePath, startOffset, endOffset === undefined ? undefined : endOffset - 1);
    return index.headerLine + index.headerBreak + decode(buf, startOffset, index.encoding);
}
