// Browser tests for the find and replace bar.
//
// These drive the real webview in headless Chrome (test/ui/harness.cjs). What
// they hold the bar to: a replace shows up in the grid at once and the counter
// moves on, the replacement text is inserted exactly as typed and find only
// sees the columns the user sees. It sees every row on screen, a frozen row
// included.
//
// Run after `tsc -p ./`:  node test/find-replace-view.test.cjs

const { runSuite } = require('./ui/harness.cjs');

// Shared by every scenario: types into the find bar and waits out its debounce.
const FIND = `
  async function find(t, needle, repl) {
    document.getElementById('btn-find-replace').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const fi = document.getElementById('find-input');
    fi.value = needle;
    fi.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('replace-input').value = repl == null ? '' : repl;
    await t.wait(300);
  }
  const count = () => document.getElementById('find-count').textContent;
  const col = (t, c, n) => { const out = []; for (let r = 0; r < n; r++) out.push(t.cell(r, c).textContent); return out.join(','); };
  async function press(t, id) { t.click(document.getElementById(id)); await t.wait(300); }
  async function freezeRow(t, row) {
    const c = t.cell(row, 0);
    const r = c.getBoundingClientRect();
    c.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 5, clientY: r.top + 5 }));
    await t.wait(200);
    const item = [...document.querySelectorAll('#row-context-menu .row-ctx-item')].find(i => i.textContent === 'Freeze row');
    if (!item) { t.check(false, 'the row menu offers Freeze row'); return; }
    item.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await t.wait(300);
  }
  // Right-clicks a cell of the row and picks the named entry of the row menu.
  async function rowMenu(t, row, label) {
    const c = t.cell(row, 0);
    const r = c.getBoundingClientRect();
    c.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 5, clientY: r.top + 5 }));
    await t.wait(200);
    const item = [...document.querySelectorAll('#row-context-menu .row-ctx-item')].find(i => i.textContent === label);
    if (!item) { t.check(false, 'the row menu offers ' + label); return; }
    item.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await t.wait(400);
  }
  // The rows of the grid that hold the active mark, as the cells there read.
  const activeAt = () => [...document.querySelectorAll('#grid-container .ag-center-cols-container .cell-find-active')]
    .map(el => el.closest('.ag-row').getAttribute('row-index') + ':' + el.textContent).join(',');
  const frozen = (c) => document.querySelector('#grid-container .ag-floating-top .ag-cell[col-id="col_' + c + '"]');
  const marks = (el) => !el ? '-' : el.classList.contains('cell-find-active') ? 'active'
    : el.classList.contains('cell-find-match') ? 'match' : 'none';
`;

function steps(body) {
    // The harness serialises the steps function, so the shared helpers are
    // pasted into its body rather than closed over.
    return new Function('return async (t, csv) => {' + FIND + body + '}')();
}

runSuite('find and replace (browser)', [
    {
        name: 'replace one updates the grid',
        csv: 'k,v\nx,abc\ny,abc\nz,abc',
        steps: steps(`
            await t.init(csv);
            await find(t, 'b', 'Z');
            t.check(count() === '1 / 3', 'three matches before the replace (' + count() + ')');
            await press(t, 'find-next');
            await press(t, 'replace-one');
            t.check(t.lastEdit() === 'k,v\\nx,abc\\ny,aZc\\nz,abc', 'the file gets the second match replaced (' + JSON.stringify(t.lastEdit()) + ')');
            t.check(col(t, 1, 3) === 'abc,aZc,abc', 'the grid shows the new value (' + col(t, 1, 3) + ')');
            t.check(count() === '2 / 2', 'the counter moves on to the match after it (' + count() + ')');
            await press(t, 'replace-one');
            t.check(t.lastEdit() === 'k,v\\nx,abc\\ny,aZc\\nz,aZc', 'a second replace takes that next match (' + JSON.stringify(t.lastEdit()) + ')');
            t.check(col(t, 1, 3) === 'abc,aZc,aZc', 'and the grid follows (' + col(t, 1, 3) + ')');
            t.check(count() === '1 / 1', 'the counter wraps to the one match left (' + count() + ')');
        `),
    },
    {
        name: 'replace all updates the grid',
        csv: 'k,v\na,a.b\nb,a.b.c\nc,x',
        steps: steps(`
            await t.init(csv);
            await find(t, 'a.b', 'N');
            await press(t, 'replace-all');
            t.check(t.lastEdit() === 'k,v\\na,N\\nb,N.c\\nc,x', 'the file gets every replace (' + JSON.stringify(t.lastEdit()) + ')');
            t.check(col(t, 1, 3) === 'N,N.c,x', 'the grid shows the new values (' + col(t, 1, 3) + ')');
            t.check(count() === '0 matches', 'nothing is left to find (' + count() + ')');
        `),
    },
    {
        name: 'replacement text is literal',
        csv: 'k,price\na,10 USD\nb,20 USD',
        steps: steps(`
            // The dollar signs are built from pieces because the harness pastes
            // this body into the page with a string replace, which would read
            // them as replacement patterns on the way in.
            const D = String.fromCharCode(36);
            const special = D + '&' + D + "'";
            await t.init(csv);
            await find(t, ' USD', D + D);
            await press(t, 'replace-all');
            t.check(t.lastEdit() === 'k,price\\na,10' + D + D + '\\nb,20' + D + D,
                'Replace All inserts ' + D + D + ' as typed (' + JSON.stringify(t.lastEdit()) + ')');
            await find(t, '10' + D + D, special);
            await press(t, 'replace-one');
            t.check(t.lastEdit() === 'k,price\\na,' + special + '\\nb,20' + D + D,
                'Replace inserts ' + special + ' as typed (' + JSON.stringify(t.lastEdit()) + ')');
        `),
    },
    {
        name: 'hidden columns are left alone',
        csv: 'name,secret\nfoo,foo\nbar,x',
        steps: steps(`
            await t.init(csv);
            document.getElementById('btn-columns').dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await t.wait(100);
            const box = document.querySelectorAll('#col-chooser-list input[type=checkbox]')[1];
            box.checked = false;
            box.dispatchEvent(new Event('change', { bubbles: true }));
            await t.wait(200);
            t.check(!t.header(1), 'the secret column is hidden');
            await find(t, 'foo', 'baz');
            t.check(count() === '1 / 1', 'find counts only the visible match (' + count() + ')');
            await press(t, 'replace-all');
            t.check(t.lastEdit() === 'name,secret\\nbaz,foo\\nbar,x', 'Replace All leaves the hidden column alone (' + JSON.stringify(t.lastEdit()) + ')');
        `),
    },
    {
        name: 'column hidden after the search',
        csv: 'name,secret\nfoo,foo\nbar,x',
        steps: steps(`
            await t.init(csv);
            await find(t, 'foo', 'baz');
            t.check(count() === '1 / 2', 'both columns are searched while both show (' + count() + ')');
            await press(t, 'find-next');
            document.getElementById('btn-columns').dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await t.wait(100);
            const box = document.querySelectorAll('#col-chooser-list input[type=checkbox]')[1];
            box.checked = false;
            box.dispatchEvent(new Event('change', { bubbles: true }));
            await t.wait(200);
            // Hiding a column searches again right away, so the active match
            // moves off the hidden cell before Replace is pressed. Replace then
            // takes the visible match and leaves the hidden cell alone.
            await press(t, 'replace-one');
            t.check(t.lastEdit() === 'name,secret\\nbaz,foo\\nbar,x', 'Replace leaves the newly hidden column alone (' + JSON.stringify(t.lastEdit()) + ')');
            t.check(count() === '0 matches', 'and nothing visible is left to find (' + count() + ')');
            await press(t, 'replace-all');
            t.check(t.lastEdit() === 'name,secret\\nbaz,foo\\nbar,x', 'Replace All leaves the newly hidden column alone (' + JSON.stringify(t.lastEdit()) + ')');
        `),
    },
    {
        name: 'hiding a column updates the counter at once',
        csv: 'name,secret\nfoo,foo\nbar,x',
        steps: steps(`
            await t.init(csv);
            await find(t, 'foo', 'baz');
            t.check(count() === '1 / 2', 'both columns are searched while both show (' + count() + ')');
            document.getElementById('btn-columns').dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await t.wait(100);
            const box = document.querySelectorAll('#col-chooser-list input[type=checkbox]')[1];
            box.checked = false;
            box.dispatchEvent(new Event('change', { bubbles: true }));
            await t.wait(200);
            t.check(count() === '1 / 1', 'the hidden match drops out of the counter (' + count() + ')');
            box.checked = true;
            box.dispatchEvent(new Event('change', { bubbles: true }));
            await t.wait(200);
            t.check(count() === '1 / 2', 'and comes back when the column shows again (' + count() + ')');
        `),
    },
    {
        // The new text holds the search text too, so starting over at the
        // front of the cell would only ever hit what the last press put in.
        name: 'replace steps through a cell that holds the text twice',
        csv: 'k,v\nx,abab\ny,b',
        steps: steps(`
            await t.init(csv);
            await find(t, 'b', 'bb');
            t.check(count() === '1 / 2', 'two cells match (' + count() + ')');
            await press(t, 'replace-one');
            t.check(t.lastEdit() === 'k,v\\nx,abbab\\ny,b', 'the first b is replaced (' + JSON.stringify(t.lastEdit()) + ')');
            t.check(count() === '1 / 2', 'the counter stays on the cell while it has more (' + count() + ')');
            await press(t, 'replace-one');
            t.check(t.lastEdit() === 'k,v\\nx,abbabb\\ny,b', 'the second press takes the second b (' + JSON.stringify(t.lastEdit()) + ')');
            t.check(count() === '2 / 2', 'then the counter moves on (' + count() + ')');
            await press(t, 'replace-one');
            t.check(t.lastEdit() === 'k,v\\nx,abbabb\\ny,bb', 'the third press takes the next cell (' + JSON.stringify(t.lastEdit()) + ')');
        `),
    },
    {
        name: 'hiding a column keeps the active match',
        csv: 'a,b,c\nfoo,1,x\nfoo,2,y\nfoo,3,z',
        steps: steps(`
            await t.init(csv);
            await find(t, 'foo', 'bar');
            await press(t, 'find-next');
            await press(t, 'find-next');
            t.check(count() === '3 / 3', 'Next moved to the third match (' + count() + ')');
            document.getElementById('btn-columns').dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await t.wait(100);
            const box = document.querySelectorAll('#col-chooser-list input[type=checkbox]')[2];
            box.checked = false;
            box.dispatchEvent(new Event('change', { bubbles: true }));
            await t.wait(200);
            t.check(count() === '3 / 3', 'hiding a column without a match stays on it (' + count() + ')');
            await press(t, 'replace-one');
            t.check(t.lastEdit() === 'a,b,c\\nfoo,1,x\\nfoo,2,y\\nbar,3,z', 'Replace takes that match (' + JSON.stringify(t.lastEdit()) + ')');
        `),
    },
    {
        // Replace is pressed before the search has caught up with the find
        // box. The matches on hand still belong to the old text. An empty
        // search text matches the empty string at the front of every cell.
        name: 'replace right after emptying the find box',
        csv: 'k,v\nx,abc\ny,abc',
        steps: steps(`
            await t.init(csv);
            await find(t, 'b', 'Z');
            t.check(count() === '1 / 2', 'two matches before the box is emptied (' + count() + ')');
            const fi = document.getElementById('find-input');
            fi.value = '';
            fi.dispatchEvent(new Event('input', { bubbles: true }));
            await press(t, 'replace-one');
            t.check(t.sent('edit').length === 0, 'Replace writes nothing (' + JSON.stringify(t.lastEdit()) + ')');
            t.check(col(t, 1, 2) === 'abc,abc', 'the grid keeps its values (' + col(t, 1, 2) + ')');
            t.check(count() === '', 'the counter is cleared (' + JSON.stringify(count()) + ')');
        `),
    },
    {
        name: 'replace right after changing the find text',
        csv: 'k,v\nx,abc\ny,xyz',
        steps: steps(`
            await t.init(csv);
            await find(t, 'b', 'Z');
            const fi = document.getElementById('find-input');
            fi.value = 'y';
            fi.dispatchEvent(new Event('input', { bubbles: true }));
            await press(t, 'replace-one');
            t.check(t.sent('edit').length === 0, 'the first press only searches (' + JSON.stringify(t.lastEdit()) + ')');
            t.check(count() === '1 / 2', 'the counter shows the new text (' + count() + ')');
            await press(t, 'replace-one');
            t.check(t.lastEdit() === 'k,v\\nx,abc\\nZ,xyz', 'the second press replaces the match it showed (' + JSON.stringify(t.lastEdit()) + ')');
        `),
    },
    {
        // "Show only duplicates" sorts the rows by group. The replace ends
        // that view, which puts them back in file order. The counter has to
        // move on from where the replaced row is now, not from the place it
        // had in the duplicates view.
        name: 'replace in the duplicates view',
        csv: 'k,v\nc,x\nb,x\na,x\nb,x\na,x',
        steps: steps(`
            await t.init(csv);
            await press(t, 'btn-duplicates');
            await press(t, 'dup-only-toggle');
            t.check(col(t, 0, 4) === 'a,a,b,b', 'the duplicates view groups the rows (' + col(t, 0, 4) + ')');
            await find(t, 'x', 'y');
            await press(t, 'find-next');
            await press(t, 'find-next');
            t.check(count() === '3 / 4', 'Next moved to the first b row (' + count() + ')');
            await press(t, 'replace-one');
            t.check(t.lastEdit() === 'k,v\\nc,x\\nb,y\\na,x\\nb,x\\na,x', 'Replace takes that row (' + JSON.stringify(t.lastEdit()) + ')');
            t.check(col(t, 0, 5) === 'c,b,a,b,a', 'the replace ends the view (' + col(t, 0, 5) + ')');
            t.check(count() === '2 / 4', 'the counter moves on to the row after it in file order (' + count() + ')');
            await press(t, 'replace-one');
            t.check(t.lastEdit() === 'k,v\\nc,x\\nb,y\\na,y\\nb,x\\na,x', 'the next Replace takes that row (' + JSON.stringify(t.lastEdit()) + ')');
        `),
    },
    {
        // The matches belonged to the rows before the change. The counter
        // stayed, a cell that no longer matched was marked and Replace sent
        // the file back unchanged, which marked it unsaved.
        name: 'an outside change searches again',
        csv: 'id,name,city\n1,Alice,Berlin\n2,Bob,Hanoi\n3,Carol,Paris',
        steps: steps(`
            await t.init(csv);
            await find(t, 'bob', 'Robert');
            t.check(count() === '1 / 1', 'Bob is found (' + count() + ')');
            window.postMessage({ type: 'update', text: 'id,name,city\\n1,Alice,Berlin\\n2,Zed,Hanoi\\n3,Carol,Paris', delimiter: ',' }, '*');
            await t.wait(400);
            t.check(count() === '0 matches', 'the counter follows the change (' + count() + ')');
            t.check(!document.querySelector('#grid-container .cell-find-match'), 'no cell is marked');
            await press(t, 'replace-one');
            t.check(t.sent('edit').length === 0, 'Replace writes nothing (' + JSON.stringify(t.lastEdit()) + ')');
            t.check(document.getElementById('btn-undo').disabled, 'and leaves no undo step');
        `),
    },
    {
        // The matches were found in the columns before the switch.
        name: 'a delimiter switch searches again',
        csv: 'k;v\nb;x\ny;b\n',
        steps: steps(`
            await t.init(csv);
            await find(t, 'b', 'Q');
            await press(t, 'find-next');
            t.check(count() === '2 / 2', 'the second match is active (' + count() + ')');
            document.querySelector('.delim-option[data-delim=";"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await t.wait(400);
            t.check(!!t.cell(1, 1) && t.cell(1, 1).classList.contains('cell-find-active'),
                'the active match is the b in the second column (' + count() + ')');
            await press(t, 'replace-one');
            t.check(t.lastEdit() === 'k;v\\nb;x\\ny;Q\\n', 'Replace takes that match (' + JSON.stringify(t.lastEdit()) + ')');
        `),
    },
    {
        // The host marks the file unsaved for every edit it gets. A replace
        // that leaves the text as it was is no change. The undo step it took
        // would undo nothing. The redo step it cleared comes back.
        name: 'a replace that changes nothing writes nothing',
        csv: 'k,v\na,Bob\nb,x',
        steps: steps(`
            await t.init(csv);
            await find(t, 'x', 'y');
            await press(t, 'replace-one');
            await press(t, 'btn-undo');
            t.check(t.lastEdit() === csv, 'undo writes the file back (' + JSON.stringify(t.lastEdit()) + ')');
            const sent = t.sent('edit').length;
            await find(t, 'Bob', 'Bob');
            await press(t, 'replace-one');
            t.check(t.sent('edit').length === sent, 'Replace writes nothing (' + JSON.stringify(t.lastEdit()) + ')');
            t.check(document.getElementById('btn-undo').disabled, 'no undo step is left behind');
            t.check(!document.getElementById('btn-redo').disabled, 'the redo step is still there');
        `),
    },
    {
        // Undo brings back a value the search no longer counted. Kept, the
        // matches left it unmarked and Next never got there.
        name: 'undo and redo search again',
        csv: 'k,v\na,b\nc,b',
        steps: steps(`
            await t.init(csv);
            await find(t, 'b', 'Q');
            await press(t, 'replace-one');
            t.check(count() === '1 / 1', 'one match is left after the replace (' + count() + ')');
            await press(t, 'btn-undo');
            t.check(count() === '2 / 2' && t.cell(0, 1).classList.contains('cell-find-match'),
                'undo counts the b it brings back (' + count() + ')');
            await press(t, 'btn-redo');
            t.check(count() === '1 / 1' && !t.cell(0, 1).classList.contains('cell-find-match'),
                'redo takes it out again (' + count() + ')');
        `),
    },
    {
        // A search moves the view to its match. The search that runs again
        // after an undo or an outside change took the user away from the row
        // they had just changed or that had just changed under them.
        name: 'searching again after undo or an outside change keeps the view',
        csv: 'k,v\nneedle,0\n' + Array.from({ length: 300 }, (_, i) => 'r' + (i + 1) + ',' + (i + 1)).join('\n') + '\n',
        steps: steps(`
            await t.init(csv);
            await find(t, 'needle', '');
            t.check(count() === '1 / 1', 'the match in the first row is found (' + count() + ')');
            const vp = document.querySelector('#grid-container .ag-body-viewport');
            vp.scrollTop = vp.scrollHeight;
            // In headless Chrome the grid never heard of a scroll set from a
            // script and drew no rows down there. The event tells it.
            vp.dispatchEvent(new Event('scroll'));
            await t.wait(400);
            const top = vp.scrollTop;
            t.check(top > 0 && !!t.cell(290, 1), 'the grid is scrolled down to row 290 (' + top + ')');
            await t.focusCell(290, 1);
            await t.pressEnter();
            const ta = document.querySelector('#grid-container textarea');
            ta.value = 'X';
            ta.dispatchEvent(new Event('input', { bubbles: true }));
            await t.pressEnter();
            await press(t, 'btn-undo');
            t.check(vp.scrollTop === top, 'undo leaves the view where it was (' + vp.scrollTop + ', was ' + top + ')');
            t.check(!!t.cell(290, 1) && t.cell(290, 1).textContent === '290', 'the undone value is on screen');
            t.check(count() === '1 / 1', 'the counter is still right (' + count() + ')');
            await press(t, 'btn-redo');
            t.check(vp.scrollTop === top && !!t.cell(290, 1) && t.cell(290, 1).textContent === 'X',
                'so does redo (' + vp.scrollTop + ')');
            window.postMessage({ type: 'update', text: csv.replace('r290,290', 'needle,Y'), delimiter: ',' }, '*');
            await t.wait(400);
            t.check(vp.scrollTop === top && !!t.cell(290, 0) && t.cell(290, 0).textContent === 'needle',
                'so does an outside change (' + vp.scrollTop + ')');
            t.check(count() === '1 / 2', 'and the counter takes in its match (' + count() + ')');
        `),
    },
    {
        // The matches of the page before were counted and marked on the next
        // one.
        name: 'another page of the paged view searches again',
        csv: 'k,v\nb,1\nc,2',
        preview: { mode: 'chunked', total: 7 },
        steps: steps(`
            window.postMessage({ type: 'init', text: csv, delimiter: ',' }, '*');
            window.postMessage({ type: 'pageData', pageNumber: 0, totalPages: 2, text: csv }, '*');
            await t.wait(900);
            await find(t, 'b', '');
            t.check(count() === '1 / 1', 'page 1 has one match (' + count() + ')');
            window.postMessage({ type: 'pageData', pageNumber: 1, totalPages: 2, text: 'k,v\\nq,b\\nb,b\\nr,3' }, '*');
            await t.wait(500);
            t.check(count() === '1 / 3', 'the counter is for page 2 (' + count() + ')');
            t.check(!!t.cell(0, 1) && t.cell(0, 1).classList.contains('cell-find-active'), 'its first match is the active one');
        `),
    },
    {
        // A frozen row stays on screen above the others. Find only went
        // through the rows below it, so the counter left it out and Replace
        // All did not touch it.
        name: 'a frozen row is searched too',
        csv: 'k,v\nb,1\nx,2\nb,3\n',
        steps: steps(`
            await t.init(csv);
            await freezeRow(t, 0);
            t.check(!!frozen(0) && frozen(0).textContent === 'b', 'the first row is frozen');
            await find(t, 'b', 'Q');
            t.check(count() === '1 / 2', 'find counts the frozen row (' + count() + ')');
            t.check(marks(frozen(0)) === 'active', 'the frozen row, on top, is the first match (' + marks(frozen(0)) + ')');
            t.check(marks(t.cell(0, 0)) === 'none' && marks(t.cell(1, 0)) === 'match',
                'below it, only the b row is marked (' + marks(t.cell(0, 0)) + ', ' + marks(t.cell(1, 0)) + ')');
            await press(t, 'find-next');
            t.check(count() === '2 / 2' && marks(t.cell(1, 0)) === 'active' && marks(frozen(0)) === 'match',
                'Next moves on to the b row below (' + count() + ')');
            await press(t, 'replace-all');
            t.check(t.lastEdit() === 'k,v\\nQ,1\\nx,2\\nQ,3\\n', 'Replace All takes both rows (' + JSON.stringify(t.lastEdit()) + ')');
            t.check(frozen(0).textContent === 'Q' && t.cell(1, 0).textContent === 'Q',
                'the grid shows both new values (' + frozen(0).textContent + ', ' + t.cell(1, 0).textContent + ')');
            t.check(count() === '0 matches', 'nothing is left to find (' + count() + ')');
        `),
    },
    {
        name: 'replace one in a frozen row',
        csv: 'k,v\nb,1\nx,2\nb,3\n',
        steps: steps(`
            await t.init(csv);
            await freezeRow(t, 0);
            // Row 0 below the frozen row holds x. The marks must not spill
            // from one onto the other, the two being row 0 of their own band.
            // The click repaints every cell, the frozen ones included.
            await find(t, 'x', 'y');
            await t.focusCell(1, 1);
            t.check(count() === '1 / 1' && marks(t.cell(0, 0)) === 'active' && marks(frozen(0)) === 'none',
                'a match in the first row below marks that row only (' + count() + ', ' + marks(frozen(0)) + ')');
            await find(t, 'b', 'Q');
            await press(t, 'replace-one');
            t.check(t.lastEdit() === 'k,v\\nQ,1\\nx,2\\nb,3\\n', 'Replace takes the frozen row first (' + JSON.stringify(t.lastEdit()) + ')');
            t.check(frozen(0).textContent === 'Q', 'the frozen row shows the new value (' + frozen(0).textContent + ')');
            t.check(count() === '1 / 1' && marks(t.cell(1, 0)) === 'active', 'the counter moves on to the row below (' + count() + ')');
            await press(t, 'replace-one');
            t.check(t.lastEdit() === 'k,v\\nQ,1\\nx,2\\nQ,3\\n', 'the next Replace takes that row (' + JSON.stringify(t.lastEdit()) + ')');
        `),
    },
    {
        // The marks were tied to where a row sat on screen. A sort moved the
        // rows and left the marks on the cells that took their place.
        name: 'a sort while the bar is open moves the marks with the rows',
        csv: 'k,v\nc,x\na,x\nb,y',
        steps: steps(`
            await t.init(csv);
            await find(t, 'x', '');
            t.check(count() === '1 / 2', 'two matches (' + count() + ')');
            t.header(0).querySelector('.ag-header-cell-label').dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await t.wait(400);
            t.check(col(t, 0, 3) === 'a,b,c', 'sorted by k (' + col(t, 0, 3) + ')');
            t.check(marks(t.cell(0, 1)) !== 'none' && marks(t.cell(1, 1)) === 'none' && marks(t.cell(2, 1)) !== 'none',
                'the x cells are marked, the y cell is not (' + [0, 1, 2].map(r => marks(t.cell(r, 1))).join(',') + ')');
            const active = () => [0, 1, 2].filter(r => marks(t.cell(r, 1)) === 'active').join(',');
            const first = active();
            await press(t, 'find-next');
            const second = active();
            t.check(first !== second && [first, second].sort().join('|') === '0|2',
                'Next goes from one x to the other in the new order (' + first + ' then ' + second + ')');
        `),
    },
    {
        // The counter kept counting a match the filter had just hidden.
        name: 'a filter while the bar is open counts only the rows it shows',
        csv: 'k,v\nc,x\na,x\nb,y',
        steps: steps(`
            await t.init(csv);
            await find(t, 'x', '');
            t.check(count() === '1 / 2', 'two matches (' + count() + ')');
            t.click(t.header(0).querySelector('.ag-header-cell-filter-button, .ag-header-cell-menu-button'));
            await t.wait(300);
            const row = [...document.querySelectorAll('.csv-filter-value-row')].find(r => r.textContent === 'a');
            const cb = row.querySelector('input');
            cb.checked = false;
            cb.dispatchEvent(new Event('change'));
            await t.wait(300);
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            await t.wait(300);
            t.check(count() === '1 / 1', 'the hidden row is no longer counted (' + count() + ')');
        `),
    },
    {
        name: 'freezing a row while the bar is open moves the marks with the rows',
        csv: 'k,v\nb,1\nx,2\nb,3\n',
        steps: steps(`
            await t.init(csv);
            await find(t, 'b', '');
            t.check(count() === '1 / 2', 'two matches (' + count() + ')');
            await freezeRow(t, 1);
            t.check(!!frozen(0) && frozen(0).textContent === 'x', 'the x row is frozen');
            t.check(marks(frozen(0)) === 'none' && marks(t.cell(0, 0)) !== 'none' && marks(t.cell(1, 0)) !== 'none',
                'both b rows below it are marked and the frozen x row is not ('
                + [marks(frozen(0)), marks(t.cell(0, 0)), marks(t.cell(1, 0))].join(',') + ')');
        `),
    },
    {
        // A match remembered its row by the place it had in the file. Deleting
        // a row above moved every row below up by one, so the search that ran
        // again looked for the active match one row too far down. The counter
        // went back to 1 and Replace took the first match of the file.
        name: 'deleting a row above keeps the active match',
        csv: 'k,v\na,apple\nb,x\nc,apple\nd,apple',
        steps: steps(`
            await t.init(csv);
            await find(t, 'apple', 'R');
            await press(t, 'find-next');
            await press(t, 'find-next');
            t.check(count() === '3 / 3' && activeAt() === '3:apple', 'Next moved to the d row (' + count() + ', ' + activeAt() + ')');
            await rowMenu(t, 1, 'Delete row');
            t.check(t.lastEdit() === 'k,v\\na,apple\\nc,apple\\nd,apple', 'the b row is deleted (' + JSON.stringify(t.lastEdit()) + ')');
            t.check(count() === '3 / 3' && activeAt() === '2:apple', 'the d row keeps the active match (' + count() + ', ' + activeAt() + ')');
            await press(t, 'replace-one');
            t.check(t.lastEdit() === 'k,v\\na,apple\\nc,apple\\nd,R', 'Replace takes the d row (' + JSON.stringify(t.lastEdit()) + ')');
        `),
    },
    {
        name: 'inserting a row above keeps the active match',
        csv: 'k,v\na,apple\nb,apple\nc,apple',
        steps: steps(`
            await t.init(csv);
            await find(t, 'apple', 'R');
            await press(t, 'find-next');
            t.check(count() === '2 / 3', 'Next moved to the b row (' + count() + ')');
            await rowMenu(t, 0, 'Insert row above');
            t.check(t.lastEdit() === 'k,v\\n,\\na,apple\\nb,apple\\nc,apple', 'a row is added on top (' + JSON.stringify(t.lastEdit()) + ')');
            t.check(count() === '2 / 3' && activeAt() === '2:apple', 'the b row keeps the active match (' + count() + ', ' + activeAt() + ')');
            await press(t, 'replace-one');
            t.check(t.lastEdit() === 'k,v\\n,\\na,apple\\nb,R\\nc,apple', 'Replace takes the b row (' + JSON.stringify(t.lastEdit()) + ')');
        `),
    },
    {
        // An insert under a sort writes the sorted order into the file first,
        // which moves nearly every row.
        name: 'an insert under a sort keeps the active match',
        csv: 'k,v\n1,apple\n2,x\n3,apple\n4,x\n5,apple\n6,x',
        steps: steps(`
            await t.init(csv);
            const label = t.header(0).querySelector('.ag-header-cell-label');
            label.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await t.wait(300);
            label.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await t.wait(300);
            t.check(col(t, 0, 6) === '6,5,4,3,2,1', 'sorted by k, highest first (' + col(t, 0, 6) + ')');
            await find(t, 'apple', 'R');
            await press(t, 'find-next');
            t.check(count() === '2 / 3' && activeAt() === '3:apple', 'Next moved to the row of 3 (' + count() + ', ' + activeAt() + ')');
            await t.focusCell(0, 0);
            document.querySelector('#grid-container .ag-cell-focus')
                .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
            await t.wait(400);
            t.check(t.lastEdit() === 'k,v\\n6,x\\n,\\n5,apple\\n4,x\\n3,apple\\n2,x\\n1,apple',
                'Ctrl+Enter adds a row under the top one (' + JSON.stringify(t.lastEdit()) + ')');
            t.check(count() === '2 / 3' && activeAt() === '4:apple', 'the row of 3 keeps the active match (' + count() + ', ' + activeAt() + ')');
            await press(t, 'replace-one');
            t.check(t.lastEdit() === 'k,v\\n6,x\\n,\\n5,apple\\n4,x\\n3,R\\n2,x\\n1,apple',
                'Replace takes the row of 3 (' + JSON.stringify(t.lastEdit()) + ')');
        `),
    },
    {
        // The search that runs after the delete cannot find the row it was on.
        // The next match after it is where Next would have gone, so that one
        // becomes the active match, not the first match of the file. The rows
        // are sorted here, so the file order is no help in finding it.
        name: 'deleting the row of the active match moves on to the next match',
        csv: 'k,v,w\n2,apple,apple\n4,x,x\n3,apple,x\n1,apple,x',
        steps: steps(`
            await t.init(csv);
            t.header(0).querySelector('.ag-header-cell-label').dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await t.wait(300);
            t.check(col(t, 0, 4) === '1,2,3,4', 'sorted by k (' + col(t, 0, 4) + ')');
            await find(t, 'apple', 'R');
            await press(t, 'find-next');
            t.check(count() === '2 / 4' && activeAt() === '1:apple', 'Next moved to the row of 2 (' + count() + ', ' + activeAt() + ')');
            await rowMenu(t, 1, 'Delete row');
            t.check(t.lastEdit() === 'k,v,w\\n4,x,x\\n3,apple,x\\n1,apple,x', 'the row of 2 is deleted (' + JSON.stringify(t.lastEdit()) + ')');
            t.check(count() === '2 / 2' && activeAt() === '1:apple', 'the row of 3 has the active match (' + count() + ', ' + activeAt() + ')');
            await press(t, 'replace-one');
            t.check(t.lastEdit() === 'k,v,w\\n4,x,x\\n3,R,x\\n1,apple,x', 'Replace takes the row of 3 (' + JSON.stringify(t.lastEdit()) + ')');
        `),
    },
    {
        // "Hide spaces around values" is on by default. Find went by the
        // value in the file, so two spaces found cells that show no space at
        // all and Replace All rewrote padding nobody could see.
        name: 'spaces hidden: find sees what the grid shows',
        csv: 'k,v\na,  Berlin  \nb,New York\nc,   \nd,plain',
        steps: steps(`
            await t.init(csv);
            await find(t, '  ', 'X');
            t.check(count() === '0 matches', 'two spaces match nothing on screen (' + count() + ')');
            await find(t, 'n  ', 'X');
            t.check(count() === '0 matches', 'nor does n and two spaces (' + count() + ')');
            await find(t, ' ', '_');
            t.check(count() === '1 / 1' && activeAt() === '1:New York', 'one space finds New York only (' + count() + ', ' + activeAt() + ')');
            await press(t, 'replace-all');
            t.check(t.lastEdit() === 'k,v\\na,  Berlin  \\nb,New_York\\nc,   \\nd,plain',
                'Replace All leaves the hidden spaces alone (' + JSON.stringify(t.lastEdit()) + ')');
            await find(t, 'berlin', 'Rome');
            t.check(count() === '1 / 1', 'Berlin is found (' + count() + ')');
            await press(t, 'replace-one');
            t.check(t.lastEdit() === 'k,v\\na,  Rome  \\nb,New_York\\nc,   \\nd,plain',
                'Replace changes what is shown and keeps the spaces around it (' + JSON.stringify(t.lastEdit()) + ')');
        `),
    },
    {
        name: 'spaces hidden: replace steps through a padded cell',
        csv: 'k,v\nx, abab ',
        steps: steps(`
            await t.init(csv);
            await find(t, 'b', 'bb');
            await press(t, 'replace-one');
            t.check(t.lastEdit() === 'k,v\\nx, abbab ', 'the first b is replaced (' + JSON.stringify(t.lastEdit()) + ')');
            await press(t, 'replace-one');
            t.check(t.lastEdit() === 'k,v\\nx, abbabb ', 'the second press takes the second b (' + JSON.stringify(t.lastEdit()) + ')');
        `),
    },
    {
        // The search text is a space here, so it is in the hidden padding too.
        // A replace that went over the whole value took the first space of
        // the padding and Replace All rewrote the padding as well.
        name: 'spaces hidden: replace keeps padding that holds the search text',
        csv: 'k,v\na,  New York  \nb,  San Jose del Monte  ',
        steps: steps(`
            await t.init(csv);
            await find(t, ' ', '_');
            t.check(count() === '1 / 2', 'both cells match (' + count() + ')');
            await press(t, 'replace-one');
            t.check(t.lastEdit() === 'k,v\\na,  New_York  \\nb,  San Jose del Monte  ',
                'Replace changes the space between the words (' + JSON.stringify(t.lastEdit()) + ')');
            await press(t, 'replace-all');
            t.check(t.lastEdit() === 'k,v\\na,  New_York  \\nb,  San_Jose_del_Monte  ',
                'Replace All changes only the spaces on screen (' + JSON.stringify(t.lastEdit()) + ')');
        `),
    },
    {
        // With the spaces shown they are part of what the user sees, so find
        // goes on matching them.
        name: 'spaces shown: find sees the spaces',
        csv: 'k,v\na,  Berlin  \nb,New York\nc,   \nd,plain',
        settings: { trimDisplay: false },
        steps: steps(`
            await t.init(csv);
            await find(t, '  ', '');
            t.check(count() === '1 / 2', 'two spaces are found around Berlin and in the blank cell (' + count() + ')');
            await find(t, ' ', '_');
            await press(t, 'replace-all');
            t.check(t.lastEdit() === 'k,v\\na,__Berlin__\\nb,New_York\\nc,___\\nd,plain',
                'Replace All replaces every space (' + JSON.stringify(t.lastEdit()) + ')');
        `),
    },
    {
        // The setting changes what the cells show, so it changes what find
        // matches. The counter and the marks kept the old matches until the
        // next search. A cell that showed Berlin stayed marked for two spaces
        // and Replace then found nothing to change.
        name: 'switching Hide spaces around values searches again',
        csv: 'k,v\na,  Berlin  \nb,New York\nc,   \nd,plain',
        settings: { trimDisplay: false },
        steps: steps(`
            await t.init(csv);
            await find(t, '  ', 'X');
            t.check(count() === '1 / 2' && marks(t.cell(0, 1)) === 'active', 'two spaces are found around Berlin (' + count() + ', ' + marks(t.cell(0, 1)) + ')');
            await t.setSetting('trimDisplay', true);
            t.check(count() === '0 matches', 'with the spaces hidden nothing matches (' + count() + ')');
            t.check(marks(t.cell(0, 1)) === 'none' && marks(t.cell(2, 1)) === 'none',
                'and no cell stays marked (' + marks(t.cell(0, 1)) + ', ' + marks(t.cell(2, 1)) + ')');
            await t.setSetting('trimDisplay', false);
            t.check(count() === '1 / 2', 'shown again, the spaces are found again (' + count() + ')');
        `),
    },
    {
        // The grid asks every cell it draws whether it holds a match. A sort
        // draws them all again. Going through the matches for each cell took
        // over a second per sort with a search like 'e' on 100,000 rows.
        // The virtual clock of the page does not see that time, so the steps
        // of the array scans are counted over one sort instead.
        name: 'a sort with many matches does not scan them for each cell',
        csv: 'a,b\n' + Array.from({ length: 1000 }, (_, i) => 'e' + (999 - i) + ',e' + i).join('\n'),
        steps: steps(`
            await t.init(csv);
            await find(t, 'e', '');
            t.check(count() === '1 / 2000', 'every cell is a match (' + count() + ')');
            const names = ['some', 'every', 'find', 'findIndex', 'filter'];
            const orig = names.map(n => Array.prototype[n]);
            let calls = 0;
            names.forEach((n, i) => {
                Array.prototype[n] = function (cb, ...rest) {
                    return orig[i].call(this, function (...a) { calls++; return cb.apply(this, a); }, ...rest);
                };
            });
            try {
                t.header(0).querySelector('.ag-header-cell-label').dispatchEvent(new MouseEvent('click', { bubbles: true }));
                await t.wait(300);
            } finally {
                names.forEach((n, i) => { Array.prototype[n] = orig[i]; });
            }
            t.check(col(t, 0, 3) === 'e0,e1,e2', 'sorted by a (' + col(t, 0, 3) + ')');
            t.check(marks(t.cell(0, 0)) !== 'none' && marks(t.cell(1, 1)) === 'match',
                'the drawn cells are marked (' + marks(t.cell(0, 0)) + ', ' + marks(t.cell(1, 1)) + ')');
            t.check(calls < 10000, 'the sort takes far fewer steps than matches times drawn cells (' + calls + ')');
        `),
    },
    {
        // With no rows left there is no grid to search, and the search used to
        // stop before it touched the counter.
        name: 'an outside change that empties the file',
        csv: 'k,v\nb,1',
        steps: steps(`
            await t.init(csv);
            await find(t, 'b', 'Q');
            t.check(count() === '1 / 1', 'one match (' + count() + ')');
            window.postMessage({ type: 'update', text: '', delimiter: ',' }, '*');
            await t.wait(500);
            t.check(count() === '0 matches', 'the counter says nothing is left (' + JSON.stringify(count()) + ')');
            await press(t, 'replace-all');
            t.check(t.sent('edit').length === 0, 'Replace All writes nothing (' + JSON.stringify(t.lastEdit()) + ')');
        `),
    },
]);
