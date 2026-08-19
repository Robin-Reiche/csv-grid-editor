import * as fs from 'fs';

export interface RowPageIndex {
    offsets: number[];   // byte offset of the first byte of each page's first data record
    totalRows: number;
    headerLine: string;
}

const QUOTE = 0x22;
const LF    = 0x0A;
const CR    = 0x0D;
const SPACE = 0x20;
const TAB   = 0x09;

// A CSV record is not a line: a quoted field may hold line breaks, so one record
// can span any number of them. Splitting the raw bytes on \n therefore counts
// too many rows and, wherever a split lands inside a quoted field, the quotes
// stop pairing up and everything after it is parsed into the wrong columns
// (issue #32). Every reader below walks the file through this scanner instead.
// It tracks quote state exactly the way the grid's parser does (see
// webview/utils/csv.ts): outside quotes a " opens a quoted section, inside one
// "" is a literal quote and a single " closes it, and only \n ends a record.
// Scanning bytes rather than characters is safe because ", \n and \r are ASCII
// and never appear inside a multi-byte UTF-8 sequence.
class RecordScanner {
    private inQuotes = false;
    // A " seen inside quotes whose meaning depends on the next byte, which can
    // sit in the next chunk: "" is a literal quote, anything else closes.
    private pendingQuote = false;

    // Whether anything but whitespace has turned up since the last record end.
    // parseCsv only keeps a final record without a trailing newline when it
    // holds something, so this decides whether the file's tail counts as a row.
    // Whitespace is the whole test here: a tail that parses to nothing but empty
    // fields (",,," or '""') is still counted, which would take the delimiter
    // and a full parse to tell apart and is worth revisiting if it ever shows up
    // in a real file.
    public remainderHasContent = false;

    // Offsets, relative to `buf`, of the byte just past each record-ending \n.
    public ends(buf: Buffer): number[] {
        const out: number[] = [];
        for (let i = 0; i < buf.length; i++) {
            const b = buf[i];
            if (b !== LF && b !== CR && b !== SPACE && b !== TAB) this.remainderHasContent = true;

            if (this.pendingQuote) {
                this.pendingQuote = false;
                if (b === QUOTE) continue;   // "" — a literal quote, still inside
                this.inQuotes = false;       // the quote closed the field
            }

            if (this.inQuotes) {
                if (b === QUOTE) this.pendingQuote = true;
            } else if (b === QUOTE) {
                this.inQuotes = true;
            } else if (b === LF) {
                out.push(i + 1);
                this.remainderHasContent = false;
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

// Head preview: the first `recordCount` records, header included.
export async function readFirstRecords(filePath: string, recordCount: number): Promise<string> {
    const scanner = new RecordScanner();
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

    return Buffer.concat(chunks).toString('utf8');
}

// Total records in the file, header included — the number the preview banner
// compares against, and the same number Open Full File would put in the grid.
export async function countRecords(filePath: string): Promise<number> {
    const scanner = new RecordScanner();
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
    recordCount: number
): Promise<{ content: string; totalRecordCount: number }> {
    const scanner = new RecordScanner();
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
        return { content: (await readRange(filePath, 0)).toString('utf8'), totalRecordCount };
    }

    const header = await readRange(filePath, 0, headerEnd - 1);
    const kept = Math.min(pushed, recordCount);
    if (kept === 0) {
        return { content: header.toString('utf8'), totalRecordCount };
    }

    const tail = await readRange(filePath, ring[(pushed - kept) % capacity]);
    return { content: Buffer.concat([header, tail]).toString('utf8'), totalRecordCount };
}

// ── F7: Chunked / Paged Mode ──

export async function buildPageIndex(filePath: string, pageSize: number): Promise<RowPageIndex> {
    const scanner = new RecordScanner();
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

    const headerLine = headerEnd < 0
        ? ''
        : (await readRange(filePath, 0, headerEnd - 1)).toString('utf8').replace(/\r?\n$/, '');

    return { offsets, totalRows: dataRows, headerLine };
}

export async function readPage(filePath: string, index: RowPageIndex, pageNum: number): Promise<string> {
    const startOffset = index.offsets[pageNum];
    const endOffset   = index.offsets[pageNum + 1]; // undefined = read to EOF
    const buf = await readRange(filePath, startOffset, endOffset === undefined ? undefined : endOffset - 1);
    return index.headerLine + '\n' + buf.toString('utf8');
}
