// Browser tests for inserting rows with the keyboard.
//
// Two ways Ctrl+Enter used to go wrong. With a column filter on, the new blank
// row was added to the file but hidden by the filter. The focus landed on the
// next row the filter let through, so whatever was typed next replaced that
// row. The first row of an emptied table was hidden the same way. And after
// the last row had been deleted, Ctrl+Enter did nothing, because the focus the
// deleted row left behind still looked like a row to insert next to. That same
// focus made a second Ctrl+Shift+K record an empty undo step and write the
// file again. A paste went into the column that focus was in and dropped
// whatever did not fit to its right. In the "Show only duplicates" view
// Ctrl+Enter cleared the column filters although the view itself was what
// hid the new row.
//
// Run after `tsc -p ./`:  node test/ui-rows.test.cjs

const { runSuite } = require('./ui/harness.cjs');

const CITIES = 'city,n\nBerlin,1\nHanoi,2\nParis,3\nRome,4';

// Runs inside the page first. focusCell (grid/refresh.ts) waits one animation
// frame before it moves the focus. Chrome runs these pages on a virtual clock.
// On that clock a frame now and then never comes. The focus then stayed
// where it was and the checks on it failed in some runs, with the code doing
// the right thing. A timer stands in for the frame. It is set here and not in
// the shared harness, so the other suites keep the browser's own timing.
const FRAMES = `window.requestAnimationFrame = cb => setTimeout(() => cb(performance.now()), 16);`;

// Runs inside the page: presses a row shortcut on the focused cell.
const PRESS = `async (t, key, mods) => {
    const target = document.querySelector('#grid-container .ag-cell-focus') || document.body;
    target.dispatchEvent(new KeyboardEvent('keydown', Object.assign({ key, bubbles: true, cancelable: true }, mods)));
    await t.wait(400);
}`;

runSuite('rows (browser)', [
    {
        name: 'insert with a filter on',
        csv: CITIES,
        steps: `async (t, csv) => {
            ${FRAMES}
            const press = ${PRESS};
            await t.init(csv);
            // Untick Paris in the city column's value filter.
            t.click(t.header(0).querySelector('.ag-header-cell-filter-button, .ag-header-cell-menu-button'));
            await t.wait(300);
            const paris = [...document.querySelectorAll('.csv-filter-value-row')].find(r => r.textContent === 'Paris');
            t.check(!!paris, 'the filter lists Paris');
            const cb = paris.querySelector('input');
            cb.checked = false;
            cb.dispatchEvent(new Event('change'));
            await t.wait(300);
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            await t.wait(200);
            const shown = () => [0, 1, 2, 3, 4, 5].map(i => t.cell(i, 0) ? t.cell(i, 0).textContent : '-').join(',');
            t.check(shown() === 'Berlin,Hanoi,Rome,-,-,-', 'Paris is filtered out (' + shown() + ')');

            await t.focusCell(0, 0);
            await press(t, 'Enter', { ctrlKey: true });
            t.check(t.lastEdit() === 'city,n\\nBerlin,1\\n,\\nHanoi,2\\nParis,3\\nRome,4',
                'Ctrl+Enter adds the row under Berlin (' + JSON.stringify(t.lastEdit()) + ')');
            const focused = document.querySelector('#grid-container .ag-cell-focus');
            t.check(t.focusedRow() === 1 && focused && focused.textContent === '',
                'the focus is on the new blank row (row ' + t.focusedRow() + ', "' + (focused && focused.textContent) + '")');
            t.check(t.cell(1, 0) && t.cell(1, 0).textContent === '', 'the new row is shown (' + shown() + ')');

            // Typing now fills the new row and leaves Hanoi alone.
            await t.pressEnter();
            const ta = document.querySelector('#grid-container textarea');
            t.check(!!ta, 'Enter opens the editor on the new row');
            if (ta) { ta.value = 'Oslo'; ta.dispatchEvent(new Event('input', { bubbles: true })); }
            await t.pressEnter();
            t.check(t.lastEdit() === 'city,n\\nBerlin,1\\nOslo,\\nHanoi,2\\nParis,3\\nRome,4',
                'the typed value lands in the new row (' + JSON.stringify(t.lastEdit()) + ')');
        }`,
    },
    {
        name: 'insert after deleting the last row',
        csv: 'a,b\n1,2',
        steps: `async (t, csv) => {
            ${FRAMES}
            const press = ${PRESS};
            await t.init(csv);
            await t.focusCell(0, 0);
            await press(t, 'K', { ctrlKey: true, shiftKey: true });
            t.check(t.lastEdit() === 'a,b', 'Ctrl+Shift+K deletes the only row (' + JSON.stringify(t.lastEdit()) + ')');
            await press(t, 'Enter', { ctrlKey: true });
            t.check(t.lastEdit() === 'a,b\\n,', 'Ctrl+Enter then starts a new first row (' + JSON.stringify(t.lastEdit()) + ')');
            t.check(!!t.cell(0, 0), 'and the grid shows it');
        }`,
    },
    {
        name: 'delete again after deleting the last row',
        csv: 'a,b\n1,2',
        steps: `async (t, csv) => {
            ${FRAMES}
            const press = ${PRESS};
            await t.init(csv);
            await t.focusCell(0, 0);
            await press(t, 'K', { ctrlKey: true, shiftKey: true });
            t.check(t.lastEdit() === 'a,b', 'Ctrl+Shift+K deletes the only row (' + JSON.stringify(t.lastEdit()) + ')');
            await press(t, 'K', { ctrlKey: true, shiftKey: true });
            t.check(t.sent('edit').length === 1, 'a second one has nothing to delete and writes nothing ('
                + t.sent('edit').length + ' edits)');
            document.getElementById('btn-undo').dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await t.wait(400);
            t.check(t.lastEdit() === 'a,b\\n1,2', 'one undo brings the row back (' + JSON.stringify(t.lastEdit()) + ')');
        }`,
    },
    {
        // The row shortcuts ask the table itself as well, so only a paste
        // still shows where the focus of a deleted last row went. A table with
        // only a header takes no paste, the same as a file opened that way.
        name: 'paste after deleting the last row',
        csv: 'a,b\n1,2',
        steps: `async (t, csv) => {
            ${FRAMES}
            const press = ${PRESS};
            await t.init(csv);
            await t.focusCell(0, 1);
            await press(t, 'K', { ctrlKey: true, shiftKey: true });
            t.check(t.lastEdit() === 'a,b', 'Ctrl+Shift+K deletes the only row (' + JSON.stringify(t.lastEdit()) + ')');
            const data = new DataTransfer();
            data.setData('text/plain', 'x\\ty');
            document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
            await t.wait(300);
            t.check(t.sent('edit').length === 1, 'a paste does not land in the column of the deleted row ('
                + JSON.stringify(t.lastEdit()) + ')');
        }`,
    },
    {
        name: 'start the first row with a filter on',
        csv: 'city,n\nBerlin,1',
        steps: `async (t, csv) => {
            ${FRAMES}
            const press = ${PRESS};
            await t.init(csv);
            // Set the city column's condition to "Is not blank", which a new
            // blank row never passes.
            t.click(t.header(0).querySelector('.ag-header-cell-filter-button, .ag-header-cell-menu-button'));
            await t.wait(300);
            const sel = document.querySelector('.csv-filter-select');
            t.check(!!sel, 'the filter offers a condition');
            sel.value = 'notblank';
            sel.dispatchEvent(new Event('change'));
            await t.wait(300);
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            await t.wait(200);

            await t.focusCell(0, 0);
            await press(t, 'K', { ctrlKey: true, shiftKey: true });
            t.check(t.lastEdit() === 'city,n', 'Ctrl+Shift+K deletes the only row (' + JSON.stringify(t.lastEdit()) + ')');
            await press(t, 'Enter', { ctrlKey: true });
            t.check(t.lastEdit() === 'city,n\\n,', 'Ctrl+Enter starts a new first row (' + JSON.stringify(t.lastEdit()) + ')');
            const status = document.getElementById('status').textContent;
            t.check(!!t.cell(0, 0) && status === '1 records', 'the new row is shown (status "' + status + '")');
            t.check(t.focusedRow() === 0, 'the focus is on it (row ' + t.focusedRow() + ')');
        }`,
    },
    {
        name: 'insert in the duplicates view with a filter on',
        csv: 'city,n\nBerlin,1\nParis,\nBerlin,1\nRome,4',
        steps: `async (t, csv) => {
            ${FRAMES}
            const press = ${PRESS};
            await t.init(csv);
            const shown = () => [0, 1, 2, 3, 4].map(i => t.cell(i, 0) ? t.cell(i, 0).textContent : '-').join(',');
            // Untick 4 in the n column. (Blank) stays ticked, so a blank row
            // passes this filter.
            t.click(t.header(1).querySelector('.ag-header-cell-filter-button, .ag-header-cell-menu-button'));
            await t.wait(300);
            const four = [...document.querySelectorAll('.csv-filter-value-row')].find(r => r.textContent === '4');
            t.check(!!four, 'the filter lists 4');
            const cb = four.querySelector('input');
            cb.checked = false;
            cb.dispatchEvent(new Event('change'));
            await t.wait(300);
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            await t.wait(200);
            t.check(shown() === 'Berlin,Paris,Berlin,-,-', 'Rome is filtered out (' + shown() + ')');

            document.getElementById('btn-duplicates').dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await t.wait(300);
            document.getElementById('dup-only-toggle').dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await t.wait(300);
            t.check(shown() === 'Berlin,Berlin,-,-,-', 'the view shows the two duplicates (' + shown() + ')');

            await t.focusCell(0, 0);
            await press(t, 'Enter', { ctrlKey: true });
            t.check(t.lastEdit() === 'city,n\\nBerlin,1\\n,\\nParis,\\nBerlin,1\\nRome,4',
                'Ctrl+Enter adds the row under the first Berlin (' + JSON.stringify(t.lastEdit()) + ')');
            t.check(shown() === 'Berlin,,Paris,Berlin,-', 'the new row is shown and Rome stays filtered out (' + shown() + ')');
            t.check(document.getElementById('btn-clear-filters').style.display !== 'none', 'the filter is still on');
            t.check(t.focusedRow() === 1, 'the focus is on the new row (row ' + t.focusedRow() + ')');
        }`,
    },
]);
