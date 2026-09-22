// Browser tests for edits that must land on the cell the user is looking at.
//
// These drive the real webview in headless Chrome (test/ui/harness.cjs). Two
// ways an edit used to reach the wrong row: Delete cleared the cell that was
// last clicked instead of the one the keyboard had moved to. Any edit made in
// the "Show only duplicates" view put back a copy of the rows taken before the
// edit, so the next edit was written to a different row. The fix for the first
// must not break a Shift+click range on the gutter or a header, which a bare
// Shift press used to reset on files with a single row or column.
//
// Run after `tsc -p ./`:  node test/find-edit-target.test.cjs

const { runSuite } = require('./ui/harness.cjs');

runSuite('edit target (browser)', [
    {
        name: 'delete after arrow keys',
        csv: 'k,v\na,1\nb,2\nc,3\nd,4',
        steps: async (t, csv) => {
            const key = async k => {
                const c = document.querySelector('#grid-container .ag-cell-focus');
                c.dispatchEvent(new KeyboardEvent('keydown', { key: k, code: k, bubbles: true, cancelable: true }));
                await t.wait(150);
            };
            await t.init(csv);
            await t.focusCell(0, 1);
            await key('ArrowDown');
            await key('ArrowDown');
            t.check(t.focusedRow() === 2, 'the focus moved to row 3 (' + t.focusedRow() + ')');
            await key('Delete');
            t.check(t.lastEdit() === 'k,v\na,1\nb,2\nc,\nd,4',
                'Delete clears the focused cell, not the clicked one (' + JSON.stringify(t.lastEdit()) + ')');

            // Shift+Arrow grows the selection from where the focus is too.
            await key('ArrowUp');
            await key('ArrowUp');
            await t.wait(100);
            const shift = new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', shiftKey: true, bubbles: true, cancelable: true });
            document.querySelector('#grid-container .ag-cell-focus').dispatchEvent(shift);
            await t.wait(150);
            await key('Delete');
            t.check(t.lastEdit() === 'k,v\na,\nb,\nc,\nd,4',
                'Shift+Arrow starts at the focused cell (' + JSON.stringify(t.lastEdit()) + ')');
        },
    },
    {
        // Holding Shift sends a keydown of its own before the Shift+click. On a
        // file with one column a single gutter row is one cell. That bare Shift
        // press turned it into a plain cell, so the Shift+click started over
        // instead of taking in the rows between.
        name: 'Shift+click on the gutter after a Shift press',
        csv: 'k\na\nb\nc\nd\ne',
        steps: async (t, csv) => {
            const gutter = r => {
                for (const row of document.querySelectorAll('#grid-container .ag-row[row-index="' + r + '"]')) {
                    const c = row.querySelector('.ag-cell[col-id="row-index"]');
                    if (c) return c;
                }
                return null;
            };
            const press = (el, shiftKey) => ['mousedown', 'mouseup', 'click'].forEach(ty =>
                el.dispatchEvent(new MouseEvent(ty, { bubbles: true, button: 0, shiftKey })));
            await t.init(csv);
            press(gutter(1), false);
            await t.wait(200);
            document.querySelector('#grid-container .ag-cell-focus').dispatchEvent(
                new KeyboardEvent('keydown', { key: 'Shift', code: 'ShiftLeft', shiftKey: true, bubbles: true, cancelable: true }));
            await t.wait(100);
            press(gutter(3), true);
            await t.wait(200);
            document.querySelector('#grid-container .ag-cell-focus').dispatchEvent(
                new KeyboardEvent('keydown', { key: 'Delete', code: 'Delete', bubbles: true, cancelable: true }));
            await t.wait(150);
            t.check(t.lastEdit() === 'k\na\n\n\n\ne',
                'Delete clears the three rows from the gutter range (' + JSON.stringify(t.lastEdit()) + ')');
        },
    },
    {
        // The same on a file with one data row, where one column is one cell.
        // A header click leaves the grid's cell focus where it was, so that old
        // focus must not be taken for a move away from the selected column.
        name: 'Shift+click on a header after a Shift press',
        csv: 'a,b,c\n1,2,3',
        steps: async (t, csv) => {
            const shiftClick = el => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, shiftKey: true }));
            await t.init(csv);
            await t.focusCell(0, 0);
            shiftClick(t.header(1));
            await t.wait(100);
            document.querySelector('#grid-container .ag-cell-focus').dispatchEvent(
                new KeyboardEvent('keydown', { key: 'Shift', code: 'ShiftLeft', shiftKey: true, bubbles: true, cancelable: true }));
            await t.wait(100);
            shiftClick(t.header(2));
            await t.wait(100);
            document.querySelector('#grid-container .ag-cell-focus').dispatchEvent(
                new KeyboardEvent('keydown', { key: 'Delete', code: 'Delete', bubbles: true, cancelable: true }));
            await t.wait(150);
            t.check(t.lastEdit() === 'a,b,c\n1,,',
                'Delete clears both selected columns and leaves the focused cell (' + JSON.stringify(t.lastEdit()) + ')');
        },
    },
    {
        // The '#' gutter holds no data. With the focus on it, Delete must not
        // clear the row's first cell on behalf of an earlier click.
        name: 'Delete on the gutter after the arrow keys',
        csv: 'k,v\na,1\nb,2\nc,3',
        steps: async (t, csv) => {
            const key = async k => {
                const c = document.querySelector('#grid-container .ag-cell-focus');
                c.dispatchEvent(new KeyboardEvent('keydown', { key: k, code: k, bubbles: true, cancelable: true }));
                await t.wait(150);
            };
            await t.init(csv);
            await t.focusCell(1, 1);
            await key('ArrowLeft');
            await key('ArrowLeft');
            const f = document.querySelector('#grid-container .ag-cell-focus');
            t.check(!!f && f.getAttribute('col-id') === 'row-index', 'the focus is on the gutter');
            await key('Delete');
            t.check(t.sent('edit').length === 0, 'Delete wrote nothing (' + JSON.stringify(t.lastEdit()) + ')');
        },
    },
    {
        name: 'edit in the duplicates view',
        csv: 'k,v\na,1\nb,2\na,1\nc,3\nb,2',
        steps: async (t, csv) => {
            const col0 = () => {
                const out = [];
                for (let r = 0; t.cell(r, 0); r++) out.push(t.cell(r, 0).textContent);
                return out.join(',');
            };
            await t.init(csv);
            t.click(document.getElementById('btn-duplicates'));
            await t.wait(200);
            t.click(document.getElementById('dup-only-toggle'));
            await t.wait(300);
            t.check(col0() === 'a,a,b,b', 'only the duplicates show (' + col0() + ')');

            await t.focusCell(0, 0);
            const del = new KeyboardEvent('keydown', { key: 'K', code: 'KeyK', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true });
            document.querySelector('#grid-container .ag-cell-focus').dispatchEvent(del);
            await t.wait(400);
            t.check(t.lastEdit() === 'k,v\nb,2\na,1\nc,3\nb,2', 'the row is deleted from the file (' + JSON.stringify(t.lastEdit()) + ')');
            t.check(col0() === 'b,a,c,b', 'the grid shows the file as it is now (' + col0() + ')');

            // Edit the row the user sees holding c, wherever it is drawn.
            let cRow = 0;
            while (t.cell(cRow, 0) && t.cell(cRow, 0).textContent !== 'c') cRow++;
            await t.focusCell(cRow, 1);
            await t.pressEnter();
            const ta = document.querySelector('#grid-container textarea');
            t.check(!!ta, 'the editor opened');
            if (!ta) return;
            ta.value = 'EDITED';
            ta.dispatchEvent(new Event('input', { bubbles: true }));
            await t.pressEnter();
            t.check(t.lastEdit() === 'k,v\nb,2\na,1\nc,EDITED\nb,2',
                'the next edit lands on the row that shows c (' + JSON.stringify(t.lastEdit()) + ')');
        },
    },
    {
        name: 'duplicates view toggled off without an edit',
        csv: 'k,v\na,1\nb,2\na,1',
        steps: async (t, csv) => {
            const col0 = () => {
                const out = [];
                for (let r = 0; t.cell(r, 0); r++) out.push(t.cell(r, 0).textContent);
                return out.join(',');
            };
            await t.init(csv);
            t.click(document.getElementById('btn-duplicates'));
            await t.wait(200);
            t.click(document.getElementById('dup-only-toggle'));
            await t.wait(300);
            t.click(document.getElementById('dup-only-toggle'));
            await t.wait(300);
            t.check(col0() === 'a,b,a', 'Show all rows brings back the file order (' + col0() + ')');
            t.check(t.sent('edit').length === 0, 'toggling the view wrote nothing');
        },
    },
    {
        name: 'file changed outside while the duplicates view is on',
        csv: 'k,v\na,1\nb,2\na,1',
        steps: async (t, csv) => {
            const col0 = () => {
                const out = [];
                for (let r = 0; t.cell(r, 0); r++) out.push(t.cell(r, 0).textContent);
                return out.join(',');
            };
            await t.init(csv);
            t.click(document.getElementById('btn-duplicates'));
            await t.wait(200);
            t.click(document.getElementById('dup-only-toggle'));
            await t.wait(300);
            t.check(col0() === 'a,a', 'only the duplicates show (' + col0() + ')');
            window.postMessage({ type: 'update', text: 'k,v\nx,1\ny,2\nz,3', delimiter: ',' }, '*');
            await t.wait(300);
            t.check(col0() === 'x,y,z', 'the grid shows the new file (' + col0() + ')');
        },
    },
]);
