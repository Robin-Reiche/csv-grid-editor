// Browser tests for Ctrl+C in the grid.
//
// Ctrl+C copied the grid's focused cell wherever the key was pressed, in the
// find box, the rename box and the other text boxes too. It stopped the
// browser from copying the text selected there. On a focused cell of a frozen
// row it copied nothing, so a paste gave whatever was copied before.
//
// Run after `tsc -p ./`:  node test/ui-keyboard.test.cjs

const { runSuite } = require('./ui/harness.cjs');

// Shared by every scenario. The steps run inside the page, where these helpers
// are rebuilt from their source, so they must not close over anything.
const HELPERS = `
    t.copied = [];
    Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: s => { t.copied.push(s); return Promise.resolve(); } },
    });
    // Presses a key with Ctrl on el and reports whether the page stopped the
    // browser's own action.
    t.ctrlKey = async (el, key, extra) => {
        const ev = new KeyboardEvent('keydown', Object.assign({
            key, code: 'Key' + key.toUpperCase(), keyCode: key.toUpperCase().charCodeAt(0),
            ctrlKey: true, bubbles: true, cancelable: true,
        }, extra));
        el.dispatchEvent(ev);
        await t.wait(150);
        return ev.defaultPrevented;
    };
    t.focused = () => document.querySelector('#grid-container .ag-cell-focus');
    t.rightClick = async (el) => {
        const r = el.getBoundingClientRect();
        el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 5, clientY: r.top + 5 }));
        await t.wait(200);
    };
    t.type = async (row, col, value) => {
        await t.focusCell(row, col);
        await t.pressEnter();
        const ta = document.querySelector('#grid-container textarea');
        if (!ta) { t.check(false, 'Enter opens the editor on ' + row + ',' + col); return null; }
        ta.value = value;
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        return ta;
    };
`;

const steps = (body) => `async (t, csv) => { ${HELPERS} await t.init(csv); ${body} }`;

runSuite('keyboard (browser)', [
    {
        name: 'Ctrl+C in a text box copies its own text',
        csv: 'city,n\nBerlin,1\nHamburg,2',
        steps: steps(`
            await t.focusCell(0, 0);
            const onCell = await t.ctrlKey(t.focused(), 'c');
            t.check(onCell && t.copied.join('|') === 'Berlin', 'Ctrl+C on a cell copies it (' + t.copied.join('|') + ')');
            // Each box with text selected in it. The key must be left to the
            // browser, which copies that selection.
            const tryBox = async (el, label) => {
                if (!el) { t.check(false, 'the ' + label + ' is there'); return; }
                el.value = 'Hamburg';
                el.focus();
                el.select();
                const before = t.copied.length;
                const prevented = await t.ctrlKey(el, 'c');
                t.check(!prevented && t.copied.length === before,
                    'Ctrl+C in the ' + label + ' is left to the browser (prevented ' + prevented + ', copied '
                    + JSON.stringify(t.copied.slice(before)) + ')');
            };
            await t.ctrlKey(t.focused(), 'f');
            await tryBox(document.getElementById('find-input'), 'find box');
            await tryBox(document.getElementById('replace-input'), 'replace box');
            document.getElementById('find-close').dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await t.wait(200);
            await t.rightClick(t.header(0));
            document.getElementById('col-ctx-rename').dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await t.wait(200);
            await tryBox(document.getElementById('rename-input'), 'rename box');
            document.getElementById('rename-cancel').dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await t.wait(200);
            document.getElementById('btn-columns').dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await t.wait(200);
            await tryBox(document.getElementById('col-chooser-search'), 'column chooser search');
            document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await t.wait(200);
            t.click(t.header(0).querySelector('.ag-header-cell-filter-button, .ag-header-cell-menu-button'));
            await t.wait(300);
            await tryBox(document.querySelector('.ag-popup .csv-filter-input'), 'value filter search');
        `),
    },
    {
        name: 'Ctrl+C on a frozen row copies its value',
        csv: 'a,b\nBerlin,x\nHanoi,y\nParis,z',
        steps: steps(`
            await t.rightClick(t.cell(1, 0));
            const item = [...document.querySelectorAll('#row-context-menu .row-ctx-item')].find(i => i.textContent === 'Freeze row');
            if (!item) { t.check(false, 'the row menu offers Freeze row'); return; }
            item.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await t.wait(300);
            const frozen = (c) => document.querySelector('#grid-container .ag-floating-top .ag-cell[col-id="col_' + c + '"]');
            t.check(!!frozen(0) && frozen(0).textContent === 'Hanoi', 'Hanoi is frozen');
            ['mousedown', 'mouseup', 'click'].forEach(ty => frozen(0).dispatchEvent(new MouseEvent(ty, { bubbles: true, button: 0 })));
            await t.wait(200);
            t.check(t.focused() === frozen(0), 'the frozen cell has the focus');
            const prevented = await t.ctrlKey(frozen(0), 'c');
            t.check(prevented && t.copied.join('|') === 'Hanoi', 'Ctrl+C copies it (' + JSON.stringify(t.copied) + ')');
            // Reached with the keyboard from the first row below it.
            await t.focusCell(0, 1);
            t.focused().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', code: 'ArrowUp', bubbles: true, cancelable: true }));
            await t.wait(200);
            t.check(t.focused() === frozen(1), 'ArrowUp moves the focus into the frozen row');
            await t.ctrlKey(t.focused(), 'c');
            t.check(t.copied[t.copied.length - 1] === 'y', 'Ctrl+C copies that cell too (' + JSON.stringify(t.copied) + ')');
        `),
    },
]);
