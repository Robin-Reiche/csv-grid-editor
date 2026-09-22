// Browser test: every toolbar control stays reachable in a narrow editor.
//
// The toolbar was a single row that could not wrap and the page clips what
// overflows. Below about 640px, the width of a split editor, the settings
// gear at its right end was pushed out of view. With it went all eight
// switches that only live behind the gear. At even narrower widths Export and
// the delimiter badge went the same way.
//
// The harness window is 1100px wide, so each check narrows the page itself to
// the width of the editor it stands for and clips the rest the way a narrow
// webview does. Then it asks the browser what a click at the middle of each
// control would land on.
//
// Run after `tsc -p ./`:  node test/ui-toolbar.test.cjs

const { runSuite } = require('./ui/harness.cjs');

// Enough rows that the "<n> rows × <n> columns" text is as long as it gets in
// everyday files.
const CSV = ['id,name,city'].concat(Array.from({ length: 12000 }, (_, i) => `${i},name ${i},city ${i}`)).join('\n');

// Runs in the page. Narrows the page to `width`, then checks each visible
// toolbar control.
const reach = async (t, csv, width) => {
    await t.init(csv);
    // The worst case: the Clear filters button only shows while a filter is
    // set and it makes the toolbar wider still.
    document.getElementById('btn-clear-filters').style.display = '';
    document.getElementById('sep-filters').style.display = '';
    document.documentElement.style.overflow = 'hidden';
    document.body.style.width = width + 'px';
    await t.wait(300);

    const controls = [...document.querySelectorAll('.toolbar > button, .toolbar > #zoom-level, .toolbar > #delim-badge')]
        .filter(el => getComputedStyle(el).display !== 'none');
    const missed = [];
    for (const el of controls) {
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        if (!hit || !el.contains(hit)) missed.push(el.id + ' at x=' + Math.round(r.left) + '..' + Math.round(r.right));
    }
    t.check(controls.length >= 12, 'found the toolbar controls (' + controls.length + ')');
    t.check(missed.length === 0, 'at ' + width + 'px every control can be clicked'
        + (missed.length ? ' (out of reach: ' + missed.join(', ') + ')' : ''));
    const gear = document.getElementById('btn-settings').getBoundingClientRect();
    t.check(gear.right <= width, 'the gear is inside the ' + width + 'px editor (right edge ' + Math.round(gear.right) + ')');
    t.check(t.container().getBoundingClientRect().height > 100, 'the grid keeps its room below the toolbar');
};

// The harness sends a test's steps to the page as source text, so the width
// has to be written into that text rather than captured.
const reachAt = width => `async (t, csv) => (${reach})(t, csv, ${width})`;

runSuite('toolbar in a narrow editor (browser)', [
    { name: '600px', csv: CSV, steps: reachAt(600) },
    { name: '500px', csv: CSV, steps: reachAt(500) },
    { name: '380px', csv: CSV, steps: reachAt(380) },
    {
        name: 'wide editor',
        csv: CSV,
        steps: async (t, csv) => {
            await t.init(csv);
            const bar = document.querySelector('.toolbar').getBoundingClientRect();
            t.check(bar.height <= 30, 'a wide editor keeps the toolbar to one row (' + Math.round(bar.height) + 'px)');
            const info = document.getElementById('info');
            t.check(info.scrollWidth <= info.clientWidth, 'the row count shows in full when there is room');
        },
    },
]);
