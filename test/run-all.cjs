// Minimal test runner: executes every *.test.cjs in this directory as its own
// Node process and aggregates the results. No framework dependency — the tests
// are plain assert-based scripts that exit non-zero on failure.
//
// Precondition: `tsc -p ./` has produced out/ (the npm "pretest" hook does this).

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const files = fs.readdirSync(dir).filter(f => f.endsWith('.test.cjs')).sort();

if (files.length === 0) {
    console.error('No *.test.cjs files found in ' + dir);
    process.exit(1);
}

let failed = 0;
for (const f of files) {
    const res = spawnSync(process.execPath, [path.join(dir, f)], { stdio: 'inherit' });
    if (res.status !== 0) failed++;
}

console.log('');
if (failed) {
    console.error(`${failed} of ${files.length} test file(s) failed`);
    process.exit(1);
}
console.log(`${files.length} test file(s) passed`);
