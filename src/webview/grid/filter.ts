import type { ColType } from '../types';

type Condition = { type: string; value: string };

export function createCombinedFilter(colType: ColType): any {
    return class {
        params: any;
        allValues: string[] = [];
        hasBlank = false;
        checkedValues = new Set<string>();
        conditions: Condition[] = [{ type: 'none', value: '' }];
        eGui!: HTMLElement;
        _searchQuery = '';
        truncated = false;
        _renderValuesList: (() => void) | null = null;

        init(params: any) {
            this.params = params;
            this._buildValueList();
            this.checkedValues = new Set(this.allValues);
            if (this.hasBlank) this.checkedValues.add('__blank__');
            this.eGui = document.createElement('div');
            this.eGui.className = 'csv-filter-panel';
            this._render();
        }

        _buildValueList() {
            const field = this.params.column.getColId();
            const vals = new Set<string>();
            this.hasBlank = false;
            this.params.api.forEachNode((n: any) => {
                const v = n.data[field];
                if (v == null || String(v).trim() === '') { this.hasBlank = true; return; }
                vals.add(String(v));
            });
            let arr = Array.from(vals);
            if (colType === 'integer' || colType === 'float') {
                arr.sort((a, b) => Number(a) - Number(b));
            } else {
                arr.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
            }
            this.allValues = arr.slice(0, 2000);
            this.truncated = arr.length > 2000;
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

            if (isNumeric) {
                const nCell = Number(valStr), nCond = Number(cv);
                if (isNaN(nCell)) return false;
                if (ct === 'eq')  return nCell === nCond;
                if (ct === 'neq') return nCell !== nCond;
                if (ct === 'gt')  return nCell > nCond;
                if (ct === 'gte') return nCell >= nCond;
                if (ct === 'lt')  return nCell < nCond;
                if (ct === 'lte') return nCell <= nCond;
            } else if (isDateType) {
                const dCell = new Date(valStr), dCond = new Date(cv);
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

        _passesAllConditions(valStr: string): boolean {
            return this.conditions.every(c => this._passesSingleCondition(valStr, c));
        }

        _valuesPassingCondition(): string[] {
            return this.allValues.filter(v => this._passesAllConditions(v));
        }

        _showBlankInList(): boolean {
            return this.hasBlank && this._passesAllConditions('');
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
                    // AND label between rows
                    if (i > 0) {
                        const andLbl = document.createElement('div');
                        andLbl.className = 'csv-filter-and-label';
                        andLbl.textContent = 'AND';
                        condRowsDiv.appendChild(andLbl);
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
                            this._renderValuesList?.();
                            this.params.filterChangedCallback();
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
                            this.conditions[0] = { type: 'none', value: '' };
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
                    this.conditions.push({ type: 'none', value: '' });
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

            const actions = document.createElement('div');
            actions.className = 'csv-filter-actions';
            const selAll = document.createElement('button');
            selAll.className = 'csv-filter-link';
            selAll.textContent = 'Select All';
            const deselAll = document.createElement('button');
            deselAll.className = 'csv-filter-link';
            deselAll.textContent = 'Deselect All';
            actions.appendChild(selAll);
            actions.appendChild(deselAll);
            valSec.appendChild(actions);

            const listDiv = document.createElement('div');
            listDiv.className = 'csv-filter-values-list';
            valSec.appendChild(listDiv);

            const renderList = () => {
                listDiv.innerHTML = '';
                const q = this._searchQuery.toLowerCase();

                // Only values that pass ALL active conditions
                let items: { label: string; value: string; isBlank: boolean }[] = [];
                if (this._showBlankInList()) items.push({ label: '(Blank)', value: '__blank__', isBlank: true });
                this._valuesPassingCondition().forEach(v => items.push({ label: v, value: v, isBlank: false }));
                if (q) items = items.filter(it => it.label.toLowerCase().includes(q));

                if (items.length === 0) {
                    const empty = document.createElement('div');
                    empty.className = 'csv-filter-empty';
                    empty.textContent = this._hasAnyActiveCondition()
                        ? 'No values match this condition'
                        : 'No matching values';
                    listDiv.appendChild(empty);
                    return;
                }
                items.forEach(item => {
                    const row = document.createElement('label');
                    row.className = 'csv-filter-value-row';
                    const cb = document.createElement('input');
                    cb.type = 'checkbox';
                    cb.checked = this.checkedValues.has(item.value);
                    cb.addEventListener('change', () => {
                        if (cb.checked) this.checkedValues.add(item.value);
                        else this.checkedValues.delete(item.value);
                        this.params.filterChangedCallback();
                    });
                    const span = document.createElement('span');
                    span.className = 'csv-filter-value-label' + (item.isBlank ? ' blank' : '');
                    span.textContent = item.label;
                    row.appendChild(cb);
                    row.appendChild(span);
                    listDiv.appendChild(row);
                });
                if (this.truncated && !q) {
                    const note = document.createElement('div');
                    note.className = 'csv-filter-empty';
                    note.textContent = 'Showing first 2000 unique values';
                    listDiv.appendChild(note);
                }
            };

            this._renderValuesList = renderList;

            selAll.addEventListener('click', () => {
                this._valuesPassingCondition().forEach(v => this.checkedValues.add(v));
                if (this._showBlankInList()) this.checkedValues.add('__blank__');
                renderList();
                this.params.filterChangedCallback();
            });
            deselAll.addEventListener('click', () => {
                this.checkedValues.clear();
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

        isFilterActive() {
            if (this._hasAnyActiveCondition()) return true;
            const allChecked = this.allValues.every(v => this.checkedValues.has(v));
            return this.hasBlank ? !(allChecked && this.checkedValues.has('__blank__')) : !allChecked;
        }

        doesFilterPass(params: any) {
            const field   = this.params.column.getColId();
            const raw     = params.data[field];
            const valStr  = raw != null ? String(raw).trim() : '';
            const isBlank = valStr === '';

            // 1. Checkbox filter
            const allChecked = this.allValues.every(v => this.checkedValues.has(v)) &&
                (!this.hasBlank || this.checkedValues.has('__blank__'));
            if (!allChecked) {
                const key = isBlank ? '__blank__' : valStr;
                if (!this.checkedValues.has(key)) return false;
            }

            // 2. All conditions (AND)
            return this._passesAllConditions(valStr);
        }

        getModel() {
            if (!this.isFilterActive()) return null;
            return {
                conditions: this.conditions.map(c => ({ type: c.type, value: c.value })),
                checkedValues: Array.from(this.checkedValues),
            };
        }

        setModel(model: any) {
            if (model == null) {
                this.conditions = [{ type: 'none', value: '' }];
                this._searchQuery = '';
                this.checkedValues = new Set(this.allValues);
                if (this.hasBlank) this.checkedValues.add('__blank__');
            } else {
                // Support legacy single-condition format
                if (Array.isArray(model.conditions)) {
                    this.conditions = model.conditions.map((c: any) => ({ type: c.type || 'none', value: c.value || '' }));
                } else if (model.condType) {
                    this.conditions = [{ type: model.condType, value: model.condValue || '' }];
                } else {
                    this.conditions = [{ type: 'none', value: '' }];
                }
                if (this.conditions.length === 0) this.conditions = [{ type: 'none', value: '' }];
                this.checkedValues = new Set(model.checkedValues || this.allValues);
            }
            this._render();
        }

        destroy() {}
    };
}
