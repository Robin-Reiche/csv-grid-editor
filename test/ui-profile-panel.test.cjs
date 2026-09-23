// Browser test: the Column Profile panel leaves the grid its room in a narrow
// editor.
//
// The panel opens at the width the stylesheet gives it, 295px. A size the user
// dragged out was already held to what the window leaves the grid, the default
// was not, so a 380px editor kept 85px for the grid: the # column and a sliver
// of the first one. The default is held to the same limits now, when the panel
// opens and when the editor is resized.
//
// The harness window is 1100px wide, so each check narrows the page itself to
// the width of the editor it stands for, the way test/ui-toolbar.test.cjs does.
//
// Run after `tsc -p ./`:  node test/ui-profile-panel.test.cjs

const { runSuite } = require('./ui/harness.cjs');

const CSV = ['id,name,city,country,amount']
    .concat(Array.from({ length: 30 }, (_, i) => `${i},name ${i},city ${i},country ${i},${i * 3}`)).join('\n');

// Shared by every scenario. Runs in the page.
const HELPERS = `
    t.narrow = async (width, height) => {
        document.documentElement.style.overflow = 'hidden';
        document.body.style.width = width + 'px';
        if (height) document.body.style.height = height + 'px';
        window.dispatchEvent(new Event('resize'));
        await t.wait(200);
    };
    t.widths = () => {
        const w = id => Math.round(document.getElementById(id).getBoundingClientRect().width);
        return { panel: w('profile-panel'), grid: w('grid-container') };
    };
    t.heights = () => {
        const h = id => Math.round(document.getElementById(id).getBoundingClientRect().height);
        return { panel: h('profile-panel'), grid: h('grid-container') };
    };
    t.toggle = async () => {
        document.getElementById('btn-profile').dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await t.wait(300);
    };
`;

const steps = (body) => `async (t, csv) => { ${HELPERS} await t.init(csv); ${body} }`;

runSuite('column profile in a narrow editor (browser)', [
    {
        name: 'wide editor',
        csv: CSV,
        steps: steps(`
            await t.toggle();
            const s = t.widths();
            t.check(s.panel === 295, 'the panel opens at its usual width (' + s.panel + ')');
        `),
    },
    {
        name: '500px',
        csv: CSV,
        steps: steps(`
            await t.narrow(500);
            await t.toggle();
            const s = t.widths();
            t.check(s.grid >= 250 && s.panel >= 180, 'the grid keeps 250px next to the panel (grid ' + s.grid + ', panel ' + s.panel + ')');
        `),
    },
    {
        name: '380px',
        csv: CSV,
        steps: steps(`
            await t.narrow(380);
            await t.toggle();
            const s = t.widths();
            t.check(s.panel === 180 && s.grid === 200, 'the panel gives way down to its smallest width (grid ' + s.grid + ', panel ' + s.panel + ')');
        `),
    },
    {
        name: 'narrowed while open',
        csv: CSV,
        steps: steps(`
            await t.toggle();
            await t.narrow(450);
            let s = t.widths();
            t.check(s.grid >= 250, 'the panel gives way when the editor gets narrower (grid ' + s.grid + ', panel ' + s.panel + ')');
            await t.narrow(1100);
            s = t.widths();
            t.check(s.panel === 295, 'and takes its usual width back when there is room again (' + s.panel + ')');
        `),
    },
    {
        name: 'docked at the bottom of a short editor',
        csv: CSV,
        steps: steps(`
            await t.narrow(1100, 320);
            await t.toggle();
            document.querySelector('.profile-dock-btn[data-dock="bottom"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await t.wait(300);
            const s = t.heights();
            t.check(s.grid >= 120, 'the grid keeps 120px above the panel (grid ' + s.grid + ', panel ' + s.panel + ')');
        `),
    },
]);
