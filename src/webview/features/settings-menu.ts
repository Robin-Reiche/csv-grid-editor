import { state } from '../state';
import { readSettings, SETTING_DEFAULTS, type SettingKey } from '../settings';
import { closeAllPopups } from './popups';
import { applyColorMode } from './color-mode';
import { applyBoolCheckboxes } from './bool-checkbox';
import { syncColumnHeaders } from '../grid/refresh';

/**
 * Settings menu (issue #41).
 *
 * The small switches that are a matter of taste live here, behind the gear in
 * the toolbar, instead of in the VS Code settings, where they would be findable
 * only by people who already know they exist. Each one is a checkbox with a
 * line saying what it does, and each is remembered per user in VS Code
 * globalState as csvGridEditor.<key> (settings.ts has the list and defaults).
 *
 * Every switch here changes how the grid LOOKS or how a key behaves. None of
 * them changes a value, so switching any of them on or off leaves the file
 * exactly as it was.
 *
 * Wrap cell text keeps its toolbar button: it is switched while reading, where
 * two clicks would be one too many.
 */

type SettingItem = {
    key: SettingKey;
    group: 'View' | 'Editing';
    label: string;
    hint: string;
    apply: () => void;
};

const container = (): HTMLElement | null => document.getElementById('grid-container');

// Redraws every visible cell. Only re-renders, never touches a value.
const redrawCells = (): void => { state.gridApi?.refreshCells({ force: true }); };

// A changed look changes what auto-fit would measure, so its cached result no
// longer describes the view.
const dropAutoFit = (): void => { state.autoFitCache = null; state.isAutoFitted = false; };

const ITEMS: SettingItem[] = [
    {
        key: 'colorMode', group: 'View',
        label: 'Color columns',
        hint: 'A tint per column, so neighboring columns are easier to tell apart.',
        apply: applyColorMode,
    },
    {
        key: 'rowHighlight', group: 'View',
        label: 'Highlight the current row',
        hint: 'A faint wash across the row you are on.',
        apply: () => { container()?.classList.toggle('row-focus-off', !state.settings.rowHighlight); },
    },
    {
        key: 'typeBadges', group: 'View',
        label: 'Type badges in the header',
        hint: 'Shows 123, abc, T/F and so on before each column name. The type stays on hover.',
        apply: () => {
            container()?.classList.toggle('type-badges-off', !state.settings.typeBadges);
            dropAutoFit();
        },
    },
    {
        key: 'alignNumbers', group: 'View',
        label: 'Align numbers to the right',
        hint: 'Number columns line up on their last digit, like in a spreadsheet.',
        apply: redrawCells,
    },
    {
        key: 'markEmpty', group: 'View',
        label: 'Mark empty cells',
        hint: 'Hatches cells with nothing in them, so gaps in the data stand out.',
        apply: redrawCells,
    },
    {
        key: 'boolCheckboxes', group: 'View',
        label: 'Checkboxes for true/false columns',
        hint: 'Draws a box instead of the word. The file keeps its own spelling.',
        apply: applyBoolCheckboxes,
    },
    {
        key: 'trimDisplay', group: 'View',
        label: 'Hide spaces around values',
        hint: 'Leaves leading and trailing spaces off the screen. The file keeps them.',
        apply: () => { redrawCells(); syncColumnHeaders(); dropAutoFit(); },
    },
    {
        key: 'enterMovesDown', group: 'Editing',
        label: 'Enter moves down after editing',
        hint: 'Off: Enter saves the value and stays in the cell.',
        apply: () => { state.gridApi?.setGridOption('enterNavigatesVerticallyAfterEdit', state.settings.enterMovesDown); },
    },
];

// The gear carries a marker while anything in here differs from its default,
// so a grid that does not look like the default says why without being opened.
function updateButton(): void {
    const changed = ITEMS.some(item => state.settings[item.key] !== SETTING_DEFAULTS[item.key]);
    document.getElementById('btn-settings')?.classList.toggle('btn-active', changed);
}

function setSetting(item: SettingItem, on: boolean): void {
    state.settings[item.key] = on;
    item.apply();
    updateButton();
    vscodeApi.postMessage({ type: 'settingChanged', key: item.key, value: on });
}

function buildList(): void {
    const list = document.getElementById('settings-list');
    if (!list) return;
    list.innerHTML = '';

    let group = '';
    for (const item of ITEMS) {
        if (item.group !== group) {
            group = item.group;
            const head = document.createElement('div');
            head.className = 'settings-group';
            head.textContent = group;
            list.appendChild(head);
        }

        const row = document.createElement('label');
        row.className = 'settings-item';
        row.dataset.key = item.key;

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = state.settings[item.key];
        cb.addEventListener('change', () => setSetting(item, cb.checked));

        const text = document.createElement('span');
        text.className = 'settings-item-text';

        const label = document.createElement('span');
        label.className = 'settings-item-label';
        label.textContent = item.label;

        const hint = document.createElement('span');
        hint.className = 'settings-item-hint';
        hint.textContent = item.hint;

        text.appendChild(label);
        text.appendChild(hint);
        row.appendChild(cb);
        row.appendChild(text);
        list.appendChild(row);
    }
}

function openMenu(): void {
    const pop = document.getElementById('settings-popover');
    const btn = document.getElementById('btn-settings');
    if (!pop || !btn) return;
    buildList();
    pop.classList.remove('hidden');
    const r  = btn.getBoundingClientRect();
    const pw = pop.offsetWidth || 260;
    // The gear sits at the right edge, so the menu hangs from its right side and
    // is clamped to the window rather than running off it. A menu taller than
    // the pane scrolls instead of losing its bottom entries.
    pop.style.top  = (r.bottom + 4) + 'px';
    pop.style.left = Math.max(4, Math.min(r.right - pw, window.innerWidth - pw - 4)) + 'px';
    pop.style.maxHeight = Math.max(120, window.innerHeight - r.bottom - 12) + 'px';
}

function closeMenu(): void {
    document.getElementById('settings-popover')?.classList.add('hidden');
}

export function setupSettingsMenu(): void {
    state.settings = readSettings(INITIAL_SETTINGS);
    // Put every switch into effect for the first render. The ones that work
    // through the grid find no grid yet and are picked up when it is built
    // (builder.ts reads state.settings), the ones on the container apply now.
    for (const item of ITEMS) item.apply();
    updateButton();

    const btn = document.getElementById('btn-settings');
    btn?.addEventListener('click', (e) => {
        e.stopPropagation();
        const pop = document.getElementById('settings-popover');
        const wasOpen = pop != null && !pop.classList.contains('hidden');
        closeAllPopups();
        if (!wasOpen) openMenu();
    });

    document.addEventListener('mousedown', (evt) => {
        const pop = document.getElementById('settings-popover');
        if (!pop || pop.classList.contains('hidden')) return;
        const t = evt.target as Node;
        if (pop.contains(t)) return;
        if (btn?.contains(t)) return; // toggle button handles itself
        closeMenu();
    }, true);
}
