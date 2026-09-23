// Browser test: every popover and dropdown stays readable when the theme's
// menus are not the color of its editor.
//
// The popovers draw on the menu background. Text or a hover color taken from
// the editor or the list colors belongs to a different background, which most
// themes keep close enough that nobody notices. A light theme with dark menus
// does not: the hovered row in the settings menu turned light gray under light
// gray text. The headings were dark gray on the dark menu. Dark themes with
// light menus exist too. Each check here opens a popover in both mixes and
// measures the contrast of every piece of text in it against what is really
// behind it, at rest and with its rows hovered.
//
// A hover cannot be made from a script, so every :hover rule of the stylesheet
// is copied under a class (same specificity, so the same rule wins) and the
// class is put on the row. The page cannot read its own stylesheet from a
// file:// address, so the rules are copied here and handed to it.
//
// Red for a destructive entry or an error is the theme's signal color. It is
// left to the theme and not measured here.
//
// Run after `tsc -p ./`:  node test/ui-popover-colors.test.cjs

const fs = require('fs');
const path = require('path');
const { runSuite } = require('./ui/harness.cjs');

// Every :hover rule of media/webview.css with :hover swapped for .__hover.
// Comments go first, they may hold braces and selectors of their own.
const HOVER_CSS = fs.readFileSync(path.join(__dirname, '..', 'media', 'webview.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .match(/[^{}]+\{[^{}]*\}/g)
    .filter(rule => rule.split('{')[0].includes(':hover'))
    .map(rule => rule.split(':hover').join('.__hover'))
    .join('\n');

// The variables VS Code puts on <html>. Light Modern with the menus of a dark
// theme. Dark Modern with the menus of a light one.
const THEMES = {
    'light with dark menus': {
        body: 'vscode-light',
        vars: {
            'editor-background': '#ffffff', 'editor-foreground': '#3b3b3b', 'foreground': '#3b3b3b',
            'descriptionForeground': '#3b3b3b', 'list-hoverBackground': '#f2f2f2',
            'sideBar-background': '#f8f8f8', 'editorWidget-background': '#f8f8f8', 'editorWidget-foreground': '#3b3b3b',
            'panel-border': '#e5e5e5', 'input-background': '#ffffff', 'input-foreground': '#3b3b3b',
            'input-border': '#cecece', 'dropdown-background': '#ffffff', 'dropdown-foreground': '#3b3b3b',
            'button-background': '#005fb8', 'button-foreground': '#ffffff', 'button-hoverBackground': '#0258a8',
            'button-secondaryBackground': '#e5e5e5', 'button-secondaryForeground': '#3b3b3b',
            'button-secondaryHoverBackground': '#cccccc', 'input-placeholderForeground': '#767676',
            'toolbar-hoverBackground': 'rgba(184, 184, 184, 0.31)', 'focusBorder': '#005fb8',
            'textLink-foreground': '#005fb8', 'errorForeground': '#f85149',
            'inputValidation-errorBackground': '#f2dede',
            'menu-background': '#252526', 'menu-foreground': '#cccccc', 'menu-border': '#454545',
            'menu-selectionBackground': '#0078d4', 'menu-selectionForeground': '#ffffff',
        },
    },
    'dark with light menus': {
        body: 'vscode-dark',
        vars: {
            'editor-background': '#1f1f1f', 'editor-foreground': '#cccccc', 'foreground': '#cccccc',
            'descriptionForeground': '#9d9d9d', 'list-hoverBackground': '#2a2d2e',
            'sideBar-background': '#181818', 'editorWidget-background': '#202020', 'editorWidget-foreground': '#cccccc',
            'panel-border': '#2b2b2b', 'input-background': '#313131', 'input-foreground': '#cccccc',
            'input-border': '#3c3c3c', 'dropdown-background': '#313131', 'dropdown-foreground': '#cccccc',
            'button-background': '#0078d4', 'button-foreground': '#ffffff', 'button-hoverBackground': '#026ec1',
            'button-secondaryBackground': '#313131', 'button-secondaryForeground': '#cccccc',
            'button-secondaryHoverBackground': '#3c3c3c', 'input-placeholderForeground': '#989898',
            'toolbar-hoverBackground': 'rgba(90, 93, 94, 0.31)', 'focusBorder': '#0078d4',
            'textLink-foreground': '#4daafc', 'errorForeground': '#f85149',
            'inputValidation-errorBackground': '#5a1d1d',
            'menu-background': '#ffffff', 'menu-foreground': '#3b3b3b', 'menu-border': '#cecece',
            'menu-selectionBackground': '#005fb8', 'menu-selectionForeground': '#ffffff',
        },
    },
};

// Runs in the page before the grid starts. Sets the theme up and adds the
// helpers that open a popover and measure it.
const SETUP = (theme) => `
    document.body.classList.remove('vscode-dark', 'vscode-light');
    document.body.classList.add(${JSON.stringify(theme.body)});
    for (const [k, v] of Object.entries(${JSON.stringify(theme.vars)})) {
        document.documentElement.style.setProperty('--vscode-' + k, v);
    }
    await t.init(csv);

    const hover = document.createElement('style');
    hover.textContent = ${JSON.stringify(HOVER_CSS)};
    document.head.appendChild(hover);

    const rgb = (c) => {
        const p = c.match(/[\\d.]+/g).map(Number);
        return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
    };
    const over = (top, under) => ({
        r: top.r * top.a + under.r * (1 - top.a),
        g: top.g * top.a + under.g * (1 - top.a),
        b: top.b * top.a + under.b * (1 - top.a),
        a: 1,
    });
    const lum = (c) => {
        const ch = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
        return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
    };
    const ratio = (a, b) => {
        const x = lum(a), y = lum(b);
        return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
    };
    // What is painted behind el: every background from the page down to it.
    const behind = (el) => {
        const chain = [];
        for (let e = el; e; e = e.parentElement) chain.unshift(e);
        let c = { r: 255, g: 255, b: 255, a: 1 };
        for (const e of chain) {
            const bg = rgb(getComputedStyle(e).backgroundColor);
            if (bg.a > 0) c = over(bg, c);
        }
        return c;
    };
    // The text color as it lands on screen, faded by every opacity above it.
    const ink = (el, bg) => {
        const c = rgb(getComputedStyle(el).color);
        let a = c.a;
        for (let e = el; e && e !== document.body; e = e.parentElement) a *= Number(getComputedStyle(e).opacity);
        return over(Object.assign({}, c, { a }), bg);
    };
    const SIGNAL = '.danger, .danger *, .goto-error';
    // Every element in root that draws text of its own, with its contrast.
    t.texts = (root) => {
        const out = [];
        for (const el of [root, ...root.querySelectorAll('*')]) {
            if (el.matches(SIGNAL)) continue;
            // A control that cannot be used is faded on purpose.
            if (el.closest(':disabled')) continue;
            if (!el.getClientRects().length || getComputedStyle(el).visibility === 'hidden') continue;
            const own = [...el.childNodes].some(n => n.nodeType === 3 && n.data.trim());
            if (!own) continue;
            const bg = behind(el);
            out.push({ what: (el.className || el.tagName) + ' "' + el.textContent.trim().slice(0, 20) + '"', ratio: ratio(ink(el, bg), bg) });
        }
        return out;
    };
    // Checks every text in root, then again with each row in rows hovered.
    t.readable = (name, root, rows) => {
        const all = t.texts(root).map(x => Object.assign(x, { state: 'at rest' }));
        for (const row of rows) {
            row.classList.add('__hover');
            for (const x of t.texts(row)) all.push(Object.assign(x, { state: 'hovered' }));
            row.classList.remove('__hover');
        }
        const bad = all.filter(x => x.ratio < 3);
        const min = all.reduce((m, x) => Math.min(m, x.ratio), 99);
        t.check(all.length > 0 && bad.length === 0, name + ': every text reads against its background ('
            + all.length + ' texts, lowest ' + min.toFixed(2) + ':1'
            + (bad.length ? ', too faint: ' + bad.map(x => x.what + ' ' + x.state + ' ' + x.ratio.toFixed(2)).join('; ') : '') + ')');
    };
    // A ticked box is filled with its accent color. On a hovered row that
    // fill has to stand apart from the row. Otherwise all that is left of the
    // box is its tick. 3:1 is the least a control needs against its ground.
    t.boxesShow = (name, rows) => {
        const all = [];
        for (const row of rows) {
            row.classList.add('__hover');
            for (const box of row.querySelectorAll('input[type="checkbox"]')) {
                if (!box.checked || !box.getClientRects().length) continue;
                const accent = getComputedStyle(box).accentColor;
                const bg = behind(row);
                all.push(accent === 'auto' ? 1 : ratio(over(rgb(accent), bg), bg));
            }
            row.classList.remove('__hover');
        }
        const min = all.reduce((m, x) => Math.min(m, x), 99);
        t.check(all.length > 0 && min >= 3, name + ': a ticked box stands apart from its hovered row ('
            + all.length + ' boxes, lowest ' + min.toFixed(2) + ':1)');
    };
    t.clickId = async (id) => {
        document.getElementById(id).dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await t.wait(250);
    };
    t.shut = async () => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await t.wait(200);
    };
`;

const CSV = ['city,n,note', 'Berlin,1,a', 'Hanoi,2,', 'Paris,3,c'].join('\n');

const each = (body) => Object.entries(THEMES).map(([name, theme]) => ({
    name,
    csv: CSV,
    steps: `async (t, csv) => { ${SETUP(theme)} ${body} }`,
}));

runSuite('popover colors (browser)', each(`
    const pop = id => document.getElementById(id);

    await t.clickId('btn-settings');
    t.readable('settings menu', pop('settings-popover'), [...pop('settings-popover').querySelectorAll('.settings-item')]);
    t.boxesShow('settings menu', [...pop('settings-popover').querySelectorAll('.settings-item')]);
    await t.shut();

    await t.clickId('btn-columns');
    t.readable('column chooser', pop('col-chooser-popover'),
        [pop('col-chooser-master'), ...pop('col-chooser-popover').querySelectorAll('.col-chooser-item')]);
    t.boxesShow('column chooser', [pop('col-chooser-master'), ...pop('col-chooser-popover').querySelectorAll('.col-chooser-item')]);
    const search = pop('col-chooser-search');
    search.value = 'zzz';
    search.dispatchEvent(new Event('input'));
    await t.wait(100);
    t.readable('column chooser with no match', pop('col-chooser-popover'), []);
    await t.shut();

    await t.clickId('btn-go-to-row');
    t.readable('go to row', pop('goto-popover'), []);
    await t.shut();

    pop('col-context-menu').dataset.colId = 'col_0';
    await t.clickId('col-ctx-rename');
    t.readable('rename column', pop('rename-popover'), []);
    await t.shut();

    await t.clickId('delim-badge');
    t.readable('delimiter menu', pop('delim-dropdown'), [...pop('delim-dropdown').querySelectorAll('.delim-option')]);
    await t.shut();

    await t.clickId('btn-export');
    t.readable('export menu', pop('export-dropdown'), [...pop('export-dropdown').querySelectorAll('.export-option')]);
    await t.shut();

    const h = t.header(0);
    const hr = h.getBoundingClientRect();
    h.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: hr.left + 10, clientY: hr.top + 5 }));
    await t.wait(250);
    t.readable('column menu', pop('col-context-menu'),
        [...pop('col-context-menu').querySelectorAll('.col-ctx-item:not(.danger)')].filter(i => i.style.display !== 'none'));
    await t.shut();

    const c = t.cell(0, 0);
    const cr = c.getBoundingClientRect();
    c.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: cr.left + 5, clientY: cr.top + 5 }));
    await t.wait(250);
    t.readable('row menu', pop('row-context-menu'), [...pop('row-context-menu').querySelectorAll('.row-ctx-item')]);
    await t.shut();

    t.click(t.header(2).querySelector('.ag-header-cell-filter-button, .ag-header-cell-menu-button'));
    await t.wait(300);
    const filter = document.querySelector('.ag-popup .ag-filter');
    t.check(!!filter, 'the column filter opens');
    if (filter) {
        const rows = () => [...filter.querySelectorAll('.csv-filter-master, .csv-filter-value-row, .csv-filter-remove-btn, .csv-filter-join-toggle')];
        t.readable('column filter', filter, rows());
        t.boxesShow('column filter', [...filter.querySelectorAll('.csv-filter-master, .csv-filter-value-row')]);
        // A second condition brings the AND/OR switch between the two.
        const sel = filter.querySelector('.csv-filter-select');
        sel.value = [...sel.options].map(o => o.value).find(v => v !== 'none') || sel.value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        await t.wait(100);
        const add = filter.querySelector('.csv-filter-add-btn');
        t.check(!!add && !add.disabled, 'a chosen condition lets another one be added');
        t.readable('column filter with a condition', filter, rows());
        if (add) add.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await t.wait(100);
        t.readable('column filter, AND', filter, rows());
        const join = filter.querySelector('.csv-filter-join-toggle');
        t.check(!!join, 'a second condition brings the AND/OR switch');
        // A hovered AND and an OR at rest have to look apart. Otherwise the
        // switch seems to flip as soon as the pointer is on it.
        const look = el => {
            const s = getComputedStyle(el);
            return [s.backgroundColor, s.borderTopColor, s.color, s.opacity].join(' ');
        };
        let andHovered = '';
        if (join) {
            join.classList.add('__hover');
            andHovered = look(join);
            join.classList.remove('__hover');
            join.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        }
        await t.wait(100);
        t.readable('column filter, OR', filter, rows());
        const or = filter.querySelector('.csv-filter-join-toggle[data-join="or"]');
        t.check(!!or && look(or) !== andHovered, 'OR at rest looks unlike a hovered AND ('
            + andHovered + ' against ' + (or && look(or)) + ')');
    }
    await t.shut();

    await t.clickId('btn-find-replace');
    t.readable('find bar', pop('find-bar'), [...pop('find-bar').querySelectorAll('button')]);
`));
