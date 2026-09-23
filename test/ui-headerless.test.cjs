// Browser tests for "First row is the header" (the settings menu, This file).
//
// Many CSV files have no header row. The grid always took the first row for
// the column names, so the first row of such a file could not be seen, sorted
// or edited as the data it is. Switched off, the first row joins the rows and
// the columns are named A, B, C. The letters are the grid's own and never
// reach the file. Switching writes nothing. Every edit afterwards writes the
// file exactly as it is, first row included, letters left out.
//
// Run after `tsc -p ./`:  node test/ui-headerless.test.cjs

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
    t.banner = () => document.getElementById('preview-text').textContent;
    t.pinned = () => document.querySelectorAll('#grid-container .ag-floating-top .ag-cell[col-id="col_0"]').length;
    t.header1 = async (on) => { await t.setSetting('firstRowIsHeader', on); await t.wait(300); };
    t.gearMarked = () => document.getElementById('btn-settings').classList.contains('btn-active');
    t.headerSent = () => t.sent('headerRowChanged').map(m => m.value).join(',');
    t.button = async (id) => {
        document.getElementById(id).dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await t.wait(400);
    };
    t.colMenu = async (colId, itemId) => {
        document.getElementById('col-context-menu').dataset.colId = colId;
        document.getElementById(itemId).dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await t.wait(400);
    };
    t.rowMenuItems = async (row, col) => {
        const c = t.cell(row, col);
        const r = c.getBoundingClientRect();
        c.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 5, clientY: r.top + 5 }));
        await t.wait(200);
        return [...document.querySelectorAll('#row-context-menu .row-ctx-item')];
    };
    t.rowMenu = async (row, col, label) => {
        const item = (await t.rowMenuItems(row, col)).find(i => i.textContent === label);
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
    t.sortBy = async (col) => {
        t.header(col).querySelector('.ag-header-cell-label').dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await t.wait(400);
    };
    t.delim = async (d) => {
        document.querySelector('.delim-option[data-delim="' + d + '"]')
            .dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await t.wait(400);
    };
    t.update = async (text) => {
        window.postMessage({ type: 'update', text, delimiter: ',' }, '*');
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
    t.paste = async (text) => {
        const data = new DataTransfer();
        data.setData('text/plain', text);
        document.querySelector('#grid-container .ag-cell-focus')
            .dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
        await t.wait(300);
    };
`;

const steps = (body) => `async (t, csv) => { ${HELPERS} await t.init(csv); ${body} }`;

runSuite('first row is the header (browser)', [
    {
        name: 'switching it off and on',
        csv: '1,alice\n2,bob',
        steps: steps(`
            t.check(t.names() === '1|alice|-|-', 'by default the first row names the columns (' + t.names() + ')');
            await t.openSettings();
            const groups = [...document.querySelectorAll('#settings-list .settings-group')].map(g => g.textContent);
            t.check(groups[0] === 'This file', 'the switch has a group of its own at the top (' + groups.join('|') + ')');
            t.check(t.settingBox('firstRowIsHeader').checked, 'and starts on');

            await t.header1(false);
            t.check(t.names() === 'A|B|-|-', 'off, the columns are named A, B (' + t.names() + ')');
            t.check(t.col(0) === '1,2' && t.col(1) === 'alice,bob', 'the first row is row 1 (' + t.col(0) + ' / ' + t.col(1) + ')');
            t.check(t.info() === '2 rows × 2 columns', 'and counts as a row (' + t.info() + ')');
            t.check(t.gearMarked(), 'the gear shows that something is off its default');
            t.check(t.headerSent() === 'false', 'the choice goes to the extension (' + t.headerSent() + ')');

            document.querySelector('.export-option[data-format="json"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await t.wait(200);
            const exported = t.sent('export').length ? JSON.stringify(JSON.parse(t.sent('export')[0].text)) : '';
            t.check(exported === '[{"A":1,"B":"alice"},{"A":2,"B":"bob"}]', 'Export names the columns A and B ('
                + exported + ')');
            await t.filterOut(1, 'alice');
            t.check(t.col(0) === '2', 'a filter lists the first row with the others (' + t.col(0) + ')');

            await t.header1(true);
            t.check(t.names() === '1|alice|-|-', 'on again, the first row names the columns (' + t.names() + ')');
            t.check(t.col(0) === '2', 'and leaves the rows (' + t.col(0) + ')');
            t.check(!t.gearMarked(), 'the gear is back to unmarked');
            t.check(t.headerSent() === 'false,true', 'that goes to the extension too (' + t.headerSent() + ')');
            t.check(t.sent('edit').length === 0, 'switching wrote nothing to the file (' + t.sent('edit').length + ' edits)');
        `),
    },
    {
        name: 'an edit writes the file without the letters',
        csv: '1,alice\r\n2,bob\r\n',
        steps: steps(`
            await t.header1(false);
            await t.edit(0, 1, 'x');
            t.check(t.lastEdit() === '1,x\\r\\n2,bob\\r\\n', 'the edit lands in the first line of the file ('
                + JSON.stringify(t.lastEdit()) + ')');
        `),
    },
    {
        name: 'the file opens the way it was left',
        csv: '1,alice\n2,bob',
        steps: `async (t, csv) => { ${HELPERS}
            window.postMessage({ type: 'init', text: csv, delimiter: ',', firstRowIsHeader: false }, '*');
            await t.wait(900);
            t.check(t.names() === 'A|B|-|-', 'a file remembered without a header opens with letters (' + t.names() + ')');
            t.check(t.col(0) === '1,2', 'and its first row as row 1 (' + t.col(0) + ')');
            t.check(t.gearMarked(), 'the gear is marked');
            await t.openSettings();
            t.check(!t.settingBox('firstRowIsHeader').checked, 'the menu shows the switch off');
            t.check(t.sent('headerRowChanged').length === 0 && t.sent('edit').length === 0, 'opening sent nothing back');
        }`,
    },
    {
        name: 'sort, edit, delete and undo',
        csv: '1,alice\n2,bob',
        steps: steps(`
            await t.header1(false);
            await t.sortBy(0);
            await t.sortBy(0);
            t.check(t.col(0) === '2,1', 'sorted descending (' + t.col(0) + ')');
            await t.edit(0, 1, 'z');
            t.check(t.lastEdit() === '1,alice\\n2,z', 'the edit hits the row it was made on (' + JSON.stringify(t.lastEdit()) + ')');
            await t.rowMenu(1, 0, 'Delete row');
            t.check(t.lastEdit() === '2,z', 'deleting the row showing 1 deletes the first line (' + JSON.stringify(t.lastEdit()) + ')');
            await t.button('btn-undo');
            t.check(t.lastEdit() === '1,alice\\n2,z', 'undo brings it back (' + JSON.stringify(t.lastEdit()) + ')');
            t.check(t.names() === 'A|B|-|-', 'the letters stay (' + t.names() + ')');
        `),
    },
    {
        name: 'columns inserted and deleted',
        csv: '1,alice\n2,bob',
        steps: steps(`
            await t.colMenu('col_0', 'col-ctx-freeze');
            await t.header1(false);
            t.check(!!document.querySelector('#grid-container .ag-pinned-left-header [col-id="col_0"]'),
                'a frozen column stays frozen');
            await t.colMenu('col_0', 'col-ctx-insert-right');
            t.check(t.names() === 'A|B|C|-', 'the letters follow an inserted column (' + t.names() + ')');
            t.check(t.lastEdit() === '1,,alice\\n2,,bob', 'the file gets the column and no letters (' + JSON.stringify(t.lastEdit()) + ')');
            await t.button('btn-undo');
            t.check(t.names() === 'A|B|-|-', 'undo takes the letter away again (' + t.names() + ')');
            t.check(t.lastEdit() === '1,alice\\n2,bob', 'and the column (' + JSON.stringify(t.lastEdit()) + ')');
            await t.colMenu('col_0', 'col-ctx-delete');
            t.check(t.names() === 'A|-|-|-', 'the letters follow a deleted column (' + t.names() + ')');
            t.check(t.lastEdit() === 'alice\\nbob', 'the file loses the column (' + JSON.stringify(t.lastEdit()) + ')');
        `),
    },
    {
        // The switch builds the grid again. The grid reported a value still
        // being typed only after that. Nothing listened any more and the
        // value never reached the file.
        name: 'switching while a value is being typed keeps it',
        csv: 'name,city\nAnna,Berlin\nBen,Oslo\n',
        steps: steps(`
            const type = async (row, col, value) => {
                await t.focusCell(row, col);
                await t.pressEnter();
                const ta = document.querySelector('#grid-container textarea');
                if (!ta) { t.check(false, 'Enter opens the editor on ' + row + ',' + col); return false; }
                ta.value = value;
                ta.dispatchEvent(new Event('input', { bubbles: true }));
                return true;
            };
            if (!await type(0, 1, 'X')) return;
            await t.header1(false);
            t.check(t.lastEdit() === 'name,city\\nAnna,X\\nBen,Oslo\\n', 'the value is written ('
                + JSON.stringify(t.lastEdit()) + ')');
            t.check(t.col(1) === 'city,X,Oslo', 'and shown in its row (' + t.col(1) + ')');
            if (!await type(1, 1, 'Y')) return;
            await t.header1(true);
            t.check(t.lastEdit() === 'name,city\\nAnna,Y\\nBen,Oslo\\n', 'switching back writes the next one ('
                + JSON.stringify(t.lastEdit()) + ')');
            t.check(t.col(1) === 'Y,Oslo', 'and shows it in its row (' + t.col(1) + ')');
        `),
    },
    {
        // Only the first line has a third field. Deleting it takes the third
        // column away, and the letters have to follow the rows that are left.
        name: 'deleting the only wide row',
        csv: '1,2,3\n4,5',
        steps: steps(`
            await t.header1(false);
            t.check(t.names() === 'A|B|C|-', 'three columns while the wide row is there (' + t.names() + ')');
            await t.rowMenu(0, 0, 'Delete row');
            t.check(t.lastEdit() === '4,5', 'the wide row leaves the file (' + JSON.stringify(t.lastEdit()) + ')');
            t.check(t.names() === 'A|B|-|-', 'and its column leaves the grid (' + t.names() + ')');
        `),
    },
    {
        name: 'rename and copy with header are not offered',
        csv: 'a,b\n1,2\n3,4',
        steps: steps(`
            const headerMenu = async () => {
                const h = t.header(0);
                const r = h.getBoundingClientRect();
                h.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 5, clientY: r.top + 5 }));
                await t.wait(200);
                const shown = document.getElementById('col-ctx-rename').style.display !== 'none';
                document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                await t.wait(100);
                return shown;
            };
            const copyItems = async () => {
                t.click(document.querySelector('#grid-container .ag-header-cell[col-id="row-index"]'));
                await t.wait(200);
                const items = (await t.rowMenuItems(0, 0)).map(i => i.textContent).filter(l => l.indexOf('Copy') === 0);
                document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                await t.wait(100);
                return items.join('|');
            };
            t.check(await headerMenu(), 'with a header, Rename column is offered');
            t.check(/with header/.test(await copyItems()), 'and so is Copy with header');
            await t.header1(false);
            t.check(!(await headerMenu()), 'without one, Rename column is not');
            const items = await copyItems();
            t.check(items === 'Copy|Copy as CSV', 'nor Copy with header (' + items + ')');
            await t.header1(true);
            t.check(await headerMenu(), 'on again, Rename column is back');
        `),
    },
    {
        name: 'a frozen first row becomes the header',
        csv: '1,alice\n2,bob',
        steps: steps(`
            await t.header1(false);
            await t.rowMenu(0, 0, 'Freeze row');
            t.check(t.pinned() === 1, 'row 1 is frozen (' + t.pinned() + ')');
            await t.header1(true);
            t.check(t.names() === '1|alice|-|-', 'on again, it names the columns (' + t.names() + ')');
            t.check(t.pinned() === 0 && t.col(0) === '2', 'and is neither frozen nor a row (' + t.pinned() + ', ' + t.col(0) + ')');
            t.check(t.info() === '1 rows × 2 columns', 'the counts agree (' + t.info() + ')');
            t.check(t.sent('edit').length === 0, 'nothing was written');
            await t.edit(0, 1, 'q');
            t.check(t.lastEdit() === '1,alice\\n2,q', 'the next edit writes the header back as it was (' + JSON.stringify(t.lastEdit()) + ')');
        `),
    },
    {
        name: 'undo and redo across the switch',
        csv: 'a,b\n1,2',
        steps: steps(`
            await t.edit(0, 1, 'x');
            t.check(t.lastEdit() === 'a,b\\n1,x', 'an edit with the header on (' + JSON.stringify(t.lastEdit()) + ')');
            await t.header1(false);
            t.check(t.col(1) === 'b,x', 'switched off (' + t.col(1) + ')');
            await t.button('btn-undo');
            t.check(t.lastEdit() === 'a,b\\n1,2', 'undo takes the edit back (' + JSON.stringify(t.lastEdit()) + ')');
            t.check(t.col(1) === 'b,2' && t.names() === 'A|B|-|-', 'and the grid stays without a header ('
                + t.col(1) + ', ' + t.names() + ')');
            await t.button('btn-redo');
            t.check(t.lastEdit() === 'a,b\\n1,x', 'redo puts it back (' + JSON.stringify(t.lastEdit()) + ')');
            await t.header1(true);
            await t.button('btn-undo');
            t.check(t.lastEdit() === 'a,b\\n1,2' && t.names() === 'a|b|-|-', 'and undo still works with the header on again ('
                + JSON.stringify(t.lastEdit()) + ', ' + t.names() + ')');
        `),
    },
    {
        name: 'a delimiter switch and an outside change keep it off',
        csv: '1;alice\n2;bob',
        steps: steps(`
            await t.header1(false);
            t.check(t.names() === 'A|-|-|-', 'one column before the switch (' + t.names() + ')');
            await t.delim(';');
            t.check(t.names() === 'A|B|-|-' && t.col(0) === '1,2', 'split on the semicolon, the first line is still a row ('
                + t.names() + ', ' + t.col(0) + ')');
            await t.update('3;carol\\n4;dan');
            t.check(t.names() === 'A|B|-|-' && t.col(0) === '3,4', 'an outside change is read without a header too ('
                + t.names() + ', ' + t.col(0) + ')');
            t.check(t.sent('edit').length === 0, 'nothing was written');
            await t.edit(0, 1, 'x');
            t.check(t.lastEdit() === '3;x\\n4;dan', 'the next edit writes the file without letters (' + JSON.stringify(t.lastEdit()) + ')');
        `),
    },
    {
        name: 'find and replace',
        csv: 'x,1\nx,2',
        steps: steps(`
            await t.button('btn-find-replace');
            const find = document.getElementById('find-input');
            find.value = 'x';
            find.dispatchEvent(new Event('input', { bubbles: true }));
            await t.wait(400);
            const count = () => document.getElementById('find-count').textContent;
            t.check(count() === '1 / 1', 'with a header, the header is not searched (' + count() + ')');
            await t.header1(false);
            t.check(count() === '2 / 2', 'without one, the first row is searched too and the match found stays current (' + count() + ')');
            document.getElementById('replace-input').value = 'z';
            await t.button('replace-one');
            t.check(t.lastEdit() === 'x,1\\nz,2', 'Replace changes the match that is current (' + JSON.stringify(t.lastEdit()) + ')');
            await t.button('replace-all');
            t.check(t.lastEdit() === 'z,1\\nz,2', 'Replace all reaches the first line too (' + JSON.stringify(t.lastEdit()) + ')');
        `),
    },
    {
        name: 'a paste that grows the table and a row above the first',
        csv: '1,alice',
        steps: steps(`
            await t.header1(false);
            await t.focusCell(0, 0);
            await t.paste('p\\tq\\nr\\ts');
            t.check(t.lastEdit() === 'p,q\\nr,s', 'the paste starts on the first line and adds one (' + JSON.stringify(t.lastEdit()) + ')');
            t.check(t.col(0) === 'p,r', 'and shows both (' + t.col(0) + ')');
            await t.rowMenu(0, 0, 'Insert row above');
            t.check(t.lastEdit() === ',\\np,q\\nr,s', 'a row inserted above row 1 goes first in the file (' + JSON.stringify(t.lastEdit()) + ')');
        `),
    },
    {
        name: 'an empty file',
        csv: '',
        steps: steps(`
            await t.header1(false);
            const btn = () => document.querySelector('#grid-container .empty-state button');
            t.check(!!btn() && /Add column/.test(btn().textContent), 'an empty file still offers its first column');
            t.click(btn());
            await t.wait(400);
            t.check(t.names() === 'A|-|-|-', 'the new column is named A (' + t.names() + ')');
            t.check(!!btn() && /Add row/.test(btn().textContent), 'and the first row is offered');
            t.click(btn());
            await t.wait(400);
            await t.edit(0, 0, 'x');
            t.check(t.lastEdit() === 'x', 'the file holds the row and no letters (' + JSON.stringify(t.lastEdit()) + ')');
        `),
    },
    {
        name: 'duplicates are looked for again',
        csv: 'a,1\na,1\na,1\nb,2',
        steps: steps(`
            await t.button('btn-duplicates');
            const text = () => document.getElementById('dup-banner-text').textContent;
            t.check(text() === '2 duplicate rows in 1 group', 'with a header, two (' + text() + ')');
            await t.header1(false);
            t.check(document.getElementById('dup-banner').classList.contains('hidden'), 'the switch ends the old search');
            await t.button('btn-duplicates');
            t.check(text() === '3 duplicate rows in 1 group', 'without one, the first line is one of them (' + text() + ')');
        `),
    },
    {
        name: 'the head preview',
        csv: 'h1,h2\n1,1\n2,2',
        preview: { mode: 'head', total: 10 },
        steps: steps(`
            t.check(t.banner() === 'Showing first 2 of 9 rows (read-only preview)', 'with a header (' + t.banner() + ')');
            await t.header1(false);
            t.check(t.col(0) === 'h1,1,2', 'without one, the first line is row 1 (' + t.col(0) + ')');
            t.check(t.banner() === 'Showing first 3 of 10 rows (read-only preview)', 'and is counted (' + t.banner() + ')');
        `),
    },
    {
        // A tail preview is the header plus the last rows, the rows in between
        // left out. Without a header that first line belongs up there, not on
        // top of the last rows.
        name: 'the tail preview',
        csv: 'h1,h2\n8,8\n9,9',
        preview: { mode: 'tail', total: 10 },
        steps: steps(`
            t.check(t.banner() === 'Showing last 2 of 9 rows (read-only preview)', 'with a header (' + t.banner() + ')');
            await t.header1(false);
            t.check(t.names() === 'A|B|-|-' && t.col(0) === '8,9', 'without one, only the last rows are shown ('
                + t.names() + ', ' + t.col(0) + ')');
            t.check(t.banner() === 'Showing last 2 of 10 rows (read-only preview)', 'counted out of all of them (' + t.banner() + ')');
            await t.header1(true);
            t.check(t.names() === 'h1|h2|-|-' && t.col(0) === '8,9', 'on again, the header is back (' + t.names() + ', ' + t.col(0) + ')');
        `),
    },
    {
        // Every page arrives with the file's first line in front of it. On
        // page 1 that line is where it belongs, on every later page it is not.
        name: 'the paged view',
        csv: 'h1,h2\n1,1\n2,2',
        preview: { mode: 'chunked', total: 5 },
        steps: `async (t, csv) => { ${HELPERS}
            window.postMessage({ type: 'init', text: csv, delimiter: ',', firstRowIsHeader: false }, '*');
            window.postMessage({ type: 'pageData', pageNumber: 0, totalPages: 2, text: csv }, '*');
            await t.wait(900);
            t.check(t.col(0) === 'h1,1,2', 'page 1 starts with the first line (' + t.col(0) + ')');
            t.check(t.banner() === 'Page 1 of 2, 5 rows in total (read-only preview)', 'the total counts it (' + t.banner() + ')');
            window.postMessage({ type: 'pageData', pageNumber: 1, totalPages: 2, text: 'h1,h2\\n3,3\\n4,4' }, '*');
            await t.wait(500);
            t.check(t.names() === 'A|B|-|-' && t.col(0) === '3,4', 'page 2 does not repeat it (' + t.names() + ', ' + t.col(0) + ')');
            await t.header1(true);
            t.check(t.names() === 'h1|h2|-|-' && t.col(0) === '3,4', 'with the header on, it names the columns ('
                + t.names() + ', ' + t.col(0) + ')');
            t.check(t.banner() === 'Page 2 of 2, 4 rows in total (read-only preview)', 'and is not counted (' + t.banner() + ')');
        }`,
    },
]);
