// Browser tests for the menus and popovers across an outside change.
//
// The row menu, the column menu and the Rename popover remember the place they
// were opened on: a row's position on screen, a column's index. An outside
// change to the file (another program or a second editor of the same file)
// swaps the rows under them. They stayed open and then acted on whatever sat
// at that place by now. Delete row deleted the row above the one right-clicked,
// Delete column deleted its neighbour and Rename wrote a header wider than the
// rows. The open cell editor is already closed on such a change (see
// test/ui-columns.test.cjs). These close too.
//
// Run after `tsc -p ./`:  node test/ui-menus.test.cjs

const { runSuite } = require('./ui/harness.cjs');

// Shared by every scenario. The steps run inside the page, where these helpers
// are rebuilt from their source, so they must not close over anything.
const HELPERS = `
    t.update = async (text) => {
        window.postMessage({ type: 'update', text, delimiter: ',' }, '*');
        await t.wait(400);
    };
    t.rightClick = async (el) => {
        const r = el.getBoundingClientRect();
        el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 5, clientY: r.top + 5 }));
        await t.wait(200);
    };
    t.shown = (id) => !document.getElementById(id).classList.contains('hidden');
`;

const steps = (body) => `async (t, csv) => { ${HELPERS} await t.init(csv); ${body} }`;

runSuite('menus across an outside change (browser)', [
    {
        name: 'the row menu closes',
        csv: 'k,v\nA,1\nB,2\nC,3\n',
        steps: steps(`
            await t.rightClick(t.cell(1, 0));
            t.check(t.shown('row-context-menu'), 'the row menu opens on B');
            await t.update('k,v\\nX,0\\nA,1\\nB,2\\nC,3\\n');
            t.check(t.cell(1, 0).textContent === 'A', 'the outside change puts A where B was');
            t.check(!t.shown('row-context-menu'), 'the row menu is closed, so Delete row cannot take A');
            t.check(t.sent('edit').length === 0, 'nothing is written');
        `),
    },
    {
        name: 'the column menu closes',
        csv: 'k,v\nA,1\nB,2\n',
        steps: steps(`
            await t.rightClick(t.header(1));
            t.check(t.shown('col-context-menu'), 'the column menu opens on v');
            await t.update('new,k,v\\n0,A,1\\n0,B,2\\n');
            t.check(!t.shown('col-context-menu'), 'the column menu is closed, so Delete column cannot take k');
            t.check(t.sent('edit').length === 0, 'nothing is written');
        `),
    },
    {
        name: 'a rename is given up',
        csv: 'name,city,n\na,b,1\nc,d,2\n',
        steps: steps(`
            await t.rightClick(t.header(2));
            document.getElementById('col-ctx-rename').dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await t.wait(200);
            t.check(t.shown('rename-popover'), 'the rename popover opens on n');
            await t.update('name,city\\na,b\\nc,d\\n');
            t.check(!t.shown('rename-popover'), 'the rename popover is closed');
            // The key still reaches the box in a test, which a person could no
            // longer do. It must not write the name anywhere.
            const input = document.getElementById('rename-input');
            input.value = 'renamed';
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
            await t.wait(300);
            t.check(t.sent('edit').length === 0, 'no header wider than the rows is written ('
                + JSON.stringify(t.lastEdit()) + ')');
        `),
    },
]);
