export const ID = 'gga-gm-control-sheet';
export const DEFAULT_SHORTCUTS = [
  ['per', 'Per', 'Per'],
  ['vision', 'Vision', 'Vision'],
  ['hearing', 'Hearing', 'Hearing'],
  ['observation', 'Observation', 'S:"Observation"'],
  ['search', 'Search', 'S:"Search"'],
  ['will', 'Will', 'Will'],
  ['fright', 'Fright Check', 'Fright Check'],
  ['dx', 'DX', 'DX'],
  ['iq', 'IQ', 'IQ'],
  ['ht', 'HT', 'HT'],
].map(([id, label, otf]) => ({ id, label, otf }));
export const COLUMNS = {
  HP: 'HP',
  FP: 'FP',
  ST: 'ST',
  DX: 'DX',
  IQ: 'IQ',
  HT: 'HT',
  PER: 'Per',
  WILL: 'Will',
  move: 'Move',
  dodge: 'Dodge',
  posture: 'Posture',
  maneuver: 'Manoeuvre',
  conditions: 'Conditions',
};
export const DEFAULT_COLUMNS = ['HP', 'FP', 'PER', 'WILL', 'move', 'dodge', 'conditions'];
export const escapeHTML = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
export const clone = (value) => structuredClone(value);
export const PREFERENCES_VERSION = 2;
export function upgradePreferences(saved = {}) {
  const prefs = { roster: [], tab: 'pc', columns: [...DEFAULT_COLUMNS], ...clone(saved) };
  prefs.shortcuts = {
    pc: clone(saved.shortcuts?.pc || DEFAULT_SHORTCUTS),
    npc: clone(saved.shortcuts?.npc || DEFAULT_SHORTCUTS),
  };
  if ((prefs.schemaVersion || 0) < 1) {
    for (const group of ['pc', 'npc']) {
      for (const addition of DEFAULT_SHORTCUTS.filter((s) => ['dx', 'iq'].includes(s.id))) {
        const exists = prefs.shortcuts[group].some(
          (s) =>
            s.id === addition.id ||
            s.otf
              .trim()
              .replace(/^\[(.*)\]$/, '$1')
              .toUpperCase() === addition.otf,
        );
        if (!exists) prefs.shortcuts[group].push(clone(addition));
      }
    }
  }
  prefs.presets ??= [];
  prefs.highlightConditions ??= true;
  prefs.showCastingEffects ??= true;
  prefs.filter ??= 'all';
  prefs.schemaVersion = PREFERENCES_VERSION;
  return prefs;
}
export function tableLayout(columns) {
  const weights = [
    36,
    240,
    ...columns.map((c) =>
      ['HP', 'FP'].includes(c) ? 88 : ['posture', 'maneuver', 'conditions'].includes(c) ? 116 : 64,
    ),
    116,
    80,
    80,
  ];
  const minWidth = weights.reduce((total, width) => total + width, 0);
  return { minWidth, widths: weights.map((width) => (100 * width) / minWidth) };
}
export const signed = (n) => `${Number(n) >= 0 ? '+' : ''}${Number(n)}`;
export const normalise = (s) =>
  String(s ?? '')
    .trim()
    .toLocaleLowerCase();
export const modifierName = (s) =>
  String(s ?? '')
    .replace(/\s*\(GM Control\)$/i, '')
    .trim();
export const modifierDesc = (s) => `${modifierName(s)} (GM Control)`;
export function integer(value, label = 'Modifier', min = -100, max = 100) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max)
    throw new Error(`${label} must be a whole number from ${min} to ${max}.`);
  return n;
}
export function textValue(value, label, max = 160) {
  const text = String(value ?? '').trim();
  if (!text || text.length > max || /[\r\n\x00-\x1f]/.test(text))
    throw new Error(`${label} is required (maximum ${max} characters).`);
  return text;
}
export function modifierLabel(value) {
  const text = textValue(value, 'Modifier description');
  // GGA interprets stars and markup in descriptions as executable roll directives.
  if (/[\[\]<>*@#]/.test(text))
    throw new Error(
      'Use plain text for the modifier description, without brackets, tags, or OtF directives.',
    );
  return modifierName(text);
}
export function scopedEntries(entries, scope, selected, tab = 'pc') {
  if (scope === 'selected') return entries.filter((e) => selected.has(e.id));
  if (scope === 'both') return [...entries];
  if (scope === 'visible') return entries.filter((e) => tab === 'both' || e.group === tab);
  return entries.filter((e) => e.group === scope);
}
export function uniqueActors(rows) {
  const seen = new Set();
  return rows.filter((r) => {
    const key = r.actor?.uuid;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
export function walkList(list) {
  const out = [];
  for (const item of Object.values(list || {})) {
    if (!item || typeof item !== 'object') continue;
    out.push(item);
    out.push(...walkList(item.contains), ...walkList(item.collapsed));
  }
  return out;
}
export function isFright(otf) {
  return /^!?\s*fright\s*check(?:\s|[+-]|$)/i.test(otf.trim());
}
export function isUnfazeable(actor, entry = {}) {
  if (entry.fright === 'exempt') return true;
  if (entry.fright === 'roll') return false;
  return walkList(actor?.system?.ads).some((a) =>
    /^unfazeable(?:\s*\(|$)/i.test(a.name?.trim() || ''),
  );
}
export function modifiersFor(actor, shortcut) {
  return (actor.getFlag?.(ID, 'modifiers') || []).filter(
    (m) => m.checks === 'all' || m.checks?.includes(shortcut.id),
  );
}
export function upsertModifier(existing, mod) {
  const index = existing.findIndex((m) => normalise(m.name) === normalise(mod.name));
  const out = clone(existing);
  if (index < 0) out.push(mod);
  else out[index] = { ...mod, id: out[index].id };
  return out;
}
export function rollModifiers(managed, extra, bucket = []) {
  const names = new Set(managed.map((m) => normalise(modifierDesc(m.name))));
  return [
    ...bucket.filter((m) => !m.tagged && !names.has(normalise(m.desc))),
    ...managed.map((m) => ({ mod: signed(m.value), modint: m.value, desc: modifierDesc(m.name) })),
    ...extra
      .filter((m) => m.value !== 0)
      .map((m) => ({ mod: signed(m.value), modint: m.value, desc: m.name })),
  ];
}
export function bucketPacket(mods) {
  return {
    modifierList: mods.map((m) => ({
      mod: signed(m.value),
      modint: m.value,
      desc: modifierDesc(m.name),
      plus: m.value >= 0,
      tagged: false,
    })),
    currentSum: mods.reduce((n, m) => n + m.value, 0),
    displaySum: signed(mods.reduce((n, m) => n + m.value, 0)),
  };
}
export function resolveOwners(rows, users, currentGM) {
  const selected = new Set();
  for (const { actor } of rows) {
    const owners = users.filter((u) => !u.isGM && actor.testUserPermission(u, 'OWNER'));
    if (owners.length) owners.forEach((u) => selected.add(u.id));
    else selected.add(currentGM.id);
  }
  return users.filter((u) => selected.has(u.id));
}
export function validateAction(action) {
  if (!action || !['attribute', 'skill-spell', 'controlroll'].includes(action.type))
    throw new Error('Use a single attribute, skill, spell, or self-control OtF.');
  if (
    action.next ||
    action.sourceId ||
    action.costs ||
    action.truetext ||
    action.falsetext ||
    action.followon
  )
    throw new Error(
      'Chained rolls, actor prefixes, costs, and scripted follow-ups are not supported in shortcuts.',
    );
  return action;
}
export function sanitiseObject(obj) {
  if (!obj) return undefined;
  return {
    name: obj.name,
    originalName: obj.originalName,
    modifierTags: obj.modifierTags || '',
    college: clone(obj.college),
    consumeAction: false,
  };
}
