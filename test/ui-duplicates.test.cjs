// Browser tests for the duplicates banner keeping up with the data.
//
// A search that finds nothing says so in a banner. After an edit, an undo or a
// switch of the header row the rows are different, and they may hold
// duplicates now. The banner said "No duplicate rows found" all the same,
// because the reset after a change only ran when duplicates had been found.
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
]);
