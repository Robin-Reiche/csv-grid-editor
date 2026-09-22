// Browser tests for the value list in a column filter.
//
// The filter is made once per column and kept, so a list built only then
// would go stale. A value typed in, pasted or loaded from disk afterwards
// would be missing from it and a value no row holds any more would still be
// offered. After "Hide spaces around values" is switched with no filter on, it
// would still list the values the old way. The list has to show the data as
// it is each time the panel opens, while the ticks the user set on values
// still there stay as they are.
//
// Run after `tsc -p ./`:  node test/ui-filter-values.test.cjs

const { runSuite } = require('./ui/harness.cjs');

// Shared by every scenario. The steps run inside the page, where these helpers
// are rebuilt from their source, so they must not close over anything.
const HELPERS = `
    const openFilter = async (col) => {
        document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        t.header(col).querySelector('.ag-header-cell-filter-button')
            .dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await t.wait(250);
    };
    const closeFilter = async () => {
        document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await t.wait(200);
    };
    const rows = () => [...document.querySelectorAll('.csv-filter-panel .csv-filter-value-row')];
    const labelOf = r => r.querySelector('.csv-filter-value-label').textContent;
    const labels = () => JSON.stringify(rows().map(labelOf));
    const ticked = () => JSON.stringify(rows().filter(r => r.querySelector('input').checked).map(labelOf));
    const untick = async (label) => {
        const cb = rows().find(r => labelOf(r) === label).querySelector('input');
        cb.checked = false;
        cb.dispatchEvent(new Event('change', { bubbles: true }));
        await t.wait(250);
    };
    const type = async (row, col, text) => {
        await t.focusCell(row, col);
        await t.pressEnter();
        const ta = document.querySelector('#grid-container textarea');
        ta.value = text;
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        await t.pressEnter();
    };
    const filterOn = () => document.getElementById('btn-clear-filters').style.display !== 'none';
`;

const steps = (body) => eval(`(async (t, csv) => { ${HELPERS} ${body} })`);

runSuite('filter value list (browser)', [
    {
        name: 'a value typed in after the list was made',
        csv: 'city,n\nBerlin,1\nHanoi,2',
        steps: steps(`
            await t.init(csv);
            await openFilter(0);
            t.check(labels() === '["Berlin","Hanoi"]', 'the list starts with the file values (' + labels() + ')');
            await closeFilter();
            await type(0, 0, 'Oslo');
            t.check(/Oslo/.test(t.lastEdit()), 'the edit reached the file (' + JSON.stringify(t.lastEdit()) + ')');
            await openFilter(0);
            t.check(labels() === '["Hanoi","Oslo"]', 'the list shows the new value and drops the old one (' + labels() + ')');
            t.check(ticked() === '["Hanoi","Oslo"]', 'with nothing filtered every value stays ticked (' + ticked() + ')');
            t.check(!filterOn(), 'and the column is still not filtered');
        `),
    },
    {
        name: 'a new value keeps the ticks already set',
        csv: 'city,n\nBerlin,1\nHanoi,2\nParis,3',
        steps: steps(`
            await t.init(csv);
            await openFilter(0);
            await untick('Hanoi');
            t.check(filterOn(), 'unticking Hanoi filters the column');
            await closeFilter();
            await type(0, 0, 'Oslo');
            await openFilter(0);
            t.check(labels() === '["Hanoi","Oslo","Paris"]', 'the list shows the new value (' + labels() + ')');
            // A value the list did not have yet is not in the ticked set, so
            // the filter already leaves it out while some values are unticked.
            // The list shows it that way rather than claim it passes.
            t.check(ticked() === '["Paris"]', 'Hanoi stays unticked and the new value follows Select all (' + ticked() + ')');
        `),
    },
    {
        name: 'spaces switch with no filter on',
        csv: 'city,n\n Berlin,1\nAnna,2\nHanoi ,3\nBerlin,4\n Zoe,5',
        steps: steps(`
            await t.init(csv);
            await openFilter(0);
            t.check(labels() === '["Anna","Berlin","Hanoi","Zoe"]', 'spaces hidden, one entry per shown value (' + labels() + ')');
            await closeFilter();
            await t.setSetting('trimDisplay', false);
            await openFilter(0);
            const l = rows().map(labelOf);
            t.check(l.length === 5 && l.includes(' Berlin') && l.includes('Berlin') && l.includes('Hanoi '),
                'spaces shown, the padded values are listed apart (' + labels() + ')');
            t.check(rows().every(r => r.querySelector('input').checked), 'and all of them are ticked (' + ticked() + ')');
        `),
    },
]);
