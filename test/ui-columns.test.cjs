// Browser tests for the grid keeping up with its columns.
//
// Swapping the rows is how the grid follows most changes. A row swap cannot
// add, remove or rename a column. An outside change to the file, undo and
// redo of a column insert or delete all arrive that way. The grid kept the
// old columns: a restored column stayed invisible, a removed one stayed on
// screen and renamed headers kept their old names.
//
// Run after `tsc -p ./`:  node test/ui-columns.test.cjs

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
            const row = document.querySelector('#grid-container .ag-center-cols-container .ag-row[row-index="' + r + '"]');
            if (!row) break;
            const c = row.querySelector('.ag-cell[col-id="col_' + col + '"]') || t.cell(r, col);
            out.push(c ? c.textContent : '-');
        }
        return out.join(',');
    };
    t.info = () => document.getElementById('info').textContent;
    t.update = async (text) => {
        window.postMessage({ type: 'update', text, delimiter: ',' }, '*');
        await t.wait(400);
    };
    t.colMenu = async (colId, itemId) => {
        document.getElementById('col-context-menu').dataset.colId = colId;
        document.getElementById(itemId).dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await t.wait(400);
    };
    t.button = async (id) => {
        document.getElementById(id).dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await t.wait(400);
    };
`;

const steps = (body) => `async (t, csv) => { ${HELPERS} await t.init(csv); ${body} }`;

runSuite('columns (browser)', [
    {
        name: 'an outside change adds a column',
        csv: 'a,b\n1,2\n3,4',
        steps: steps(`
            await t.update('a,b,c\\n1,2,3\\n3,4,5');
            t.check(t.names() === 'a|b|c|-', 'the new column gets a header (' + t.names() + ')');
            t.check(t.col(2) === '3,5', 'and its values are shown (' + t.col(2) + ')');
            t.check(t.info() === '2 rows × 3 columns', 'the counts agree (' + t.info() + ')');
        `),
    },
    {
        name: 'an outside change drops a column',
        csv: 'a,b,c\n1,2,3',
        steps: steps(`
            await t.update('a,b\\n1,2');
            t.check(t.names() === 'a|b|-|-', 'the dropped column is gone (' + t.names() + ')');
        `),
    },
    {
        name: 'an outside change renames the headers',
        csv: 'a,b\n1,2',
        steps: steps(`
            await t.update('x,y\\n1,2');
            t.check(t.names() === 'x|y|-|-', 'the headers read the new names (' + t.names() + ')');
        `),
    },
    {
        name: 'undo and redo of a column delete',
        csv: 'a,b,c\n1,2,3',
        steps: steps(`
            await t.colMenu('col_0', 'col-ctx-delete');
            t.check(t.names() === 'b|c|-|-', 'the column is deleted (' + t.names() + ')');
            await t.button('btn-undo');
            t.check(t.lastEdit() === 'a,b,c\\n1,2,3', 'undo puts it back in the file (' + JSON.stringify(t.lastEdit()) + ')');
            t.check(t.names() === 'a|b|c|-', 'and on screen (' + t.names() + ')');
            t.check(t.col(2) === '3', 'with its values (' + t.col(2) + ')');
            await t.button('btn-redo');
            t.check(t.names() === 'b|c|-|-', 'redo deletes it again (' + t.names() + ')');
        `),
    },
    {
        name: 'undo and redo of a column insert',
        csv: 'a,b\n1,2',
        steps: steps(`
            await t.colMenu('col_1', 'col-ctx-insert-right');
            t.check(t.names() === 'a|b||-', 'a blank column is added (' + t.names() + ')');
            await t.button('btn-undo');
            t.check(t.names() === 'a|b|-|-', 'undo takes it off the screen (' + t.names() + ')');
            await t.button('btn-redo');
            t.check(t.names() === 'a|b||-', 'redo brings it back (' + t.names() + ')');
        `),
    },
    {
        name: 'what a rebuild keeps',
        csv: 'a,b\n1,2\n3,4',
        steps: steps(`
            await t.colMenu('col_0', 'col-ctx-freeze');
            // Freeze the second row through its own menu.
            const c = t.cell(1, 1);
            const r = c.getBoundingClientRect();
            c.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 5, clientY: r.top + 5 }));
            await t.wait(200);
            const item = [...document.querySelectorAll('#row-context-menu .row-ctx-item')].find(i => i.textContent === 'Freeze row');
            t.check(!!item, 'the row menu offers Freeze row');
            item.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await t.wait(300);
            await t.focusCell(0, 1);

            await t.update('a,b,c\\n1,2,3\\n3,4,5');
            t.check(t.names() === 'a|b|c|-', 'the new column is there (' + t.names() + ')');
            t.check(!!document.querySelector('#grid-container .ag-pinned-left-header [col-id="col_0"]'), 'the frozen column stays frozen');
            const frozen = document.querySelector('#grid-container .ag-floating-top .ag-cell[col-id="col_2"]');
            t.check(!!frozen && frozen.textContent === '5', 'the frozen row stays frozen, with its new value ('
                + (frozen && frozen.textContent) + ')');
            const focused = document.querySelector('#grid-container .ag-cell-focus');
            t.check(t.focusedRow() === 0 && !!focused && focused.getAttribute('col-id') === 'col_1',
                'the focus stays on its cell (row ' + t.focusedRow() + ', ' + (focused && focused.getAttribute('col-id')) + ')');
        `),
    },
    {
        name: 'a hidden column past the end is forgotten',
        csv: 'a,b,c\n1,2,3',
        steps: steps(`
            await t.button('btn-columns');
            const boxes = document.querySelectorAll('#col-chooser-list .col-chooser-item input');
            boxes[2].checked = false;
            boxes[2].dispatchEvent(new Event('change', { bubbles: true }));
            await t.wait(300);
            document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            await t.wait(100);
            t.check(t.names() === 'a|b|-|-', 'c is hidden (' + t.names() + ')');
            await t.update('a,b\\n1,2');
            await t.update('a,b,x\\n1,2,3');
            t.check(t.names() === 'a|b|x|-', 'a column that comes back later is a new one and is shown (' + t.names() + ')');
        `),
    },
]);
