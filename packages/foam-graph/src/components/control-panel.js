var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var ControlPanel_1;
import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import './autocomplete-input';
import { getTypeColor } from '../lib/colors';
let ControlPanel = class ControlPanel extends LitElement {
    constructor() {
        super(...arguments);
        this.style = {};
        this.showNodesOfType = {};
        this.nodeTypeCounts = {};
        this.groupMatchCounts = {};
        this.autocompleteOptions = [];
        this.previewMatchCount = 0;
        this.groupDraft = {
            active: false,
            property: 'type',
            value: '',
        };
        this.groups = [];
        this.textFade = 0;
        this.nodeFontSizeMultiplier = 1;
        this.nodeSizeMultiplier = 1.5;
        this.linkWidthMultiplier = 2;
        this.animateLinks = 'forward';
        this.forces = {
            collide: 2,
            repel: 30,
            link: 30,
            velocityDecay: 0.4,
        };
        this.selection = {
            neighborDepth: 1,
            centerOnSelect: true,
            zoomOnSelect: true,
        };
        this.graphScope = 'full';
    }
    static { ControlPanel_1 = this; }
    static { this.styles = css `
    :host {
      position: fixed;
      top: 8px;
      right: 8px;
      width: 220px;
      display: block;
      background: var(--vscode-sideBar-background, #252526);
      border: 1px solid var(--vscode-panel-border, #454545);
      border-radius: 4px;
      font-size: 12px;
      color: var(--vscode-foreground, #ccc);
      z-index: 10;
      user-select: none;
    }

    details {
      border-bottom: 1px solid var(--vscode-panel-border, #454545);
    }

    details:last-child {
      border-bottom: none;
    }

    summary {
      padding: 5px 8px;
      cursor: pointer;
      font-weight: 600;
      list-style: none;
      display: flex;
      align-items: center;
      gap: 4px;
      background: var(--vscode-sideBarSectionHeader-background, #2d2d2d);
    }

    summary::before {
      content: '▶';
      font-size: 8px;
      transition: transform 0.1s;
    }

    details[open] summary::before {
      transform: rotate(90deg);
    }

    .section-content {
      padding: 6px 8px 8px;
      display: flex;
      flex-direction: column;
      gap: 7px;
    }

    .checkbox-row {
      display: flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
    }

    .checkbox-row .group-dot {
      margin-left: auto;
    }

    .checkbox-row input[type='checkbox'] {
      appearance: none;
      -webkit-appearance: none;
      width: 13px;
      height: 13px;
      flex-shrink: 0;
      border: 1px solid var(--vscode-checkbox-border, #6b6b6b);
      background: var(--vscode-checkbox-background, #3c3c3c);
      border-radius: 2px;
      margin: 0;
      cursor: pointer;
      position: relative;
    }

    .checkbox-row input[type='checkbox']:checked {
      background: var(--vscode-focusBorder, #007acc);
      border-color: var(--vscode-focusBorder, #007acc);
    }

    .checkbox-row input[type='checkbox']:checked::after {
      content: '';
      position: absolute;
      left: 3px;
      top: 0px;
      width: 4px;
      height: 8px;
      border: 1.5px solid white;
      border-top: none;
      border-left: none;
      transform: rotate(45deg);
    }

    .slider-row {
      display: grid;
      grid-template-columns: 60px 1fr 32px;
      align-items: center;
      gap: 4px;
    }

    .slider-row input[type='range'] {
      appearance: none;
      -webkit-appearance: none;
      width: 100%;
      height: 3px;
      background: var(--vscode-scrollbarSlider-background, #424242);
      border-radius: 2px;
      outline: none;
      margin: 0;
      cursor: pointer;
    }

    .slider-row input[type='range']::-webkit-slider-thumb {
      -webkit-appearance: none;
      width: 11px;
      height: 11px;
      background: var(--vscode-focusBorder, #007acc);
      border-radius: 50%;
      cursor: pointer;
    }

    .slider-row input[type='range']::-moz-range-thumb {
      width: 11px;
      height: 11px;
      background: var(--vscode-focusBorder, #007acc);
      border-radius: 50%;
      cursor: pointer;
      border: none;
    }

    .value {
      text-align: right;
      font-variant-numeric: tabular-nums;
      opacity: 0.8;
    }

    .select-row {
      display: grid;
      grid-template-columns: 60px 1fr;
      align-items: center;
      gap: 4px;
    }

    .group-dot {
      font-size: 10px;
      line-height: 1;
      flex-shrink: 0;
    }

    select {
      background: var(--vscode-dropdown-background, #3c3c3c);
      color: var(--vscode-dropdown-foreground, #ccc);
      border: 1px solid var(--vscode-dropdown-border, #454545);
      padding: 2px 4px;
      font-size: 12px;
    }

    .group-divider {
      border: none;
      border-top: 1px solid var(--vscode-panel-border, #454545);
      margin: 4px 0;
    }

    .group-row {
      display: flex;
      align-items: center;
      gap: 5px;
    }

    .group-dot {
      cursor: pointer;
    }

    .group-dot input[type='color'] {
      display: none;
    }

    .group-label {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .group-match-hint {
      opacity: 0.55;
      font-size: 10px;
      flex-shrink: 0;
    }

    .icon-btn {
      background: none;
      border: none;
      color: var(--vscode-foreground, #ccc);
      cursor: pointer;
      padding: 0 2px;
      font-size: 11px;
      opacity: 0.6;
      flex-shrink: 0;
    }

    .icon-btn:hover {
      opacity: 1;
    }

    .add-group-btn {
      background: none;
      border: 1px dashed var(--vscode-panel-border, #454545);
      color: var(--vscode-foreground, #ccc);
      cursor: pointer;
      padding: 3px 6px;
      font-size: 11px;
      width: 100%;
      text-align: left;
      opacity: 0.7;
    }

    .add-group-btn:hover {
      opacity: 1;
    }

    .add-group-form {
      display: flex;
      flex-direction: column;
      gap: 5px;
      border: 1px solid var(--vscode-panel-border, #454545);
      padding: 6px;
    }

    .add-group-form input[type='text'] {
      background: var(--vscode-input-background, #3c3c3c);
      color: var(--vscode-input-foreground, #ccc);
      border: 1px solid var(--vscode-input-border, #454545);
      padding: 2px 4px;
      font-size: 12px;
      width: 100%;
      box-sizing: border-box;
    }

    .add-group-form-row {
      display: flex;
      gap: 4px;
      align-items: center;
    }

    .add-group-form-row select {
      flex: 0 0 auto;
      width: 60px;
    }

    foam-autocomplete-input {
      flex: 1;
    }

    .add-group-form-actions {
      display: flex;
      gap: 4px;
      justify-content: flex-end;
      align-items: center;
    }

    .btn {
      background: var(--vscode-button-background, #0e639c);
      color: var(--vscode-button-foreground, #fff);
      border: none;
      padding: 3px 8px;
      font-size: 11px;
      cursor: pointer;
    }

    .btn-secondary {
      background: var(--vscode-button-secondaryBackground, #3a3d41);
      color: var(--vscode-button-secondaryForeground, #ccc);
    }

    .color-swatch {
      width: 18px;
      height: 18px;
      border: 1px solid var(--vscode-panel-border, #454545);
      cursor: pointer;
      flex-shrink: 0;
      position: relative;
    }

    .color-swatch input[type='color'] {
      position: absolute;
      opacity: 0;
      width: 100%;
      height: 100%;
      top: 0;
      left: 0;
      cursor: pointer;
      padding: 0;
      border: none;
    }
  `; }
    static { this._SPECIAL_TYPES = [
        'tag',
        'attachment',
        'image',
        'placeholder',
    ]; }
    static { this._SPECIAL_LABELS = {
        tag: 'Show tags',
        attachment: 'Show attachments',
        image: 'Show images',
        placeholder: 'Show placeholders',
    }; }
    static { this._MATCH_HINT = {
        type: 'exact or /regex/',
        path: 'substring or /regex/',
        tag: 'exact or /regex/',
        title: 'substring or /regex/',
    }; }
    get _specialTypes() {
        return ControlPanel_1._SPECIAL_TYPES.filter(t => t in this.showNodesOfType);
    }
    get _noteTypes() {
        return Object.keys(this.showNodesOfType)
            .filter(t => !ControlPanel_1._SPECIAL_TYPES.includes(t))
            .sort();
    }
    render() {
        return html `
      <details open>
        <summary>Groups</summary>
        <div class="section-content">
          <label class="select-row">
            <span>Color by</span>
            <select
              .value=${this.style.colorMode ?? 'none'}
              @change=${(e) => this._emit('style-change', {
            colorMode: e.target.value,
        })}
            >
              <option value="none">None</option>
              <option value="directory">Directory</option>
              <option value="type">Type</option>
            </select>
          </label>

          ${this._specialTypes.map(type => html `
              <div class="checkbox-row">
                <input
                  type="checkbox"
                  .checked=${this.showNodesOfType[type]}
                  @change=${(e) => this._emit('toggle-node-type', {
            type,
            visible: e.target.checked,
        })}
                />
                <span style="flex:1"
                  >${ControlPanel_1._SPECIAL_LABELS[type]}
                  (${this.nodeTypeCounts[type] ?? 0})</span
                >
                ${this.style.colorMode !== 'directory' ||
            type === 'tag' ||
            type === 'placeholder'
            ? html `<span
                      class="group-dot"
                      title="Click to change color"
                      @click=${(e) => {
                const input = e.currentTarget.querySelector('input[type="color"]');
                input?.showPicker?.();
            }}
                    >
                      <span style="color: ${getTypeColor(type, this.style)}"
                        >●</span
                      >
                      <input
                        type="color"
                        .value=${getTypeColor(type, this.style)}
                        @input=${(e) => this._emit('style-change', {
                node: {
                    ...this.style.node,
                    [type]: e.target.value,
                },
            })}
                      />
                    </span>`
            : ''}
              </div>
            `)}
          ${this.groups.length > 0 ? html `<hr class="group-divider" />` : ''}
          ${this.groups.map((group, i) => html `
              <div class="checkbox-row">
                <input
                  type="checkbox"
                  .checked=${group.enabled}
                  @change=${(e) => this._updateGroup(i, {
            enabled: e.target.checked,
        })}
                />
                <span
                  style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
                  >${group.label} (${this.groupMatchCounts[group.id] ?? 0})</span
                >
                <span
                  class="group-dot"
                  title="Click to change color"
                  @click=${(e) => this._openColorPicker(e, i)}
                >
                  <span style="color: ${group.color}">●</span>
                  <input
                    type="color"
                    .value=${group.color}
                    @input=${(e) => this._updateGroup(i, {
            color: e.target.value,
        })}
                  />
                </span>
                <button
                  class="icon-btn"
                  title="Delete group"
                  @click=${() => this._deleteGroup(i)}
                >
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 10 10"
                    fill="currentColor"
                  >
                    <path
                      d="M1.5 1.5 L8.5 8.5 M8.5 1.5 L1.5 8.5"
                      stroke="currentColor"
                      stroke-width="1.5"
                      stroke-linecap="round"
                    />
                  </svg>
                </button>
              </div>
            `)}
          ${this.groupDraft.active
            ? html `
                <div class="add-group-form">
                  <div class="add-group-form-row">
                    <select
                      .value=${this.groupDraft.property}
                      @change=${(e) => this._emitDraftChange({
                property: e.target
                    .value,
            })}
                    >
                      <option value="type">type</option>
                      <option value="path">path</option>
                      <option value="tag">tag</option>
                      <option value="title">title</option>
                    </select>
                    <foam-autocomplete-input
                      .value=${this.groupDraft.value}
                      .options=${this.autocompleteOptions}
                      placeholder=${ControlPanel_1._MATCH_HINT[this.groupDraft.property] ?? 'exact'}
                      @value-change=${(e) => this._emitDraftChange({ value: e.detail })}
                      @keydown=${(e) => {
                if (e.key === 'Enter')
                    this._emit('add-group', null);
            }}
                    ></foam-autocomplete-input>
                  </div>
                  <div class="add-group-form-actions">
                    ${this.groupDraft.value
                ? html `<span style="opacity:0.6;font-size:11px;flex:1"
                          >${this.previewMatchCount}
                          note${this.previewMatchCount === 1 ? '' : 's'}
                          match</span
                        >`
                : html `<span style="flex:1"></span>`}
                    <button
                      class="btn btn-secondary"
                      @click=${() => this._emit('cancel-draft', null)}
                    >
                      Cancel
                    </button>
                    <button
                      class="btn"
                      @click=${() => this._emit('add-group', null)}
                    >
                      Add
                    </button>
                  </div>
                </div>
              `
            : html `
                <button
                  class="add-group-btn"
                  @click=${() => this._emit('start-draft', null)}
                >
                  + Add group
                </button>
              `}
        </div>
      </details>

      <details>
        <summary>Appearance</summary>
        <div class="section-content">
          <label class="slider-row">
            <span>Text Fade</span>
            <input
              type="range"
              min="-2"
              max="2"
              step="0.1"
              .value=${String(this.textFade)}
              @input=${(e) => this._emit('text-fade-change', parseFloat(e.target.value))}
            />
            <span class="value">${this.textFade.toFixed(1)}</span>
          </label>
          <label class="slider-row">
            <span>Font Size</span>
            <input
              type="range"
              min="0.5"
              max="3"
              step="0.1"
              .value=${String(this.nodeFontSizeMultiplier)}
              @input=${(e) => this._emit('font-size-multiplier-change', parseFloat(e.target.value))}
            />
            <span class="value"
              >${this.nodeFontSizeMultiplier.toFixed(1)}×</span
            >
          </label>
          <label class="slider-row">
            <span>Node Size</span>
            <input
              type="range"
              min="0"
              max="5"
              step="0.1"
              .value=${String(this.nodeSizeMultiplier)}
              @input=${(e) => this._emit('node-size-multiplier-change', parseFloat(e.target.value))}
            />
            <span class="value">${this.nodeSizeMultiplier.toFixed(1)}×</span>
          </label>
          <label class="slider-row">
            <span>Link Size</span>
            <input
              type="range"
              min="0"
              max="5"
              step="0.1"
              .value=${String(this.linkWidthMultiplier)}
              @input=${(e) => this._emit('link-width-multiplier-change', parseFloat(e.target.value))}
            />
            <span class="value">${this.linkWidthMultiplier.toFixed(1)}×</span>
          </label>
          <label class="select-row">
            <span>Link flow</span>
            <select
              .value=${this.animateLinks}
              @change=${(e) => this._emit('animate-links-change', e.target.value)}
            >
              <option value="forward">Forward</option>
              <option value="off">Off</option>
              <option value="reverse">Reverse</option>
            </select>
          </label>
        </div>
      </details>

      <details>
        <summary>Forces</summary>
        <div class="section-content">
          <label class="slider-row">
            <span>Collide</span>
            <input
              type="range"
              min="0"
              max="4"
              step="0.1"
              .value=${String(this.forces.collide)}
              @input=${(e) => this._emitForcesChange({
            collide: parseFloat(e.target.value),
        })}
            />
            <span class="value">${this.forces.collide.toFixed(1)}</span>
          </label>
          <label class="slider-row">
            <span>Repel</span>
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              .value=${String(this.forces.repel)}
              @input=${(e) => this._emitForcesChange({
            repel: parseFloat(e.target.value),
        })}
            />
            <span class="value">${this.forces.repel}</span>
          </label>
          <label class="slider-row">
            <span>Link Dist</span>
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              .value=${String(this.forces.link)}
              @input=${(e) => this._emitForcesChange({
            link: parseFloat(e.target.value),
        })}
            />
            <span class="value">${this.forces.link}</span>
          </label>
          <label class="slider-row">
            <span>Velocity</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              .value=${String(this.forces.velocityDecay)}
              @input=${(e) => this._emitForcesChange({
            velocityDecay: parseFloat(e.target.value),
        })}
            />
            <span class="value">${this.forces.velocityDecay.toFixed(2)}</span>
          </label>
        </div>
      </details>

      <details>
        <summary>Selection</summary>
        <div class="section-content">
          <label class="slider-row">
            <span>Depth</span>
            <input
              type="range"
              min="0"
              max="3"
              step="1"
              .value=${String(this.selection.neighborDepth)}
              @input=${(e) => this._emitSelectionChange({
            neighborDepth: parseInt(e.target.value),
        })}
            />
            <span class="value">${this.selection.neighborDepth}</span>
          </label>
          <label class="checkbox-row">
            <input
              type="checkbox"
              .checked=${this.selection.centerOnSelect}
              @change=${(e) => this._emitSelectionChange({
            centerOnSelect: e.target.checked,
        })}
            />
            <span>Center on select</span>
          </label>
          <label class="checkbox-row">
            <input
              type="checkbox"
              .checked=${this.selection.zoomOnSelect}
              @change=${(e) => this._emitSelectionChange({
            zoomOnSelect: e.target.checked,
        })}
            />
            <span>Zoom on select</span>
          </label>
          <label class="checkbox-row">
            <input
              type="checkbox"
              .checked=${this.graphScope !== 'full'}
              @change=${(e) => this._emit('graph-scope-change', e.target.checked ? { depth: 1 } : 'full')}
            />
            <span>Focus graph</span>
          </label>
          ${this.graphScope !== 'full'
            ? html `<label class="slider-row">
                <span>Focus depth</span>
                <input
                  type="range"
                  min="1"
                  max="3"
                  step="1"
                  .value=${String(this.graphScope.depth)}
                  @input=${(e) => this._emit('graph-scope-change', {
                depth: parseInt(e.target.value),
            })}
                />
                <span class="value">${this.graphScope.depth}</span>
              </label>`
            : null}
        </div>
      </details>
    `;
    }
    _emit(eventName, detail) {
        this.dispatchEvent(new CustomEvent(eventName, { detail, bubbles: true, composed: true }));
    }
    _emitForcesChange(patch) {
        this._emit('forces-change', { ...this.forces, ...patch });
    }
    _openColorPicker(e, _index) {
        const dot = e.currentTarget;
        const input = dot.querySelector('input[type="color"]');
        if (input)
            input.showPicker?.();
    }
    _updateGroup(index, patch) {
        this._emit('update-group', { index, patch });
    }
    _deleteGroup(index) {
        this._emit('delete-group', index);
    }
    _emitDraftChange(patch) {
        this._emit('draft-change', { ...this.groupDraft, ...patch, active: true });
    }
    _emitSelectionChange(patch) {
        this._emit('selection-change', { ...this.selection, ...patch });
    }
};
__decorate([
    property({ type: Object })
], ControlPanel.prototype, "style", void 0);
__decorate([
    property({ type: Object })
], ControlPanel.prototype, "showNodesOfType", void 0);
__decorate([
    property({ type: Object })
], ControlPanel.prototype, "nodeTypeCounts", void 0);
__decorate([
    property({ type: Object })
], ControlPanel.prototype, "groupMatchCounts", void 0);
__decorate([
    property({ type: Array })
], ControlPanel.prototype, "autocompleteOptions", void 0);
__decorate([
    property({ type: Number })
], ControlPanel.prototype, "previewMatchCount", void 0);
__decorate([
    property({ type: Object })
], ControlPanel.prototype, "groupDraft", void 0);
__decorate([
    property({ type: Array })
], ControlPanel.prototype, "groups", void 0);
__decorate([
    property({ type: Number })
], ControlPanel.prototype, "textFade", void 0);
__decorate([
    property({ type: Number })
], ControlPanel.prototype, "nodeFontSizeMultiplier", void 0);
__decorate([
    property({ type: Number })
], ControlPanel.prototype, "nodeSizeMultiplier", void 0);
__decorate([
    property({ type: Number })
], ControlPanel.prototype, "linkWidthMultiplier", void 0);
__decorate([
    property({ type: String })
], ControlPanel.prototype, "animateLinks", void 0);
__decorate([
    property({ type: Object })
], ControlPanel.prototype, "forces", void 0);
__decorate([
    property({ type: Object })
], ControlPanel.prototype, "selection", void 0);
__decorate([
    property({ type: Object })
], ControlPanel.prototype, "graphScope", void 0);
ControlPanel = ControlPanel_1 = __decorate([
    customElement('foam-control-panel')
], ControlPanel);
export { ControlPanel };
