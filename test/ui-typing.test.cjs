// Browser tests for what the grid tells the extension about a value being
// typed into a cell.
//
// A typed value reached the extension only when the cell was committed with
// Enter, the save key or a click elsewhere. Until then VS Code knew nothing of
// it. Ctrl+W or the tab's close button closed the tab without asking and the
// value was gone. Auto-save and Save All by its key chord saved the file
// without it and the tab looked saved. The grid now says so as soon as the
// value changes, which marks the tab unsaved. When a save asks, the grid hands
// the extension the file with the value in it without closing the cell.
//
// Run after `tsc -p ./`:  node test/ui-typing.test.cjs

const { runSuite } = require('./ui/harness.cjs');

// Shared by every scenario. The steps run inside the page, where these helpers
// are rebuilt from their source, so they must not close over anything.
const HELPERS = `
    t.editor = () => document.querySelector('#grid-container textarea');
    t.open = async (row, col) => {
        await t.focusCell(row, col);
        await t.pressEnter();
        const ta = t.editor();
        if (!ta) t.check(false, 'Enter opens the editor on ' + row + ',' + col);
        return ta;
    };
    t.input = (ta, value) => {
        ta.value = value;
        ta.dispatchEvent(new Event('input', { bubbles: true }));
    };
    t.key = async (el, key, extra) => {
        const ev = new KeyboardEvent('keydown', Object.assign({ key, code: key, bubbles: true, cancelable: true }, extra));
        el.dispatchEvent(ev);
        await t.wait(250);
        return ev;
    };
    // A save in VS Code: the extension asks the page for the value being typed.
    t.flush = async () => {
        window.postMessage({ type: 'flush' }, '*');
        await t.wait(150);
        const f = t.sent('flushed');
        return f[f.length - 1];
    };
    t.ended = () => t.sent('typingEnded');
    // The typing messages in the order sent. The page also says when it has
    // the keyboard, which has nothing to do with them.
    t.order = () => window.__sent.map(m => m.type).filter(ty => ty !== 'ready' && ty !== 'focus').join(',');
    t.sortBy = async (col) => {
        t.header(col).querySelector('.ag-header-cell-label').dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await t.wait(400);
    };
    // A letter pressed on the keyboard: it goes to whatever has the focus
    // and types into a text box unless the page stops it.
    t.typeKey = (ch) => {
        const el = document.activeElement;
        const ev = new KeyboardEvent('keydown', { key: ch, code: 'Key' + ch.toUpperCase(), keyCode: ch.toUpperCase().charCodeAt(0), bubbles: true, cancelable: true });
        el.dispatchEvent(ev);
        if (!ev.defaultPrevented && el.tagName === 'TEXTAREA') {
            el.setRangeText(ch, el.selectionStart, el.selectionEnd, 'end');
            el.dispatchEvent(new Event('input', { bubbles: true }));
        }
        return el;
    };
`;

const steps = (body) => `async (t, csv) => { ${HELPERS} await t.init(csv); ${body} }`;

// A file of more than 1 MB of text. While another editor shows a file this
// large, the grid sends it once the typing pauses instead of with every
// change (multiline-cell-editor.ts).
const BIG = 'name,city\nAnna,Berlin\nBen,Oslo\n'
    + Array.from({ length: 70000 }, (_, i) => `row ${i},city ${i}`).join('\n') + '\n';

runSuite('typing (browser)', [
    // VS Code backs a file up and auto-saves it a moment after the last
    // change it was told of. Told only of the first change, it took a backup
    // or a save about every second in the middle of the typing. Each had the
    // grid write out the whole file.
    {
        name: 'each change of the value is reported',
        csv: 'name,city\nAnna,Berlin\nBen,Oslo\n',
        steps: steps(`
            const ta = await t.open(0, 1);
            if (!ta) return;
            t.check(t.sent('typing').length === 0, 'opening the editor reports nothing');
            t.input(ta, 'Berlin');
            t.check(t.sent('typing').length === 0, 'an input that leaves the value as it was reports nothing');
            t.input(ta, 'Berlinx');
            t.check(t.sent('typing').length === 1, 'the first change is reported (' + t.sent('typing').length + ')');
            t.input(ta, 'Berlinxy');
            t.input(ta, 'Berlin');
            t.check(t.sent('typing').length === 3, 'and every one after it (' + t.sent('typing').length + ')');
            t.input(ta, 'Berlin');
            t.check(t.sent('typing').length === 3, 'but not an input that changes nothing (' + t.sent('typing').length + ')');
            t.check(t.sent('typing').every(m => Object.keys(m).length === 1), 'without the file (' + JSON.stringify(t.sent('typing')) + ')');
            await t.key(ta, 'Escape');
            t.check(!t.editor(), 'Escape closes the editor');
            t.check(t.ended().length === 1 && !('text' in t.ended()[0]), 'the end is reported without a text ('
                + JSON.stringify(t.ended()) + ')');
            t.check(t.sent('edit').length === 0, 'nothing is written');
        `),
    },
    {
        name: 'an editor that opens with a typed letter is reported at once',
        csv: 'name,city\nAnna,Berlin\nBen,Oslo\n',
        steps: steps(`
            await t.focusCell(0, 1);
            await t.key(document.querySelector('#grid-container .ag-cell-focus'), 'x', { code: 'KeyX', keyCode: 88 });
            const ta = t.editor();
            if (!ta) { t.check(false, 'the letter opens the editor'); return; }
            t.check(ta.value === 'x', 'the editor holds the letter (' + JSON.stringify(ta.value) + ')');
            t.check(t.sent('typing').length === 1, 'the change is reported (' + t.sent('typing').length + ')');
            await t.pressEnter();
            t.check(t.lastEdit() === 'name,city\\nAnna,x\\nBen,Oslo\\n', 'Enter writes it (' + JSON.stringify(t.lastEdit()) + ')');
            // The extension drops the mark only after the value has reached it.
            t.check(t.order() === 'typing,edit,typingEnded', 'the end comes after the edit (' + t.order() + ')');
            t.check(!('text' in t.ended()[0]), 'without a text');
        `),
    },
    {
        name: 'a line break is a change',
        csv: 'name,city\nAnna,Berlin\nBen,Oslo\n',
        steps: steps(`
            const ta = await t.open(0, 1);
            if (!ta) return;
            ta.setSelectionRange(6, 6);
            await t.key(ta, 'Enter', { shiftKey: true });
            t.check(ta.value === 'Berlin\\n', 'Shift+Enter puts a break in (' + JSON.stringify(ta.value) + ')');
            t.check(t.sent('typing').length === 1, 'the change is reported (' + t.sent('typing').length + ')');
        `),
    },
    {
        name: 'a save takes the value and leaves the editor open',
        csv: 'name,city\nAnna,Berlin\nBen,Oslo\n',
        steps: steps(`
            const ta = await t.open(0, 1);
            if (!ta) return;
            t.input(ta, 'TYPED');
            const f = await t.flush();
            t.check(!!f && f.text === 'name,city\\nAnna,TYPED\\nBen,Oslo\\n', 'the answer holds the value ('
                + JSON.stringify(f) + ')');
            t.check(t.editor() === ta && ta.value === 'TYPED', 'the editor is still open with the value');
            t.check(document.activeElement === ta, 'and keeps the keyboard');
            t.check(t.sent('edit').length === 0, 'nothing is written into the grid');
            t.check(t.cell(0, 1).textContent === 'Berlin', 'the cell under the editor is unchanged');
            // The save marks the tab saved. The next change has to mark it again.
            t.input(ta, 'TYPED2');
            t.check(t.sent('typing').length === 2, 'the next change is reported again (' + t.sent('typing').length + ')');
            t.input(ta, 'TYPED23');
            t.check(t.sent('typing').length === 3, 'and the one after it (' + t.sent('typing').length + ')');
            const g = await t.flush();
            t.check(!!g && g.text === 'name,city\\nAnna,TYPED23\\nBen,Oslo\\n', 'a second save takes the newer value ('
                + JSON.stringify(g) + ')');
            // Escape gives the value up. The file holds the one the save
            // took, so the extension is told what the grid holds instead.
            await t.key(ta, 'Escape');
            t.check(!t.editor(), 'Escape closes the editor');
            t.check(t.cell(0, 1).textContent === 'Berlin', 'the cell shows the old value');
            t.check(t.ended().length === 1 && t.ended()[0].text === csv, 'the end brings the text the grid holds ('
                + JSON.stringify(t.ended()) + ')');
            t.check(t.sent('edit').length === 0, 'nothing is written');
            t.check(document.getElementById('btn-undo').disabled, 'and there is nothing to undo');
        `),
    },
    {
        name: 'committing after a save writes the value once',
        csv: 'name,city\nAnna,Berlin\nBen,Oslo\n',
        steps: steps(`
            const ta = await t.open(0, 1);
            if (!ta) return;
            t.input(ta, 'TYPED');
            const f = await t.flush();
            await t.pressEnter();
            t.check(t.sent('edit').length === 1 && t.lastEdit() === f.text, 'Enter writes the same text ('
                + JSON.stringify(t.sent('edit')) + ')');
            t.check(t.ended().length === 1 && !('text' in t.ended()[0]), 'the end brings no text of its own ('
                + JSON.stringify(t.ended()) + ')');
            document.getElementById('btn-undo').dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await t.wait(300);
            t.check(t.lastEdit() === csv, 'one undo takes it back (' + JSON.stringify(t.lastEdit()) + ')');
        `),
    },
    {
        name: 'a value typed back after a save is handed over too',
        csv: 'name,city\nAnna,Berlin\nBen,Oslo\n',
        steps: steps(`
            const ta = await t.open(0, 1);
            if (!ta) return;
            t.input(ta, 'TYPED');
            await t.flush();
            // The file holds TYPED now, so the old value is a change again.
            t.input(ta, 'Berlin');
            t.check(t.sent('typing').length === 2, 'the change back is reported (' + t.sent('typing').length + ')');
            const g = await t.flush();
            t.check(!!g && g.text === csv, 'the next save takes the old value back (' + JSON.stringify(g) + ')');
            await t.key(ta, 'Escape');
            t.check(t.ended().length === 1 && !('text' in t.ended()[0]), 'the end then has nothing to add ('
                + JSON.stringify(t.ended()) + ')');
        `),
    },
    {
        name: 'a save with nothing typed gets an empty answer',
        csv: 'name,city\nAnna,Berlin\nBen,Oslo\n',
        steps: steps(`
            let f = await t.flush();
            t.check(!!f && !('text' in f), 'with no editor open (' + JSON.stringify(f) + ')');
            const ta = await t.open(0, 1);
            if (!ta) return;
            f = await t.flush();
            t.check(!!f && !('text' in f), 'with the value unchanged (' + JSON.stringify(f) + ')');
            t.check(t.editor() === ta, 'the editor stays open');
            await t.key(ta, 'Escape');
            t.check(t.ended().length === 0, 'an editor that reported nothing reports no end');
        `),
    },
    {
        name: 'a save answers after a commit already on its way',
        csv: 'name,city\nAnna,Berlin\nBen,Oslo\n',
        steps: steps(`
            const ta = await t.open(0, 1);
            if (!ta) return;
            t.input(ta, 'TYPED');
            // Enter and the save's question in one go: the grid reports the
            // commit a moment later. The answer must not overtake it.
            ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
            window.postMessage({ type: 'flush' }, '*');
            await t.wait(300);
            t.check(t.order() === 'typing,edit,typingEnded,flushed', 'the edit comes before the answer (' + t.order() + ')');
        `),
    },
    // The grid reports that a cell closed a moment after Enter or Tab. A key
    // pressed within those few milliseconds opened the next cell and told
    // the extension of its value first. The late report of the first cell
    // then took the mark off. Auto-save saved the file without the letter
    // and marked the tab saved. Ctrl+W threw the letter away.
    {
        name: 'a letter typed right after Enter keeps the tab marked',
        csv: 'name,city\nAnna,Berlin\nBen,Oslo\n',
        steps: steps(`
            const ta = await t.open(0, 1);
            if (!ta) return;
            t.input(ta, 'ab');
            ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
            document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', code: 'KeyX', keyCode: 88, bubbles: true, cancelable: true }));
            await t.wait(300);
            const tb = t.editor();
            if (!tb || tb.value !== 'x') { t.check(false, 'the letter opens the cell below (' + (tb && JSON.stringify(tb.value)) + ')'); return; }
            const order = t.order().split(',');
            t.check(order.lastIndexOf('typing') > order.lastIndexOf('typingEnded'), 'the extension still knows of the letter (' + t.order() + ')');
            const f = await t.flush();
            t.check(!!f && f.text === 'name,city\\nAnna,ab\\nBen,x\\n', 'a save takes the letter (' + JSON.stringify(f) + ')');
            // The save took the letter, so Escape brings the text the grid holds.
            await t.key(tb, 'Escape');
            const ended = t.ended();
            t.check(t.order().endsWith(',typingEnded') && ended[ended.length - 1].text === 'name,city\\nAnna,ab\\nBen,Oslo\\n',
                'Escape in the cell below ends the report and gives the letter up (' + t.order() + ')');
        `),
    },
    {
        name: 'a value typed right after Tab keeps the tab marked',
        csv: 'name,city\nAnna,Berlin\nBen,Oslo\n',
        steps: steps(`
            const ta = await t.open(0, 0);
            if (!ta) return;
            t.input(ta, 'ab');
            ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', keyCode: 9, bubbles: true, cancelable: true }));
            const tb = t.editor();
            if (!tb || tb === ta) { t.check(false, 'Tab opens the next cell'); return; }
            t.input(tb, 'x');
            await t.wait(300);
            const order = t.order().split(',');
            t.check(order.lastIndexOf('typing') > order.lastIndexOf('typingEnded'), 'the extension still knows of the value (' + t.order() + ')');
            const f = await t.flush();
            t.check(!!f && f.text === 'name,city\\nab,x\\nBen,Oslo\\n', 'a save takes the value (' + JSON.stringify(f) + ')');
        `),
    },
    {
        name: 'with another editor a letter typed right after Enter is sent',
        csv: 'name,city\nAnna,Berlin\nBen,Oslo\n',
        steps: steps(`
            window.postMessage({ type: 'shared', value: true }, '*');
            await t.wait(50);
            const ta = await t.open(0, 1);
            if (!ta) return;
            t.input(ta, 'ab');
            ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
            document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', code: 'KeyX', keyCode: 88, bubbles: true, cancelable: true }));
            await t.wait(300);
            if (!t.editor() || t.editor().value !== 'x') { t.check(false, 'the letter opens the cell below'); return; }
            const sent = t.sent('typedText');
            t.check(sent.length > 0 && sent[sent.length - 1].text === 'name,city\\nAnna,ab\\nBen,x\\n', 'the file with the letter is sent ('
                + JSON.stringify(sent) + ')');
        `),
    },
    // Tab opens the next cell with its value selected. A moment later the
    // grid puts the focus back on that cell, beside the editor. The editor
    // took it back only after another moment. A key pressed in between went
    // nowhere and the editor kept the old value selected.
    {
        name: 'a letter typed while the grid puts the focus on the cell after Tab is typed',
        csv: 'name,city\nAnna,Berlin\nBen,Oslo\n',
        steps: steps(`
            const ta = await t.open(0, 0);
            if (!ta) return;
            t.input(ta, 'ab');
            // The key comes right after the focus left the next cell's
            // editor for the cell, the earliest a key can come.
            let typedInto = null;
            document.addEventListener('blur', e => {
                if (typedInto || e.target === ta || !(e.target instanceof HTMLTextAreaElement)) return;
                typedInto = 'pending';
                setTimeout(() => { typedInto = t.typeKey('x'); });
            }, true);
            ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', keyCode: 9, bubbles: true, cancelable: true }));
            await t.wait(300);
            if (!typedInto) { t.check(false, 'the grid did not move the focus to the cell'); return; }
            const tb = t.editor();
            t.check(!!tb && tb.value === 'x', 'the letter replaces the value (' + (tb && JSON.stringify(tb.value)) + ', typed into '
                + (typedInto.tagName || typedInto) + ')');
            t.check(document.activeElement === tb, 'the editor has the keyboard');
        `),
    },
    {
        name: 'a save finds the row in a sorted view',
        csv: 'name,city\nAnna,Oslo\nBen,Berlin\nCleo,Paris\n',
        steps: steps(`
            await t.sortBy(1);
            t.check(t.cell(0, 1).textContent === 'Berlin', 'Berlin is on top');
            const ta = await t.open(0, 1);
            if (!ta) return;
            t.input(ta, 'X');
            const f = await t.flush();
            t.check(!!f && f.text === 'name,city\\nAnna,Oslo\\nBen,X\\nCleo,Paris\\n', 'the value goes to Ben ('
                + JSON.stringify(f) + ')');
        `),
    },
    {
        name: 'a save finds the row in a filtered view',
        csv: 'name,city\nAnna,Oslo\nBen,Berlin\nCleo,Paris\n',
        steps: steps(`
            t.click(t.header(1).querySelector('.ag-header-cell-filter-button, .ag-header-cell-menu-button'));
            await t.wait(300);
            const row = [...document.querySelectorAll('.csv-filter-value-row')].find(r => r.textContent === 'Oslo');
            if (!row) { t.check(false, 'the filter lists Oslo'); return; }
            const cb = row.querySelector('input');
            cb.checked = false;
            cb.dispatchEvent(new Event('change'));
            await t.wait(300);
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            await t.wait(200);
            t.check(t.cell(0, 1).textContent === 'Berlin', 'Oslo is filtered out');
            const ta = await t.open(0, 1);
            if (!ta) return;
            t.input(ta, 'X');
            const f = await t.flush();
            t.check(!!f && f.text === 'name,city\\nAnna,Oslo\\nBen,X\\nCleo,Paris\\n', 'the value goes to Ben ('
                + JSON.stringify(f) + ')');
        `),
    },
    {
        name: 'a save finds a frozen row',
        csv: 'name,city\nAnna,Berlin\nBen,Oslo\n',
        steps: steps(`
            const r = t.cell(1, 0).getBoundingClientRect();
            t.cell(1, 0).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 5, clientY: r.top + 5 }));
            await t.wait(200);
            const item = [...document.querySelectorAll('#row-context-menu .row-ctx-item')].find(i => i.textContent === 'Freeze row');
            if (!item) { t.check(false, 'the row menu offers Freeze row'); return; }
            item.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await t.wait(300);
            const frozen = document.querySelector('#grid-container .ag-floating-top .ag-cell[col-id="col_1"]');
            t.check(!!frozen && frozen.textContent === 'Oslo', 'Ben is frozen');
            ['mousedown', 'mouseup', 'click'].forEach(ty => frozen.dispatchEvent(new MouseEvent(ty, { bubbles: true, button: 0 })));
            await t.wait(200);
            await t.pressEnter();
            const ta = t.editor();
            if (!ta) { t.check(false, 'Enter opens the editor on the frozen cell'); return; }
            t.input(ta, 'Rome');
            const f = await t.flush();
            t.check(!!f && f.text === 'name,city\\nAnna,Berlin\\nBen,Rome\\n', 'the frozen row gets the value ('
                + JSON.stringify(f) + ')');
        `),
    },
    {
        name: 'a save leaves the column letters of a file without a header out',
        csv: 'Anna,Berlin\nBen,Oslo\n',
        steps: `async (t, csv) => { ${HELPERS}
            window.postMessage({ type: 'init', text: csv, delimiter: ',', firstRowIsHeader: false }, '*');
            await t.wait(900);
            t.check(t.cell(1, 1).textContent === 'Oslo', 'the first row of the file is a row');
            const ta = await t.open(1, 1);
            if (!ta) return;
            t.input(ta, 'X');
            const f = await t.flush();
            t.check(!!f && f.text === 'Anna,Berlin\\nBen,X\\n', 'the file gets the value and no letters ('
                + JSON.stringify(f) + ')');
        }`,
    },
    // A Source Control diff closes without asking while the file's grid tab
    // is open. Neither Ctrl+W nor the close button takes the focus out of
    // the page. The value typed in the diff was lost. While another editor
    // shows the file, the grid sends the extension the file with the value
    // in it, which the extension hands to the other editor when this one
    // closes.
    {
        name: 'a lone editor does not write out the file while a value is typed',
        csv: 'name,city\nAnna,Berlin\nBen,Oslo\n',
        steps: steps(`
            const ta = await t.open(0, 1);
            if (!ta) return;
            t.input(ta, 'TYPED');
            await t.wait(1000);
            t.check(t.sent('typedText').length === 0, 'the file was sent for nobody (' + t.sent('typedText').length + ')');
        `),
    },
    // The diff's close button can be clicked right after the last key. The
    // value typed was lost when the pause before the grid sent it had not
    // run out yet.
    {
        name: 'with another editor on a small file the value is sent with every change',
        csv: 'name,city\nAnna,Berlin\nBen,Oslo\n',
        steps: steps(`
            window.postMessage({ type: 'shared', value: true }, '*');
            await t.wait(50);
            const ta = await t.open(0, 1);
            if (!ta) return;
            // Sent right after the key, not after a pause.
            t.input(ta, 'T');
            await t.wait(1);
            let sent = t.sent('typedText');
            t.check(sent.length === 1 && sent[0].text === 'name,city\\nAnna,T\\nBen,Oslo\\n', 'the first change is sent at once ('
                + JSON.stringify(sent) + ')');
            t.input(ta, 'TY');
            await t.wait(1);
            sent = t.sent('typedText');
            t.check(sent.length === 2 && sent[1].text === 'name,city\\nAnna,TY\\nBen,Oslo\\n', 'and the next one ('
                + JSON.stringify(sent) + ')');
            t.input(ta, 'Berlin');
            await t.wait(1);
            sent = t.sent('typedText');
            t.check(sent.length === 3 && !('text' in sent[2]), 'the value typed back to the cell is sent at once without a text ('
                + JSON.stringify(sent) + ')');
            t.input(ta, 'X');
            await t.wait(500);
            t.check(t.sent('typedText').length === 4, 'and nothing again after the pause (' + t.sent('typedText').length + ')');
            await t.flush();
            await t.wait(500);
            t.check(t.sent('typedText').length === 4, 'the value a save took is not sent again (' + t.sent('typedText').length + ')');
            t.check(t.editor() === ta && document.activeElement === ta, 'the editor stays open and keeps the keyboard');
            t.check(t.sent('edit').length === 0, 'nothing is written into the grid');
        `),
    },
    {
        name: 'with another editor on a small file a letter that opens the editor is sent at once',
        csv: 'name,city\nAnna,Berlin\nBen,Oslo\n',
        steps: steps(`
            window.postMessage({ type: 'shared', value: true }, '*');
            await t.wait(50);
            await t.focusCell(0, 1);
            document.querySelector('#grid-container .ag-cell-focus').dispatchEvent(new KeyboardEvent('keydown',
                { key: 'x', code: 'KeyX', keyCode: 88, bubbles: true, cancelable: true }));
            await t.wait(1);
            if (!t.editor()) { t.check(false, 'the letter opens the editor'); return; }
            const sent = t.sent('typedText');
            t.check(sent.length === 1 && sent[0].text === 'name,city\\nAnna,x\\nBen,Oslo\\n', 'the value is sent ('
                + JSON.stringify(sent) + ')');
        `),
    },
    {
        name: 'with another editor on a large file the value is sent once the typing pauses',
        csv: BIG,
        steps: steps(`
            window.postMessage({ type: 'shared', value: true }, '*');
            await t.wait(50);
            const ta = await t.open(0, 1);
            if (!ta) return;
            t.input(ta, 'T');
            await t.wait(100);
            t.input(ta, 'TY');
            await t.wait(100);
            t.check(t.sent('typedText').length === 0, 'the file was written out with every key ('
                + t.sent('typedText').length + ')');
            await t.wait(500);
            const sent = t.sent('typedText');
            t.check(sent.length === 1 && sent[0].text === csv.replace('Anna,Berlin', 'Anna,TY'), 'the file with the value is sent once ('
                + JSON.stringify(sent.map(m => m.text && m.text.slice(0, 40))) + ')');
            t.check(t.editor() === ta && document.activeElement === ta, 'the editor stays open and keeps the keyboard');
            t.check(t.sent('edit').length === 0, 'nothing is written into the grid');
            t.check(t.cell(0, 1).textContent === 'Berlin', 'the cell under the editor is unchanged');
        `),
    },
    {
        name: 'a key with Ctrl sends the value at once',
        csv: BIG,
        steps: `async (t, csv) => { ${HELPERS}
            window.postMessage({ type: 'init', text: csv, delimiter: ',', shared: true }, '*');
            await t.wait(900);
            const ta = await t.open(0, 1);
            if (!ta) return;
            t.input(ta, 'X');
            // Ctrl+W closes the diff right away, before any pause.
            ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', code: 'KeyW', keyCode: 87, ctrlKey: true, bubbles: true, cancelable: true }));
            const sent = t.sent('typedText');
            t.check(sent.length === 1 && sent[0].text === csv.replace('Anna,Berlin', 'Anna,X'), 'the value is sent before the key reaches VS Code ('
                + JSON.stringify(sent.map(m => m.text && m.text.slice(0, 40))) + ')');
            await t.wait(600);
            t.check(t.sent('typedText').length === 1, 'and not again after the pause (' + t.sent('typedText').length + ')');
        }`,
    },
    // With the extension on another machine every message goes over the
    // network. The whole file sent with every key queued up there and a
    // save waited seconds behind it on a slow upload. So the grid waits for
    // the pause then, whatever the size of the file.
    {
        name: 'with another editor and the extension on another machine a small file is sent once the typing pauses',
        csv: 'name,city\nAnna,Berlin\nBen,Oslo\n',
        steps: `async (t, csv) => { ${HELPERS}
            window.postMessage({ type: 'init', text: csv, delimiter: ',', shared: true, remote: true }, '*');
            await t.wait(900);
            const ta = await t.open(0, 1);
            if (!ta) return;
            t.input(ta, 'T');
            await t.wait(100);
            t.input(ta, 'TY');
            await t.wait(100);
            t.check(t.sent('typedText').length === 0, 'the file was sent with every key (' + t.sent('typedText').length + ')');
            await t.wait(500);
            const sent = t.sent('typedText');
            t.check(sent.length === 1 && sent[0].text === 'name,city\\nAnna,TY\\nBen,Oslo\\n', 'the file with the value is sent once ('
                + JSON.stringify(sent) + ')');
            // Ctrl+W closes the diff right away, before any pause.
            t.input(ta, 'TYX');
            ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', code: 'KeyW', keyCode: 87, ctrlKey: true, bubbles: true, cancelable: true }));
            const now = t.sent('typedText');
            t.check(now.length === 2 && now[1].text === 'name,city\\nAnna,TYX\\nBen,Oslo\\n', 'a key with Ctrl does not send the value at once ('
                + JSON.stringify(now) + ')');
        }`,
    },
    {
        name: 'a value typed back to the cell\'s own is sent without a text',
        csv: 'name,city\nAnna,Berlin\nBen,Oslo\n',
        steps: steps(`
            window.postMessage({ type: 'shared', value: true }, '*');
            await t.wait(50);
            const ta = await t.open(0, 1);
            if (!ta) return;
            t.input(ta, 'X');
            await t.wait(500);
            t.input(ta, 'Berlin');
            await t.wait(500);
            const sent = t.sent('typedText');
            t.check(sent.length === 2 && 'text' in sent[0] && !('text' in sent[1]), 'the second report has no text ('
                + JSON.stringify(sent) + ')');
        `),
    },
    {
        name: 'nothing is sent once the cell is closed',
        csv: BIG,
        steps: steps(`
            window.postMessage({ type: 'shared', value: true }, '*');
            await t.wait(50);
            const ta = await t.open(0, 1);
            if (!ta) return;
            t.input(ta, 'X');
            await t.key(ta, 'Escape');
            await t.wait(500);
            t.check(t.sent('typedText').length === 0, 'a value given up was sent (' + JSON.stringify(t.sent('typedText')) + ')');
            window.postMessage({ type: 'shared', value: false }, '*');
            const tb = await t.open(1, 1);
            if (!tb) return;
            t.input(tb, 'Y');
            await t.wait(500);
            t.check(t.sent('typedText').length === 0, 'the file was sent after the other editor closed');
        `),
    },
    {
        name: 'an editor told of another editor while a value is typed sends it',
        csv: 'name,city\nAnna,Berlin\nBen,Oslo\n',
        steps: steps(`
            const ta = await t.open(0, 1);
            if (!ta) return;
            t.input(ta, 'X');
            window.postMessage({ type: 'shared', value: true }, '*');
            await t.wait(500);
            const sent = t.sent('typedText');
            t.check(sent.length === 1 && sent[0].text === 'name,city\\nAnna,X\\nBen,Oslo\\n', 'the value was not sent ('
                + JSON.stringify(sent) + ')');
        `),
    },
    {
        name: 'a save that takes the value leaves nothing to send',
        csv: BIG,
        steps: steps(`
            window.postMessage({ type: 'shared', value: true }, '*');
            await t.wait(50);
            const ta = await t.open(0, 1);
            if (!ta) return;
            t.input(ta, 'X');
            await t.flush();
            await t.wait(500);
            t.check(t.sent('typedText').length === 0, 'the value the save took was sent again ('
                + JSON.stringify(t.sent('typedText')) + ')');
        `),
    },
    {
        name: 'an outside change that rebuilds the grid ends the report',
        csv: 'name,city\nAnna,Berlin\nBen,Oslo\n',
        steps: steps(`
            const ta = await t.open(0, 1);
            if (!ta) return;
            t.input(ta, 'TYPED');
            await t.flush();
            // Another column, so the grid is built anew and the editor goes.
            window.postMessage({ type: 'update', text: 'name,city,zip\\nAnna,Berlin,1\\nBen,Oslo,2\\n' }, '*');
            await t.wait(500);
            t.check(!t.editor(), 'the editor is gone');
            t.check(t.ended().length === 1 && t.ended()[0].text === 'name,city,zip\\nAnna,Berlin,1\\nBen,Oslo,2\\n',
                'the end is reported with the text the grid holds (' + JSON.stringify(t.ended()) + ')');
        `),
    },
]);
