// Browser tests for typing a condition into a column filter.
//
// Typing a condition froze the grid for about a second per key on 100,000
// rows. Each filter pass asked for every row whether all values were ticked,
// which went through every value again: rows times values lookups. A key now
// costs lookups in proportion to the rows. The condition is also applied once
// the typing pauses instead of on each key. The key typed last is always the
// one that applies.
//
// Run after `tsc -p ./`:  node test/ui-filter-condition.test.cjs

const { runSuite } = require('./ui/harness.cjs');

// 1000 rows with 1000 different names.
const NAMES = 'name,n\n' + Array.from({ length: 1000 }, (_, i) => 'item' + String(i).padStart(4, '0') + ',' + i).join('\n');

// Shared by every scenario. The steps run inside the page, where these helpers
// are rebuilt from their source, so they must not close over anything.
const HELPERS = `
    // createGrid is a getter that cannot be replaced, so the whole global is
    // swapped for a proxy that hands out the grid it made.
    let api = null;
    const real = window.agGrid;
    window.agGrid = new Proxy(real, { get: (o, k) => k === 'createGrid' ? ((el, opts) => (api = real.createGrid(el, opts))) : o[k] });
    const openFilter = async (col) => {
        document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        t.header(col).querySelector('.ag-header-cell-filter-button')
            .dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await t.wait(250);
    };
    const closeFilter = () => document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const choose = async (type) => {
        const sel = document.querySelector('.csv-filter-panel .csv-filter-select');
        sel.value = type;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        await t.wait(250);
    };
    const type = (text) => {
        const inp = document.querySelector('.csv-filter-panel .csv-filter-cond-input');
        inp.value = text;
        inp.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const shown = () => api.getDisplayedRowCount();
`;

const steps = (body) => eval(`(async (t, csv) => { ${HELPERS} ${body} })`);

runSuite('filter condition typing (browser)', [
    {
        name: 'a key costs lookups in proportion to the rows',
        csv: NAMES,
        steps: steps(`
            await t.init(csv);
            window.agGrid = real;
            t.check(shown() === 1000, 'all rows are shown (' + shown() + ')');
            await openFilter(0);
            await choose('contains');
            // Every value is still ticked. Set lookups are counted while one key
            // is typed and the filter runs.
            const has = Set.prototype.has;
            let lookups = 0;
            Set.prototype.has = function (v) { lookups++; return has.call(this, v); };
            try {
                type('9');
                await t.wait(400);
            } finally {
                Set.prototype.has = has;
            }
            t.check(shown() === 271, 'the condition applies (' + shown() + ' rows)');
            t.check(lookups < 100000, 'one key takes far fewer lookups than rows times values (' + lookups + ')');
        `),
    },
    {
        name: 'the key typed last applies once the typing pauses',
        csv: NAMES,
        steps: steps(`
            await t.init(csv);
            window.agGrid = real;
            let passes = 0;
            api.addEventListener('filterChanged', () => passes++);
            await openFilter(0);
            await choose('contains');
            passes = 0;
            type('1');
            await t.wait(30);
            type('12');
            await t.wait(30);
            type('123');
            await t.wait(400);
            t.check(passes === 1, 'three quick keys run the filter once (' + passes + ')');
            t.check(shown() === 1, 'and the last one is what it applies (' + shown() + ' rows)');
            const labels = [...document.querySelectorAll('.csv-filter-panel .csv-filter-value-row')].length;
            t.check(labels === 1, 'the value list follows it too (' + labels + ')');
            // Closed before the pause is over, the panel still applies the key.
            type('12');
            closeFilter();
            await t.wait(400);
            t.check(shown() === 20, 'a key typed right before the panel closes still applies (' + shown() + ' rows)');
            t.check(document.getElementById('btn-clear-filters').style.display !== 'none', 'and the column shows as filtered');
        `),
    },
]);
