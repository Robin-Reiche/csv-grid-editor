// How a file's bytes become the text the grid shows and back again. A save
// has to give back the very bytes it was given for every row nobody edited,
// so a file is written in the encoding it was read in.
//
// Most CSV files are UTF-8. Excel's "CSV UTF-8" starts it with a byte order
// mark. Excel's plain "CSV" is written in the Windows code page, which is
// Windows-1252 in Western Europe. Excel's Unicode text and some database tools
// write UTF-16 with a byte order mark. All of these used to be read as UTF-8.
// Every umlaut of a Windows-1252 file turned into U+FFFD. The first save wrote
// that over the whole file.

// The names VS Code gives these encodings in its files.encoding setting.
export type FileEncoding = 'utf8' | 'utf8bom' | 'utf16le' | 'utf16be' | 'windows1252';

export function isFileEncoding(value: unknown): value is FileEncoding {
    return value === 'utf8' || value === 'utf8bom' || value === 'utf16le'
        || value === 'utf16be' || value === 'windows1252';
}

const UTF8_BOM    = [0xEF, 0xBB, 0xBF];
const UTF16LE_BOM = [0xFF, 0xFE];
const UTF16BE_BOM = [0xFE, 0xFF];

// What Windows-1252 has at 0x80 to 0x9F, where Latin-1 has control
// characters. The five bytes Windows-1252 leaves unassigned keep their Latin-1
// meaning, the way browsers read them, so they come back out as they went in.
const WINDOWS_1252_HIGH = [
    0x20AC, 0x0081, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021,
    0x02C6, 0x2030, 0x0160, 0x2039, 0x0152, 0x008D, 0x017D, 0x008F,
    0x0090, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014,
    0x02DC, 0x2122, 0x0161, 0x203A, 0x0153, 0x009D, 0x017E, 0x0178
];
const WINDOWS_1252_BYTE = new Map(
    WINDOWS_1252_HIGH.map((code, i) => [String.fromCharCode(code), String.fromCharCode(0x80 + i)])
);

function asBuffer(bytes: Uint8Array): Buffer {
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function startsWith(bytes: Uint8Array, mark: number[]): boolean {
    return bytes.length >= mark.length && mark.every((byte, i) => bytes[i] === byte);
}

function withMark(mark: number[], body: Uint8Array): Uint8Array {
    const bytes = new Uint8Array(mark.length + body.length);
    bytes.set(mark);
    bytes.set(body, mark.length);
    return bytes;
}

// Every byte has a character in Windows-1252, so reading a file this way
// never loses one, even when the file was something else after all.
export function decodeWindows1252(bytes: Uint8Array): string {
    return asBuffer(bytes).toString('latin1')
        .replace(/[\x80-\x9F]/g, c => String.fromCharCode(WINDOWS_1252_HIGH[c.charCodeAt(0) - 0x80]));
}

// Null when the text holds a character Windows-1252 has no byte for.
function encodeWindows1252(text: string): Uint8Array | null {
    let encodable = true;
    const latin1 = text.replace(/[^\x00-\x7F\xA0-\xFF]/g, c => {
        const byte = WINDOWS_1252_BYTE.get(c);
        if (byte === undefined) encodable = false;
        return byte ?? c;
    });
    return encodable ? Buffer.from(latin1, 'latin1') : null;
}

// Whether the bytes from `lo` to `hi` include the byte at `i` of `b`.
function inRange(b: Uint8Array, i: number, lo: number, hi: number): boolean {
    return i < b.length && b[i] >= lo && b[i] <= hi;
}

// How many bytes the UTF-8 character at `i` takes, 0 when no valid one starts
// there. Valid is what TextDecoder accepts: no overlong forms, no surrogates,
// nothing past U+10FFFF.
function utf8Length(b: Uint8Array, i: number): number {
    const c = b[i];
    if (c < 0x80) return 1;
    if (c >= 0xC2 && c <= 0xDF) return inRange(b, i + 1, 0x80, 0xBF) ? 2 : 0;
    if (c >= 0xE0 && c <= 0xEF) {
        const ok = inRange(b, i + 1, c === 0xE0 ? 0xA0 : 0x80, c === 0xED ? 0x9F : 0xBF)
            && inRange(b, i + 2, 0x80, 0xBF);
        return ok ? 3 : 0;
    }
    if (c >= 0xF0 && c <= 0xF4) {
        const ok = inRange(b, i + 1, c === 0xF0 ? 0x90 : 0x80, c === 0xF4 ? 0x8F : 0xBF)
            && inRange(b, i + 2, 0x80, 0xBF) && inRange(b, i + 3, 0x80, 0xBF);
        return ok ? 4 : 0;
    }
    return 0;
}

// UTF-8, but a byte that is not part of a valid UTF-8 character is read as
// its Windows-1252 character, the way a line a legacy tool added to a UTF-8
// file was written. No byte turns into U+FFFD. Written back as UTF-8, every
// other byte comes out as it was.
export function decodeUtf8KeepingStrays(bytes: Uint8Array): string {
    const buf = asBuffer(bytes);
    let text = '';
    let from = 0;
    for (let i = 0; i < buf.length;) {
        const n = utf8Length(buf, i);
        if (n) {
            i += n;
            continue;
        }
        text += buf.toString('utf8', from, i) + decodeWindows1252(buf.subarray(i, i + 1));
        from = ++i;
    }
    return text + buf.toString('utf8', from);
}

// Whether these bytes, the start of a longer file, can begin UTF-8 text. A
// character cut in two at the end of them does not count against it.
export function startsAsUtf8(bytes: Uint8Array): boolean {
    try {
        new TextDecoder('utf-8', { fatal: true }).decode(bytes, { stream: true });
        return true;
    } catch {
        return false;
    }
}

// A file with a UTF-16 byte order mark is UTF-16. Anything else is UTF-8 when
// it is valid UTF-8. When it is not, it is Windows-1252, unless it starts with
// the UTF-8 byte order mark. The mark says the file is UTF-8. A byte that is
// not is most likely part of a line some legacy tool added later, so only such
// bytes are read as Windows-1252 then. Read whole that way, the mark showed as
// "ï»¿" in front of the first header name and every umlaut was mojibake, which
// a save wrote into the file for good. The grid never sees a byte order mark:
// kept, it would sit in front of the first header name.
//
// `current` is the encoding of the document that reads its file again. Plain
// ASCII is valid UTF-8 and Windows-1252 alike. Taken for UTF-8, a Windows-1252
// file whose last umlaut was edited away saved the next umlaut in UTF-8, which
// Excel reads as ANSI and garbles. So the document keeps its encoding whenever
// that encoding gives these very bytes for the text.
export function decodeFile(raw: Uint8Array, current?: FileEncoding): { text: string; encoding: FileEncoding } {
    const found = detectEncoding(raw);
    if (current && current !== found.encoding) {
        const bytes = encodeFile(found.text, current);
        if (bytes && asBuffer(bytes).equals(asBuffer(raw))) return { text: found.text, encoding: current };
    }
    return found;
}

function detectEncoding(raw: Uint8Array): { text: string; encoding: FileEncoding } {
    const bytes = asBuffer(raw);
    // UTF-16 has two bytes for every unit. With an odd count the file is not
    // UTF-16 whatever it starts with. Windows-1252 keeps all its bytes then.
    if (bytes.length % 2 === 0) {
        if (startsWith(bytes, UTF16LE_BOM)) {
            return { text: bytes.toString('utf16le', 2), encoding: 'utf16le' };
        }
        if (startsWith(bytes, UTF16BE_BOM)) {
            return { text: Buffer.from(bytes.subarray(2)).swap16().toString('utf16le'), encoding: 'utf16be' };
        }
    }
    try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        return { text, encoding: startsWith(bytes, UTF8_BOM) ? 'utf8bom' : 'utf8' };
    } catch {
        if (startsWith(bytes, UTF8_BOM)) {
            return { text: decodeUtf8KeepingStrays(bytes.subarray(UTF8_BOM.length)), encoding: 'utf8bom' };
        }
        return { text: decodeWindows1252(bytes), encoding: 'windows1252' };
    }
}

// The bytes of a file with this text, behind the byte order mark the encoding
// has. Null when the encoding cannot hold every character of the text, which
// only happens with Windows-1252.
export function encodeFile(text: string, encoding: FileEncoding): Uint8Array | null {
    switch (encoding) {
        case 'utf8':        return new TextEncoder().encode(text);
        case 'utf8bom':     return withMark(UTF8_BOM, new TextEncoder().encode(text));
        case 'utf16le':     return withMark(UTF16LE_BOM, Buffer.from(text, 'utf16le'));
        case 'utf16be':     return withMark(UTF16BE_BOM, Buffer.from(text, 'utf16le').swap16());
        case 'windows1252': return encodeWindows1252(text);
    }
}
