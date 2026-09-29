var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
/**
 * A text input with a custom inline autocomplete dropdown.
 * Emits a `value-change` CustomEvent<string> whenever the value changes.
 */
let AutocompleteInput = class AutocompleteInput extends LitElement {
    constructor() {
        super(...arguments);
        /** Full list of autocomplete options. Empty means no dropdown shown. */
        this.options = [];
        this.value = '';
        this.placeholder = '';
        this._open = false;
        this._index = -1;
    }
    static { this.styles = css `
    :host {
      display: block;
      position: relative;
    }

    input {
      width: 100%;
      box-sizing: border-box;
      background: var(--vscode-input-background, #3c3c3c);
      color: var(--vscode-input-foreground, #ccc);
      border: 1px solid var(--vscode-input-border, #454545);
      padding: 2px 4px;
      font-size: 12px;
    }

    ul {
      position: absolute;
      top: 100%;
      left: 0;
      right: 0;
      z-index: 100;
      background: var(--vscode-dropdown-background, #3c3c3c);
      border: 1px solid var(--vscode-dropdown-border, #454545);
      max-height: 140px;
      overflow-y: auto;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    li {
      padding: 3px 6px;
      font-size: 12px;
      cursor: pointer;
      color: var(--vscode-dropdown-foreground, #ccc);
    }

    li:hover,
    li.active {
      background: var(--vscode-list-activeSelectionBackground, #094771);
      color: var(--vscode-list-activeSelectionForeground, #fff);
    }
  `; }
    get _filtered() {
        if (!this.value)
            return this.options;
        const lower = this.value.toLowerCase();
        return this.options.filter(o => o.toLowerCase().includes(lower));
    }
    _emit() {
        this.dispatchEvent(new CustomEvent('value-change', { detail: this.value }));
    }
    _select(option) {
        this.value = option;
        this._open = false;
        this._index = -1;
        this._emit();
    }
    render() {
        const filtered = this._filtered;
        return html `
      <input
        type="text"
        placeholder=${this.placeholder}
        .value=${this.value}
        @focus=${() => { this._open = true; this._index = -1; }}
        @blur=${() => { setTimeout(() => { this._open = false; }, 150); }}
        @input=${(e) => {
            this.value = e.target.value;
            this._open = true;
            this._index = -1;
            this._emit();
        }}
        @keydown=${(e) => {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                this._index = Math.min(this._index + 1, filtered.length - 1);
            }
            else if (e.key === 'ArrowUp') {
                e.preventDefault();
                this._index = Math.max(this._index - 1, -1);
            }
            else if (e.key === 'Enter') {
                if (this._index >= 0 && filtered[this._index]) {
                    e.stopPropagation();
                    this._select(filtered[this._index]);
                }
                // if no autocomplete selection, let Enter bubble to parent
            }
            else if (e.key === 'Escape') {
                this._open = false;
            }
        }}
      />
      ${this._open && filtered.length > 0 ? html `
        <ul>
          ${filtered.map((o, idx) => html `
            <li
              class=${idx === this._index ? 'active' : ''}
              @mousedown=${() => this._select(o)}
            >${o}</li>
          `)}
        </ul>
      ` : ''}
    `;
    }
};
__decorate([
    property({ type: Array })
], AutocompleteInput.prototype, "options", void 0);
__decorate([
    property({ type: String })
], AutocompleteInput.prototype, "value", void 0);
__decorate([
    property({ type: String })
], AutocompleteInput.prototype, "placeholder", void 0);
__decorate([
    state()
], AutocompleteInput.prototype, "_open", void 0);
__decorate([
    state()
], AutocompleteInput.prototype, "_index", void 0);
AutocompleteInput = __decorate([
    customElement('foam-autocomplete-input')
], AutocompleteInput);
export { AutocompleteInput };
