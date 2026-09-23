// How a file's bytes are read and written back (src/encoding.ts). A file that
// is not UTF-8 used to be read as UTF-8 anyway: every umlaut of a Windows-1252
// file (Excel's plain "CSV") became U+FFFD and a UTF-16 file became noise.
// The first save wrote that over the whole file. Whatever encoding a file is
// read in, writing the same text back has to give the same bytes.
//
// Run after `tsc -p ./`:  node test/file-encoding.test.cjs

const assert = require('assert');
const { decodeFile, encodeFile, decodeWindows1252, startsAsUtf8 } = require('../out/encoding.js');

let failures = 0;
function test(name, fn) {
    try { fn(); console.log('  ✓ ' + name); }
    catch (e) { failures++; console.error('  ✗ ' + name + '\n      ' + e.message); }
}

const bytes = (...b) => Buffer.from(b.flat());
const roundTrip = raw => {
    const { text, encoding } = decodeFile(raw);
    const back = encodeFile(text, encoding);
    assert.ok(back, `${encoding} could not write back what it read`);
    assert.ok(Buffer.from(back).equals(Buffer.from(raw)),
        `${encoding}: ${Buffer.from(raw).toString('hex')} came back as ${Buffer.from(back).toString('hex')}`);
    return { text, encoding };
};

console.log('reading and writing a file in its own encoding');

test('Windows-1252 reads every byte the way the Encoding Standard does', () => {
    const all = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
    assert.strictEqual(decodeWindows1252(all), new TextDecoder('windows-1252').decode(all));
});

test('every byte of a Windows-1252 file comes back as it was', () => {
    const all = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
    assert.strictEqual(roundTrip(all).encoding, 'windows1252');
});

test('an umlaut in Windows-1252 reads as the umlaut', () => {
    const { text, encoding } = roundTrip(Buffer.from('Name;Stadt\r\nJ\xF6rg;K\xF6ln\r\n', 'latin1'));
    assert.strictEqual(encoding, 'windows1252');
    assert.strictEqual(text, 'Name;Stadt\r\nJörg;Köln\r\n');
});

test('valid UTF-8 stays UTF-8, with or without the byte order mark', () => {
    assert.deepStrictEqual(roundTrip(Buffer.from('a,b\nJürgen,Köln\n')), { text: 'a,b\nJürgen,Köln\n', encoding: 'utf8' });
    assert.deepStrictEqual(roundTrip(bytes([0xEF, 0xBB, 0xBF], [...Buffer.from('a\nö\n')])), { text: 'a\nö\n', encoding: 'utf8bom' });
    assert.deepStrictEqual(roundTrip(Buffer.alloc(0)), { text: '', encoding: 'utf8' });
});

test('UTF-16 with a byte order mark is read as UTF-16, either byte order', () => {
    const le = bytes([0xFF, 0xFE], [...Buffer.from('a,ö\r\n', 'utf16le')]);
    assert.deepStrictEqual(roundTrip(le), { text: 'a,ö\r\n', encoding: 'utf16le' });
    const be = bytes([0xFE, 0xFF], [...Buffer.from('a,ö\r\n', 'utf16le').swap16()]);
    assert.deepStrictEqual(roundTrip(be), { text: 'a,ö\r\n', encoding: 'utf16be' });
});

test('UTF-16 keeps a lone surrogate as it was', () => {
    roundTrip(bytes([0xFF, 0xFE], [0x00, 0xD8, 0x41, 0x00]));
});

test('an odd number of bytes behind a UTF-16 mark is no UTF-16 and keeps every byte', () => {
    assert.strictEqual(roundTrip(bytes([0xFF, 0xFE, 0x41])).encoding, 'windows1252');
});

test('Windows-1252 cannot write a character it has no byte for', () => {
    for (const c of ['Ł', '✓', '😀', '\u0080']) {
        assert.strictEqual(encodeFile('a;' + c, 'windows1252'), null, JSON.stringify(c) + ' was written anyway');
    }
    assert.ok(encodeFile('\u20AC \u201Equoted\u201C \u2013 \u0178', 'windows1252'), 'a character Windows-1252 has was refused');
});

// A UTF-8 export with a byte order mark that a legacy tool later added a
// Windows-1252 line to. Read whole as Windows-1252, the mark stood in front
// of the first header name as "ï»¿" and every umlaut was mojibake. The first
// save that needed UTF-8 wrote all of that into the file.
test('a stray byte in a UTF-8 file with a byte order mark is read on its own', () => {
    const utf8 = s => [...Buffer.from(s, 'utf8')];
    const raw = bytes([0xEF, 0xBB, 0xBF], utf8('name;city\nMüller;Köln\nSch'), [0xF6], utf8('n;x\n'));
    const { text, encoding } = decodeFile(raw);
    assert.strictEqual(text, 'name;city\nMüller;Köln\nSchön;x\n');
    assert.strictEqual(encoding, 'utf8bom');
    // Written back, only the stray byte changes, into the UTF-8 of its character.
    const back = Buffer.from(encodeFile(text, encoding));
    assert.strictEqual(back.toString('hex'),
        Buffer.from(bytes([0xEF, 0xBB, 0xBF], utf8('name;city\nMüller;Köln\nSchön;x\n'))).toString('hex'));
});

test('without a byte order mark a file that is not UTF-8 is still Windows-1252', () => {
    const raw = bytes([...Buffer.from('Müller;', 'utf8')], [0xF6]);
    assert.deepStrictEqual(decodeFile(raw), { text: 'MÃ¼ller;ö', encoding: 'windows1252' });
});

test('behind a byte order mark each byte outside a valid UTF-8 sequence is its Windows-1252 character', () => {
    // Every sequence TextDecoder accepts as one character is read as UTF-8.
    const valid = (b, i) => {
        for (let n = 1; n <= 4 && i + n <= b.length; n++) {
            try {
                const s = new TextDecoder('utf-8', { fatal: true }).decode(b.subarray(i, i + n));
                if ([...s].length === 1) return n;
            } catch {}
        }
        return 0;
    };
    let seed = 7;
    const rnd = n => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) % n; };
    for (let run = 0; run < 300; run++) {
        const parts = [];
        for (let k = 0; k < 40; k++) {
            const pick = rnd(4);
            if (pick === 0) parts.push(rnd(256));
            else if (pick === 1) parts.push(0xC0 + rnd(64), rnd(256));
            else parts.push(...Buffer.from(String.fromCodePoint(rnd(0x110000)), 'utf8'));
        }
        const body = Buffer.from(parts);
        let want = '';
        for (let i = 0; i < body.length;) {
            const n = valid(body, i);
            want += n ? new TextDecoder().decode(body.subarray(i, i + n)) : decodeWindows1252(body.subarray(i, i + 1));
            i += n || 1;
        }
        const raw = Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), body]);
        const got = decodeFile(raw).text;
        assert.strictEqual(got, want, 'bytes ' + body.toString('hex'));
    }
});

test('the start of a file counts as UTF-8 when a character is cut at its end', () => {
    const cut = Buffer.from('abc ö').subarray(0, 5);    // the first byte of ö only
    assert.strictEqual(startsAsUtf8(cut), true);
    assert.strictEqual(startsAsUtf8(Buffer.from('K\xF6ln', 'latin1')), false);
});

if (failures) { console.error(`\n${failures} test(s) failed`); process.exit(1); }
console.log('\nAll file encoding tests passed.');
