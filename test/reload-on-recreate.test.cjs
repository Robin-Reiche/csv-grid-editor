// Regression guard for issue #25 (grid keeps showing stale data after an
// external rewrite): the file watcher must reload on BOTH change and create.
// A script that regenerates a CSV by deleting it (or its whole folder) and
// writing it fresh produces a delete followed by a create, never a change, so
// a change-only listener never fires and the grid silently goes stale. Measured
// on Windows: python and PowerShell regenerates both produced delete+create
// ~100 ms apart, while an in-place rewrite produced a change.
//
// Also guards the manual escape hatch: File > Revert File cannot serve as one,
// because VSCode drops a revert before it reaches the provider unless the
// document has unsaved changes, so the reload command has to exist.
//
// Run after `tsc -p ./`:  node test/reload-on-recreate.test.cjs

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'src', 'csvEditorProvider.ts'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

let failures = 0;
function test(name, fn) {
    try { fn(); console.log('  ✓ ' + name); }
    catch (e) { failures++; console.error('  ✗ ' + name + '\n      ' + e.message); }
}

console.log('external rewrites reload the grid (issue #25)');

test('watcher reloads on change', () => {
    assert.ok(/watcher\.onDidChange\(/.test(src), 'no onDidChange listener on the watcher');
});

test('watcher also reloads on create (delete+create rewrite)', () => {
    assert.ok(/watcher\.onDidCreate\(/.test(src), 'no onDidCreate listener — a regenerated file will not reload');
});

test('both listeners run the same reload path', () => {
    const change = src.match(/watcher\.onDidChange\(([^\n]*)\)/);
    const create = src.match(/watcher\.onDidCreate\(([^\n]*)\)/);
    assert.ok(change && create, 'could not read both listener bodies');
    assert.ok(/reload\(\)/.test(change[1]), 'onDidChange does not call reload()');
    assert.ok(/reload\(\)/.test(create[1]), 'onDidCreate does not call reload()');
});

test('reload still ignores the echo of our own save', () => {
    assert.ok(/if \(text === document\.content\) return false;/.test(src),
        'the identical-content guard is gone — saving would wipe frozen rows');
});

test('reload command is declared in package.json', () => {
    const commands = (pkg.contributes && pkg.contributes.commands) || [];
    const cmd = commands.find(c => c.command === 'csvViewer.reloadFromDisk');
    assert.ok(cmd, 'csvViewer.reloadFromDisk is not contributed');
    assert.strictEqual(cmd.title, 'Reload from Disk');
});

test('reload command is registered in the provider', () => {
    assert.ok(/registerCommand\('csvViewer\.reloadFromDisk'/.test(src),
        'the contributed command has no handler and would fail when invoked');
});

if (failures) { console.error(`\n${failures} test(s) failed`); process.exit(1); }
console.log('\nAll tests passed');
