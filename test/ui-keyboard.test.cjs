// Browser tests for Ctrl+C and Ctrl+S in the grid.
//
// Ctrl+C copied the grid's focused cell wherever the key was pressed, in the
// find box, the rename box and the other text boxes too. It stopped the
// browser from copying the text selected there. On a focused cell of a frozen
// row it copied nothing, so a paste gave whatever was copied before. Ctrl+S
// while a cell was being typed in saved the file without the typed value and
// the tab showed it as saved. VS Code saves as soon as it gets the key. The
// value only reached the file once the grid had reported the commit.
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
    // Where the keyboard is: the cell that has the browser focus as
    // row/column. Anything else gives its tag. A frozen row's number
    // starts with t-.
    t.onCell = () => {
        const a = document.activeElement;
        const cell = a && a.closest && a.closest('#grid-container .ag-cell');
        return cell ? cell.closest('.ag-row').getAttribute('row-index') + '/' + cell.getAttribute('col-id') : String(a && a.tagName);
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
    {
        name: 'Ctrl+S saves the value being typed',
        csv: 'name,city\nAnna,Berlin\nBen,Oslo\n',
        steps: steps(`
            const ta = await t.type(0, 1, 'TYPED');
            if (!ta) return;
            const ev = new KeyboardEvent('keydown', { key: 's', code: 'KeyS', keyCode: 83, ctrlKey: true, bubbles: true, cancelable: true });
            ta.dispatchEvent(ev);
            // VS Code handles the key right after the page has seen it, so the
            // edit has to be on its way by the time the key is through.
            t.check(t.lastEdit() === 'name,city\\nAnna,TYPED\\nBen,Oslo\\n', 'the edit is sent while the key is handled ('
                + JSON.stringify(t.lastEdit()) + ')');
            t.check(!ev.defaultPrevented, 'the key goes on to VS Code');
            await t.wait(400);
            t.check(!document.querySelector('#grid-container textarea'), 'the editor is closed');
            t.check(t.sent('edit').length === 1, 'the value is written once (' + t.sent('edit').length + ')');
            t.check(t.cell(0, 1).textContent === 'TYPED', 'the cell shows it');
            // The keys stay with the grid, the way they do after Enter.
            t.check(t.onCell() === '0/col_1', 'the keyboard is back on the cell (' + t.onCell() + ')');
            document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
            await t.wait(250);
            t.check(t.onCell() === '1/col_1', 'and the arrow keys move from there (' + t.onCell() + ')');
            document.getElementById('btn-undo').dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await t.wait(300);
            t.check(t.lastEdit() === csv, 'one undo takes it back (' + JSON.stringify(t.lastEdit()) + ')');
            t.check(document.getElementById('btn-undo').disabled, 'and nothing else is left to undo');
            // Without an open editor the key writes nothing.
            await t.focusCell(1, 1);
            const sent = t.sent('edit').length;
            await t.ctrlKey(t.focused(), 's');
            t.check(t.sent('edit').length === sent, 'Ctrl+S on a cell that is not open writes nothing');
        `),
    },
    {
        name: 'Ctrl+S with the value unchanged writes nothing',
        csv: 'name,city\nAnna,Berlin\n',
        steps: steps(`
            const ta = await t.type(0, 1, 'Berlin');
            if (!ta) return;
            ta.dispatchEvent(new KeyboardEvent('keydown', { key: 's', code: 'KeyS', keyCode: 83, ctrlKey: true, bubbles: true, cancelable: true }));
            await t.wait(400);
            t.check(!document.querySelector('#grid-container textarea'), 'the editor is closed');
            t.check(t.sent('edit').length === 0, 'nothing is written (' + JSON.stringify(t.lastEdit()) + ')');
            t.check(t.onCell() === '0/col_1', 'the keyboard is back on the cell (' + t.onCell() + ')');
            t.check(document.getElementById('btn-undo').disabled, 'and nothing is there to undo');
        `),
    },
    {
        // A frozen row sits in a band of its own above the others, with row
        // numbers of its own.
        name: 'Ctrl+S saves the value typed in a frozen row',
        csv: 'name,city\nAnna,Berlin\nBen,Oslo\n',
        steps: steps(`
            await t.rightClick(t.cell(1, 0));
            const item = [...document.querySelectorAll('#row-context-menu .row-ctx-item')].find(i => i.textContent === 'Freeze row');
            if (!item) { t.check(false, 'the row menu offers Freeze row'); return; }
            item.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await t.wait(300);
            const frozen = document.querySelector('#grid-container .ag-floating-top .ag-cell[col-id="col_1"]');
            t.check(!!frozen && frozen.textContent === 'Oslo', 'Ben is frozen');
            ['mousedown', 'mouseup', 'click'].forEach(ty => frozen.dispatchEvent(new MouseEvent(ty, { bubbles: true, button: 0 })));
            await t.wait(200);
            await t.pressEnter();
            const ta = document.querySelector('#grid-container textarea');
            if (!ta) { t.check(false, 'Enter opens the editor on the frozen cell'); return; }
            ta.value = 'Rome';
            ta.dispatchEvent(new Event('input', { bubbles: true }));
            ta.dispatchEvent(new KeyboardEvent('keydown', { key: 's', code: 'KeyS', keyCode: 83, ctrlKey: true, bubbles: true, cancelable: true }));
            t.check(t.lastEdit() === 'name,city\\nAnna,Berlin\\nBen,Rome\\n', 'the frozen row gets the value ('
                + JSON.stringify(t.lastEdit()) + ')');
            await t.wait(250);
            t.check(t.onCell() === 't-0/col_1', 'the keyboard is back on the frozen cell (' + t.onCell() + ')');
        `),
    },
]);
