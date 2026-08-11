// Tests for the export format converters (webview/utils/export-formats.ts):
// JSON / JSON Lines / Markdown table / XML generation from the grid's string
// matrix. The risky parts are key derivation (blank and duplicate headers must
// not silently drop fields), value coercion (numbers/booleans should be typed
// in JSON, but NEVER lossily — "007" IDs, huge integers and stray text inside
// a numeric column must survive as strings) and XML well-formedness (arbitrary
// header text has to become a legal element name, cell text has to be escaped).
//
// Run after `npm run compile` (or `tsc -p ./`):  node test/export-formats.test.cjs

const assert = require('assert');
const {
    uniqueKeys,
    coerceValue,
    toJson,
    toJsonLines,
    toMarkdownTable,
    xmlTagNames,
    escapeXmlText,
    toXml,
} = require('../out/webview/utils/export-formats.js');

let failures = 0;
function test(name, fn) {
    try { fn(); console.log('  ✓ ' + name); }
    catch (e) { failures++; console.error('  ✗ ' + name + '\n      ' + e.message); }
}

console.log('export formats');

// ── uniqueKeys ───────────────────────────────────────────────────────────────

test('keys pass through when headers are clean', () => {
    assert.deepStrictEqual(uniqueKeys(['name', 'city']), ['name', 'city']);
});

test('blank headers become positional column_N keys', () => {
    assert.deepStrictEqual(uniqueKeys(['name', '', '  ']), ['name', 'column_2', 'column_3']);
});

test('duplicate headers get numeric suffixes instead of overwriting each other', () => {
    assert.deepStrictEqual(uniqueKeys(['id', 'id', 'id']), ['id', 'id_2', 'id_3']);
});

test('a suffixed key never collides with a real header of the same name', () => {
    assert.deepStrictEqual(uniqueKeys(['id', 'id', 'id_2']), ['id', 'id_2', 'id_2_2']);
});

// ── coerceValue ──────────────────────────────────────────────────────────────

test('integer column: plain integers become numbers', () => {
    assert.strictEqual(coerceValue('42', 'integer'), 42);
    assert.strictEqual(coerceValue('-7', 'integer'), -7);
    assert.strictEqual(coerceValue('0', 'integer'), 0);
});

test('integer column: leading-zero IDs stay strings', () => {
    assert.strictEqual(coerceValue('007', 'integer'), '007');
});

test('integer column: integers past 2^53 stay strings (would round)', () => {
    assert.strictEqual(coerceValue('9007199254740993', 'integer'), '9007199254740993');
});

test('integer column: stray text stays a string', () => {
    assert.strictEqual(coerceValue('n/a', 'integer'), 'n/a');
});

test('float column: decimals become numbers, trailing zeros are numerically lossless', () => {
    assert.strictEqual(coerceValue('3.14', 'float'), 3.14);
    assert.strictEqual(coerceValue('2.50', 'float'), 2.5);
});

test('typed columns: empty cells become null', () => {
    assert.strictEqual(coerceValue('', 'integer'), null);
    assert.strictEqual(coerceValue('  ', 'float'), null);
    assert.strictEqual(coerceValue('', 'boolean'), null);
});

test('string column: values pass through verbatim, empty stays ""', () => {
    assert.strictEqual(coerceValue('007', 'string'), '007');
    assert.strictEqual(coerceValue('', 'string'), '');
    assert.strictEqual(coerceValue(' padded ', 'string'), ' padded ');
});

test('boolean column: true/false coerce case-insensitively, yes/no stay strings', () => {
    assert.strictEqual(coerceValue('true', 'boolean'), true);
    assert.strictEqual(coerceValue('FALSE', 'boolean'), false);
    assert.strictEqual(coerceValue('yes', 'boolean'), 'yes');
});

test('date columns stay strings', () => {
    assert.strictEqual(coerceValue('2026-06-10', 'date'), '2026-06-10');
});

// ── toJson ───────────────────────────────────────────────────────────────────

test('toJson produces an array of typed objects keyed by header', () => {
    const out = toJson(
        ['name', 'age', 'active'],
        [['Alice', '30', 'true'], ['Bob', '', 'false']],
        ['string', 'integer', 'boolean']
    );
    assert.deepStrictEqual(JSON.parse(out), [
        { name: 'Alice', age: 30, active: true },
        { name: 'Bob',  age: null, active: false },
    ]);
    assert.ok(out.endsWith('\n'), 'ends with a newline');
    assert.ok(out.indexOf('\n  ') >= 0, 'pretty-printed with indentation');
});

test('toJson fills short rows with empty/null instead of undefined', () => {
    const out = JSON.parse(toJson(['a', 'b'], [['x']], ['string', 'string']));
    assert.deepStrictEqual(out, [{ a: 'x', b: '' }]);
});

// ── toJsonLines ──────────────────────────────────────────────────────────────

test('toJsonLines emits one compact object per line', () => {
    const out = toJsonLines(['n'], [['1'], ['2']], ['integer']);
    assert.strictEqual(out, '{"n":1}\n{"n":2}\n');
});

test('toJsonLines: every line parses on its own', () => {
    const out = toJsonLines(['a', 'b'], [['x', '1'], ['y', '2']], ['string', 'integer']);
    const lines = out.trim().split('\n');
    assert.strictEqual(lines.length, 2);
    assert.deepStrictEqual(JSON.parse(lines[1]), { a: 'y', b: 2 });
});

// ── toMarkdownTable ──────────────────────────────────────────────────────────

test('toMarkdownTable renders header, separator and rows', () => {
    const out = toMarkdownTable(['name', 'age'], [['Alice', '30']], ['string', 'integer']);
    assert.strictEqual(out, '| name | age |\n| --- | ---: |\n| Alice | 30 |\n');
});

test('toMarkdownTable right-aligns numeric columns only', () => {
    const out = toMarkdownTable(['s', 'i', 'f'], [], ['string', 'integer', 'float']);
    assert.strictEqual(out.split('\n')[1], '| --- | ---: | ---: |');
});

test('toMarkdownTable escapes pipes and converts newlines to <br>', () => {
    const out = toMarkdownTable(['a|b'], [['line1\nline2'], ['win\r\nrow']], ['string']);
    const lines = out.split('\n');
    assert.strictEqual(lines[0], '| a\\|b |');
    assert.strictEqual(lines[2], '| line1<br>line2 |');
    assert.strictEqual(lines[3], '| win<br>row |');
});

test('toMarkdownTable pads short rows so the table stays rectangular', () => {
    const out = toMarkdownTable(['a', 'b'], [['x']], ['string', 'string']);
    assert.strictEqual(out.split('\n')[2], '| x |  |');
});

// ── xmlTagNames ──────────────────────────────────────────────────────────────

test('clean headers become element names unchanged', () => {
    assert.deepStrictEqual(xmlTagNames(['name', 'city_2']), ['name', 'city_2']);
});

test('characters illegal in an XML name become underscores', () => {
    assert.deepStrictEqual(xmlTagNames(['Total (€)', 'first name']), ['Total____', 'first_name']);
});

test('names that cannot start an XML name get an underscore prefix', () => {
    assert.deepStrictEqual(xmlTagNames(['1st year', '-lead', '.dot']), ['_1st_year', '_-lead', '_.dot']);
});

test('the reserved "xml" prefix is escaped', () => {
    assert.deepStrictEqual(xmlTagNames(['xmlns', 'XmlId']), ['_xmlns', '_XmlId']);
});

test('blank headers become positional column_N element names', () => {
    assert.deepStrictEqual(xmlTagNames(['a', '', '  ']), ['a', 'column_2', 'column_3']);
});

test('non-ASCII letters survive as element names', () => {
    assert.deepStrictEqual(xmlTagNames(['Größe', 'Họ tên']), ['Größe', 'Họ_tên']);
});

// XML 1.0 5th edition allows an astral letter in a name and libxml2 accepts one,
// but expat rejects it anywhere in a tag, which is what Python's standard
// library, PHP and Perl parse with. A file those cannot open at all is worse
// than a header that lost a character, so astral characters are replaced like
// any other illegal one. BMP characters must keep coming through untouched.
// One astral character has to yield ONE underscore, not two: it is a surrogate
// pair in JavaScript and a per-unit loop would double it.
test('astral characters are replaced, BMP characters are not', () => {
    assert.deepStrictEqual(
        xmlTagNames(['\u{1D400}bc', '\u{20000}', '中文']),
        ['_bc', '_', '中文']);
});

test('headers that sanitize onto the same name are still made unique', () => {
    assert.deepStrictEqual(xmlTagNames(['a b', 'a-b', 'a b']), ['a_b', 'a-b', 'a_b_2']);
});

// ── escapeXmlText ────────────────────────────────────────────────────────────

test('markup characters are escaped', () => {
    assert.strictEqual(escapeXmlText('a & b <tag> "q" \'s\''), 'a &amp; b &lt;tag&gt; "q" \'s\'');
});

test('an already-escaped entity is not double-decoded, only re-escaped', () => {
    assert.strictEqual(escapeXmlText('&amp;'), '&amp;amp;');
});

test('CR is escaped so parsers do not normalise it away, LF and tab stay literal', () => {
    assert.strictEqual(escapeXmlText('a\r\nb\tc'), 'a&#13;\nb\tc');
});

test('control characters illegal in XML 1.0 are dropped', () => {
    const raw = 'a' + String.fromCharCode(0) + 'b' + String.fromCharCode(0x1f) + 'c';
    assert.strictEqual(escapeXmlText(raw), 'abc');
});

test('astral characters (emoji) survive intact', () => {
    assert.strictEqual(escapeXmlText('ok 👍'), 'ok 👍');
});

test('a lone surrogate is dropped instead of producing invalid XML', () => {
    assert.strictEqual(escapeXmlText('a' + String.fromCharCode(0xd800) + 'b'), 'ab');
});

// ── toXml ────────────────────────────────────────────────────────────────────

test('toXml wraps rows in a declaration and a <rows> root', () => {
    const out = toXml(['name', 'age'], [['Alice', '30']], ['string', 'integer']);
    assert.strictEqual(out,
        '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<rows>\n' +
        '  <row>\n' +
        '    <name>Alice</name>\n' +
        '    <age>30</age>\n' +
        '  </row>\n' +
        '</rows>\n');
});

test('toXml on an empty row set still emits a well-formed root', () => {
    const out = toXml(['a'], [], ['string']);
    assert.strictEqual(out, '<?xml version="1.0" encoding="UTF-8"?>\n<rows>\n</rows>\n');
});

test('toXml writes numbers verbatim — no coercion, so "2.50" and "007" keep their text', () => {
    const out = toXml(['f', 'id'], [['2.50', '007']], ['float', 'integer']);
    assert.ok(out.indexOf('<f>2.50</f>') >= 0, 'trailing zero kept');
    assert.ok(out.indexOf('<id>007</id>') >= 0, 'leading zero kept');
});

test('toXml: an empty cell is self-closing in a typed column, empty text in a string column', () => {
    const out = toXml(['age', 'note'], [['', '']], ['integer', 'string']);
    assert.ok(out.indexOf('    <age/>\n') >= 0, 'typed empty cell is self-closing');
    assert.ok(out.indexOf('    <note></note>\n') >= 0, 'string empty cell stays an empty element');
});

test('toXml escapes cell content instead of emitting raw markup', () => {
    const out = toXml(['a'], [['<b>&</b>']], ['string']);
    assert.ok(out.indexOf('<a>&lt;b&gt;&amp;&lt;/b&gt;</a>') >= 0);
});

test('toXml pads short rows so every row has the same elements', () => {
    const out = toXml(['a', 'b'], [['x']], ['string', 'string']);
    assert.ok(out.indexOf('<b></b>') >= 0);
});

if (failures) { console.error('\n' + failures + ' test(s) failed'); process.exit(1); }
console.log('\nAll tests passed');
