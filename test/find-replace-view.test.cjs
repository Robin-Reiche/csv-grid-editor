// Browser tests for the find and replace bar.
//
// These drive the real webview in headless Chrome (test/ui/harness.cjs). What
// they hold the bar to: a replace shows up in the grid at once and the counter
// moves on, the replacement text is inserted exactly as typed and find only
// sees the columns the user sees.
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
]);
