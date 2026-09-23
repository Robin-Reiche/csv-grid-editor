// Browser tests for values with spaces around them (v1.23 reads files
// untrimmed and "Hide spaces around values" decides what is shown).
//
// The rule everything here checks: with the setting on, every place that
// lists, compares, copies or exports values works on what the grid SHOWS, so
// ' Berlin ' and 'Berlin' are one value. With it off they are two, exactly as
// the file has them. Switching the setting while a sort or a filter is active
// must leave both working. None of this may ever write to the file.
//
// Also here: a Shift or Ctrl click on a checkbox is a selection gesture and
// must not flip the value.
//
// Run after `tsc -p ./`:  node test/ui-trim.test.cjs

const { runSuite } = require('./ui/harness.cjs');

// Chrome inherits the time zone from this process. The date scenario below
// only means something east of UTC, where a date parsed as local midnight
// lands on the day before, so it is pinned here instead of left to the host.
process.env.TZ = 'Europe/Berlin';

const CITIES = 'city,n\n Berlin,1\nAnna,2\nHanoi ,3\nBerlin,4\n Zoe,5';
const SORTING = 'city,n\nAnna,1\n Zoe,2\nBerlin,3\n  Carl,4';
const PADDED_HEADERS = 'name,   , city \nAnna,x, Berlin ';
const DATES = 'd,n\n 2024-01-05,1\n2024-01-05,2\n2024-02-01,3';

// Shared by the filter scenarios. The steps run inside the page, where these
// helpers are rebuilt from their source, so they must not close over anything.
const FILTER_HELPERS = `
    t.shownCol = (col) => {
        const out = [];
        for (let r = 0; ; r++) { const c = t.cell(r, col); if (!c) break; out.push(c.textContent); }
        return out;
    };
    t.openFilter = async (col) => {
        document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        t.header(col).querySelector('.ag-header-cell-filter-button')
            .dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await t.wait(250);
        return document.querySelector('.csv-filter-panel');
    };
    t.setCond = async (panel, type, value) => {
        const sel = panel.querySelector('.csv-filter-select');
        sel.value = type;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        await t.wait(100);
        const inp = panel.querySelector('.csv-filter-cond-input');
        inp.value = value;
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        await t.wait(250);
    };
    t.filterRows = () => [...document.querySelectorAll('.csv-filter-panel .csv-filter-value-row')];
    t.filterLabels = () => t.filterRows().map(r => r.querySelector('.csv-filter-value-label').textContent);
    t.untick = async (label) => {
        const row = t.filterRows().find(r => r.querySelector('.csv-filter-value-label').textContent === label);
        if (!row) { t.check(false, 'the filter lists ' + JSON.stringify(label)); return; }
        const cb = row.querySelector('input');
        cb.checked = false;
        cb.dispatchEvent(new Event('change', { bubbles: true }));
        await t.wait(250);
    };
`;

const withHelpers = (body) => eval(`(async (t, csv) => { ${FILTER_HELPERS} ${body} })`);

runSuite('spaces around values (browser)', [
    {
        name: 'filter, spaces hidden',
        csv: CITIES,
        steps: withHelpers(`
            await t.init(csv);
            await t.openFilter(0);
            const labels = t.filterLabels();
            t.check(JSON.stringify(labels) === JSON.stringify(['Anna', 'Berlin', 'Hanoi', 'Zoe']),
                'the list shows each value once, as the grid shows it (' + JSON.stringify(labels) + ')');
            await t.untick('Anna');
            let shown = t.shownCol(0);
            t.check(JSON.stringify(shown) === JSON.stringify(['Berlin', 'Hanoi', 'Berlin', 'Zoe']),
                'unticking Anna hides only Anna (' + JSON.stringify(shown) + ')');
            await t.untick('Berlin');
            shown = t.shownCol(0);
            t.check(JSON.stringify(shown) === JSON.stringify(['Hanoi', 'Zoe']),
                'unticking Berlin hides both Berlin rows (' + JSON.stringify(shown) + ')');
            t.check(t.sent('edit').length === 0, 'filtering wrote nothing');
        `),
    },
    {
        name: 'filter, spaces shown',
        csv: CITIES,
        settings: { trimDisplay: false },
        steps: withHelpers(`
            await t.init(csv);
            await t.openFilter(0);
            const labels = t.filterLabels();
            t.check(labels.length === 5 && labels.includes(' Berlin') && labels.includes('Berlin')
                && labels.includes('Hanoi '), 'the list keeps padded values apart (' + JSON.stringify(labels) + ')');
            await t.untick('Anna');
            let shown = t.shownCol(0);
            t.check(shown.length === 4 && !shown.includes('Anna'),
                'unticking Anna hides only Anna (' + JSON.stringify(shown) + ')');
            await t.untick(' Berlin');
            shown = t.shownCol(0);
            t.check(JSON.stringify(shown) === JSON.stringify(['Hanoi ', 'Berlin', ' Zoe']),
                'unticking the padded Berlin hides only that row (' + JSON.stringify(shown) + ')');
        `),
    },
    {
        name: 'filter, setting switched while filtered',
        csv: CITIES,
        steps: withHelpers(`
            await t.init(csv);
            await t.openFilter(0);
            await t.untick('Anna');
            await t.setSetting('trimDisplay', false);
            let shown = t.shownCol(0);
            t.check(shown.length === 4 && !shown.includes('Anna'),
                'switching spaces on keeps the same rows (' + JSON.stringify(shown) + ')');
            await t.openFilter(0);
            const rows = t.filterRows();
            const ticked = rows.filter(r => r.querySelector('input').checked)
                .map(r => r.querySelector('.csv-filter-value-label').textContent);
            t.check(rows.length === 5 && ticked.length === 4 && !ticked.includes('Anna'),
                'the list now keeps padded values apart, Anna still unticked (' + JSON.stringify(ticked) + ')');
            await t.setSetting('trimDisplay', true);
            shown = t.shownCol(0);
            t.check(shown.length === 4 && !shown.includes('Anna'),
                'and switching back keeps them too (' + JSON.stringify(shown) + ')');
        `),
    },
    {
        // With spaces shown ' 2024-01-05' is its own value in the list, but it
        // is still the 5th of January. A condition has to read it as that date.
        name: 'date condition, spaces shown',
        csv: DATES,
        settings: { trimDisplay: false },
        steps: withHelpers(`
            await t.init(csv);
            t.check(new Date(2024, 0, 5).getTimezoneOffset() < 0,
                'the page runs east of UTC, where the bug shows (offset ' + new Date(2024, 0, 5).getTimezoneOffset() + ')');
            const panel = await t.openFilter(0);
            await t.setCond(panel, 'eq', '2024-01-05');
            let shown = t.shownCol(1);
            t.check(JSON.stringify(shown) === JSON.stringify(['1', '2']),
                'Equals 2024-01-05 keeps the padded date too (' + JSON.stringify(shown) + ')');
            let labels = t.filterLabels();
            t.check(labels.includes(' 2024-01-05') && labels.includes('2024-01-05') && !labels.includes('2024-02-01'),
                'the list offers both spellings of the day and nothing else (' + JSON.stringify(labels) + ')');
            await t.setCond(panel, 'lt', '2024-01-05');
            shown = t.shownCol(1);
            t.check(shown.length === 0,
                'Before 2024-01-05 does not count the padded date as the day before (' + JSON.stringify(shown) + ')');
        `),
    },
    {
        // Two spellings of one day are the same date, so a sort keeps them in
        // file order instead of putting the padded one an hour earlier.
        name: 'date sort, spaces around one',
        csv: 'd,n\n2024-01-05,1\n 2024-01-05,2\n2024-01-04,3',
        steps: withHelpers(`
            await t.init(csv);
            t.header(0).querySelector('.ag-header-cell-label').dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await t.wait(250);
            const shown = t.shownCol(1);
            t.check(JSON.stringify(shown) === JSON.stringify(['3', '1', '2']),
                'ascending puts the 4th first and keeps both 5ths in file order (' + JSON.stringify(shown) + ')');
        `),
    },
    {
        name: 'sort',
        csv: SORTING,
        steps: withHelpers(`
            await t.init(csv);
            t.header(0).querySelector('.ag-header-cell-label').dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await t.wait(250);
            let shown = t.shownCol(0);
            t.check(JSON.stringify(shown) === JSON.stringify(['Anna', 'Berlin', 'Carl', 'Zoe']),
                'ascending sorts by what is shown (' + JSON.stringify(shown) + ')');
            await t.setSetting('trimDisplay', false);
            shown = t.shownCol(0);
            t.check(JSON.stringify(shown) === JSON.stringify(['  Carl', ' Zoe', 'Anna', 'Berlin']),
                'with spaces shown the active sort follows the spaces (' + JSON.stringify(shown) + ')');
            await t.setSetting('trimDisplay', true);
            shown = t.shownCol(0);
            t.check(JSON.stringify(shown) === JSON.stringify(['Anna', 'Berlin', 'Carl', 'Zoe']),
                'and switching back sorts by the shown value again (' + JSON.stringify(shown) + ')');
            t.check(t.sent('edit').length === 0, 'sorting wrote nothing');
        `),
    },
    {
        // A cell of only spaces is a blank cell. Number('   ') is 0, so the
        // number comparator used to sort it in with the zeros instead of after
        // the numbers with the other blanks.
        name: 'number sort, blank cells',
        csv: 'n,x\n5,a\n   ,b\n-2,c\n0,d\n,e',
        steps: withHelpers(`
            await t.init(csv);
            t.header(0).querySelector('.ag-header-cell-label').dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await t.wait(250);
            const order = t.shownCol(1);
            t.check(JSON.stringify(order.slice(0, 3)) === JSON.stringify(['c', 'd', 'a'])
                && order.slice(3).sort().join() === 'b,e',
                'ascending puts -2, 0, 5 first and both blank cells after them (' + JSON.stringify(order) + ')');
        `),
    },
    {
        name: 'column chooser',
        csv: PADDED_HEADERS,
        steps: async (t, csv) => {
            await t.init(csv);
            const labels = async () => {
                document.getElementById('btn-columns').dispatchEvent(new MouseEvent('click', { bubbles: true }));
                await t.wait(150);
                const out = [...document.querySelectorAll('#col-chooser-list .col-chooser-label')].map(s => s.textContent);
                document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                await t.wait(100);
                return out;
            };
            let l = await labels();
            t.check(JSON.stringify(l) === JSON.stringify(['name', '(column 2)', 'city']),
                'names are shown as the header shows them, a blank one as (column N) (' + JSON.stringify(l) + ')');
            await t.setSetting('trimDisplay', false);
            l = await labels();
            t.check(JSON.stringify(l) === JSON.stringify(['name', '(column 2)', ' city ']),
                'with spaces shown the names keep them, a blank one is still (column N) (' + JSON.stringify(l) + ')');
        },
    },
    {
        name: 'export',
        csv: PADDED_HEADERS,
        steps: async (t, csv) => {
            await t.init(csv);
            const exportAs = async (format) => {
                t.click(document.querySelector('.export-option[data-format="' + format + '"]'));
                await t.wait(100);
                const e = t.sent('export');
                return e.length ? e[e.length - 1].text : '';
            };
            let md = await exportAs('md');
            t.check(md.includes('| Anna | x | Berlin |') && md.includes('| name |  | city |'),
                'Markdown exports what the grid shows (' + JSON.stringify(md) + ')');
            let json = await exportAs('json');
            t.check(json.includes('"city": "Berlin"'), 'JSON exports the shown value (' + JSON.stringify(json) + ')');
            await t.setSetting('trimDisplay', false);
            md = await exportAs('md');
            t.check(md.includes('|  Berlin  |') && md.includes('|  city  |'),
                'with spaces shown the export keeps them in names and values alike (' + JSON.stringify(md) + ')');
            t.check(t.sent('edit').length === 0, 'exporting wrote nothing');
        },
    },
    {
        // Copy took the value as the file has it, so a cell that showed
        // Berlin put '  Berlin  ' on the clipboard. Pasted into a search box
        // or a spreadsheet, the hidden spaces made lookups fail.
        name: 'copy',
        csv: ' city ,b\n  Berlin  ,x\nHanoi, y ',
        steps: async (t, csv) => {
            const copied = [];
            Object.defineProperty(navigator, 'clipboard', {
                configurable: true,
                value: { writeText: s => { copied.push(s); return Promise.resolve(); } },
            });
            const last = () => (copied.length ? copied[copied.length - 1] : null);
            const ctrlC = async () => {
                const target = document.querySelector('#grid-container .ag-cell-focus') || document.body;
                target.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', code: 'KeyC', ctrlKey: true, bubbles: true, cancelable: true }));
                await t.wait(100);
            };
            const shiftClick = async (row, col) => {
                const c = t.cell(row, col);
                ['mousedown', 'mouseup', 'click'].forEach(ty =>
                    c.dispatchEvent(new MouseEvent(ty, { bubbles: true, button: 0, shiftKey: true })));
                await t.wait(200);
            };
            const menu = async (row, col, label) => {
                const c = t.cell(row, col);
                const r = c.getBoundingClientRect();
                c.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 5, clientY: r.top + 5 }));
                await t.wait(200);
                const item = [...document.querySelectorAll('#row-context-menu .row-ctx-item')].find(i => i.textContent === label);
                if (!item) { t.check(false, 'the row menu offers ' + label); return; }
                item.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                await t.wait(100);
            };
            await t.init(csv);
            t.check(t.cell(0, 0).textContent === 'Berlin', 'the cell shows Berlin (' + JSON.stringify(t.cell(0, 0).textContent) + ')');
            await t.focusCell(0, 0);
            await ctrlC();
            t.check(last() === 'Berlin', 'Ctrl+C on the cell copies what it shows (' + JSON.stringify(last()) + ')');
            await menu(0, 0, 'Copy');
            t.check(last() === 'Berlin', 'so does Copy in the menu (' + JSON.stringify(last()) + ')');
            await shiftClick(1, 1);
            await ctrlC();
            t.check(last() === 'Berlin\tx\nHanoi\ty', 'Ctrl+C on a range copies what the cells show (' + JSON.stringify(last()) + ')');
            await menu(1, 1, 'Copy with header');
            t.check(last() === 'city\tb\nBerlin\tx\nHanoi\ty',
                'Copy with header takes the column names as shown too (' + JSON.stringify(last()) + ')');
            await menu(1, 1, 'Copy as CSV');
            t.check(last() === 'Berlin,x\nHanoi,y', 'Copy as CSV copies what the cells show (' + JSON.stringify(last()) + ')');
            await menu(1, 1, 'Copy as CSV with header');
            t.check(last() === 'city,b\nBerlin,x\nHanoi,y', 'and so does Copy as CSV with header (' + JSON.stringify(last()) + ')');

            await t.setSetting('trimDisplay', false);
            await t.focusCell(0, 0);
            await ctrlC();
            t.check(last() === '  Berlin  ', 'with spaces shown Ctrl+C keeps them (' + JSON.stringify(last()) + ')');
            await menu(0, 0, 'Copy');
            t.check(last() === '  Berlin  ', 'and so does Copy in the menu (' + JSON.stringify(last()) + ')');
            await shiftClick(1, 1);
            await menu(1, 1, 'Copy with header');
            t.check(last() === ' city \tb\n  Berlin  \tx\nHanoi\t y ',
                'and so does a range, column names included (' + JSON.stringify(last()) + ')');
            t.check(t.sent('edit').length === 0, 'copying wrote nothing');
        },
    },
    {
        name: 'checkbox with a modifier',
        csv: 'name,active,n,note\na,true,1,x\nb,false,2,y\nc,true,3,z\nd,false,4,w',
        settings: { boolCheckboxes: true },
        steps: async (t, csv) => {
            await t.init(csv);
            const clickBox = async (row, col, mods) => {
                const box = t.box(row, col);
                ['mousedown', 'mouseup', 'click'].forEach(ty => box.dispatchEvent(new MouseEvent(ty,
                    Object.assign({ bubbles: true, cancelable: true, button: 0, detail: 1 }, mods))));
                await t.wait(200);
            };
            await t.focusCell(0, 0);
            await clickBox(2, 1, { shiftKey: true });
            const selected = document.querySelectorAll('#grid-container .cell-range-sel').length;
            t.check(selected > 1, 'Shift+click on a box extends the selection (' + selected + ' cells)');
            t.check(t.sent('edit').length === 0, 'Shift+click on a box does not flip it (' + JSON.stringify(t.lastEdit()) + ')');
            await clickBox(3, 1, { ctrlKey: true });
            await clickBox(3, 1, { metaKey: true });
            await clickBox(3, 1, { altKey: true });
            t.check(t.sent('edit').length === 0, 'Ctrl, Cmd or Alt+click on a box does not flip it ('
                + t.sent('edit').length + ' edits)');
            await clickBox(3, 1, {});
            t.check(t.sent('edit').length === 1 && /d,true,4,w/.test(t.lastEdit()),
                'a plain click still flips it');
        },
    },
]);
