// Browser tests for the settings menu and the checkbox mode (issue #41).
//
// These drive the real webview in headless Chrome (test/ui/harness.cjs): open
// the gear, flip a switch, look at what the grid draws and at what it sends to
// the extension. Two promises are checked throughout. A switch changes the
// view and nothing else, so no switch may ever send an edit. And the file's
// values come back exactly as they were read, spaces around them included.
//
// Run after `tsc -p ./`:  node test/ui-settings.test.cjs

const { runSuite } = require('./ui/harness.cjs');

const CITIES = [
    'city,active,amount,note',
    ' Berlin ,true,12,',
    'Hanoi,false,7,x',
    'Paris,true,1500,',
].join('\n');

// Padding in a header, before a value, after a value and in front of a value
// with a line break in it. The last header has a line break of its own.
const PADDED = [
    '    city,n,"  top\nbottom"',
    '     Berlin,1,a',
    'Berlin,2,b',
    'Berlin     ,3,c',
    '"  Ber\nlin",4,d',
].join('\n');

// Where the browser draws text, which is what the spaces switch is about. A
// value can hold its spaces while the browser draws them zero wide, so reading
// textContent alone proves nothing. Runs in the page.
const DRAWN = `
    // x of the first "letter" inside el, from el's left edge. null if absent.
    t.xOf = (el, letter) => {
        const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        for (let n = w.nextNode(); n; n = w.nextNode()) {
            const i = n.data.indexOf(letter);
            if (i < 0) continue;
            const r = document.createRange();
            r.setStart(n, i);
            r.setEnd(n, i + 1);
            return r.getBoundingClientRect().left - el.getBoundingClientRect().left;
        }
        return null;
    };
    // y of the first "letter" inside el, from el's top edge.
    t.yOf = (el, letter) => {
        const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        for (let n = w.nextNode(); n; n = w.nextNode()) {
            const i = n.data.indexOf(letter);
            if (i < 0) continue;
            const r = document.createRange();
            r.setStart(n, i);
            r.setEnd(n, i + 1);
            return r.getBoundingClientRect().top - el.getBoundingClientRect().top;
        }
        return null;
    };
    // How wide the text inside el is drawn, spaces included where they show.
    t.drawnWidth = el => {
        const r = document.createRange();
        r.selectNodeContents(el);
        return r.getBoundingClientRect().width;
    };
`;

const BOOLEANS = [
    'name,active,sub,flag,tf,sw,num,note',
    'a,true,Yes,Y,T,ON,1,alpha',
    'b,FALSE,no,N,f,off,0,beta',
    'c,True,YES,y,t,On,1,gamma',
    'd,false,No,N,T,OFF,0,delta',
    'e,TRUE,yes,Y,f,on,1,epsilon',
    'f,false,no,n,T,off,0,zeta',
    'g,true,Yes,Y,t,On,1,eta',
    'h,False,No,N,f,OFF,0,theta',
    'i,,yes,Y,T,on,1,iota',
    'j,unknown,no,N,f,off,0,kappa',
].join('\n');

runSuite('settings menu (browser)', [
    {
        name: 'defaults',
        csv: CITIES,
        steps: async (t, csv) => {
            await t.init(csv);
            t.check(!!document.getElementById('btn-settings'), 'the toolbar has a gear');
            t.check(!document.getElementById('btn-colormode'), 'the color button left the toolbar for the menu');
            t.check(!document.getElementById('btn-settings').classList.contains('btn-active'),
                'the gear is unmarked while everything is at its default');
            const c = t.container().classList;
            t.check(!c.contains('cm-on') && !c.contains('row-focus-off') && !c.contains('type-badges-off'),
                'the grid looks the way it did before the menu existed');
            const label = t.header(2).querySelector('.ag-header-cell-label');
            t.check(getComputedStyle(label, '::before').content.includes('123'), 'type badges show by default');
            t.check(t.cell(0, 0).textContent === 'Berlin', 'spaces around a value are hidden by default ("'
                + t.cell(0, 0).textContent + '")');

            await t.openSettings();
            const items = document.querySelectorAll('#settings-list .settings-item');
            const groups = [...document.querySelectorAll('#settings-list .settings-group')].map(g => g.textContent);
            // Eight settings every file shares, and above them the one that
            // belongs to this file alone, "First row is the header".
            t.check(items.length === 9, 'the menu has nine switches (' + items.length + ')');
            t.check(groups.join('|') === 'This file|View|Editing', 'grouped as This file, View and Editing ('
                + groups.join('|') + ')');
            t.check([...items].every(i => i.querySelector('.settings-item-hint').textContent.length > 15),
                'every switch says what it does');
            t.check(t.sent('edit').length === 0, 'opening a file and the menu wrote nothing');
        },
    },
    {
        name: 'each switch',
        csv: CITIES,
        steps: async (t, csv) => {
            await t.init(csv);
            const changed = key => t.sent('settingChanged').filter(m => m.key === key).map(m => m.value).join(',');

            await t.setSetting('colorMode', true);
            t.check(t.container().classList.contains('cm-on'), 'Color columns tints the columns');
            t.check(changed('colorMode') === 'true', 'Color columns is remembered (' + changed('colorMode') + ')');
            t.check(document.getElementById('btn-settings').classList.contains('btn-active'),
                'the gear is marked once something differs from the default');
            await t.setSetting('colorMode', false);

            const rowWash = () => getComputedStyle(document.querySelector('#grid-container .ag-row.ag-row-focus')).backgroundImage;
            await t.focusCell(1, 0);
            t.check(rowWash().includes('gradient'), 'the row you are on is washed by default');
            await t.setSetting('rowHighlight', false);
            await t.focusCell(1, 0);
            t.check(rowWash() === 'none', 'Highlight the current row off takes the wash away');
            await t.setSetting('rowHighlight', true);
            await t.focusCell(1, 0);
            t.check(rowWash().includes('gradient'), 'and on brings it back');

            await t.setSetting('typeBadges', false);
            const label = t.header(2).querySelector('.ag-header-cell-label');
            t.check(getComputedStyle(label, '::before').content === 'none', 'Type badges off hides the badge');
            await t.setSetting('typeBadges', true);
            t.check(getComputedStyle(label, '::before').content.includes('123'), 'and on brings it back');

            await t.setSetting('alignNumbers', true);
            t.check(t.cell(0, 2).classList.contains('csv-num-cell')
                && getComputedStyle(t.cell(0, 2)).textAlign === 'right', 'Align numbers puts a number column on the right');
            t.check(!t.cell(0, 0).classList.contains('csv-num-cell'), 'a text column stays on the left');
            await t.setSetting('alignNumbers', false);
            t.check(!t.cell(0, 2).classList.contains('csv-num-cell'), 'and off puts it back');

            await t.setSetting('markEmpty', true);
            t.check(t.cell(0, 3).classList.contains('csv-empty-cell'), 'Mark empty cells marks an empty cell');
            t.check(getComputedStyle(t.cell(0, 3), '::after').backgroundImage.includes('gradient'),
                'the mark is drawn as a hatch');
            t.check(!t.cell(1, 3).classList.contains('csv-empty-cell'), 'a filled cell is left alone');
            await t.setSetting('markEmpty', false);
            t.check(!t.cell(0, 3).classList.contains('csv-empty-cell'), 'and off removes the marks');

            await t.setSetting('trimDisplay', false);
            t.check(t.cell(0, 0).textContent === ' Berlin ', 'Hide spaces off shows the value as the file has it ("'
                + t.cell(0, 0).textContent + '")');
            await t.setSetting('trimDisplay', true);
            t.check(t.cell(0, 0).textContent === 'Berlin', 'and on hides them again');

            // Opening and committing an editor sends no edit when the value is
            // unchanged, so this does not disturb the no-edit check below.
            await t.focusCell(0, 3);
            await t.pressEnter();
            await t.pressEnter();
            t.check(t.focusedRow() === 1, 'Enter after editing moves down by default (row ' + t.focusedRow() + ')');
            await t.setSetting('enterMovesDown', false);
            await t.focusCell(0, 3);
            await t.pressEnter();
            await t.pressEnter();
            t.check(t.focusedRow() === 0, 'Enter moves down off keeps you in the cell (row ' + t.focusedRow() + ')');
            t.check(changed('enterMovesDown') === 'false', 'and is remembered');

            t.check(t.sent('edit').length === 0, 'no switch wrote anything to the file ('
                + t.sent('edit').length + ' edits)');
        },
    },
    {
        name: 'spaces shown are drawn',
        csv: PADDED,
        settings: { trimDisplay: false },
        // Wrap cell text stays off, its default. A line that does not wrap
        // drops the spaces at its start and end, so the cells held their
        // padding and drew it zero wide.
        steps: `async (t, csv) => {
            ${DRAWN}
            await t.init(csv);
            const padded = t.xOf(t.cell(0, 0), 'B'), plain = t.xOf(t.cell(1, 0), 'B');
            t.check(padded - plain > 10, 'five spaces push the word to the right (B at ' + padded + ' against ' + plain + ')');
            const trailing = t.drawnWidth(t.cell(2, 0)), bare = t.drawnWidth(t.cell(1, 0));
            t.check(trailing - bare > 10, 'spaces after a value take room too (' + trailing + ' against ' + bare + ')');

            const head = t.header(0).querySelector('.ag-header-cell-text');
            t.check(t.xOf(head, 'c') > 8, 'the header draws its spaces (c at ' + t.xOf(head, 'c') + ')');
            const multi = t.header(2).querySelector('.ag-header-cell-text');
            const size = parseFloat(getComputedStyle(multi).fontSize);
            t.check(multi.getBoundingClientRect().height < size * 1.8 && t.xOf(multi, 't') > 4,
                'a header with a line break keeps to one line and shows its spaces ('
                + multi.getBoundingClientRect().height + 'px high, t at ' + t.xOf(multi, 't') + ')');

            const cell = t.cell(3, 0);
            t.check(Math.abs(t.yOf(cell, 'l') - t.yOf(cell, 'B')) < 2 && t.xOf(cell, 'B') - plain > 4,
                'a value with a line break stays on one line with its spaces (B at y ' + t.yOf(cell, 'B')
                + ', l at y ' + t.yOf(cell, 'l') + ')');
            document.getElementById('btn-wraptext').dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await t.wait(400);
            const wrapped = t.cell(3, 0);
            t.check(t.yOf(wrapped, 'l') - t.yOf(wrapped, 'B') > 5, 'with Wrap cell text on the break is a real one ('
                + t.yOf(wrapped, 'B') + ' and ' + t.yOf(wrapped, 'l') + ')');
            document.getElementById('btn-wraptext').dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await t.wait(400);
            t.check(Math.abs(t.yOf(t.cell(3, 0), 'l') - t.yOf(t.cell(3, 0), 'B')) < 2, 'and off again it is back on one line');

            t.click(t.header(0).querySelector('.ag-header-cell-filter-button, .ag-header-cell-menu-button'));
            await t.wait(300);
            const labels = [...document.querySelectorAll('.csv-filter-value-label')];
            const lab = text => labels.find(l => l.textContent === text);
            t.check(!!lab('     Berlin') && !!lab('Berlin'), 'the value filter lists the padded value apart');
            if (lab('     Berlin') && lab('Berlin')) {
                t.check(t.drawnWidth(lab('     Berlin')) - t.drawnWidth(lab('Berlin')) > 10,
                    'and draws it with its spaces, so the two do not look the same');
            }
            // A value with a line break shows its first line and an ellipsis.
            // A label only as wide as that line had no room for the ellipsis.
            // The browser dropped the word to make some.
            const two = lab('  Ber\\nlin');
            if (two) {
                const r = document.createRange();
                r.setStart(two.firstChild, 0);
                r.setEnd(two.firstChild, 5);
                const line = r.getBoundingClientRect().width;
                t.check(two.clientWidth > line + 10 && t.yOf(two, 'B') < 4, 'a listed value with a line break keeps its first line in view ('
                    + two.clientWidth + ' wide for a ' + line + ' line)');
            } else {
                t.check(false, 'the value filter lists the value with a line break');
            }
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            await t.wait(200);

            document.getElementById('btn-columns').dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await t.wait(200);
            const name = [...document.querySelectorAll('.col-chooser-label')].find(l => l.textContent === '    city');
            t.check(!!name && t.xOf(name, 'c') > 8, 'the column chooser draws the spaces of a name ('
                + (name && t.xOf(name, 'c')) + ')');
            document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            await t.wait(100);

            await t.setSetting('trimDisplay', true);
            t.check(Math.abs(t.xOf(t.cell(0, 0), 'B') - t.xOf(t.cell(1, 0), 'B')) < 1, 'switched back on, the spaces are gone');
            t.check(t.xOf(t.header(0).querySelector('.ag-header-cell-text'), 'c') < 2, 'from the header too');
        }`,
    },
    {
        name: 'auto-fit makes room for the spaces shown',
        // The padded value sits far below the first screen, where the check
        // auto-fit runs on the drawn cells cannot see it, so the measurement
        // alone has to get it right.
        csv: ['city,n'].concat(Array.from({ length: 80 }, (_, i) =>
            (i === 70 ? ' '.repeat(40) + 'Berlin' : 'Paris') + ',' + i)).join('\n'),
        settings: { trimDisplay: false },
        steps: `async (t, csv) => {
            ${DRAWN}
            await t.init(csv);
            document.getElementById('btn-autofit').dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await t.wait(1500);
            const viewport = document.querySelector('#grid-container .ag-body-viewport');
            viewport.scrollTop = 100000;
            viewport.dispatchEvent(new Event('scroll'));
            await t.wait(500);
            const cell = t.cell(70, 0);
            t.check(!!cell && t.xOf(cell, 'B') > 60, 'the spaces are drawn (B at ' + (cell && t.xOf(cell, 'B')) + ')');
            t.check(!!cell && cell.scrollWidth <= cell.clientWidth, 'and the column is wide enough for them ('
                + (cell && cell.scrollWidth) + ' in ' + (cell && cell.clientWidth) + ')');
        }`,
    },
    {
        name: 'remembered settings',
        csv: CITIES,
        settings: { colorMode: true, typeBadges: false, alignNumbers: true },
        steps: async (t, csv) => {
            await t.init(csv);
            const c = t.container().classList;
            t.check(c.contains('cm-on'), 'a remembered Color columns is on at open');
            t.check(c.contains('type-badges-off'), 'a remembered Type badges off is off at open');
            t.check(t.cell(0, 2).classList.contains('csv-num-cell'), 'a remembered Align numbers is on at open');
            t.check(document.getElementById('btn-settings').classList.contains('btn-active'), 'the gear shows it');
            await t.openSettings();
            t.check(t.settingBox('colorMode').checked && !t.settingBox('typeBadges').checked,
                'the menu shows the remembered state');
        },
    },
    {
        name: 'spaces survive an edit',
        csv: CITIES,
        steps: async (t, csv) => {
            // The bug the trim switch came with: values were trimmed as the file
            // was read, so the first edit anywhere wrote every padded value back
            // without its spaces.
            await t.init(csv);
            await t.setSetting('boolCheckboxes', true);
            t.click(t.box(1, 1));
            await t.wait(250);
            const lines = (t.lastEdit() || '').split('\n');
            t.check(lines[2] === 'Hanoi,true,7,x', 'the edit itself landed (' + lines[2] + ')');
            t.check(lines[1] === ' Berlin ,true,12,', 'a padded value in another row keeps its spaces ("' + lines[1] + '")');
        },
    },
    {
        name: 'checkboxes',
        csv: BOOLEANS,
        steps: async (t, csv) => {
            await t.init(csv);
            t.check(t.boxesIn(1) === 0, 'off by default');
            await t.setSetting('boolCheckboxes', true);
            t.check(t.boxesIn(1) === 8, 'true/false: a box per known word (' + t.boxesIn(1) + ')');
            t.check(t.boxesIn(2) === 10 && t.boxesIn(3) === 10 && t.boxesIn(4) === 10 && t.boxesIn(5) === 10,
                'yes/no, y/n, t/f and on/off all get boxes');
            t.check(t.boxesIn(6) === 0 && t.boxesIn(7) === 0, 'numbers and text get none');
            t.check(!t.box(8, 1) && t.cell(8, 1).textContent === '', 'an empty cell stays empty');
            t.check(!t.box(9, 1) && t.cell(9, 1).textContent === 'unknown', 'a value a box cannot say keeps its text');
            t.check(t.box(0, 1).classList.contains('csv-bool-box--on') && !t.box(1, 1).classList.contains('csv-bool-box--on'),
                'true is ticked and FALSE is not');

            // Drawn in the cell's text color, the one color every theme keeps
            // readable against the cell. Theme checkbox colors were not.
            const cellColor = getComputedStyle(t.cell(1, 1)).color;
            t.check(getComputedStyle(t.box(1, 1)).borderTopColor === cellColor, 'an empty box is outlined in the text color');
            t.check(getComputedStyle(t.box(0, 1)).backgroundColor === cellColor, 'a ticked box is filled with the text color');

            t.click(t.box(0, 2));
            await t.wait(200);
            t.check(t.lastEdit().split('\n')[1] === 'a,true,No,Y,T,ON,1,alpha', 'Yes flips to No, not false');
            t.click(t.box(1, 3));
            await t.wait(200);
            t.check(t.lastEdit().split('\n')[2] === 'b,FALSE,no,Y,f,off,0,beta', 'N flips to Y');
            t.click(t.box(4, 5));
            await t.wait(200);
            t.check(t.lastEdit().split('\n')[5] === 'e,TRUE,yes,Y,f,off,1,epsilon', 'on flips to off, case kept');

            document.getElementById('btn-undo').dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await t.wait(500);
            t.check(t.lastEdit().split('\n')[5] === 'e,TRUE,yes,Y,f,on,1,epsilon', 'undo takes a click back');
            t.check(!!t.box(4, 5) && t.box(4, 5).classList.contains('csv-bool-box--on'), 'and the box follows the undo');

            const b = t.box(2, 2);
            ['mousedown', 'click'].forEach(ty => b.dispatchEvent(new MouseEvent(ty, { bubbles: true, detail: 1 })));
            ['mousedown', 'click', 'dblclick'].forEach(ty => b.dispatchEvent(new MouseEvent(ty, { bubbles: true, detail: 2 })));
            await t.wait(300);
            t.check(!document.querySelector('#grid-container .ag-cell textarea'), 'a double-click on a box opens no editor');
            t.check(t.lastEdit().split('\n')[3] === 'c,True,NO,y,t,On,1,gamma', 'and flips once, not twice');

            const edits = t.sent('edit').length;
            await t.setSetting('boolCheckboxes', false);
            t.check(t.boxesIn(2) === 0 && t.sent('edit').length === edits, 'switching off brings the words back and writes nothing');
        },
    },
    {
        name: 'checkboxes with a sort',
        csv: ['name,sub', 'a,Yes', 'b,no', 'c,YES', 'd,No'].join('\n'),
        steps: async (t, csv) => {
            await t.init(csv);
            await t.setSetting('boolCheckboxes', true);
            const before = t.lastEdit() || csv;
            t.header(1).querySelector('.ag-header-cell-label').dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await t.wait(400);
            const top = t.cell(0, 0).textContent;
            t.click(t.box(0, 1));
            await t.wait(250);
            const a = before.split('\n'), b = t.lastEdit().split('\n');
            const moved = a.map((l, i) => l === b[i] ? null : b[i]).filter(Boolean);
            t.check(moved.length === 1 && moved[0].split(',')[0] === top,
                'the click edits the row it is on (' + top + ': ' + moved.join('|') + ')');
        },
    },
]);
