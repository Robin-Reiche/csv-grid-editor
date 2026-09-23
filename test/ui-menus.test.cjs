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
    // Where the keyboard is: the cell that has the browser focus as
    // row/column. Anything else gives its tag.
    t.onCell = () => {
        const a = document.activeElement;
        const cell = a && a.closest && a.closest('#grid-container .ag-cell');
        return cell ? cell.closest('.ag-row').getAttribute('row-index') + '/' + cell.getAttribute('col-id') : String(a && a.tagName);
    };
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
        // Menus that hold no row or column stay open. A file another program
        // rewrites every few seconds, a growing log, closed them under the user
        // before they could pick anything.
        name: 'the settings menu and the export list stay open',
        csv: 'k,v\nA,1\nB,2\n',
        steps: steps(`
            document.getElementById('btn-settings').dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await t.wait(150);
            t.check(t.shown('settings-popover'), 'the settings menu opens');
            await t.update('k,v\\nA,1\\nB,2\\nC,3\\n');
            t.check(t.shown('settings-popover'), 'it stays open across the outside change');
            document.getElementById('btn-export').dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await t.wait(150);
            t.check(t.shown('export-dropdown'), 'the export list opens');
            await t.update('k,v\\nA,1\\nB,2\\nC,3\\nD,4\\n');
            t.check(t.shown('export-dropdown'), 'and stays open too');
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
    {
        // Go to row, the column chooser and Settings close too. A box in
        // them may have had the keyboard. The cell focused before takes it
        // back, so the keys do not go nowhere.
        name: 'the keys go back to the grid from a closed popover',
        csv: 'k,v\nA,1\nB,2\nC,3\n',
        steps: steps(`
            // The column chooser lists the columns by index, so it closes on an
            // outside change. Its search box had the keyboard.
            await t.focusCell(1, 1);
            document.getElementById('btn-columns').dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await t.wait(200);
            t.check(t.shown('col-chooser-popover') && t.onCell() === 'INPUT', 'the column chooser has the keyboard (' + t.onCell() + ')');
            await t.update('k,v\\nA,1\\nB,2\\nC,3\\nD,4\\n');
            t.check(!t.shown('col-chooser-popover'), 'the column chooser is closed');
            t.check(t.onCell() === '1/col_1', 'the keyboard is back on the cell (' + t.onCell() + ')');
            // Go to row holds no row until Go is pressed, so it stays open for
            // the number being typed.
            document.getElementById('btn-go-to-row').dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await t.wait(200);
            await t.update('k,v\\nA,1\\nB,2\\nC,3\\nD,4\\nE,5\\n');
            t.check(t.shown('goto-popover'), 'Go to row stays open');
        `),
    },
]);
