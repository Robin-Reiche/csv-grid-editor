// How much memory the rows of a parsed file keep alive.
//
// The grid reads a file without trimming its values. The parser built each
// value one character at a time. Without the trim pass that used to copy every
// value in one piece, V8 kept each one as a chain with a link per character. A
// file with a long text column then took 5 to 14 times the memory of 1.22.0 and
// opened up to twice as slowly. A 227 MB file crashed the webview before it
// showed anything. The parser now cuts each value out of the text in one piece.
//
// The check runs in a child process started with --expose-gc, so it can
// collect the garbage before it measures. Values built character by character
// kept about 28 times the size of the text. Cut in one piece they keep about
// the size of the text, row arrays included.
//
// Run after `tsc -p ./`:  node test/parse-memory.test.cjs

const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

let failures = 0;
function test(name, fn) {
    try { fn(); console.log('  ✓ ' + name); }
    catch (e) { failures++; console.error('  ✗ ' + name + '\n      ' + e.message); }
}

console.log('parse memory');

// Runs in the child. Prints what the parsed rows keep, as a multiple of the
// size of the text.
const CHILD = `
const { parseCsv } = require(${JSON.stringify(path.join(__dirname, '..', 'out', 'webview', 'utils', 'csv.js'))});
const long = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor '.repeat(3);
// Joined from an array, so the text is one flat string the way a file read
// from disk is. Built with += it would be flattened by the first slice. That
// copy would then count as memory the rows keep.
const lines = ['id,title,description,amount,active\\n'];
for (let i = 0; i < 20000; i++) lines.push(i + ',Title number ' + i + ',' + long + i + ',' + (i * 1.5) + ',yes\\n');
const text = lines.join('');
global.gc(); global.gc();
const before = process.memoryUsage().heapUsed;
const rows = parseCsv(text, ',', false, true);
global.gc(); global.gc();
const kept = process.memoryUsage().heapUsed - before;
console.log(JSON.stringify({ rows: rows.length, ratio: kept / text.length }));
`;

test('the rows of a file with long values keep about the memory of the text', () => {
    const res = spawnSync(process.execPath, ['--expose-gc', '-e', CHILD], { encoding: 'utf8' });
    assert.strictEqual(res.status, 0, res.stderr);
    const { rows, ratio } = JSON.parse(res.stdout.trim());
    assert.strictEqual(rows, 20001);
    assert.ok(ratio < 3, 'the rows keep ' + ratio.toFixed(1) + ' times the size of the text');
});

console.log(failures === 0 ? '\nAll parse memory tests passed.' : `\n${failures} test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
