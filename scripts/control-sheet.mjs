import * as log from './log.mjs';
import {
  ID,
  DEFAULT_SHORTCUTS,
  COLUMNS,
  clone,
  escapeHTML as esc,
  integer,
  modifierLabel,
  modifiersFor,
  resolveOwners,
  scopedEntries,
  signed,
  textValue,
  uniqueActors,
  validateAction,
  PREFERENCES_VERSION,
  upgradePreferences,
  tableLayout,
} from './core.mjs';
import { formDialog, field, numberInput, textInput, option, checkbox } from './dialogs.mjs';
import { resolveRoll, rollOne, resultTable } from './rolls.mjs';
import { createRequests } from './requests.mjs';
import { RequestTracker } from './request-tracker.mjs';
import { SectionLayout } from './section-layout.mjs';
import { sceneRoster, rosterIdentity } from './roster.mjs';
import {
  rowMatchesFilter,
  conditionHighlights,
  validatePreset,
  exportConfiguration,
  parseConfiguration,
  importConfiguration,
} from './features.mjs';
import { applyCharacterModifier, removeCharacterModifiers, sendBuckets } from './modifiers.mjs';
import {
  castingEffectsFor,
  castingEffectBadges,
  manageCastingEffects,
} from './casting-effects.mjs';

const App = foundry.applications.api.ApplicationV2;
const collection = (value) => value?.contents || Array.from(value || []);
const icon = (name, text) =>
  `<i class="fa-solid fa-${name}" aria-hidden="true"></i>${text ? ` ${esc(text)}` : ''}`;
const btn = (action, label, extra = '') =>
  `<button type="button" data-gcs="${action}" ${extra}>${label}</button>`;
const attr = (s, p) => foundry.utils.getProperty(s, p);
const imagePath = (path) =>
  /^(?:https?:|\/|[a-z0-9_])/i.test(path || '') ? path : 'icons/svg/mystery-man.svg';

export class GMControlSheet extends App {
  static DEFAULT_OPTIONS = {
    id: 'gga-gm-control-sheet',
    tag: 'section',
    classes: ['gcs-window'],
    window: { title: 'GM Control Sheet', icon: 'fa-solid fa-clipboard-list', resizable: true },
    position: { width: 1180, height: 770 },
  };
  constructor(options = {}) {
    const saved = game.user.getFlag(ID, 'preferences') || {};
    const prefs = upgradePreferences(saved);
    const position = prefs.position || {};
    super({
      ...options,
      position: {
        ...position,
        width: Math.min(position.width || 1180, window.innerWidth - 40),
        height: Math.min(position.height || 770, window.innerHeight - 50),
      },
    });
    this.prefs = prefs;
    this._saveOnOpen = (saved.schemaVersion || 0) < PREFERENCES_VERSION;
    this.selection = new Set();
    this.draft = {
      scope: 'selected',
      shortcut: 'observation',
      shared: 0,
      reason: 'GM adjustment',
      includeBucket: false,
    };
    this.results = [];
    this.rows = [];
    this.busy = false;
    this._saveQueue = Promise.resolve();
  }
  get shortcuts() {
    const groups = this.prefs.tab === 'both' ? ['pc', 'npc'] : [this.prefs.tab];
    return [
      ...new Map(
        groups.flatMap((g) => this.prefs.shortcuts[g] || DEFAULT_SHORTCUTS).map((s) => [s.id, s]),
      ).values(),
    ];
  }
  visibleRows() {
    return this.rows.filter(
      (r) =>
        (this.prefs.tab === 'both' || r.entry.group === this.prefs.tab) &&
        rowMatchesFilter(r, this.prefs.filter, canvas.scene, game.combat),
    );
  }
  scopeDescription() {
    const entries = this.targetEntries(),
      visible = new Set(this.visibleRows().map((r) => r.entry.id));
    const hidden = entries.filter((e) => !visible.has(e.id)).length;
    return `${entries.length} roster entries in scope${hidden ? ` · ${hidden} hidden by tab/filter` : ''}`;
  }
  openTracker() {
    this.tracker ||= new RequestTracker();
    if (this.tracker.rendered) {
      this.tracker.maximize();
      this.tracker.bringToFront();
    } else this.tracker.render({ force: true });
  }
  get shortcut() {
    return this.shortcuts.find((s) => s.id === this.draft.shortcut) || this.shortcuts[0];
  }
  shortcutFor(entry) {
    return (
      this.prefs.shortcuts[entry.group]?.find((s) => s.id === this.shortcut?.id) || this.shortcut
    );
  }
  async save() {
    const value = clone(this.prefs);
    this._saveQueue = this._saveQueue
      .catch(() => {})
      .then(() => game.user.setFlag(ID, 'preferences', value));
    await this._saveQueue;
  }
  refresh() {
    this.tracker?.refresh();
    clearTimeout(this._refreshTimer);
    this._refreshTimer = setTimeout(() => {
      if (this._sectionLayout?.dragging) return this.refresh();
      if (this.rendered && !this.busy) this.render({ force: true });
    }, 150);
  }
  async _preClose(options) {
    clearTimeout(this._refreshTimer);
    this._pendingSectionHTML = null;
    this._sectionLayout?.destroy();
    this.prefs.position = Object.fromEntries(
      ['left', 'top', 'width', 'height'].map((k) => [k, this.position[k]]),
    );
    await this.save();
    return super._preClose(options);
  }
  async resolveEntry(entry) {
    try {
      const doc = await fromUuid(entry.uuid);
      const token = doc?.documentName === 'Token' ? doc : null;
      const actor = token ? token.actor : doc?.documentName === 'Actor' ? doc : null;
      return { entry: { ...entry, tokenUuid: token?.uuid || entry.tokenUuid }, actor, token };
    } catch {
      return { entry, actor: null, token: null };
    }
  }
  async resolveRoster() {
    const resolved = await Promise.all(this.prefs.roster.map((e) => this.resolveEntry(e)));
    for (const row of resolved) {
      const family = row.token?.actorId ? `Actor.${row.token.actorId}` : row.actor?.uuid;
      if (family) this.prefs.roster.find((e) => e.id === row.entry.id).actorUuid = family;
      row.entry.actorUuid ||= family;
    }
    return sceneRoster(resolved, canvas.scene);
  }
  sourceEntry(id) {
    const row = this.rows.find((r) => r.entry.id === id);
    return this.prefs.roster.find((e) => e.id === (row?.entry.sourceId || id));
  }
  async checkedRow(id) {
    const live = await this.resolveRoster();
    if (rosterIdentity(live) !== rosterIdentity(this.rows)) {
      await this.render({ force: true });
      throw new Error('The scene roster changed. Review the refreshed rows and try again.');
    }
    return live.find((r) => r.entry.id === id);
  }
  async _prepareContext() {
    if (!game.user.isGM) throw new Error('The GM Control Sheet is available only to GMs.');
    if (this._saveOnOpen) {
      await this.save();
      this._saveOnOpen = false;
    }
    this.rows = await this.resolveRoster();
    const rowIds = new Set(this.rows.map((r) => r.entry.id));
    this.selection = new Set([...this.selection].filter((id) => rowIds.has(id)));
    const active = this.shortcut;
    const visible = this.visibleRows();
    const rendered = await Promise.all(
      visible.map(async (row) => {
        let check;
        if (row.actor && active) {
          try {
            check = await resolveRoll(row.actor, this.shortcutFor(row.entry), row.entry);
          } catch {
            check = { missing: true };
          }
        }
        let effects = [],
          effectsError = '';
        if (this.prefs.showCastingEffects !== false) {
          try {
            effects = await castingEffectsFor(row.actor);
          } catch (error) {
            effectsError = 'Effects unavailable';
            log.error('Casting effects', error);
          }
        }
        return this.rowHTML(row, active, check, effects, effectsError);
      }),
    );
    return { visible, rendered, active };
  }
  targetEntries() {
    if (this.draft.scope === 'visible') return this.visibleRows().map((r) => r.entry);
    return scopedEntries(
      this.rows.map((r) => r.entry),
      this.draft.scope,
      this.selection,
      this.prefs.tab,
    );
  }
  async targetRows(single = null) {
    const live = await this.resolveRoster();
    if (rosterIdentity(live) !== rosterIdentity(this.rows)) {
      await this.render({ force: true });
      throw new Error('The scene roster changed. Review the refreshed rows and try again.');
    }
    const entries = single
      ? this.rows.map((r) => r.entry).filter((e) => e.id === single)
      : this.targetEntries();
    if (!entries.length)
      throw new Error('Select characters or choose PCs, NPCs, or Both in the action scope.');
    const rows = await Promise.all(entries.map((e) => this.resolveEntry(e)));
    const missing = rows.filter((r) => !r.actor);
    if (missing.length)
      throw new Error(
        `Remove or repair missing roster entries: ${missing.map((r) => r.entry.name || r.entry.uuid).join(', ')}`,
      );
    return uniqueActors(rows);
  }
  async _renderHTML(context) {
    const { visible, rendered, active } = context;
    const layout = tableLayout(this.prefs.columns);
    const root = document.createElement('div');
    root.className = 'gcs-root';
    root.innerHTML = `<div class="gcs-top"><div><span class="gcs-kicker">GURPS 4e · GAME MASTER</span><h2>The whole cast.  One sheet.</h2></div>
      <div class="gcs-tools">${btn('refresh', icon('rotate'), 'title="Refresh" aria-label="Refresh"')}${btn('settings', icon('sliders', 'Configure'))}</div></div>
      <div class="gcs-roster-bar"><nav class="gcs-tabs" aria-label="Roster">${[
        ['pc', 'PCs'],
        ['npc', 'NPCs'],
        ['both', 'Both'],
      ]
        .map(([g, label]) =>
          btn(
            'tab',
            `${label} <span>${this.rows.filter((r) => g === 'both' || r.entry.group === g).length}</span>`,
            `data-tab="${g}" aria-pressed="${g === this.prefs.tab}"`,
          ),
        )
        .join('')}</nav>
      <div class="gcs-tools"><label class="gcs-filter">Show<select data-filter>${[
        ['all', 'Whole roster'],
        ['scene', 'Current scene'],
        ['combat', 'Current combat'],
      ]
        .map(([v, l]) => option(v, l, this.prefs.filter === v))
        .join(
          '',
        )}</select></label>${btn('add', icon('user-plus', 'Add actors'))}${btn('tokens', icon('street-view', 'Add selected tokens'))}</div></div>
      <div class="gcs-selection"><span>${this.selection.size} selected across both rosters · ${visible.length} shown</span><div>${btn('select', 'Select visible')}${btn('clear', 'Clear selection')}</div></div>
      <div class="gcs-panels"><div class="gcs-grid" id="gcs-characters" data-section="characters" role="region" aria-label="Characters"><table class="gcs-table" style="min-width:${layout.minWidth}px"><colgroup>${layout.widths.map((width) => `<col style="width:${width}%">`).join('')}</colgroup><thead><tr><th class="gcs-select-col"><span class="gcs-sr">Select</span></th><th class="gcs-name-col">Character</th>${this.prefs.columns.map((c) => `<th>${esc(COLUMNS[c])}</th>`).join('')}<th>${esc(active?.label || 'Check')}<small>Sheet value</small></th><th>Adjust</th><th><span class="gcs-sr">Actions</span></th></tr></thead>
      <tbody>${rendered.join('') || `<tr><td colspan="${this.prefs.columns.length + 5}"><div class="gcs-empty">${icon('users')}<h3>${this.prefs.roster.length ? 'No characters in this view' : 'Add your cast'}</h3><p>${this.prefs.roster.length ? 'Change the roster tab or Show filter to see your cast.' : 'Drag actors or tokens here, or use the buttons above.'}</p></div></td></tr>`}</tbody></table></div>
      <div class="gcs-divider" data-divider="0" role="separator" tabindex="0" aria-label="Resize Characters and Group actions" aria-orientation="horizontal" aria-controls="gcs-characters gcs-group-actions" title="Drag to resize; use Up and Down arrow keys"></div>
      <div class="gcs-action-area" id="gcs-group-actions" data-section="actions" role="region" aria-label="Group actions"><div class="gcs-action-title"><strong>Group actions</strong><span class="gcs-target-count">${esc(this.scopeDescription())}</span></div>
      <div class="gcs-section-body"><div class="gcs-controls"><label>Apply to<select data-draft="scope">${[
        ['selected', 'Selected characters'],
        ['visible', 'Visible characters'],
        ['pc', 'All PCs'],
        ['npc', 'All NPCs'],
        ['both', 'PCs and NPCs'],
      ]
        .map(([v, l]) => option(v, l, this.draft.scope === v))
        .join('')}</select></label>
      <label>Check<select data-draft="shortcut">${this.shortcuts.map((s) => option(s.id, s.label, s.id === active?.id)).join('')}</select></label>
      <label class="gcs-small-field">Modifier<input type="number" data-draft="shared" value="${esc(this.draft.shared)}" min="-100" max="100" step="1"></label>
      <label class="gcs-reason">Reason<input type="text" data-draft="reason" value="${esc(this.draft.reason)}" maxlength="160"></label></div>
      <div class="gcs-action-buttons"><label class="gcs-check"><input type="checkbox" data-draft="includeBucket"${this.draft.includeBucket ? ' checked' : ''}> Include my bucket in GM rolls</label><div>${btn('roll', icon('eye-slash', 'Roll as GM'), 'class="gcs-primary"')}${btn('request', icon('comment-dots', 'Request rolls'))}${btn('modifiers', icon('plus-minus', 'Group modifiers'))}</div></div>
      <p class="gcs-hint">GM rolls are private.  All PCs / All NPCs include hidden rows; choose Visible characters to follow the filter.</p></div></div>
      <div class="gcs-divider" data-divider="1" role="separator" tabindex="0" aria-label="Resize Group actions and Latest GM results" aria-orientation="horizontal" aria-controls="gcs-group-actions gcs-latest-results" title="Drag to resize; use Up and Down arrow keys"></div>
      <div class="gcs-results" id="gcs-latest-results" data-section="results" role="region" aria-label="Latest GM results"><div class="gcs-action-title"><strong>Latest GM results</strong><span>Visible only to you here</span>${btn('tracker', icon('list-check', 'Requested roll results'))}${this.results.length ? btn('summary', icon('comment', 'GM chat summary')) : ''}</div><div class="gcs-section-body">${this.results.length ? resultTable(this.results) : '<p class="gcs-hint">Results from your next batch will appear here.</p>'}</div></div></div>`;
    if (this.busy) root.classList.add('gcs-busy');
    return root;
  }
  _replaceHTML(result, content) {
    // Do not replace a divider while a pointer is dragging it.
    if (this._sectionLayout?.dragging) {
      this._pendingSectionHTML = { result, content };
      return;
    }
    this._sectionLayout?.destroy();
    const sectionScroll = Array.from(content.querySelectorAll('.gcs-section-body')).map((el) => ({
      top: el.scrollTop,
      left: el.scrollLeft,
    }));
    const oldGrid = content.querySelector('.gcs-grid');
    const scroll = { top: oldGrid?.scrollTop || 0, left: oldGrid?.scrollLeft || 0 };
    const focused = content.contains(document.activeElement) ? document.activeElement : null;
    const draftKey = focused?.dataset.draft;
    const dividerKey = focused?.dataset.divider;
    const start = focused?.selectionStart;
    content.replaceChildren(result);
    this._sectionLayout = new SectionLayout(
      result.querySelector('.gcs-panels'),
      this.prefs.sectionSizes,
      (sizes) => {
        this.prefs.sectionSizes = sizes;
        this.save().catch((error) => this.error(error));
      },
      () => {
        const pending = this._pendingSectionHTML;
        this._pendingSectionHTML = null;
        if (pending) this._replaceHTML(pending.result, pending.content);
      },
    );
    this._sectionLayout.layout();
    result.querySelector('.gcs-grid').scrollTo(scroll.left, scroll.top);
    result
      .querySelectorAll('.gcs-section-body')
      .forEach((el, i) => el.scrollTo(sectionScroll[i]?.left || 0, sectionScroll[i]?.top || 0));
    if (dividerKey != null)
      result.querySelector(`[data-divider="${dividerKey}"]`)?.focus({ preventScroll: true });
    if (draftKey) {
      const input = result.querySelector(`[data-draft="${draftKey}"]`);
      input?.focus();
      if (input?.type === 'text' && start != null) input.setSelectionRange(start, start);
    }
    result.addEventListener('input', (e) => {
      const key = e.target.dataset.draft;
      if (key) this.draft[key] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    });
    result.addEventListener('change', (e) =>
      this.handleChange(e).catch((error) => this.error(error)),
    );
    result.addEventListener('click', (e) => {
      const target = e.target.closest('[data-gcs]');
      if (!target || this.busy) return;
      e.preventDefault();
      this.handleAction(target.dataset.gcs, target).catch((error) => this.error(error));
    });
    result.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });
    result.addEventListener('drop', (e) => this.drop(e).catch((error) => this.error(error)));
  }
  error(error) {
    log.error(error);
    ui.notifications.error(error.message || String(error));
  }
  async handleChange(event) {
    const el = event.target;
    if (el.hasAttribute('data-filter')) {
      this.prefs.filter = el.value;
      await this.save();
      await this.render({ force: true });
    } else if (el.dataset.select) {
      if (el.checked) this.selection.add(el.dataset.select);
      else this.selection.delete(el.dataset.select);
      await this.render({ force: true });
    } else if (el.dataset.adjust) {
      const row = await this.checkedRow(el.dataset.adjust);
      const entry = this.sourceEntry(el.dataset.adjust);
      if (!row || !entry) throw new Error('This roster entry is unavailable.');
      if (row.token && row.entry.uuid !== entry.uuid) {
        entry.tokenAdjustments ??= {};
        entry.tokenAdjustments[row.token.uuid] = integer(el.value);
      } else entry.adjustment = integer(el.value);
      row.entry.adjustment = integer(el.value);
      Object.assign(this.rows.find((r) => r.entry.id === el.dataset.adjust).entry, {
        adjustment: row.entry.adjustment,
      });
      await this.save();
    } else if (el.dataset.draft && ['scope', 'shortcut'].includes(el.dataset.draft))
      await this.render({ force: true });
  }
  rowHTML({ entry, actor, token }, shortcut, check, effects = [], effectsError = '') {
    if (!actor)
      return `<tr class="gcs-missing"><td></td><td colspan="${this.prefs.columns.length + 3}">Missing: ${esc(entry.name || entry.uuid)}</td><td>${btn('remove', icon('trash'), `data-id="${entry.id}" title="Remove missing entry"`)}</td></tr>`;
    const tokenImage = token?.texture?.src || actor.prototypeToken?.texture?.src;
    const dual = tokenImage && tokenImage !== actor.img;
    const status = collection(actor.statuses)
      .map((s) =>
        game.i18n.localize(
          CONFIG.statusEffects.find((e) => e.id === s)?.name ||
            CONFIG.statusEffects.find((e) => e.id === s)?.label ||
            s,
        ),
      )
      .join(', ');
    const values = Object.fromEntries(
      this.prefs.columns.map((c) => {
        let value;
        if (['HP', 'FP'].includes(c))
          value = `${actor.system[c]?.value ?? '—'} / ${actor.system[c]?.max ?? '—'}`;
        else if (['ST', 'DX', 'IQ', 'HT', 'PER', 'WILL'].includes(c))
          value = attr(actor.system, `attributes.${c}.value`);
        else if (c === 'move' || c === 'dodge') value = actor.system[`current${c}`];
        else if (c === 'conditions') value = status || '—';
        else value = actor.system.conditions?.[c];
        return [c, value ?? '—'];
      }),
    );
    const alerts = this.prefs.highlightConditions ? conditionHighlights(actor) : [];
    const mods = actor.getFlag(ID, 'modifiers') || [];
    const applicable = shortcut ? modifiersFor(actor, shortcut) : [];
    const tooltip = applicable.map((m) => `${signed(m.value)} ${m.name}`).join('; ');
    const scene = token
      ? `Scene token · ${token.parent?.name || 'Scene'}`
      : 'Actor record · no token on this scene';
    const checkCell = check?.exempt
      ? '<span class="gcs-pill">Exempt</span>'
      : !check || check.missing
        ? '<span class="gcs-muted">Not found</span>'
        : btn(
            'row-roll',
            esc(check.target),
            `class="gcs-roll-value" data-id="${entry.id}" title="Private ${esc(shortcut.label)} roll${tooltip ? '; ' + esc(tooltip) : ''}"`,
          );
    return `<tr class="${this.selection.has(entry.id) ? 'gcs-selected' : ''} ${alerts.some((a) => a.severity === 'critical') ? 'gcs-row-critical' : alerts.length ? 'gcs-row-warning' : ''}"><td><input type="checkbox" aria-label="Select ${esc(actor.name)}" data-select="${entry.id}"${this.selection.has(entry.id) ? ' checked' : ''}></td>
      <td class="gcs-character"><div class="gcs-identity">${btn('sheet', `<img src="${esc(imagePath(actor.img))}" alt="${esc(actor.name)}">`, `class="gcs-portrait" data-id="${entry.id}" title="Open character sheet"`)}
      ${dual ? btn('locate', `<img src="${esc(imagePath(tokenImage))}" alt="Token for ${esc(actor.name)}">`, `class="gcs-token-art" data-id="${entry.id}" title="Locate token"`) : ''}
      <div class="gcs-identity-text">${btn('sheet', esc(entry.name || token?.name || actor.name), `class="gcs-character-name" data-id="${entry.id}" title="Open character sheet"`)}<small>${esc(scene)}${this.prefs.tab === 'both' ? ` · ${entry.group === 'pc' ? 'PC' : 'NPC'}` : ''}</small>${dual && token && token.name !== actor.name ? `<small>${esc(actor.name)}</small>` : ''}</div></div>
      ${castingEffectBadges(effects)}${effectsError ? `<small class="gcs-muted">${esc(effectsError)}</small>` : ''}
      ${alerts.length ? `<div class="gcs-condition-chips">${alerts.map((a) => `<span class="gcs-alert-${a.severity}" title="${esc(a.detail)}">${esc(a.label)}</span>`).join('')}</div>` : ''}
      ${mods.length ? `<div class="gcs-mod-chips">${mods.map((m) => `<span title="${esc(m.checks === 'all' ? 'All control-sheet checks' : m.checks.join(', '))}">${esc(signed(m.value))} ${esc(m.name)}</span>`).join('')}</div>` : ''}</td>
      ${this.prefs.columns.map((c) => `<td class="${['posture', 'maneuver', 'conditions'].includes(c) ? 'gcs-text-stat' : 'gcs-number'} ${alerts.find((a) => a.stat === c) ? 'gcs-resource-alert' : ''}">${esc(values[c])}</td>`).join('')}
      <td class="gcs-check-cell">${checkCell}${tooltip ? `<small title="${esc(tooltip)}">${signed(applicable.reduce((n, m) => n + m.value, 0))} assigned</small>` : ''}</td>
      <td class="gcs-adjust-cell"><input class="gcs-adjust" type="number" min="-100" max="100" step="1" value="${esc(entry.adjustment || 0)}" data-adjust="${entry.id}" aria-label="Individual roll adjustment for ${esc(actor.name)}"></td>
      <td><div class="gcs-row-tools">${btn('locate', icon('location-crosshairs'), `data-id="${entry.id}" title="Locate token" aria-label="Locate token"`)}${btn('edit', icon('ellipsis-vertical'), `data-id="${entry.id}" title="Character options" aria-label="Character options"`)}</div></td></tr>`;
  }
  async handleAction(action, el) {
    const id = el.dataset.id;
    if (action === 'casting-effect')
      return manageCastingEffects(el.dataset.caster, el.dataset.effect);
    if (action === 'tab') {
      this.prefs.tab = el.dataset.tab;
      await this.save();
      return this.render({ force: true });
    }
    if (action === 'refresh') return this.render({ force: true });
    if (action === 'select') {
      this.visibleRows()
        .filter((r) => r.actor)
        .forEach((r) => this.selection.add(r.entry.id));
      return this.render({ force: true });
    }
    if (action === 'clear') {
      this.selection.clear();
      return this.render({ force: true });
    }
    if (action === 'add') return this.addActors();
    if (action === 'tokens') return this.addTokens();
    if (action === 'tracker') return this.openTracker();
    if (action === 'settings') return this.configure();
    if (action === 'edit') return this.editEntry(id);
    if (action === 'remove') {
      const source = this.sourceEntry(id);
      this.prefs.roster = this.prefs.roster.filter(
        (e) => e !== source && (!source?.actorUuid || e.actorUuid !== source.actorUuid),
      );
      this.selection.delete(id);
      await this.save();
      return this.render({ force: true });
    }
    if (action === 'sheet') {
      const row = await this.checkedRow(id);
      return row.actor?.sheet.render(true);
    }
    if (action === 'locate') return this.locate(id);
    if (action === 'roll' || action === 'row-roll')
      return this.rollBatch(action === 'row-roll' ? id : null);
    if (action === 'request') return this.requestRolls();
    if (action === 'modifiers') return this.groupModifiers();
    if (action === 'summary')
      return ChatMessage.create({
        user: game.user.id,
        whisper: ChatMessage.getWhisperRecipients('GM').map((u) => u.id),
        content: `<h3>GM Control Sheet</h3>${resultTable(this.results)}`,
      });
  }
  async addDocuments(documents, group) {
    let added = 0;
    const existing = await this.resolveRoster();
    const documentIds = new Set([
      ...this.prefs.roster.map((e) => e.uuid),
      ...existing.map((r) => r.entry.uuid),
    ]);
    const actorIds = new Set(
      [...existing.map((r) => r.actor?.uuid), ...this.prefs.roster.map((e) => e.actorUuid)].filter(
        Boolean,
      ),
    );
    for (const doc of documents) {
      if (
        !['Actor', 'Token'].includes(doc?.documentName) ||
        (doc.documentName === 'Token' && !doc.actor)
      )
        continue;
      // Existing scene rows cover either add route. Distinct current tokens
      // remain visible while duplicate saved sources are collapsed.
      const key = doc.documentName === 'Token' && doc.actorLink ? doc.actor.uuid : doc.uuid;
      if (documentIds.has(doc.uuid) || actorIds.has(key)) continue;
      this.prefs.roster.push({
        id: foundry.utils.randomID(),
        uuid: doc.uuid,
        actorUuid: doc.documentName === 'Token' ? `Actor.${doc.actorId}` : doc.uuid,
        name: doc.name,
        group,
        adjustment: 0,
        overrides: {},
        fright: 'auto',
      });
      documentIds.add(doc.uuid);
      actorIds.add(doc.documentName === 'Token' ? doc.actor.uuid : doc.uuid);
      added++;
    }
    await this.save();
    await this.render({ force: true });
    ui.notifications.info(`${added} roster entr${added === 1 ? 'y' : 'ies'} added.`);
  }
  async destinationGroup() {
    if (this.prefs.tab !== 'both') return this.prefs.tab;
    const data = await formDialog(
      'Add to roster',
      field(
        'Roster',
        '<select name="group"><option value="pc">PCs</option><option value="npc">NPCs</option></select>',
      ),
      'Continue',
      380,
    );
    return data?.get('group');
  }
  async addActors() {
    const actors = collection(game.actors).sort((a, b) => a.name.localeCompare(b.name));
    const data = await formDialog(
      'Add actors',
      field(
        'Roster',
        `<select name="group">${option('pc', 'PCs', this.prefs.tab !== 'npc')}${option('npc', 'NPCs', this.prefs.tab === 'npc')}</select>`,
      ) +
        `<div class="gcs-choice-list">${actors.map((a) => checkbox('actors', a.id, a.name)).join('')}</div>`,
      'Add selected',
    );
    if (data)
      await this.addDocuments(
        data.getAll('actors').map((id) => game.actors.get(id)),
        data.get('group'),
      );
  }
  async addTokens() {
    const tokens = canvas.tokens?.controlled || [];
    if (!tokens.length) throw new Error('Select tokens on the canvas first.');
    const group = await this.destinationGroup();
    if (group)
      await this.addDocuments(
        tokens.map((t) => t.document),
        group,
      );
  }
  async drop(event) {
    event.preventDefault();
    if (this.busy) return;
    let data;
    try {
      data = JSON.parse(event.dataTransfer.getData('text/plain'));
    } catch {
      return;
    }
    let doc;
    if (data.uuid) doc = await fromUuid(data.uuid);
    else if (data.type === 'Token')
      doc = game.scenes.get(data.sceneId || canvas.scene?.id)?.tokens.get(data.id);
    else if (data.type === 'Actor') doc = game.actors.get(data.id);
    if (!doc || !['Actor', 'Token'].includes(doc.documentName)) return;
    const group = await this.destinationGroup();
    if (group) await this.addDocuments([doc], group);
  }
  async locate(id) {
    const row = await this.checkedRow(id);
    if (!row.actor) throw new Error('This character no longer exists.');
    let tokens = row.token
      ? [row.token]
      : collection(game.scenes).flatMap((s) =>
          collection(s.tokens).filter((t) => t.actorLink && t.actorId === row.actor.id),
        );
    if (!tokens.length)
      throw new Error(
        'No linked token is placed for this actor.  Add a specific unlinked token to locate that instance.',
      );
    let token = tokens[0];
    if (tokens.length > 1) {
      const data = await formDialog(
        'Locate token',
        field(
          'Token',
          `<select name="uuid">${tokens.map((t) => option(t.uuid, `${t.parent.name} · ${t.name}`, t.parent.id === canvas.scene?.id)).join('')}</select>`,
        ),
        'Locate',
      );
      if (!data) return;
      token = tokens.find((t) => t.uuid === data.get('uuid'));
    }
    if (canvas.scene?.id !== token.parent.id) await token.parent.view();
    const object = canvas.tokens?.get(token.id);
    if (!object) throw new Error('The token is not ready on the canvas.  Try Locate again.');
    await canvas.animatePan({ x: object.center.x, y: object.center.y });
    object.control({ releaseOthers: true });
  }
  async rollBatch(single) {
    const rows = await this.targetRows(single);
    const shortcut = this.shortcut;
    const shared = integer(this.draft.shared);
    const reason = modifierLabel(this.draft.reason);
    this.busy = true;
    this.results = [];
    await this.render({ force: true });
    try {
      for (const row of rows) {
        try {
          this.results.push(
            await rollOne({
              actor: row.actor,
              entry: row.entry,
              shortcut: this.shortcutFor(row.entry),
              shared,
              reason,
              personal: integer(row.entry.adjustment || 0),
              includeBucket: !!this.draft.includeBucket,
            }),
          );
        } catch (error) {
          this.results.push({
            name: row.actor.name,
            label: shortcut.label,
            status: `Error: ${error.message}`,
          });
          log.error('Roll', error);
        }
      }
    } finally {
      this.busy = false;
      await this.render({ force: true });
    }
  }
  async requestRolls() {
    const rows = await this.targetRows();
    const shortcut = this.shortcut;
    const owners = resolveOwners(rows, collection(game.users), game.user).filter((u) => !u.isGM);
    const players = collection(game.users).filter((u) => !u.isGM);
    const data = await formDialog(
      'Request player rolls',
      `<p>${esc(shortcut.label)} for ${rows.map((r) => esc(r.actor.name)).join(', ')}.</p>` +
        field(
          'Send request',
          '<select name="audience"><option value="whisper">Whisper to selected players</option><option value="public">Public chat</option></select>',
        ) +
        field(
          'Roll results',
          '<select name="mode"><option value="blindroll">Blind to GMs</option><option value="publicroll">Public</option></select>',
        ) +
        field(
          'Instruction',
          textInput('instruction', '', 'Check the windows before crossing the courtyard.'),
        ) +
        `<strong>Players who may respond</strong><div class="gcs-choice-list">${players
          .map((u) =>
            checkbox(
              'users',
              u.id,
              `${u.name}${u.active ? '' : ' (offline; request remains in chat)'}`,
              owners.some((o) => o.id === u.id),
            ),
          )
          .join('')}</div>` +
        '<small>Each player can roll only for characters they own.  NPCs without player owners should be rolled by the GM.</small>',
      'Send request',
    );
    if (!data) return;
    const users = players.filter((u) => data.getAll('users').includes(u.id));
    if (!users.length) throw new Error('Choose at least one player.');
    const inaccessible = rows.filter(
      (r) => !users.some((u) => r.actor.testUserPermission(u, 'OWNER')),
    );
    if (inaccessible.length)
      throw new Error(
        `No selected player owns: ${inaccessible.map((r) => r.actor.name).join(', ')}.  Adjust your selection or roll these as GM.`,
      );
    const mappedRows = rows.map((r) => ({
      ...r,
      entry: {
        ...r.entry,
        overrides: {
          ...r.entry.overrides,
          [shortcut.id]: r.entry.overrides?.[shortcut.id] || this.shortcutFor(r.entry).otf,
        },
      },
    }));
    await createRequests(mappedRows, shortcut, {
      shared: integer(this.draft.shared),
      reason: modifierLabel(this.draft.reason),
      mode: data.get('mode'),
      audience: data.get('audience'),
      users,
      instruction: data.get('instruction'),
    });
    ui.notifications.info('Roll request sent.');
  }
  async groupModifiers() {
    const rows = await this.targetRows();
    const data = await formDialog(
      'Group modifiers',
      `<p><strong>${rows.length} characters:</strong> ${rows.map((r) => esc(r.actor.name)).join(', ')}</p>` +
        field(
          'Action',
          '<select name="action"><option value="character">Apply to characters</option><option value="preset">Use saved preset</option><option value="bucket">Send to users’ buckets</option><option value="remove">Remove character modifiers</option></select>',
        ) +
        '<p>Character modifiers stay with these actors for control-sheet rolls and its player requests.  Buckets are for rolls made elsewhere in GGA.</p>',
      'Continue',
    );
    if (!data) return;
    if (data.get('action') === 'remove') return this.removeModifiers(rows);
    if (data.get('action') === 'bucket') return this.distributeModifiers(rows);
    if (data.get('action') === 'preset') {
      const preset = await this.choosePreset();
      if (preset) await this.applyModifierForm(rows, preset);
      return;
    }
    await this.applyModifierForm(rows);
  }
  allShortcuts() {
    return [
      ...new Map(
        ['pc', 'npc'].flatMap((g) => this.prefs.shortcuts[g]).map((s) => [s.id, s]),
      ).values(),
    ];
  }
  async choosePreset() {
    if (!this.prefs.presets.length)
      throw new Error('Save a preset when applying a character modifier first.');
    const data = await formDialog(
      'Choose modifier preset',
      field(
        'Preset',
        `<select name="preset">${this.prefs.presets.map((p) => option(p.id, `${p.label} · ${signed(p.value)} ${p.name}`)).join('')}</select>`,
      ),
      'Continue',
    );
    return data ? this.prefs.presets.find((p) => p.id === data.get('preset')) : null;
  }
  modifierFields(preset) {
    const known = this.allShortcuts(),
      checks = preset?.checks || ['vision', 'observation', 'search'];
    const unknown = checks === 'all' ? [] : checks.filter((id) => !known.some((s) => s.id === id));
    return (
      (unknown.length
        ? '<p>Some saved checks have been removed from Configure.  Review and save the affected checks below.</p>'
        : '') +
      field('Description', textInput('name', preset?.name || 'Darkness')) +
      field('Modifier', numberInput('value', preset?.value ?? -2)) +
      field(
        'Scope',
        `<select name="scope">${option('checks', 'Selected checks below', checks !== 'all')}${option('all', 'All control-sheet checks', checks === 'all')}</select>`,
      ) +
      `<div class="gcs-choice-list gcs-two-col">${known.map((s) => checkbox('checks', s.id, s.label, checks !== 'all' && checks.includes(s.id))).join('')}</div>`
    );
  }
  presetFromForm(data, id) {
    return validatePreset(
      {
        id: id || foundry.utils.randomID(),
        label: data.get('presetName'),
        name: data.get('name'),
        value: data.get('value'),
        checks: data.get('scope') === 'all' ? 'all' : data.getAll('checks'),
      },
      new Set(this.allShortcuts().map((s) => s.id)),
    );
  }
  async storePreset(preset) {
    const existing = this.prefs.presets.findIndex(
      (p) => p.id === preset.id || p.label.toLocaleLowerCase() === preset.label.toLocaleLowerCase(),
    );
    if (existing < 0) {
      if (this.prefs.presets.length >= 100) throw new Error('Keep at most 100 presets.');
      this.prefs.presets.push(preset);
    } else this.prefs.presets[existing] = { ...preset, id: this.prefs.presets[existing].id };
    await this.save();
  }
  async applyModifierForm(rows, preset = null) {
    const mod = await formDialog(
      'Apply character modifier',
      this.modifierFields(preset) +
        '<p>Choose checks affected in this situation.  The same description updates its assigned modifier instead of stacking.  Applies to control-sheet rolls and requests.</p>' +
        checkbox('savePreset', 'yes', preset ? 'Update this preset' : 'Save as a reusable preset') +
        field('Preset name', textInput('presetName', preset?.label || 'Darkness −2')),
      'Apply to characters',
    );
    if (!mod) return;
    if (!mod.get('savePreset')) mod.set('presetName', preset?.label || 'Temporary modifier');
    const checked = this.presetFromForm(mod, preset?.id);
    if (mod.get('savePreset')) await this.storePreset(checked);
    const result = await applyCharacterModifier(rows, checked);
    this.reportMutation(result, 'Modifier applied');
    await this.render({ force: true });
  }
  async managePresets() {
    const preset = await this.choosePreset();
    if (!preset) return;
    const data = await formDialog(
      'Edit modifier preset',
      field('Preset name', textInput('presetName', preset.label)) +
        this.modifierFields(preset) +
        checkbox('remove', 'yes', 'Delete this saved preset') +
        '<p>Editing or deleting a preset does not change modifiers already assigned to characters.</p>',
      'Save preset',
    );
    if (!data) return;
    if (data.get('remove')) {
      this.prefs.presets = this.prefs.presets.filter((p) => p.id !== preset.id);
      await this.save();
    } else {
      const checked = this.presetFromForm(data, preset.id);
      if (
        this.prefs.presets.some(
          (p) =>
            p.id !== preset.id && p.label.toLocaleLowerCase() === checked.label.toLocaleLowerCase(),
        )
      )
        throw new Error('Another preset already uses that name.');
      await this.storePreset(checked);
    }
    await this.render({ force: true });
  }
  reportMutation(result, label) {
    ui.notifications.info(`${label}: ${result.count} characters.`);
    if (result.errors.length) ui.notifications.error(result.errors.join('; '));
  }
  async removeModifiers(rows) {
    const names = [
      ...new Set(rows.flatMap((r) => (r.actor.getFlag(ID, 'modifiers') || []).map((m) => m.name))),
    ];
    if (!names.length) throw new Error('These characters have no control-sheet modifiers.');
    const data = await formDialog(
      'Remove character modifiers',
      `<p>Remove the selected modifiers from the ${rows.length} characters in scope.</p><div class="gcs-choice-list">${names.map((n) => checkbox('names', n.toLocaleLowerCase(), n)).join('')}</div>`,
      'Remove',
    );
    if (!data) return;
    if (!data.getAll('names').length) throw new Error('Choose a modifier to remove.');
    this.reportMutation(
      await removeCharacterModifiers(rows, data.getAll('names')),
      'Modifiers removed',
    );
    await this.render({ force: true });
  }
  async distributeModifiers(rows) {
    const owners = resolveOwners(rows, collection(game.users), game.user);
    const users = collection(game.users);
    const data = await formDialog(
      'Send modifiers to buckets',
      field(
        'Source',
        `<select name="source"><option value="single">Compose one modifier below</option><option value="bucket">Copy my current bucket</option>${this.prefs.presets.map((p) => option(`preset:${p.id}`, `Preset: ${p.label} (${signed(p.value)} ${p.name})`)).join('')}</select>`,
      ) +
        `<div class="gcs-two-col">${field('Description', textInput('name', 'Darkness'))}${field('Modifier', numberInput('value', -2))}</div>` +
        field(
          'Delivery',
          '<select name="delivery"><option value="add">Add to existing modifiers</option><option value="replace">Replace recipients’ buckets</option></select>',
        ) +
        `<strong>Recipients</strong><div class="gcs-choice-list">${users.map((u) => checkbox('users', u.id, `${u.name}${u.isGM ? ' (GM)' : ''}${u.active ? '' : ' · offline'}`, u.active && owners.some((o) => o.id === u.id), !u.active)).join('')}</div>` +
        '<p>Preset check restrictions apply only to character modifiers.  In a bucket, the modifier applies to the user’s next roll.  A bucket belongs to a user, so one delivery affects that user’s next roll, whichever character they use.  GM-controlled NPCs share your bucket.  Offline users cannot receive bucket changes.</p>',
      'Send modifiers',
    );
    if (!data) return;
    const preset = this.prefs.presets.find((p) => `preset:${p.id}` === data.get('source'));
    const mods = preset
      ? [{ name: preset.name, value: preset.value }]
      : data.get('source') === 'bucket'
        ? clone(GURPS.ModifierBucket.modifierStack.modifierList).map((m) => ({
            name: m.desc,
            value: m.modint,
          }))
        : [{ name: data.get('name'), value: data.get('value') }];
    const recipients = users.filter((u) => data.getAll('users').includes(u.id));
    if (
      data.get('source') === 'bucket' &&
      data.get('delivery') === 'add' &&
      recipients.some((u) => u.id === game.user.id)
    )
      throw new Error(
        'Deselect yourself when adding a copy of your own bucket, to avoid doubling it.',
      );
    const names = await sendBuckets(recipients, mods, data.get('delivery') === 'add');
    ui.notifications.info(`Modifiers sent to ${names.join(', ')}.`);
  }
  async editEntry(id) {
    const entry = this.sourceEntry(id);
    if (!entry) throw new Error('This roster entry is unavailable.');
    const followsActor = this.rows.some(
      (r) => r.entry.sourceId === entry.id && r.entry.uuid !== entry.uuid,
    );
    const shortcuts = [
      ...new Map(
        ['pc', 'npc'].flatMap((g) => this.prefs.shortcuts[g]).map((s) => [s.id, s]),
      ).values(),
    ];
    const data = await formDialog(
      'Character options',
      (followsActor
        ? '<p>This roster entry follows its tokens on the current scene and uses the actor when none are present. These options apply to this roster source and its generated rows; each token keeps its own individual adjustment.</p>'
        : '') +
        field('Display name', textInput('name', entry.name)) +
        `<div class="gcs-two-col">${field('Roster', `<select name="group">${option('pc', 'PCs', entry.group === 'pc')}${option('npc', 'NPCs', entry.group === 'npc')}</select>`)}${field('Position', `<input type="number" name="position" min="1" max="${this.prefs.roster.length}" value="${this.prefs.roster.indexOf(entry) + 1}">`)}</div>` +
        field(
          'Fright Checks',
          `<select name="fright">${option('auto', 'Detect Unfazeable by name', entry.fright === 'auto')}${option('exempt', 'Exempt', entry.fright === 'exempt')}${option('roll', 'Roll normally', entry.fright === 'roll')}</select>`,
        ) +
        '<strong>Actor-specific OtFs</strong><p>Leave blank to use the roster shortcut.  Supply an explicit default or a differently named skill here.</p>' +
        shortcuts
          .map((s) =>
            field(s.label, textInput(`override-${s.id}`, entry.overrides?.[s.id] || '', s.otf)),
          )
          .join('') +
        checkbox('remove', 'yes', 'Remove this character and all its roster sources'),
      'Save',
    );
    if (!data) return;
    if (data.get('remove')) {
      this.prefs.roster = this.prefs.roster.filter(
        (e) => e !== entry && (!entry.actorUuid || e.actorUuid !== entry.actorUuid),
      );
      this.selection.delete(id);
    } else {
      const overrides = {};
      for (const s of shortcuts) {
        const text = data.get(`override-${s.id}`).trim();
        if (text) {
          validateAction(GURPS.parselink(text).action);
          overrides[s.id] = text;
        }
      }
      Object.assign(entry, {
        name: textValue(data.get('name'), 'Display name'),
        group: data.get('group'),
        fright: data.get('fright'),
        overrides,
      });
      const pos = integer(data.get('position'), 'Position', 1, this.prefs.roster.length) - 1;
      this.prefs.roster.splice(this.prefs.roster.indexOf(entry), 1);
      this.prefs.roster.splice(pos, 0, entry);
    }
    await this.save();
    await this.render({ force: true });
  }
  async configure() {
    const data = await formDialog(
      'Configure control sheet',
      '<strong>Visible statistics</strong><div class="gcs-choice-list gcs-two-col">' +
        Object.entries(COLUMNS)
          .map(([k, v]) => checkbox('columns', k, v, this.prefs.columns.includes(k)))
          .join('') +
        '</div>' +
        checkbox(
          'highlightConditions',
          'yes',
          'Highlight low HP/FP and marked conditions',
          this.prefs.highlightConditions,
        ) +
        checkbox(
          'showCastingEffects',
          'yes',
          'Show Casting Assistant effects beside characters (0.5.0+)',
          this.prefs.showCastingEffects !== false,
        ) +
        checkbox('resetSectionSizes', 'yes', 'Reset section sizes') +
        '<p>Save changes before exporting or opening Presets.  Export uses your saved settings.</p>' +
        '<p>One shortcut per line: <code>Label | OtF</code>.  Use a single attribute, skill, spell, or self-control roll.  Example: <code>Observation | S:"Observation"</code>.</p>' +
        ['pc', 'npc']
          .map((g) =>
            field(
              `${g === 'pc' ? 'PC' : 'NPC'} shortcuts`,
              `<textarea name="${g}" rows="8">${esc(this.prefs.shortcuts[g].map((s) => `${s.label} | ${s.otf}`).join('\n'))}</textarea>`,
            ),
          )
          .join('') +
        '<p>Fright Checks use the sheet’s Fright Check value, with the GURPS 4e limit applied after modifiers.  Adjustments and exemptions remain under GM control.</p>',
      'Save',
      650,
      [
        ['presets', 'Presets'],
        ['export', 'Export'],
        ['import', 'Import'],
      ],
    );
    if (!data) return;
    if (data.get('_gcsAction') === 'presets') return this.managePresets();
    if (data.get('_gcsAction') === 'export') return this.exportSettings();
    if (data.get('_gcsAction') === 'import') return this.importSettings();
    const shortcuts = {};
    const byLabel = new Map(
      ['pc', 'npc']
        .flatMap((g) => this.prefs.shortcuts[g])
        .map((s) => [s.label.toLocaleLowerCase(), s.id]),
    );
    for (const group of ['pc', 'npc']) {
      shortcuts[group] = String(data.get(group))
        .split('\n')
        .filter((l) => l.trim())
        .map((line) => {
          const split = line.indexOf('|');
          if (split < 1) throw new Error('Each shortcut needs Label | OtF.');
          const label = textValue(line.slice(0, split), 'Shortcut label', 60);
          const otf = textValue(line.slice(split + 1), 'OtF', 160);
          validateAction(GURPS.parselink(otf).action);
          const key = label.toLocaleLowerCase();
          if (!byLabel.has(key)) byLabel.set(key, foundry.utils.randomID());
          return { id: byLabel.get(key), label, otf };
        });
      if (!shortcuts[group].length) throw new Error('Keep at least one shortcut in each roster.');
      if (new Set(shortcuts[group].map((s) => s.id)).size !== shortcuts[group].length)
        throw new Error('Shortcut labels must be unique within each roster.');
    }
    if (data.get('resetSectionSizes')) this.prefs.sectionSizes = null;
    this.prefs.columns = data.getAll('columns');
    this.prefs.shortcuts = shortcuts;
    this.prefs.highlightConditions = !!data.get('highlightConditions');
    this.prefs.showCastingEffects = !!data.get('showCastingEffects');
    await this.save();
    await this.render({ force: true });
  }
  exportSettings() {
    const content = JSON.stringify(exportConfiguration(this.prefs), null, 2);
    const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'gga-gm-control-sheet-configuration.json';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    ui.notifications.info('Saved configuration exported.');
  }
  async importSettings() {
    const data = await formDialog(
      'Import configuration',
      field(
        'Configuration JSON',
        '<input type="file" name="configuration" accept=".json,application/json">',
      ) +
        '<p>Import saved columns, PC/NPC checks, modifier presets, and highlighting preferences.  You will review the contents before applying them.</p>',
      'Review',
    );
    if (!data) return;
    const file = data.get('configuration');
    if (!file?.size || file.size > 262144)
      throw new Error('Choose a configuration JSON file smaller than 256 KB.');
    const incoming = parseConfiguration(await file.text(), (otf) => GURPS.parselink(otf).action);
    const review = await formDialog(
      'Review configuration import',
      `<p>This replaces your saved columns, checks, presets, and display preferences.</p><p><strong>Columns:</strong> ${incoming.columns.map((c) => esc(COLUMNS[c])).join(', ') || 'None'}</p>` +
        ['pc', 'npc']
          .map(
            (g) =>
              `<p><strong>${g === 'pc' ? 'PC' : 'NPC'} checks:</strong> ${incoming.shortcuts[g].map((s) => `${esc(s.label)} <code>${esc(s.otf)}</code>`).join(', ')}</p>`,
          )
          .join('') +
        `<p><strong>Presets:</strong> ${
          incoming.presets
            .map(
              (p) =>
                `${esc(p.label)} (${signed(p.value)} ${esc(p.name)}; ${esc(
                  p.checks === 'all'
                    ? 'all checks'
                    : p.checks
                        .map(
                          (id) =>
                            Object.values(incoming.shortcuts)
                              .flat()
                              .find((s) => s.id === id).label,
                        )
                        .join(', '),
                )})`,
            )
            .join('; ') || 'None'
        }</p>` +
        `<p><strong>Condition highlighting:</strong> ${incoming.highlightConditions ? 'On' : 'Off'}</p>` +
        `<p><strong>Casting Assistant effects:</strong> ${incoming.showCastingEffects ? 'On' : 'Off'}</p>` +
        '<p>Your roster, individual overrides, assigned character modifiers, and chat requests remain in this world.  Matching check names retain their local links.  Review assigned modifiers if you replace or remove checks.</p>',
      'Import configuration',
      650,
    );
    if (!review) return;
    this.prefs = importConfiguration(this.prefs, incoming, () => foundry.utils.randomID());
    await this.save();
    await this.render({ force: true });
    ui.notifications.info('Configuration imported.');
  }
}
