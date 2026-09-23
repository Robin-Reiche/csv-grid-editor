// Regression guard: the file watcher has to see changes to a file whose name
// holds a glob character.
//
// The watcher is a RelativePattern of the file's folder and a pattern. VS
// Code reads that pattern as a glob. The pattern used to be the bare file
// name. In data[1].csv the [1] is a character class that matches data1.csv
// and never data[1].csv. In report{2024}.csv the braces are a choice that
// matches report2024.csv. VS Code also trims the pattern, so a name with a
// space at either end missed as well. For all of those the grid never
// reloaded, never warned about an outside change under unsaved edits and never
// picked up a byte order mark added outside.
//
// VS Code filters every watcher event through that glob before the extension
// sees it. The matcher below follows parsePattern and parseRegExp in VS Code's
// src/vs/base/common/glob.ts for what a single file name can reach: the trim,
// the plain name fast path, brackets, braces, ? and *.
//
// Run after `tsc -p ./`:  node test/watcher-pattern.test.cjs

const assert = require('assert');
const Module = require('module');

const patterns = [];

const vscodeStub = {
    EventEmitter: class { constructor() { this.event = () => ({ dispose() {} }); } fire() {} dispose() {} },
    Uri: {
        file: p => ({ fsPath: p, toString: () => 'file://' + p }),
        joinPath: (base, ...parts) => ({ fsPath: [base.fsPath, ...parts].join('/') }),
    },
    RelativePattern: class { constructor(base, pattern) { this.base = base; this.pattern = pattern; } },
    workspace: {
        fs: {
            stat: async () => ({ size: 4 }),
            readFile: async () => new TextEncoder().encode('a\n1\n'),
            writeFile: async () => {},
        },
        createFileSystemWatcher: pattern => {
            patterns.push(pattern);
            return { onDidChange() {}, onDidCreate() {}, dispose() {} };
        },
    },
    window: {}, commands: {}, Disposable: { from() {} },
};

const load = Module._load;
Module._load = function (request, ...rest) {
    if (request === 'vscode') return vscodeStub;
    return load.call(this, request, ...rest);
};

const { CsvEditorProvider } = require('../out/csvEditorProvider.js');

// ── VS Code's glob, as far as one file name reaches it ──

const NO_PATH_REGEX = '[^/\\\\]';
const escapeRegExp = s => s.replace(/[\\{}*+?|^$.[\]()]/g, '\\$&');

function splitGlobAware(pattern, splitChar) {
    const segments = [];
    let inBraces = false, inBrackets = false, cur = '';
    for (const ch of pattern) {
        if (ch === splitChar && !inBraces && !inBrackets) { segments.push(cur); cur = ''; continue; }
        if (ch === '{') inBraces = true;
        else if (ch === '}') inBraces = false;
        else if (ch === '[') inBrackets = true;
        else if (ch === ']') inBrackets = false;
        cur += ch;
    }
    if (cur) segments.push(cur);
    return segments;
}

// One path segment, which is all a file name is.
function segmentRegExp(segment) {
    let regEx = '';
    let inBraces = false, braceVal = '', inBrackets = false, bracketVal = '';
    for (const ch of segment) {
        if (ch !== '}' && inBraces) { braceVal += ch; continue; }
        // A ] right after the [ is taken literally.
        if (inBrackets && (ch !== ']' || !bracketVal)) {
            if (ch === '-') bracketVal += ch;
            else if ((ch === '^' || ch === '!') && !bracketVal) bracketVal += '^';
            else if (ch !== '/') bracketVal += escapeRegExp(ch);
            continue;
        }
        switch (ch) {
            case '{': inBraces = true; continue;
            case '[': inBrackets = true; continue;
            case '}':
                regEx += `(?:${splitGlobAware(braceVal, ',').map(segmentRegExp).join('|')})`;
                inBraces = false; braceVal = '';
                break;
            case ']':
                regEx += '[' + bracketVal + ']';
                inBrackets = false; bracketVal = '';
                break;
            case '?': regEx += NO_PATH_REGEX; continue;
            case '*': regEx += `${NO_PATH_REGEX}*?`; continue;
            default: regEx += escapeRegExp(ch);
        }
    }
    return regEx;
}

// Whether VS Code lets through an event for `name` in the watched folder.
function globMatches(pattern, name) {
    pattern = pattern.trim();
    if (/^([\w.-]+(\/[\w.-]+)*)\/?$/.test(pattern)) return name === pattern;
    let re;
    try { re = new RegExp(`^${segmentRegExp(pattern)}$`); } catch { return false; }
    return re.test(name);
}

// ── The tests ──

let failures = 0;
async function test(name, fn) {
    try { await fn(); console.log('  ✓ ' + name); }
    catch (e) { failures++; console.error('  ✗ ' + name + '\n      ' + e.message); }
}

// The pattern the provider watches for `/data/<name>`.
async function watchedPattern(name) {
    patterns.length = 0;
    const context = { extensionUri: { fsPath: '/ext' }, globalState: { get: (_k, d) => d, update() {} } };
    const provider = new CsvEditorProvider(context);
    const doc = await provider.openCustomDocument(vscodeStub.Uri.file('/data/' + name), {}, {});
    const panel = {
        webview: {
            options: null, html: '', cspSource: 'stub',
            asWebviewUri: u => u.fsPath,
            postMessage: () => Promise.resolve(true),
            onDidReceiveMessage() {},
        },
        onDidDispose() {},
    };
    await provider.resolveCustomEditor(doc, panel, {});
    assert.strictEqual(patterns.length, 1, 'the file was not watched');
    assert.strictEqual(patterns[0].base.fsPath, '/data', 'the watcher looks at another folder');
    return patterns[0].pattern;
}

async function main() {
    console.log('the file watcher sees changes to its own file, whatever the name');

    await test('the matcher reads a glob the way VS Code does', () => {
        assert.strictEqual(globMatches('data[1].csv', 'data1.csv'), true);
        assert.strictEqual(globMatches('data[1].csv', 'data[1].csv'), false);
        assert.strictEqual(globMatches('report{2024}.csv', 'report2024.csv'), true);
        assert.strictEqual(globMatches(' spaced.csv', ' spaced.csv'), false);
        assert.strictEqual(globMatches('sales (1).csv', 'sales (1).csv'), true);
    });

    const cases = [
        // name, a sibling the raw name used to match instead
        ['plain.csv', null],
        ['sales (1).csv', null],
        ['data[1].csv', 'data1.csv'],
        ['export [final].csv', 'export f.csv'],
        ['report{2024}.csv', 'report2024.csv'],
        ['x{a,b}.csv', 'xa.csv'],
        ['a]b[c.csv', null],
        ['[].csv', null],
        ['what?.csv', 'whatX.csv'],
        ['star*.csv', 'starfish.csv'],
        ['!bang^caret-dash.csv', null],
        [' spaced.csv', 'spaced.csv'],
        ['trailing.csv ', 'trailing.csv'],
    ];
    for (const [name, sibling] of cases) {
        await test(`${JSON.stringify(name)} reloads on its own change`, async () => {
            const pattern = await watchedPattern(name);
            assert.ok(globMatches(pattern, name), `pattern ${JSON.stringify(pattern)} does not match the file itself`);
            if (sibling) {
                assert.ok(!globMatches(pattern, sibling), `pattern ${JSON.stringify(pattern)} matches ${JSON.stringify(sibling)}`);
            }
        });
    }

    if (failures) { console.error(`\n${failures} test(s) failed`); process.exit(1); }
    console.log('\nAll watcher pattern tests passed.');
}

main();
