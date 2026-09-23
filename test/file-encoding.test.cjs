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

test('the start of a file counts as UTF-8 when a character is cut at its end', () => {
    const cut = Buffer.from('abc ö').subarray(0, 5);    // the first byte of ö only
    assert.strictEqual(startsAsUtf8(cut), true);
    assert.strictEqual(startsAsUtf8(Buffer.from('K\xF6ln', 'latin1')), false);
});

if (failures) { console.error(`\n${failures} test(s) failed`); process.exit(1); }
console.log('\nAll file encoding tests passed.');
