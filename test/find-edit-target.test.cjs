// Browser tests for edits that must land on the cell the user is looking at.
//
// These drive the real webview in headless Chrome (test/ui/harness.cjs). Delete
// used to clear the cell that was last clicked instead of the one the keyboard
// had moved to.
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
]);
