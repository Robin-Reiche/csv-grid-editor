// Browser tests for keeping a file's line endings and its final newline.
//
// Every edit sends the whole table back as the file's text. When that text
// joins the rows with LF and ends without a line break, ticking one checkbox
// in a CRLF file rewrites every line and drops the break at the end of the
// file. Each scenario here edits one cell and checks that the text sent back
// differs from the file in that cell only.
//
// Run after `tsc -p ./`:  node test/ui-line-endings.test.cjs

const { runSuite } = require('./ui/harness.cjs');

// Shared by every scenario. The steps run inside the page, where these helpers
// are rebuilt from their source, so they must not close over anything.
const HELPERS = `
    t.edit = async (row, col, value) => {
        await t.focusCell(row, col);
        await t.pressEnter();
        const ta = document.querySelector('#grid-container textarea');
        if (!ta) { t.check(false, 'Enter opens the editor on ' + row + ',' + col); return; }
        ta.value = value;
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        await t.pressEnter();
        await t.wait(300);
    };
    t.tick = async (row, col) => {
        const box = t.box(row, col);
        if (!box) { t.check(false, 'a checkbox is drawn at ' + row + ',' + col); return; }
        t.click(box);
        await t.wait(300);
    };
    t.same = (expected, what) => {
        const got = t.lastEdit();
        t.check(got === expected, what + ' (' + JSON.stringify(got) + ')');
    };
`;

const steps = (body) => `async (t, csv) => { ${HELPERS} await t.init(csv); ${body} }`;

runSuite('line endings (browser)', [
    {
        name: 'CRLF with a line break at the end',
        csv: 'name,active,note\r\na,true,"x\r\ny"\r\nb,false,z\r\n',
        settings: { boolCheckboxes: true },
        steps: steps(`
            await t.tick(0, 1);
            t.same(csv.replace('a,true', 'a,false'), 'only the ticked cell changes');
            document.getElementById('btn-undo').dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await t.wait(300);
            t.same(csv, 'undo gives back the file as it was');
        `),
    },
    {
        name: 'LF without a line break at the end',
        csv: 'name,city\na,Berlin\nb,Rome',
        steps: steps(`
            await t.edit(0, 1, 'Paris');
            t.same(csv.replace('Berlin', 'Paris'), 'only the edited cell changes');
        `),
    },
    {
        name: 'LF with a blank last line',
        csv: 'name,active\na,true\nb,false\n\n',
        settings: { boolCheckboxes: true },
        steps: steps(`
            await t.tick(0, 1);
            t.same(csv.replace('a,true', 'a,false'), 'the blank line and the break at the end stay');
        `),
    },
    {
        name: 'CRLF inside a quoted value of an LF file',
        csv: 'note,active\n"l1\r\nl2\r\nl3\r\nl4",true\nb,false\n',
        settings: { boolCheckboxes: true },
        steps: steps(`
            await t.tick(0, 1);
            t.same(csv.replace(',true', ',false'), 'the rows keep LF and the value keeps its CRLF');
        `),
    },
    {
        name: 'an outside change brings its own line ending',
        csv: 'name,active\na,true\n',
        settings: { boolCheckboxes: true },
        steps: steps(`
            const changed = 'name,active\\r\\na,true\\r\\nb,true\\r\\n';
            window.postMessage({ type: 'update', text: changed, delimiter: ',' }, '*');
            await t.wait(400);
            await t.tick(0, 1);
            t.same(changed.replace('a,true', 'a,false'), 'the edit is written the way the changed file ends its lines');
        `),
    },
    {
        name: 'a delimiter switch keeps the line ending',
        csv: 'name;active\r\na;true\r\n',
        settings: { boolCheckboxes: true },
        steps: steps(`
            document.querySelector('.delim-option[data-delim=";"]')
                .dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await t.wait(400);
            await t.tick(0, 1);
            t.same(csv.replace('a;true', 'a;false'), 'the edit keeps CRLF and the break at the end');
        `),
    },
    {
        // Split at the comma the quote sits in the middle of "a;", so the two LF
        // in it end rows and tie with the two CRLF. At the semicolon they are
        // inside the value and the file is plainly CRLF.
        name: 'a delimiter switch reads the line ending again',
        csv: 'k;v\r\na;"x\ny\nz"\r\n',
        steps: steps(`
            document.querySelector('.delim-option[data-delim=";"]')
                .dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await t.wait(400);
            await t.edit(0, 0, 'b');
            t.same(csv.replace('a;', 'b;'), 'the rows keep CRLF and the value keeps its LF');
        `),
    },
    {
        // A classic Mac file ends its rows with a lone CR. It opened as one
        // header of four columns. The first edit joined its lines for good.
        name: 'rows ending with a lone CR',
        csv: 'a,b\r1,2\r3,4\r',
        steps: steps(`
            const info = document.getElementById('info').textContent;
            t.check(info === '2 rows × 2 columns', 'the file opens as its rows (' + info + ')');
            await t.edit(1, 1, 'X');
            t.same(csv.replace('3,4', '3,X'), 'only the edited cell changes');
        `),
    },
    {
        // What Python's csv module writes on Windows without newline=''.
        name: 'rows ending with CR CR LF',
        csv: 'a,b\r\r\n1,2\r\r\n3,4\r\r\n',
        steps: steps(`
            await t.edit(1, 1, 'X');
            t.same(csv.replace('3,4', '3,X'), 'only the edited cell changes');
        `),
    },
    {
        // The CR stays in its value. Written back bare, other programs would
        // read it as a line break and split the row, so it gains quotes.
        name: 'a CR inside an unquoted value',
        csv: 'a,b\n1,x\ry\n3,4\n',
        steps: steps(`
            await t.edit(1, 1, 'X');
            t.same(csv.replace('3,4', '3,X').replace('x', '"x').replace('y', 'y"'),
                'the CR stays in the row nobody touched');
        `),
    },
    {
        // Kept for the same reason in quotes.
        name: 'a CR at the end of the file',
        csv: 'a,b\n1,2\n3,4\r',
        steps: steps(`
            await t.edit(0, 1, 'X');
            t.same(csv.replace('1,2', '1,X').replace('3,4', '3,"4') + '"', 'the CR at the end stays');
        `),
    },
    {
        // Python's csv module writes a value with a lone CR in quotes. The
        // first edit in another row wrote it back bare.
        name: 'a quoted value with a lone CR',
        csv: 'a,b\n"x\ry",2\n3,4\n',
        steps: steps(`
            await t.edit(1, 1, 'X');
            t.same(csv.replace('3,4', '3,X'), 'the value keeps its quotes');
        `),
    },
    {
        // The editor shows every break as LF. Enter on a value with a lone CR
        // or with CRLF and LF mixed wrote it back with other breaks.
        name: 'the editor opened and closed without a change',
        csv: 'a,b\n"x\ry",2\n"x\r\ny\nz",4\n',
        steps: steps(`
            for (const row of [0, 1]) {
                await t.focusCell(row, 0);
                await t.pressEnter();
                t.check(!!document.querySelector('#grid-container textarea'), 'the editor opens on row ' + row);
                await t.pressEnter();
                await t.wait(300);
            }
            t.check(t.sent('edit').length === 0, 'nothing is written (' + JSON.stringify(t.lastEdit()) + ')');
        `),
    },
    {
        // Deleting the only row leaves a CRLF file with no row break to read.
        // A delimiter switch reads the text again and fell back to LF, so the
        // next added row went into the file with LF.
        name: 'a delimiter switch on a file cut to one line',
        csv: 'a,b\r\n1,2',
        steps: steps(`
            const key = (k, mods) => document.dispatchEvent(new KeyboardEvent('keydown',
                Object.assign({ key: k, bubbles: true, cancelable: true }, mods)));
            await t.focusCell(0, 0);
            key('K', { ctrlKey: true, shiftKey: true });
            await t.wait(400);
            t.check(t.lastEdit() === 'a,b', 'the only row is deleted (' + JSON.stringify(t.lastEdit()) + ')');
            for (const d of [';', ',']) {
                document.getElementById('delim-badge').dispatchEvent(new MouseEvent('click', { bubbles: true }));
                await t.wait(150);
                document.querySelector('.delim-option[data-delim="' + d + '"]')
                    .dispatchEvent(new MouseEvent('click', { bubbles: true }));
                await t.wait(400);
            }
            key('Enter', { ctrlKey: true });
            await t.wait(400);
            t.check(t.lastEdit() === 'a,b\\r\\n,', 'the added row is written with CRLF (' + JSON.stringify(t.lastEdit()) + ')');
        `),
    },
]);
