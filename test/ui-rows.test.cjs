// Browser tests for inserting rows with the keyboard.
//
// Two ways Ctrl+Enter used to go wrong. With a column filter on, the new blank
// row was added to the file but hidden by the filter. The focus landed on the
// next row the filter let through, so whatever was typed next replaced that
// row. The first row of an emptied table was hidden the same way. And after
// the last row had been deleted, Ctrl+Enter did nothing, because the focus the
// deleted row left behind still looked like a row to insert next to. That same
// focus made a second Ctrl+Shift+K record an empty undo step and write the
// file again. So did Ctrl+Shift+K with a filter that hid every row. A paste
// went into the column that focus was in and dropped whatever did not fit to
// its right. In the "Show only duplicates" view Ctrl+Enter cleared the column
// filters although the view itself was what hid the new row.
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

// Runs inside the page: opens a cell and types into it without committing.
// It also reads the rows on screen as name|value pairs.
const TYPE = `
    t.type = async (row, col, value) => {
        await t.focusCell(row, col);
        await t.pressEnter();
        const ta = document.querySelector('#grid-container textarea');
        if (!ta) { t.check(false, 'Enter opens the editor on ' + row + ',' + col); return null; }
        ta.value = value;
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        return ta;
    };
    t.rows = () => {
        const out = [];
        for (let r = 0; t.cell(r, 0); r++) out.push(t.cell(r, 0).textContent + '|' + t.cell(r, 1).textContent);
        return out.join(',');
    };
`;

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
            // This used to expect 'a,b\\n,', which the next read of the file
            // took for a trailing blank line. The empty row now gets a break
            // after it and stays a row (test/empty-table.test.cjs).
            t.check(t.lastEdit() === 'a,b\\n,\\n', 'Ctrl+Enter then starts a new first row (' + JSON.stringify(t.lastEdit()) + ')');
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
        // The focus stays on the row a filter hides, so the key still names a
        // row that is not on screen.
        name: 'delete with every row filtered out',
        csv: 'a,b\n1,2\n3,4',
        steps: `async (t, csv) => {
            ${FRAMES}
            const press = ${PRESS};
            await t.init(csv);
            await t.focusCell(0, 0);
            for (const v of ['2', '4']) {
                t.click(t.header(1).querySelector('.ag-header-cell-filter-button, .ag-header-cell-menu-button'));
                await t.wait(300);
                const row = [...document.querySelectorAll('.csv-filter-value-row')].find(r => r.textContent === v);
                if (!row) { t.check(false, 'the filter lists ' + v); return; }
                const cb = row.querySelector('input');
                cb.checked = false;
                cb.dispatchEvent(new Event('change'));
                await t.wait(300);
                document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
                await t.wait(200);
            }
            t.check(!t.cell(0, 0), 'the filter hides every row');
            await press(t, 'K', { ctrlKey: true, shiftKey: true });
            t.check(t.sent('edit').length === 0, 'Ctrl+Shift+K has nothing to delete and writes nothing ('
                + JSON.stringify(t.lastEdit()) + ')');
            t.check(document.getElementById('btn-undo').disabled, 'and leaves no undo step');
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
            // With a break after the empty row, see 'insert after deleting the
            // last row' above for why 'city,n\\n,' was the wrong thing to expect.
            t.check(t.lastEdit() === 'city,n\\n,\\n', 'Ctrl+Enter starts a new first row (' + JSON.stringify(t.lastEdit()) + ')');
            const status = document.getElementById('status').textContent;
            t.check(!!t.cell(0, 0) && status === '1 records', 'the new row is shown (status "' + status + '")');
            t.check(t.focusedRow() === 0, 'the focus is on it (row ' + t.focusedRow() + ')');
        }`,
    },
    {
        // An insert under a sort writes the order on screen into the file.
        // The frozen rows were left out of that order and went to the end of
        // the file, with the rows a filter hides. On screen they sit on top,
        // in the order they were frozen. That is where they go now.
        name: 'insert under a sort with frozen rows',
        csv: 'n,v\nd,4\nb,2\na,1\nc,3\ne,5\n',
        steps: `async (t, csv) => {
            ${FRAMES}
            const press = ${PRESS};
            await t.init(csv);
            const freeze = async (row) => {
                const c = t.cell(row, 0);
                const r = c.getBoundingClientRect();
                c.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 5, clientY: r.top + 5 }));
                await t.wait(200);
                const item = [...document.querySelectorAll('#row-context-menu .row-ctx-item')].find(i => i.textContent === 'Freeze row');
                if (!item) { t.check(false, 'the row menu offers Freeze row'); return; }
                item.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                await t.wait(300);
            };
            // In the order on screen. The grid moves a row it keeps rather
            // than its element, so the page order can differ.
            const band = () => [...document.querySelectorAll('#grid-container .ag-floating-top .ag-cell[col-id="col_0"]')]
                .sort((a, b) => a.closest('.ag-row').getAttribute('row-index').localeCompare(b.closest('.ag-row').getAttribute('row-index')))
                .map(c => c.textContent).join(',');
            const body = () => [0, 1, 2, 3, 4].map(i => t.cell(i, 0) ? t.cell(i, 0).textContent : '-').join(',');
            await freeze(4);
            await freeze(1);
            t.check(band() === 'e,b', 'e and then b are frozen (' + band() + ')');
            t.header(0).querySelector('.ag-header-cell-label').dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await t.wait(300);
            t.check(body() === 'a,c,d,-,-', 'the rows below are sorted (' + body() + ')');
            await t.focusCell(0, 0);
            await press(t, 'Enter', { ctrlKey: true });
            t.check(t.lastEdit() === 'n,v\\ne,5\\nb,2\\na,1\\n,\\nc,3\\nd,4\\n',
                'the frozen rows go on top of the file as shown (' + JSON.stringify(t.lastEdit()) + ')');
            t.check(band() === 'e,b' && body() === 'a,,c,d,-', 'the grid looks as before, with the new row (' + band() + ' | ' + body() + ')');
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
    {
        // The key committed the value being typed, but the grid reported it
        // only after the rows had moved. By then the row in that place was
        // another one. Under a sort the value overwrote another row's value
        // in the file while the grid went on showing both rows as they were.
        name: 'Ctrl+Enter while typing under a sort',
        csv: 'name,city\nAnna,Oslo\nBen,Berlin\nCleo,Paris\nDan,Athens\n',
        steps: `async (t, csv) => {
            ${FRAMES}
            ${TYPE}
            await t.init(csv);
            t.header(1).querySelector('.ag-header-cell-label').dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await t.wait(400);
            t.check(t.rows() === 'Dan|Athens,Ben|Berlin,Anna|Oslo,Cleo|Paris', 'sorted by city (' + t.rows() + ')');
            const ta = await t.type(2, 1, 'X');
            if (!ta) return;
            ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
            await t.wait(400);
            t.check(t.lastEdit() === 'name,city\\nDan,Athens\\nBen,Berlin\\nAnna,X\\n,\\nCleo,Paris\\n',
                'Anna gets the value and the new row goes under her (' + JSON.stringify(t.lastEdit()) + ')');
            t.check(t.sent('edit').length === 2, 'the value and the row are written once each (' + t.sent('edit').length + ' edits)');
            t.check(t.rows() === 'Dan|Athens,Ben|Berlin,Anna|X,|,Cleo|Paris', 'the grid shows the file (' + t.rows() + ')');
        }`,
    },
    {
        // The insert writes the frozen row on top of the file, so Ben takes
        // the first place, the one Anna had. Anna's old row left the grid.
        // The grid reported the value on it later all the same. Written
        // through that row's place, it went to Ben while the frozen band
        // went on showing Berlin.
        name: 'Ctrl+Enter while typing under a sort with a frozen row',
        csv: 'name,city\nAnna,Oslo\nBen,Berlin\nCleo,Paris\nDan,Athens\n',
        steps: `async (t, csv) => {
            ${FRAMES}
            ${TYPE}
            await t.init(csv);
            const c = t.cell(1, 0);
            const r = c.getBoundingClientRect();
            c.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 5, clientY: r.top + 5 }));
            await t.wait(200);
            const item = [...document.querySelectorAll('#row-context-menu .row-ctx-item')].find(i => i.textContent === 'Freeze row');
            if (!item) { t.check(false, 'the row menu offers Freeze row'); return; }
            item.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await t.wait(300);
            t.header(1).querySelector('.ag-header-cell-label').dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await t.wait(400);
            t.check(t.rows() === 'Dan|Athens,Anna|Oslo,Cleo|Paris', 'Ben is frozen and the rest sorted by city (' + t.rows() + ')');
            const ta = await t.type(1, 1, 'X');
            if (!ta) return;
            ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
            await t.wait(400);
            t.check(t.lastEdit() === 'name,city\\nBen,Berlin\\nDan,Athens\\nAnna,X\\n,\\nCleo,Paris\\n',
                'Anna keeps the value and Ben keeps Berlin (' + JSON.stringify(t.lastEdit()) + ')');
            t.check(t.sent('edit').length === 2, 'the value and the row are written once each (' + t.sent('edit').length + ' edits)');
            // A value committed in the frozen row still reaches the file.
            const frozen = document.querySelector('#grid-container .ag-floating-top .ag-cell[col-id="col_1"]');
            ['mousedown', 'mouseup', 'click'].forEach(ty => frozen.dispatchEvent(new MouseEvent(ty, { bubbles: true, button: 0 })));
            await t.wait(200);
            await t.pressEnter();
            const fta = document.querySelector('#grid-container textarea');
            if (!fta) { t.check(false, 'Enter opens the editor on the frozen cell'); return; }
            fta.value = 'Rome';
            fta.dispatchEvent(new Event('input', { bubbles: true }));
            await t.pressEnter();
            t.check(t.lastEdit() === 'name,city\\nBen,Rome\\nDan,Athens\\nAnna,X\\n,\\nCleo,Paris\\n',
                'Enter in the frozen row writes into Ben (' + JSON.stringify(t.lastEdit()) + ')');
        }`,
    },
    {
        name: 'Ctrl+Enter while typing',
        csv: 'name,city\nAnna,Berlin\nBen,Oslo\nCleo,Paris\n',
        steps: `async (t, csv) => {
            ${FRAMES}
            ${TYPE}
            await t.init(csv);
            const ta = await t.type(1, 1, 'X');
            if (!ta) return;
            ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
            await t.wait(400);
            t.check(t.lastEdit() === 'name,city\\nAnna,Berlin\\nBen,X\\n,\\nCleo,Paris\\n',
                'Ben gets the value and the new row goes under him (' + JSON.stringify(t.lastEdit()) + ')');
            t.check(t.rows() === 'Anna|Berlin,Ben|X,|,Cleo|Paris', 'the grid shows the file (' + t.rows() + ')');
        }`,
    },
    {
        name: 'Ctrl+Shift+Enter while typing',
        csv: 'name,city\nAnna,Berlin\nBen,Oslo\nCleo,Paris\n',
        steps: `async (t, csv) => {
            ${FRAMES}
            ${TYPE}
            await t.init(csv);
            const ta = await t.type(1, 1, 'X');
            if (!ta) return;
            ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
            await t.wait(400);
            t.check(t.lastEdit() === 'name,city\\nAnna,Berlin\\n,\\nBen,X\\nCleo,Paris\\n',
                'the new row goes above Ben and Ben gets the value (' + JSON.stringify(t.lastEdit()) + ')');
            t.check(t.sent('edit').length === 2, 'the value and the row are written once each (' + t.sent('edit').length + ' edits)');
            t.check(t.rows() === 'Anna|Berlin,|,Ben|X,Cleo|Paris', 'the grid shows the file (' + t.rows() + ')');
        }`,
    },
    {
        // The new blank row takes the place of the row being typed in. Its
        // cell is empty just like the one typed into. Only the row itself
        // tells the two apart.
        name: 'Ctrl+Shift+Enter while typing into an empty cell',
        csv: 'name,note\nAnna,\nBen,\nCleo,\n',
        steps: `async (t, csv) => {
            ${FRAMES}
            ${TYPE}
            await t.init(csv);
            const ta = await t.type(1, 1, 'X');
            if (!ta) return;
            ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
            await t.wait(400);
            t.check(t.lastEdit() === 'name,note\\nAnna,\\n,\\nBen,X\\nCleo,\\n',
                'only Ben gets the value (' + JSON.stringify(t.lastEdit()) + ')');
            t.check(t.rows() === 'Anna|,|,Ben|X,Cleo|', 'the grid shows the file (' + t.rows() + ')');
        }`,
    },
    {
        // Writing the value ends the "Show only duplicates" view, as every
        // edit does. The rows come back in the order of the file. The row to
        // insert next to is the one typed in, not the one that now sits in
        // its place.
        name: 'Ctrl+Enter while typing in the duplicates view',
        csv: 'city,n\nBerlin,1\nParis,\nBerlin,1\nRome,4',
        steps: `async (t, csv) => {
            ${FRAMES}
            ${TYPE}
            await t.init(csv);
            document.getElementById('btn-duplicates').dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await t.wait(300);
            document.getElementById('dup-only-toggle').dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await t.wait(300);
            t.check(t.rows() === 'Berlin|1,Berlin|1', 'the view shows the two duplicates (' + t.rows() + ')');
            const ta = await t.type(1, 1, 'X');
            if (!ta) return;
            ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
            await t.wait(400);
            t.check(t.lastEdit() === 'city,n\\nBerlin,1\\nParis,\\nBerlin,X\\n,\\nRome,4',
                'the second Berlin gets the value and the new row goes under it (' + JSON.stringify(t.lastEdit()) + ')');
            t.check(t.rows() === 'Berlin|1,Paris|,Berlin|X,|,Rome|4', 'the grid shows the file (' + t.rows() + ')');
            t.check(t.focusedRow() === 3, 'the focus is on the new row (row ' + t.focusedRow() + ')');
        }`,
    },
    {
        // The commits that move no row still write the value once.
        name: 'Enter and Ctrl+S under a sort write once',
        csv: 'name,city\nAnna,Oslo\nBen,Berlin\nCleo,Paris\n',
        steps: `async (t, csv) => {
            ${FRAMES}
            ${TYPE}
            await t.init(csv);
            t.header(1).querySelector('.ag-header-cell-label').dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await t.wait(400);
            let ta = await t.type(1, 1, 'X');
            if (!ta) return;
            await t.pressEnter();
            t.check(t.sent('edit').length === 1 && t.lastEdit() === 'name,city\\nAnna,X\\nBen,Berlin\\nCleo,Paris\\n',
                'Enter writes the value into Anna once (' + JSON.stringify(t.sent('edit')) + ')');
            ta = await t.type(0, 1, 'Y');
            if (!ta) return;
            ta.dispatchEvent(new KeyboardEvent('keydown', { key: 's', code: 'KeyS', keyCode: 83, ctrlKey: true, bubbles: true, cancelable: true }));
            await t.wait(400);
            t.check(t.sent('edit').length === 2 && t.lastEdit() === 'name,city\\nAnna,X\\nBen,Y\\nCleo,Paris\\n',
                'Ctrl+S writes the value into Ben once (' + JSON.stringify(t.sent('edit')) + ')');
        }`,
    },
]);
