// Browser tests for the duplicates banner keeping up with the data.
//
// A search that finds nothing says so in a banner. After an edit, an undo or a
// switch of the header row the rows are different, and they may hold
// duplicates now. The banner said "No duplicate rows found" all the same,
// because the reset after a change only ran when duplicates had been found.
// "Show only duplicates" brought up the Clear filters button, which clears
// column filters only and so did nothing for that view.
//
// Run after `tsc -p ./`:  node test/ui-duplicates.test.cjs

const { runSuite } = require('./ui/harness.cjs');

const HELPERS = `
    t.banner = () => {
        const b = document.getElementById('dup-banner');
        return b.classList.contains('hidden') ? '' : document.getElementById('dup-banner-text').textContent;
    };
    t.search = async () => {
        document.getElementById('btn-duplicates').dispatchEvent(new MouseEvent('click', { bubbles: true }));
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
    t.button = async (id) => {
        document.getElementById(id).dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await t.wait(400);
    };
    t.clearShown = () => document.getElementById('btn-clear-filters').style.display !== 'none';
    t.rowCount = () => document.querySelectorAll('#grid-container .ag-center-cols-container .ag-row').length;
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
`;

const steps = (body) => `async (t, csv) => { ${HELPERS} await t.init(csv); ${body} }`;

runSuite('duplicates banner (browser)', [
    {
        name: 'a search that found nothing',
        csv: 'a,b\n1,x\n2,y',
        steps: steps(`
            await t.search();
            t.check(t.banner() === 'No duplicate rows found', 'the search reports nothing found (' + JSON.stringify(t.banner()) + ')');
            await t.edit(1, 0, '1');
            await t.edit(1, 1, 'x');
            t.check(t.banner() === '', 'an edit takes the old result away (' + JSON.stringify(t.banner()) + ')');
            await t.search();
            t.check(/^2 duplicate rows/.test(t.banner()), 'and a new search finds the rows that are duplicates now ('
                + JSON.stringify(t.banner()) + ')');
        `),
    },
    {
        // "Show only duplicates" hides rows with a filter of its own, which
        // the Clear button does not clear. The button came up for that view
        // all the same and did nothing when clicked.
        name: 'the Clear filters button in the duplicates view',
        csv: 'a,b,c\n1,x,p\n2,y,q\n1,x,p\n3,z,r\n4,w,s',
        steps: steps(`
            await t.search();
            await t.button('dup-only-toggle');
            t.check(t.rowCount() === 2, 'the view shows the two duplicates (' + t.rowCount() + ')');
            t.check(!t.clearShown(), 'with no column filter on there is nothing to clear');
            await t.button('dup-only-toggle');
            await t.filterOut(0, '4');
            t.check(t.clearShown(), 'a column filter brings the button up');
            await t.button('dup-only-toggle');
            t.check(t.rowCount() === 2 && t.clearShown(), 'and it stays up in the view ('
                + t.rowCount() + ' rows)');
            await t.button('btn-clear-filters');
            t.check(!t.clearShown(), 'Clear takes the column filter off and the button with it');
            t.check(t.rowCount() === 2 && document.getElementById('dup-only-toggle').textContent === 'Show all rows',
                'the view stays as it was (' + t.rowCount() + ' rows)');
            await t.button('dup-only-toggle');
            t.check(t.rowCount() === 5, 'Show all rows brings every row back, the one filtered out before too ('
                + t.rowCount() + ')');
        `),
    },
]);
