// Browser tests for switching the delimiter by hand.
//
// A switch re-splits the text of the file into columns. That text was the one
// the file was opened with, so every edit made since then was gone from the
// grid after a switch and the next edit wrote the old table back into the
// file. An outside change was never kept either. It was also split with the
// delimiter found at open instead of the one the user had picked. A switch in
// the "Show only duplicates" view left that view up with the old rows.
//
// Run after `tsc -p ./`:  node test/ui-delimiter.test.cjs

const { runSuite } = require('./ui/harness.cjs');

// Shared by every scenario. The steps run inside the page, where these helpers
// are rebuilt from their source, so they must not close over anything.
const HELPERS = `
    t.names = () => [0, 1, 2, 3].map(i => {
        const h = t.header(i);
        return h ? h.querySelector('.ag-header-cell-text').textContent : '-';
    }).join('|');
    t.col = (col) => {
        const out = [];
        for (let r = 0; ; r++) {
            const c = t.cell(r, col);
            if (!c) break;
            out.push(c.textContent);
        }
        return out.join(',');
    };
    t.update = async (text) => {
        window.postMessage({ type: 'update', text, delimiter: ',' }, '*');
        await t.wait(400);
    };
    t.delim = async (d) => {
        document.querySelector('.delim-option[data-delim="' + d + '"]')
            .dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await t.wait(400);
    };
    t.button = async (id) => {
        document.getElementById(id).dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await t.wait(400);
    };
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
`;

const steps = (body) => `async (t, csv) => { ${HELPERS} await t.init(csv); ${body} }`;

runSuite('delimiter switch (browser)', [
    {
        name: 'a switch keeps the edits',
        csv: 'k,v\na,1\nb,2',
        steps: steps(`
            await t.edit(0, 1, 'EDIT1');
            t.check(t.lastEdit() === 'k,v\\na,EDIT1\\nb,2', 'the edit is written (' + JSON.stringify(t.lastEdit()) + ')');
            await t.delim(';');
            t.check(t.col(0) === 'a,EDIT1,b,2', 'a semicolon splits the edited text (' + t.col(0) + ')');
            await t.delim(',');
            t.check(t.col(1) === 'EDIT1,2', 'back on the comma the edit is still there (' + t.col(1) + ')');
            await t.edit(1, 1, 'EDIT2');
            t.check(t.lastEdit() === 'k,v\\na,EDIT1\\nb,EDIT2', 'and the next edit keeps it in the file ('
                + JSON.stringify(t.lastEdit()) + ')');
        `),
    },
    {
        name: 'a switch after an outside change',
        csv: 'a,b\n1,2',
        steps: steps(`
            await t.update('p;q;r\\n7;8;9');
            await t.delim(';');
            t.check(t.names() === 'p|q|r|-', 'the switch splits the changed file (' + t.names() + ')');
            t.check(t.col(0) === '7', 'not the one that was opened (' + t.col(0) + ')');
        `),
    },
    {
        name: 'an outside change after a switch',
        csv: 'name;qty\napple;1',
        steps: steps(`
            await t.delim(';');
            t.check(t.names() === 'name|qty|-|-', 'the semicolon splits the file (' + t.names() + ')');
            await t.update('name;qty\\nx;9');
            t.check(t.col(0) === 'x' && t.col(1) === '9', 'the change is split on the semicolon too ('
                + t.col(0) + ' / ' + t.col(1) + ')');
            await t.edit(0, 1, '10');
            t.check(t.lastEdit() === 'name;qty\\nx;10', 'and written back with it (' + JSON.stringify(t.lastEdit()) + ')');
        `),
    },
    {
        name: 'a switch in the duplicates view',
        csv: 'k;v\na;1\nb;2\na;1',
        steps: steps(`
            await t.button('btn-duplicates');
            await t.button('dup-only-toggle');
            t.check(t.col(0) === 'a;1,a;1', 'the view shows the two duplicates (' + t.col(0) + ')');
            await t.delim(';');
            t.check(document.getElementById('dup-banner').classList.contains('hidden'),
                'the switch ends the view, its rows were split the old way');
            t.check(t.col(0) === 'a,b,a' && t.col(1) === '1,2,1', 'every row is shown, split on the semicolon ('
                + t.col(0) + ' / ' + t.col(1) + ')');
        `),
    },
    {
        // The edit wrote the last row without its quotes. The switch read the
        // text again and took the spaces for a trailing blank line.
        name: 'a quoted last row of spaces',
        csv: 'name,note\nx,1\n"   ","   "',
        steps: steps(`
            await t.edit(0, 0, 'y');
            t.check(t.lastEdit() === 'name,note\\ny,1\\n"   ","   "', 'the edit keeps the quotes ('
                + JSON.stringify(t.lastEdit()) + ')');
            await t.delim(';');
            await t.delim(',');
            const info = document.getElementById('info').textContent;
            t.check(info === '2 rows × 2 columns', 'the row is still there after a switch (' + info + ')');
            await t.edit(0, 1, '2');
            t.check(t.lastEdit() === 'name,note\\ny,2\\n"   ","   "', 'and in the file after the next edit ('
                + JSON.stringify(t.lastEdit()) + ')');
        `),
    },
]);
