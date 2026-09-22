// Browser tests for edits that must land on the cell the user is looking at.
//
// These drive the real webview in headless Chrome (test/ui/harness.cjs). Two
// ways an edit used to reach the wrong row: Delete cleared the cell that was
// last clicked instead of the one the keyboard had moved to, and any edit made
// in the "Show only duplicates" view put back a copy of the rows taken before
// the edit, so the next edit was written to a different row.
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
]);
