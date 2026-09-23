// Browser tests for the grid keeping up with its columns.
//
// Swapping the rows is how the grid follows most changes. A row swap cannot
// add, remove or rename a column. An outside change to the file, undo and
// redo of a column insert or delete all arrive that way. The grid kept the
// old columns: a restored column stayed invisible, a removed one stayed on
// screen and renamed headers kept their old names. Building the columns again
// drops the column filters, yet the Clear filters button stayed up. A cell
// editor open at that moment is cancelled. What was typed would otherwise
// land in the new table at the editor's old row, unseen on screen. The type
// badge and the header tooltip went stale after an undo, a rename or the
// "Hide spaces" switch, while the cells already used the new type. A column
// with no name in the header row lost its type on every row swap: its badge
// read Text and its checkboxes turned back into words.
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
    t.types = () => [0, 1, 2, 3].map(i => {
        const h = t.header(i);
        if (!h) return '-';
        const c = [...h.classList].find(k => k.indexOf('col-type-') === 0);
        return c ? c.slice(9) : '?';
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
    t.rowMenu = async (row, col, label) => {
        const c = t.cell(row, col);
        const r = c.getBoundingClientRect();
        c.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 5, clientY: r.top + 5 }));
        await t.wait(200);
        const item = [...document.querySelectorAll('#row-context-menu .row-ctx-item')].find(i => i.textContent === label);
        if (!item) { t.check(false, 'the row menu offers ' + label); return; }
        item.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await t.wait(400);
    };
    // Unticks one value in a column's value filter.
    t.filterOut = async (col, value) => {
        t.click(t.header(col).querySelector('.ag-header-cell-filter-button, .ag-header-cell-menu-button'));
        await t.wait(300);
        const row = [...document.querySelectorAll('.csv-filter-value-row')].find(r => r.textContent === value);
        if (!row) { t.check(false, 'the filter lists ' + value); return; }
        const cb = row.querySelector('input');
        cb.checked = false;
        cb.dispatchEvent(new Event('change'));
        await t.wait(300);
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await t.wait(200);
    };
    t.shown = (id) => document.getElementById(id).style.display !== 'none';
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
    // Opens the editor and types into it without committing.
    t.typeUnsaved = async (row, col, value) => {
        await t.focusCell(row, col);
        await t.pressEnter();
        const ta = document.querySelector('#grid-container textarea');
        if (!ta) { t.check(false, 'Enter opens the editor on ' + row + ',' + col); return; }
        ta.value = value;
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        await t.wait(100);
    };
    // The header tooltip is AG Grid's own popup, shown after a hover.
    t.tip = async (col) => {
        const h = t.header(col);
        const r = h.getBoundingClientRect();
        const o = { bubbles: true, clientX: r.left + 10, clientY: r.top + 5 };
        h.dispatchEvent(new MouseEvent('mouseover', o));
        h.dispatchEvent(new MouseEvent('mouseenter', Object.assign({}, o, { bubbles: false })));
        h.dispatchEvent(new MouseEvent('mousemove', o));
        await t.wait(700);
        const el = document.querySelector('.ag-tooltip, .ag-tooltip-custom');
        const text = el ? el.textContent : null;
        h.dispatchEvent(new MouseEvent('mouseleave', Object.assign({}, o, { bubbles: false })));
        h.dispatchEvent(new MouseEvent('mouseout', o));
        await t.wait(300);
        return text;
    };
`;

const steps = (body) => `async (t, csv) => { ${HELPERS} await t.init(csv); ${body} }`;

runSuite('columns (browser)', [
    // ── the column set follows the data ─────────────────────────────────────
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
        // No row means no column type to work out, so nothing else on the way
        // renames the headers.
        name: 'an outside change renames the headers of a table with no rows',
        csv: 'a,b',
        steps: steps(`
            await t.update('x,y');
            t.check(t.names() === 'x|y|-|-', 'the headers read the new names (' + t.names() + ')');
        `),
    },
    {
        name: 'an outside change adds a column while a cell is being edited',
        csv: 'a,b\n1,2\n3,4',
        steps: steps(`
            await t.typeUnsaved(0, 0, 'half');
            await t.update('a,b,c\\n1,2,3\\n3,4,5');
            t.check(!document.querySelector('#grid-container textarea'), 'the editor is closed');
            t.check(t.sent('edit').length === 0, 'the typed value is not written ('
                + JSON.stringify(t.lastEdit()) + ')');
            t.check(t.col(0) === '1,3', 'the cells show the file (' + t.col(0) + ')');
            await t.edit(0, 2, 'z');
            t.check(t.lastEdit() === 'a,b,c\\n1,2,z\\n3,4,5', 'the next edit writes the file as it is on screen ('
                + JSON.stringify(t.lastEdit()) + ')');
        `),
    },
    {
        // The row the editor was opened on now holds the outside change's new row.
        name: 'an outside change adds a column and a row above the cell being edited',
        csv: 'a,b\n1,2\n3,4',
        steps: steps(`
            await t.typeUnsaved(0, 0, 'half');
            await t.update('a,b,c\\nNEW,0,0\\n1,2,3\\n3,4,5');
            t.check(t.sent('edit').length === 0, 'nothing is written over the new row ('
                + JSON.stringify(t.lastEdit()) + ')');
            t.check(t.col(0) === 'NEW,1,3', 'the cells show the file (' + t.col(0) + ')');
        `),
    },
    {
        // The columns stay, so the grid only swaps the rows. The editor stayed
        // open on its row position, which now held the row above. Enter wrote
        // the typed value into that row.
        name: 'an outside change adds a row above the cell being edited',
        csv: 'a,b\n1,2\n3,4',
        steps: steps(`
            await t.typeUnsaved(1, 1, 'TYPED');
            await t.update('a,b\\nNEW,0\\n1,2\\n3,4');
            const open = !!document.querySelector('#grid-container textarea');
            t.check(!open, 'the editor is closed');
            if (open) await t.pressEnter();
            t.check(t.sent('edit').length === 0, 'the typed value is not written ('
                + JSON.stringify(t.lastEdit()) + ')');
            t.check(t.col(1) === '0,2,4', 'the cells show the file (' + t.col(1) + ')');
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
    {
        name: 'a rebuild turns the Clear filters button off',
        csv: 'city,n\nBerlin,1\nParis,2\nRome,3',
        steps: steps(`
            await t.filterOut(0, 'Rome');
            t.check(t.col(0) === 'Berlin,Paris', 'Rome is filtered out (' + t.col(0) + ')');
            t.check(t.shown('btn-clear-filters') && t.shown('sep-filters'), 'the Clear filters button is up');
            await t.update('city,n,x\\nBerlin,1,1\\nParis,2,2\\nRome,3,3');
            t.check(t.col(0) === 'Berlin,Paris,Rome', 'the new columns start without a filter (' + t.col(0) + ')');
            t.check(!t.shown('btn-clear-filters') && !t.shown('sep-filters'), 'so the button goes away');
        `),
    },

    // ── the type badge and tooltip follow the type ──────────────────────────
    {
        name: 'type badge after undo of a column delete',
        csv: 'name,active,amount\na,true,1\nb,false,2\nc,true,3',
        steps: steps(`
            t.check(t.types() === 'string|boolean|integer|-', 'the types at open (' + t.types() + ')');
            await t.colMenu('col_0', 'col-ctx-delete');
            t.check(t.types() === 'boolean|integer|-|-', 'after the delete (' + t.types() + ')');
            await t.button('btn-undo');
            t.check(t.types() === 'string|boolean|integer|-', 'after the undo (' + t.types() + ')');
            const tip = await t.tip(1);
            t.check(tip === 'Boolean', 'the tooltip agrees (' + tip + ')');
        `),
    },
    {
        name: 'type badge after a rename',
        csv: 'k,v\na,x\nb,1\nc,2\nd,3\ne,4',
        steps: steps(`
            t.check(t.types() === 'string|string|-|-', 'one word among four numbers is text (' + t.types() + ')');
            await t.edit(0, 1, '5');
            t.check(t.types() === 'string|integer|-|-', 'the edit makes it a number column (' + t.types() + ')');
            let tip = await t.tip(1);
            t.check(tip === 'Integer', 'the tooltip follows the edit (' + tip + ')');
            document.getElementById('col-context-menu').dataset.colId = 'col_1';
            document.getElementById('col-ctx-rename').dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await t.wait(200);
            document.getElementById('rename-input').value = 'value';
            document.getElementById('rename-ok').dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await t.wait(300);
            t.check(t.names() === 'k|value|-|-', 'the column is renamed (' + t.names() + ')');
            t.check(t.types() === 'string|integer|-|-', 'and keeps its badge (' + t.types() + ')');
            tip = await t.tip(1);
            t.check(tip === 'Integer', 'and its tooltip (' + tip + ')');
        `),
    },
    {
        name: 'type badge after the Hide spaces switch',
        csv: 'k, v \na,x\nb,1\nc,2\nd,3\ne,4',
        steps: steps(`
            await t.edit(0, 1, '5');
            t.check(t.types() === 'string|integer|-|-', 'the edit makes it a number column (' + t.types() + ')');
            await t.setSetting('trimDisplay', false);
            t.check(t.names() === 'k| v |-|-', 'the header shows its spaces (' + JSON.stringify(t.names()) + ')');
            t.check(t.types() === 'string|integer|-|-', 'and keeps its badge (' + t.types() + ')');
        `),
    },
    {
        // The second column has values but no name in the header row.
        name: 'type badge of a column wider than the header',
        csv: 'a\nx,1\ny,2\nz,3',
        steps: steps(`
            t.check(t.types() === 'string|integer|-|-', 'the types at open (' + t.types() + ')');
            await t.rowMenu(0, 0, 'Delete row');
            t.check(t.lastEdit() === 'a\\ny,2\\nz,3', 'the row is deleted (' + JSON.stringify(t.lastEdit()) + ')');
            t.check(t.types() === 'string|integer|-|-', 'the column keeps its badge (' + t.types() + ')');
            const tip = await t.tip(1);
            t.check(tip === 'Integer', 'and its tooltip (' + tip + ')');
        `),
    },
    {
        name: 'checkboxes in a column wider than the header',
        csv: 'a\nx,true\ny,false\nz,true',
        settings: { boolCheckboxes: true },
        steps: steps(`
            t.check(t.boxesIn(1) === 3, 'the column is drawn as checkboxes at open (' + t.boxesIn(1) + ')');
            await t.rowMenu(0, 0, 'Delete row');
            t.check(t.boxesIn(1) === 2, 'and still after a row is deleted (' + t.boxesIn(1) + ')');
        `),
    },
    // ── what a rebuild leaves behind ────────────────────────────────────────
    {
        // Rebuilding emptied the container but left the old grid alive with its
        // listeners, one more on every undo of a column change.
        name: 'a rebuild takes the old grid down',
        csv: 'a,b,c\n1,2,3',
        steps: steps(`
            // createGrid is a getter that cannot be replaced, so the whole
            // global is swapped for a proxy that records every grid made.
            const made = [];
            const real = window.agGrid;
            const wrap = (el, opts) => { const api = real.createGrid(el, opts); made.push(api); return api; };
            window.agGrid = new Proxy(real, { get: (o, k) => k === 'createGrid' ? wrap : o[k] });
            await t.colMenu('col_0', 'col-ctx-delete');
            await t.button('btn-undo');
            window.agGrid = real;
            t.check(made.length === 2, 'delete and undo each built the grid again (' + made.length + ')');
            t.check(made.length === 2 && made[0].isDestroyed() && !made[1].isDestroyed(),
                'only the grid on screen is still alive');
        `),
    },
    {
        // 1.5 and 1.25 sort the wrong way round as text. A column that became a
        // number column through an edit kept sorting as text.
        name: 'the sort follows a column that became a number column',
        csv: 'n,k\nx,a\n1.5,b\n1.25,c\n2,d',
        steps: steps(`
            t.check(t.types().split('|')[0] === 'string', 'the column starts as text (' + t.types() + ')');
            await t.edit(0, 0, '0.5');
            await t.wait(400);
            t.check(t.types().split('|')[0] === 'float', 'the edit makes it a number column (' + t.types() + ')');
            t.header(0).querySelector('.ag-header-cell-label').dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await t.wait(300);
            t.check(t.col(1) === 'a,c,b,d', 'ascending sorts by value: 0.5, 1.25, 1.5, 2 (' + t.col(1) + ')');
        `),
    },
]);
