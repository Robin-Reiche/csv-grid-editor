// Browser tests for pasting text that holds nothing but spaces.
//
// A file's last line of only spaces is a trailing blank line and is dropped
// when the file is read. Paste goes through the same parser. For a while it
// took that rule along: pasting spaces into a cell did nothing. The last row
// of a pasted block was skipped when it held only spaces. On the clipboard
// those spaces are what the user copied, so they are pasted like any value.
//
// Run after `tsc -p ./`:  node test/ui-paste.test.cjs

const { runSuite } = require('./ui/harness.cjs');

// Runs inside the page: pastes text onto the focused cell the way Ctrl+V does.
const PASTE = `async (t, text) => {
    const data = new DataTransfer();
    data.setData('text/plain', text);
    document.querySelector('#grid-container .ag-cell-focus')
        .dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    await t.wait(300);
}`;

runSuite('paste (browser)', [
    {
        // The file side of the same rule, so both callers are held to their half.
        name: 'a file ending in a line of spaces',
        csv: 'a,b\n1,2\n3,4\n   ',
        steps: `async (t, csv) => {
            await t.init(csv);
            t.check(!!t.cell(1, 0) && !t.cell(2, 0), 'the line of spaces is not read as a row');
        }`,
    },
    {
        name: 'spaces alone',
        csv: 'a,b\n1,2\n3,4\n5,6',
        steps: `async (t, csv) => {
            const paste = ${PASTE};
            await t.init(csv);
            await t.focusCell(0, 1);
            await paste(t, '   ');
            t.check(t.lastEdit() === 'a,b\\n1,   \\n3,4\\n5,6',
                'pasting spaces into a cell writes them (' + JSON.stringify(t.lastEdit()) + ')');
        }`,
    },
    {
        name: 'a block whose last row is spaces',
        csv: 'a,b\n1,2\n3,4\n5,6',
        steps: `async (t, csv) => {
            const paste = ${PASTE};
            await t.init(csv);
            await t.focusCell(0, 0);
            await paste(t, 'x\\ty\\n  \\t  ');
            t.check(t.lastEdit() === 'a,b\\nx,y\\n  ,  \\n5,6',
                'the second row of spaces is pasted too (' + JSON.stringify(t.lastEdit()) + ')');
        }`,
    },
]);
