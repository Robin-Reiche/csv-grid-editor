import type { ColType } from '../types';
import { state } from '../state';
import { trimPadding } from '../utils/csv';

// `join` is the operator linking this condition to the previous one in the
// list (unused on the first condition). Conditions with join 'or' start a new
// OR-group; AND binds tighter than OR.
type Condition = { type: string; value: string; join: 'and' | 'or' };

// The value a row is listed and matched under: what the grid shows for it, so
// with "Hide spaces around values" on ' Berlin ' and 'Berlin' are one entry and
// with it off they are two. The list and doesFilterPass both go through here,
// which is what keeps a ticked value from hiding its rows. A value made of
// nothing but whitespace counts as blank either way. '' means blank.
// `trimmed` is the setting to key under, the same rule as shownValue in
// control-char-cell.ts but passed in, because _syncKeys needs the old keys too.
function filterKey(raw: unknown, trimmed: boolean): string {
    if (raw == null) return '';
    const s = String(raw);
    return s.trim() === '' ? '' : trimmed ? trimPadding(s) : s;
}

// One collator for the whole sort of a value list. localeCompare with options
// builds a new one on each call. A sort makes n log n calls, which took seconds
// on a column with many different values.
const collator = new Intl.Collator(undefined, { sensitivity: 'base' });

// Counts the changes to the rows the value lists are made from. A list keeps
// the count it was made at. Opening its panel makes the list again only when
// the count has moved since. builder.ts counts every row swap and every edit
// that goes through the grid. Replace (find-replace.ts) and Delete on a
// selection (range-select.ts) write into the rows past the grid, so they count
// as well.
let rowsVersion = 0;

export function markValueListsStale(): void {
    rowsVersion++;
}

// How many values the list draws. A column can hold far more different values
// than anyone scrolls through. Drawing them all would take seconds. Only the
// drawing stops here. The filter keeps a tick for every value, so the ones
// not drawn pass until the user unticks them, through Select all or by
// searching the list for them.
const LIST_CAP = 2000;

export function createCombinedFilter(colType: ColType): any {
    return class {
        params: any;
        allValues: string[] = [];
        hasBlank = false;
        checkedValues = new Set<string>();
        conditions: Condition[] = [{ type: 'none', value: '', join: 'and' }];
        eGui!: HTMLElement;
        _searchQuery = '';
        _renderValuesList: (() => void) | null = null;
        _displayedValues: string[] = [];
        // The trimDisplay setting the keys above were made under. See _syncKeys.
        _keyedTrimmed = state.settings.trimDisplay;
        // The rowsVersion the list was made at.
        _builtAt = -1;
        // Whether every value is ticked, null until asked. See _everyTicked.
        _allTicked: boolean | null = null;
        // The last key typed into a condition, waiting for the typing to
        // pause. See _applyTyped.
        _typing: ReturnType<typeof setTimeout> | null = null;

        init(params: any) {
            this.params = params;
            this._buildValueList();
            this.checkedValues = new Set(this.allValues);
            if (this.hasBlank) this.checkedValues.add('__blank__');
            this._ticksChanged();
            this.eGui = document.createElement('div');
            this.eGui.className = 'csv-filter-panel';
            this._render();
        }

        _buildValueList() {
            const field = this.params.column.getColId();
            const vals = new Set<string>();
            this.hasBlank = false;
            this._keyedTrimmed = state.settings.trimDisplay;
            this._builtAt = rowsVersion;
            this.params.api.forEachNode((n: any) => {
                const key = filterKey(n.data[field], this._keyedTrimmed);
                if (key === '') { this.hasBlank = true; return; }
                vals.add(key);
            });
            let arr = Array.from(vals);
            if (colType === 'integer' || colType === 'float') {
                arr.sort((a, b) => Number(a) - Number(b));
            } else {
                arr.sort(collator.compare);
            }
            this.allValues = arr;
            this._ticksChanged();
        }

        // Whether every value is ticked, the blank one too. The ticks then let
        // every row through, which is how the filter starts and how it stays
        // while a condition is typed. doesFilterPass asks this for every row.
        // Worked out there, it went through all values once per row, which
        // froze the grid for about a second per key typed on 100,000 rows. So
        // it is kept. Every change to the list or to the ticks drops it.
        _everyTicked(): boolean {
            if (this._allTicked === null) {
                this._allTicked = this.allValues.every(v => this.checkedValues.has(v))
                    && (!this.hasBlank || this.checkedValues.has('__blank__'));
            }
            return this._allTicked;
        }

        _ticksChanged() {
            this._allTicked = null;
        }

        // Applies what is typed into a condition once the typing pauses. Each
        // key used to run the filter over every row and draw the value list
        // again. The condition holds the typed text at once, so the key typed
        // last is the one that applies, also when the panel is closed before
        // the pause is over.
        _applyTyped() {
            if (this._typing !== null) clearTimeout(this._typing);
            this._typing = setTimeout(() => {
                this._typing = null;
                this._renderValuesList?.();
                this.params.filterChangedCallback();
            }, 200);
        }

        _conditionOptions() {
            if (colType === 'integer' || colType === 'float') {
                return [
                    { id: 'none', label: '\u2014 No condition \u2014' },
                    { id: 'eq',  label: '= Equals' },
                    { id: 'neq', label: '\u2260 Does not equal' },
                    { id: 'gt',  label: '> Greater than' },
                    { id: 'gte', label: '\u2265 Greater than or equal' },
                    { id: 'lt',  label: '< Less than' },
                    { id: 'lte', label: '\u2264 Less than or equal' },
                    { id: 'blank',    label: 'Is blank' },
                    { id: 'notblank', label: 'Is not blank' },
                ];
            } else if (colType === 'date' || colType === 'datetime' || colType === 'time') {
                return [
                    { id: 'none', label: '\u2014 No condition \u2014' },
                    { id: 'eq',  label: '= Equals' },
                    { id: 'neq', label: '\u2260 Does not equal' },
                    { id: 'gt',  label: '> After' },
                    { id: 'gte', label: '\u2265 After or on' },
                    { id: 'lt',  label: '< Before' },
                    { id: 'lte', label: '\u2264 Before or on' },
                    { id: 'blank',    label: 'Is blank' },
                    { id: 'notblank', label: 'Is not blank' },
                ];
            } else {
                return [
                    { id: 'none',        label: '\u2014 No condition \u2014' },
                    { id: 'contains',    label: 'Contains' },
                    { id: 'notcontains', label: 'Does not contain' },
                    { id: 'eq',          label: 'Equals' },
                    { id: 'neq',         label: 'Does not equal' },
                    { id: 'startswith',  label: 'Begins with' },
                    { id: 'endswith',    label: 'Ends with' },
                    { id: 'blank',       label: 'Is blank' },
                    { id: 'notblank',    label: 'Is not blank' },
                ];
            }
        }

        // Brings the list and the ticks up to date with the rows. The list is
        // made from the rows, so an edit, a paste or an outside change that
        // brings in a value or takes the last one away leaves it stale. Opening
        // the panel passes `force` for that reason, when the rows changed since
        // the list was made. Switching "Hide spaces around values" changes what
        // a value is keyed under, so everything that reads the keys calls this
        // first. The filter then never compares keys of two kinds.
        //
        // The ticks carry over row by row: a new key is ticked when any row
        // behind it was ticked under the old key. A value the old list did not
        // have follows Select all. It is ticked when every value was, so a
        // filter that let everything through still does. Otherwise it is
        // unticked, which is how the filter already treated it. While the
        // keys stay the same, the ticks of values no row holds right now are
        // kept, so an undo that brings a ticked value back finds it still
        // ticked.
        _syncKeys(force = false) {
            const rekey = this._keyedTrimmed !== state.settings.trimDisplay;
            if (!rekey && !force) return;
            const field = this.params.column.getColId();
            const known = new Set(this.allValues);
            const allTicked = this._everyTicked();
            const wasTicked = (oldKey: string) =>
                oldKey === '' ? (this.hasBlank ? this.checkedValues.has('__blank__') : allTicked)
                    : known.has(oldKey) ? this.checkedValues.has(oldKey) : allTicked;
            const checked = rekey ? new Set<string>() : new Set(this.checkedValues);
            if (this.checkedValues.has('__blank__')) checked.add('__blank__');
            this.params.api.forEachNode((n: any) => {
                const v = n.data[field];
                if (!wasTicked(filterKey(v, this._keyedTrimmed))) return;
                const newKey = filterKey(v, state.settings.trimDisplay);
                checked.add(newKey === '' ? '__blank__' : newKey);
            });
            this._buildValueList();
            this.checkedValues = checked;
            this._ticksChanged();
            // The panel is kept between openings, so its list is redrawn here
            // rather than showing the old keys the next time it opens.
            this._renderValuesList?.();
        }

        // ── condition evaluation ───────────────────────────────────────────────

        _passesSingleCondition(valStr: string, cond: Condition): boolean {
            const ct = cond.type;
            if (ct === 'none') return true;
            const isBlank = valStr === '';
            if (ct === 'blank')    return isBlank;
            if (ct === 'notblank') return !isBlank;
            if (!cond.value) return true;

            const cv = cond.value;
            const isNumeric  = colType === 'integer' || colType === 'float';
            const isDateType = colType === 'date' || colType === 'datetime' || colType === 'time';
            // With "Hide spaces around values" off the key keeps the file's
            // padding, but a number or a date is the same with or without it.
            // The parse gets the bare value, the way column-type.ts detected it,
            // because new Date(' 2024-01-05') reads local midnight instead of
            // the ISO date and lands on the day before east of UTC.
            const bare = valStr.trim();

            if (isNumeric) {
                const nCell = Number(bare), nCond = Number(cv);
                if (isNaN(nCell)) return false;
                if (ct === 'eq')  return nCell === nCond;
                if (ct === 'neq') return nCell !== nCond;
                if (ct === 'gt')  return nCell > nCond;
                if (ct === 'gte') return nCell >= nCond;
                if (ct === 'lt')  return nCell < nCond;
                if (ct === 'lte') return nCell <= nCond;
            } else if (isDateType) {
                const dCell = new Date(bare), dCond = new Date(cv);
                if (isNaN(dCell.getTime())) return false;
                const ds = dCell.toISOString().slice(0, 10);
                const dc = dCond.toISOString().slice(0, 10);
                if (ct === 'eq')  return ds === dc;
                if (ct === 'neq') return ds !== dc;
                if (ct === 'gt')  return dCell > dCond;
                if (ct === 'gte') return dCell >= dCond;
                if (ct === 'lt')  return dCell < dCond;
                if (ct === 'lte') return dCell <= dCond;
            } else {
                const lo = valStr.toLowerCase(), lc = cv.toLowerCase();
                if (ct === 'contains')    return lo.includes(lc);
                if (ct === 'notcontains') return !lo.includes(lc);
                if (ct === 'eq')          return lo === lc;
                if (ct === 'neq')         return lo !== lc;
                if (ct === 'startswith')  return lo.startsWith(lc);
                if (ct === 'endswith')    return lo.endsWith(lc);
            }
            return true;
        }

        _passesConditions(valStr: string): boolean {
            // Active conditions are split into OR-groups: a new group begins at
            // each condition whose join is 'or'. AND binds tighter than OR, so
            // the value passes when every condition of any one group passes.
            const active = this.conditions.filter(c => c.type !== 'none');
            if (active.length === 0) return true;
            const groups: Condition[][] = [[]];
            active.forEach((c, idx) => {
                if (idx > 0 && c.join === 'or') groups.push([]);
                groups[groups.length - 1].push(c);
            });
            return groups.some(g => g.every(c => this._passesSingleCondition(valStr, c)));
        }

        _valuesPassingCondition(): string[] {
            this._syncKeys();
            return this.allValues.filter(v => this._passesConditions(v));
        }

        _showBlankInList(): boolean {
            return this.hasBlank && this._passesConditions('');
        }

        _hasAnyActiveCondition(): boolean {
            return this.conditions.some(c => c.type !== 'none');
        }

        // ── rendering ─────────────────────────────────────────────────────────

        _render() {
            this.eGui.innerHTML = '';
            const isNumeric = colType === 'integer' || colType === 'float';
            const isDate    = colType === 'date'    || colType === 'datetime';

            // ── Condition section ──
            const condSec = document.createElement('div');
            condSec.className = 'csv-filter-section';
            const condLabel = document.createElement('div');
            condLabel.className = 'csv-filter-section-label';
            condLabel.textContent = 'Condition';
            condSec.appendChild(condLabel);

            const condRowsDiv = document.createElement('div');
            condRowsDiv.className = 'csv-filter-cond-rows';

            const rebuildCondRows = () => {
                condRowsDiv.innerHTML = '';
                this.conditions.forEach((cond, i) => {
                    // AND/OR join toggle between rows — click to flip the operator
                    if (i > 0) {
                        if (cond.join !== 'or') cond.join = 'and';
                        const joinBtn = document.createElement('button');
                        joinBtn.type = 'button';
                        joinBtn.className = 'csv-filter-join-toggle';
                        joinBtn.title = 'Toggle AND / OR';
                        joinBtn.textContent = cond.join === 'or' ? 'OR' : 'AND';
                        joinBtn.dataset.join = cond.join;
                        joinBtn.addEventListener('click', () => {
                            cond.join = cond.join === 'or' ? 'and' : 'or';
                            joinBtn.textContent = cond.join === 'or' ? 'OR' : 'AND';
                            joinBtn.dataset.join = cond.join;
                            this._renderValuesList?.();
                            this.params.filterChangedCallback();
                        });
                        condRowsDiv.appendChild(joinBtn);
                    }

                    const row = document.createElement('div');
                    row.className = 'csv-filter-cond-row';

                    // Condition type dropdown
                    const sel = document.createElement('select');
                    sel.className = 'csv-filter-select';
                    this._conditionOptions().forEach(opt => {
                        const o = document.createElement('option');
                        o.value = opt.id;
                        o.textContent = opt.label;
                        if (opt.id === cond.type) o.selected = true;
                        sel.appendChild(o);
                    });
                    sel.addEventListener('change', () => {
                        cond.type = sel.value;
                        const newNeedsInput = sel.value !== 'none' && sel.value !== 'blank' && sel.value !== 'notblank';
                        if (!newNeedsInput) cond.value = '';
                        rebuildCondRows();
                        this._renderValuesList?.();
                        this.params.filterChangedCallback();
                    });
                    row.appendChild(sel);

                    // Value input (only when condition needs a value)
                    const needsInput = cond.type !== 'none' && cond.type !== 'blank' && cond.type !== 'notblank';
                    if (needsInput) {
                        const inp = document.createElement('input');
                        inp.className = 'csv-filter-input csv-filter-cond-input';
                        inp.type = isNumeric ? 'number' : isDate ? 'date' : 'text';
                        inp.value = cond.value;
                        inp.placeholder = isNumeric ? 'Value\u2026' : 'Filter\u2026';
                        inp.addEventListener('input', () => {
                            cond.value = inp.value;
                            this._applyTyped();
                        });
                        row.appendChild(inp);
                    }

                    // Remove button
                    const removeBtn = document.createElement('button');
                    removeBtn.className = 'csv-filter-remove-btn';
                    removeBtn.title = 'Remove condition';
                    removeBtn.textContent = '\u00D7';
                    removeBtn.addEventListener('click', () => {
                        if (this.conditions.length === 1) {
                            // Reset instead of removing
                            this.conditions[0] = { type: 'none', value: '', join: 'and' };
                        } else {
                            this.conditions.splice(i, 1);
                        }
                        rebuildCondRows();
                        this._renderValuesList?.();
                        this.params.filterChangedCallback();
                    });
                    row.appendChild(removeBtn);

                    condRowsDiv.appendChild(row);
                });

                // Add condition button
                const addBtn = document.createElement('button');
                addBtn.className = 'csv-filter-add-btn';
                addBtn.textContent = '+ Add condition';
                const lastCond = this.conditions[this.conditions.length - 1];
                addBtn.disabled = lastCond.type === 'none';
                addBtn.addEventListener('click', () => {
                    this.conditions.push({ type: 'none', value: '', join: 'and' });
                    rebuildCondRows();
                    this.params.filterChangedCallback();
                });
                condRowsDiv.appendChild(addBtn);
            };

            rebuildCondRows();
            condSec.appendChild(condRowsDiv);
            this.eGui.appendChild(condSec);

            // ── Values section ──
            const valSec = document.createElement('div');
            valSec.className = 'csv-filter-section';
            const valLabel = document.createElement('div');
            valLabel.className = 'csv-filter-section-label';
            valLabel.textContent = 'Values';
            valSec.appendChild(valLabel);

            const searchInp = document.createElement('input');
            searchInp.className = 'csv-filter-input';
            searchInp.style.marginTop = '0';
            searchInp.placeholder = 'Search values\u2026';
            searchInp.value = this._searchQuery;
            valSec.appendChild(searchInp);

            const masterRow = document.createElement('label');
            masterRow.className = 'csv-filter-master';
            const masterCb = document.createElement('input');
            masterCb.type = 'checkbox';
            const masterLabel = document.createElement('span');
            masterLabel.className = 'csv-filter-master-label';
            masterLabel.textContent = 'Select all';
            const masterCount = document.createElement('span');
            masterCount.className = 'csv-filter-master-count';
            masterRow.appendChild(masterCb);
            masterRow.appendChild(masterLabel);
            masterRow.appendChild(masterCount);
            valSec.appendChild(masterRow);

            const listDiv = document.createElement('div');
            listDiv.className = 'csv-filter-values-list';
            valSec.appendChild(listDiv);

            const syncMaster = () => {
                const displayed = this._displayedValues;
                const total = displayed.length;
                let checked = 0;
                for (const v of displayed) if (this.checkedValues.has(v)) checked++;
                masterCb.checked = total > 0 && checked === total;
                masterCb.indeterminate = checked > 0 && checked < total;
                masterCb.disabled = total === 0;
                masterCount.textContent = total > 0 ? `${checked} / ${total}` : '';
                masterLabel.textContent = this._searchQuery ? 'Select all matches' : 'Select all';
            };

            const renderList = () => {
                listDiv.innerHTML = '';
                const q = this._searchQuery.toLowerCase();

                let items: { label: string; value: string; isBlank: boolean }[] = [];
                if (this._showBlankInList()) items.push({ label: '(Blank)', value: '__blank__', isBlank: true });
                this._valuesPassingCondition().forEach(v => items.push({ label: v, value: v, isBlank: false }));
                if (q) items = items.filter(it => it.label.toLowerCase().includes(q));

                // Select all goes by these, the values past the drawn ones too.
                this._displayedValues = items.map(it => it.value);
                const drawn = items.slice(0, LIST_CAP + (items[0]?.isBlank ? 1 : 0));

                if (items.length === 0) {
                    const empty = document.createElement('div');
                    empty.className = 'csv-filter-empty';
                    empty.textContent = this._hasAnyActiveCondition()
                        ? 'No values match this condition'
                        : 'No matching values';
                    listDiv.appendChild(empty);
                    syncMaster();
                    return;
                }
                drawn.forEach(item => {
                    const row = document.createElement('label');
                    row.className = 'csv-filter-value-row';
                    const cb = document.createElement('input');
                    cb.type = 'checkbox';
                    cb.checked = this.checkedValues.has(item.value);
                    cb.addEventListener('change', () => {
                        if (cb.checked) this.checkedValues.add(item.value);
                        else this.checkedValues.delete(item.value);
                        this._ticksChanged();
                        syncMaster();
                        this.params.filterChangedCallback();
                    });
                    const span = document.createElement('span');
                    span.className = 'csv-filter-value-label' + (item.isBlank ? ' blank' : '');
                    span.textContent = item.label;
                    row.appendChild(cb);
                    row.appendChild(span);
                    listDiv.appendChild(row);
                });
                if (drawn.length < items.length) {
                    const note = document.createElement('div');
                    note.className = 'csv-filter-empty';
                    note.textContent = `Showing first ${LIST_CAP} unique values`;
                    listDiv.appendChild(note);
                }
                syncMaster();
            };

            this._renderValuesList = renderList;

            masterCb.addEventListener('change', () => {
                const check = masterCb.checked;
                for (const v of this._displayedValues) {
                    if (check) this.checkedValues.add(v);
                    else this.checkedValues.delete(v);
                }
                this._ticksChanged();
                renderList();
                this.params.filterChangedCallback();
            });

            searchInp.addEventListener('input', () => {
                this._searchQuery = searchInp.value;
                renderList();
            });
            renderList();
            this.eGui.appendChild(valSec);
        }

        getGui() { return this.eGui; }

        // AG Grid calls this each time the panel opens, which is when a stale
        // list would show. While the rows are as they were, the list on hand
        // is still right and is kept. Making it again cost seconds on a column
        // with many different values. On the first open init has just made it.
        afterGuiAttached() { this._syncKeys(this._builtAt !== rowsVersion); }

        isFilterActive() {
            this._syncKeys();
            if (this._hasAnyActiveCondition()) return true;
            return !this._everyTicked();
        }

        doesFilterPass(params: any) {
            const field   = this.params.column.getColId();
            this._syncKeys();
            const valStr  = filterKey(params.data[field], this._keyedTrimmed);
            const isBlank = valStr === '';

            // 1. Checkbox filter
            if (!this._everyTicked()) {
                const key = isBlank ? '__blank__' : valStr;
                if (!this.checkedValues.has(key)) return false;
            }

            // 2. Conditions (AND/OR groups)
            return this._passesConditions(valStr);
        }

        getModel() {
            this._syncKeys();
            if (!this.isFilterActive()) return null;
            return {
                conditions: this.conditions.map(c => ({ type: c.type, value: c.value, join: c.join })),
                checkedValues: Array.from(this.checkedValues),
            };
        }

        setModel(model: any) {
            if (model == null) {
                this.conditions = [{ type: 'none', value: '', join: 'and' }];
                this._searchQuery = '';
                this.checkedValues = new Set(this.allValues);
                if (this.hasBlank) this.checkedValues.add('__blank__');
            } else {
                // Support legacy single-condition format and models without `join`
                if (Array.isArray(model.conditions)) {
                    this.conditions = model.conditions.map((c: any) => ({
                        type: c.type || 'none',
                        value: c.value || '',
                        join: c.join === 'or' ? 'or' : 'and',
                    }));
                } else if (model.condType) {
                    this.conditions = [{ type: model.condType, value: model.condValue || '', join: 'and' }];
                } else {
                    this.conditions = [{ type: 'none', value: '', join: 'and' }];
                }
                if (this.conditions.length === 0) this.conditions = [{ type: 'none', value: '', join: 'and' }];
                this.checkedValues = new Set(model.checkedValues || this.allValues);
            }
            this._ticksChanged();
            this._render();
        }

        // A grid built again makes its filters afresh, so a key still waiting
        // has nothing left to apply to.
        destroy() {
            if (this._typing !== null) clearTimeout(this._typing);
        }
    };
}
