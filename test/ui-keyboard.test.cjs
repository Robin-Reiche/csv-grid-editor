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
    t.editor = () => document.querySelector('#grid-container textarea');
    // Presses a key on el or where the keyboard is. The event it hands back
    // tells whether the page stopped the browser's own action.
    t.press = async (key, extra, el) => {
        const letter = key.length === 1;
        const ev = new KeyboardEvent('keydown', Object.assign({
            key, code: letter ? 'Key' + key.toUpperCase() : key,
            keyCode: letter ? key.toUpperCase().charCodeAt(0) : 0, bubbles: true, cancelable: true,
        }, extra));
        (el || document.activeElement || document.body).dispatchEvent(ev);
        await t.wait(150);
        return ev;
    };
    // VS Code's webview host listens on the window as a key bubbles up and
    // finishes a key chord from there.
    t.host = [];
    window.addEventListener('keydown', e => t.host.push(e.key));
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
        // File > Save from the menu or a click anywhere else in VS Code
        // takes the focus out of the page first. The editor stayed open, so
        // the save wrote the file without the value and the tab looked saved.
        name: 'leaving the page saves the value being typed',
        csv: 'name,city\nAnna,Berlin\nBen,Oslo\n',
        steps: steps(`
            const ta = await t.type(0, 1, 'TYPED');
            if (!ta) return;
            window.dispatchEvent(new FocusEvent('blur'));
            t.check(t.lastEdit() === 'name,city\\nAnna,TYPED\\nBen,Oslo\\n', 'the edit is sent as the page loses the focus ('
                + JSON.stringify(t.lastEdit()) + ')');
            await t.wait(300);
            t.check(!document.querySelector('#grid-container textarea'), 'the editor is closed');
            t.check(t.sent('edit').length === 1, 'the value is written once (' + t.sent('edit').length + ')');
            // Without an open editor leaving the page writes nothing.
            window.dispatchEvent(new FocusEvent('blur'));
            await t.wait(100);
            t.check(t.sent('edit').length === 1, 'a second blur writes nothing');
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
    {
        // AltGr+S types a letter on some Windows layouts (Polish ś).
        // Chromium can report AltGr as Ctrl+Alt. It closed the editor and
        // wrote the half typed value. The rest of the word started a new one.
        name: 'AltGr+S leaves the editor open',
        csv: 'name,city\nAnna,Berlin\n',
        steps: steps(`
            const ta = await t.type(0, 0, 'Wi');
            if (!ta) return;
            await t.press('ś', { code: 'KeyS', keyCode: 83, ctrlKey: true, altKey: true });
            t.check(t.editor() === ta && ta.value === 'Wi', 'the editor stays open with the value');
            t.check(t.sent('edit').length === 0, 'nothing is written (' + JSON.stringify(t.sent('edit')) + ')');
            // Save All on macOS is Cmd+Option+S.
            await t.press('s', { metaKey: true, altKey: true });
            t.check(t.lastEdit() === 'name,city\\nWi,Berlin\\n', 'Cmd+Option+S still writes it (' + JSON.stringify(t.lastEdit()) + ')');
        `),
    },
    {
        // VS Code's two key chords start with Ctrl+K: Ctrl+K S is Save All
        // on Windows. The page kept the focus, the S went into the cell and
        // VS Code still ran the command.
        name: 'the key after Ctrl+K is left to VS Code in an open cell',
        csv: 'name,city\nAnna,Berlin\nBen,Oslo\n',
        steps: steps(`
            const ta = await t.type(0, 1, 'TYPED');
            if (!ta) return;
            await t.press('k', { ctrlKey: true });
            const s = await t.press('s');
            t.check(s.defaultPrevented, 'the S types nothing');
            t.check(t.host.slice(-2).join(',') === 'k,s', 'VS Code gets both keys (' + t.host.join(',') + ')');
            t.check(t.editor() === ta && ta.value === 'TYPED', 'the editor stays open with the value');
            const next = await t.press('s');
            t.check(!next.defaultPrevented, 'the key after that types again');
            // A modifier pressed on its own does not finish the chord.
            await t.press('k', { ctrlKey: true });
            await t.press('Shift', { shiftKey: true });
            t.check((await t.press('S', { shiftKey: true })).defaultPrevented, 'Ctrl+K Shift+S types nothing either');
            await t.press('k', { ctrlKey: true });
            await t.press('Escape');
            t.check(t.editor() === ta, 'Ctrl+K Escape leaves the editor open');
            await t.press('k', { ctrlKey: true });
            await t.press('Enter');
            t.check(t.editor() === ta, 'Ctrl+K Enter leaves the editor open');
            await t.press('k', { ctrlKey: true });
            await t.press('Enter', { shiftKey: true });
            t.check(ta.value === 'TYPED', 'Ctrl+K Shift+Enter puts no line break in (' + JSON.stringify(ta.value) + ')');
            // Ctrl+K Ctrl+S opens the keyboard shortcuts, it does not save.
            await t.press('k', { ctrlKey: true });
            await t.press('s', { ctrlKey: true });
            t.check(t.editor() === ta && t.sent('edit').length === 0, 'Ctrl+K Ctrl+S leaves the editor open');
            await t.pressEnter();
            t.check(t.lastEdit() === 'name,city\\nAnna,TYPED\\nBen,Oslo\\n', 'Enter writes what was typed ('
                + JSON.stringify(t.lastEdit()) + ')');
        `),
    },
    {
        name: 'the key after Ctrl+K is left to VS Code on a cell',
        csv: 'name,city\nAnna,Berlin\nBen,Oslo\n',
        steps: steps(`
            await t.focusCell(0, 1);
            await t.press('k', { ctrlKey: true }, t.focused());
            const s = await t.press('s', {}, t.focused());
            t.check(s.defaultPrevented && !t.editor(), 'Ctrl+K S opens no editor');
            t.check(t.host.slice(-2).join(',') === 'k,s', 'VS Code gets both keys (' + t.host.join(',') + ')');
            // Each check starts on the focused cell, whatever the one before did.
            if (t.editor()) { await t.press('Escape', {}, t.editor()); await t.focusCell(0, 1); }
            await t.press('k', { ctrlKey: true }, t.focused());
            await t.press('ArrowDown', {}, t.focused());
            t.check(t.focusedRow() === 0, 'Ctrl+K ArrowDown leaves the focus where it was (' + t.focusedRow() + ')');
            if (t.focusedRow() !== 0) await t.focusCell(0, 1);
            await t.press('k', { ctrlKey: true }, t.focused());
            await t.press('c', { ctrlKey: true }, t.focused());
            t.check(t.copied.length === 0, 'Ctrl+K Ctrl+C copies nothing (' + JSON.stringify(t.copied) + ')');
            // VS Code gives the chord up when the focus goes elsewhere.
            await t.press('k', { ctrlKey: true }, t.focused());
            window.dispatchEvent(new FocusEvent('blur'));
            await t.press('x', {}, t.focused());
            t.check(!!t.editor() && t.editor().value === 'x', 'after leaving the page a key types again ('
                + (t.editor() && JSON.stringify(t.editor().value)) + ')');
        `),
    },
    {
        // VS Code gives a pending Ctrl+K up after five seconds. The page
        // went on waiting, so the next key typed was lost however late.
        name: 'the key after Ctrl+K types again once VS Code gave the chord up',
        csv: 'name,city\nAnna,Berlin\nBen,Oslo\n',
        steps: steps(`
            const ta = await t.type(0, 1, 'TYPED');
            if (!ta) return;
            await t.press('k', { ctrlKey: true });
            await t.wait(4500);
            t.check((await t.press('s')).defaultPrevented, 'a key 4.5 s after Ctrl+K is still left to VS Code');
            await t.press('k', { ctrlKey: true });
            await t.wait(5500);
            const x = await t.press('x');
            t.check(!x.defaultPrevented, 'a key 5.5 s after Ctrl+K types');
            t.check(!(await t.press('y')).defaultPrevented, 'the key after that types too');
            t.check(t.editor() === ta, 'the editor stays open');
        `),
    },
    {
        // Ctrl+K Enter is VS Code's Keep Editor. The key after Ctrl+K still
        // acted in the boxes and menus of the page: Enter renamed the column,
        // Escape closed Find.
        name: 'the key after Ctrl+K is left to VS Code in the boxes and menus',
        csv: 'name,city\nAnna,Berlin\nBen,Oslo\n',
        steps: steps(`
            const shown = id => !document.getElementById(id).classList.contains('hidden');
            const click = el => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); return t.wait(200); };
            const chord = async (el, key, extra) => { await t.press('k', { ctrlKey: true }, el); return t.press(key, extra, el); };

            await t.rightClick(t.header(1));
            await click(document.getElementById('col-ctx-rename'));
            const rename = document.getElementById('rename-input');
            rename.value = 'Town';
            await chord(rename, 'Enter');
            await chord(rename, 'Escape');
            t.check(shown('rename-popover'), 'Ctrl+K Enter and Ctrl+K Escape leave the rename box open');
            t.check(t.sent('edit').length === 0, 'the column is not renamed (' + JSON.stringify(t.sent('edit')) + ')');
            await click(document.getElementById('rename-cancel'));

            await click(document.getElementById('btn-find-replace'));
            const find = document.getElementById('find-input');
            find.value = 'e';
            find.dispatchEvent(new Event('input', { bubbles: true }));
            await t.wait(500);
            const count = document.getElementById('find-count').textContent;
            await chord(find, 'Enter');
            t.check(document.getElementById('find-count').textContent === count,
                'Ctrl+K Enter stays on the match (' + count + ', then ' + document.getElementById('find-count').textContent + ')');
            await chord(find, 'Escape');
            t.check(shown('find-bar'), 'Ctrl+K Escape leaves Find open');
            await chord(document.getElementById('replace-input'), 'Escape');
            t.check(shown('find-bar'), 'Ctrl+K Escape in the replace box leaves Find open');
            await click(document.getElementById('find-close'));

            await chord(document.body, 'g', { ctrlKey: true });
            t.check(!shown('goto-popover'), 'Ctrl+K Ctrl+G opens no Go to row');
            await click(document.getElementById('btn-go-to-row'));
            const go = document.getElementById('goto-input');
            go.value = '2';
            await chord(go, 'Enter');
            await chord(go, 'Escape');
            t.check(shown('goto-popover'), 'Ctrl+K Enter and Ctrl+K Escape leave Go to row open');
            await click(document.getElementById('goto-cancel'));

            await t.rightClick(t.header(0));
            await chord(document.body, 'Escape');
            t.check(shown('col-context-menu'), 'Ctrl+K Escape leaves the column menu open');
            await t.press('Escape', {}, document.body);
            t.check(!shown('col-context-menu'), 'Escape on its own still closes it');

            await click(document.getElementById('btn-profile'));
            const search = document.querySelector('.profile-ov-search');
            if (!search) { t.check(false, 'the column profile has its filter box'); return; }
            search.value = 'ci';
            search.dispatchEvent(new Event('input', { bubbles: true }));
            await chord(search, 'Escape');
            t.check(search.value === 'ci', 'Ctrl+K Escape keeps the column profile filter (' + JSON.stringify(search.value) + ')');
        `),
    },
]);
