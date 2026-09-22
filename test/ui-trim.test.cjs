// Browser tests for values with spaces around them (v1.23 reads files
// untrimmed and "Hide spaces around values" decides what is shown).
//
// The rule everything here checks: with the setting on, every place that
// lists, compares or exports values works on what the grid SHOWS, so ' Berlin '
// and 'Berlin' are one value. With it off they are two, exactly as the file has
// them. Switching the setting while a sort or a filter is active must leave
// both working. None of this may ever write to the file.
//
// Run after `tsc -p ./`:  node test/ui-trim.test.cjs

const { runSuite } = require('./ui/harness.cjs');

const CITIES = 'city,n\n Berlin,1\nAnna,2\nHanoi ,3\nBerlin,4\n Zoe,5';
const SORTING = 'city,n\nAnna,1\n Zoe,2\nBerlin,3\n  Carl,4';
const PADDED_HEADERS = 'name,   , city \nAnna,x, Berlin ';

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
]);
