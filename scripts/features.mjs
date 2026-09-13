import {ID, COLUMNS, clone, integer, modifierLabel, normalise, textValue, validateAction} from './core.mjs';

const collection = value => value?.contents || Array.from(value || []);
export function rowMatchesFilter(row, filter, scene, combat) {
  if (filter === 'all') return true;
  if (!row.actor) return false;
  const matchesToken = token => row.token ? token?.uuid === row.token.uuid :
    !!token?.actorLink && token.actorId === row.actor.id;
  if (filter === 'scene') return !!scene && collection(scene.tokens).some(matchesToken);
  if (filter === 'combat') return !!combat && collection(combat.combatants).some(c => {
    if (c.token) return matchesToken(c.token);
    // Actor-only combatants may match an actor row, never a particular token instance.
    return !row.token && !c.tokenId && c.actor?.uuid === row.actor.uuid;
  });
  return false;
}

export function conditionHighlights(actor) {
  const flags = actor.system?.conditions || {};
  const statuses = new Set(collection(actor.statuses));
  const alerts = [];
  for (const [stat, state] of [['HP', 'reeling'], ['FP', 'exhausted']]) {
    const resource = actor.system?.[stat];
    const value = Number(resource?.value), max = Number(resource?.max);
    const low = resource?.value != null && Number.isFinite(value) && Number.isFinite(max) && max > 0 && value < max / 3;
    if (low || flags[state] || statuses.has(state)) alerts.push({stat, severity: value <= 0 ? 'critical' : 'warning',
      label: low ? `Low ${stat}` : (stat === 'HP' ? 'Reeling' : 'Exhausted'),
      detail: low ? `${stat} below one-third of maximum` : `${stat === 'HP' ? 'Reeling' : 'Exhausted'} marked in GGA`});
  }
  if (statuses.has('stun') || statuses.has('stunned')) alerts.push({label:'Stunned', detail:'Stun marked in GGA', severity:'warning'});
  if (statuses.has('mentalstun')) alerts.push({label:'Mental stun', detail:'Mental stun marked in GGA', severity:'warning'});
  if (statuses.has('disabled')) alerts.push({label:'Disabled', detail:'Disabled marked in GGA', severity:'critical'});
  if (statuses.has('unconscious')) alerts.push({label:'Unconscious', detail:'Unconsciousness marked in GGA', severity:'critical'});
  if (statuses.has('dead')) alerts.push({label:'Dead', detail:'Death marked in GGA', severity:'critical'});
  return alerts;
}

const safeId = value => {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(value) || ['__proto__','constructor','prototype'].includes(value)) throw new Error('Invalid configuration identifier.');
  return value;
};
export function validatePreset(preset, shortcutIds) {
  const checks = preset.checks === 'all' ? 'all' : Array.isArray(preset.checks) ? [...new Set(preset.checks.map(safeId))] : [];
  if (checks !== 'all' && (!checks.length || checks.some(id => !shortcutIds.has(id)))) throw new Error('Choose existing checks for this preset.');
  return {id:safeId(preset.id), label:textValue(preset.label, 'Preset name', 60),
    name:modifierLabel(preset.name), value:integer(preset.value), checks};
}
export function exportConfiguration(prefs) {
  const known = new Set(Object.values(prefs.shortcuts).flat().map(s=>s.id));
  for (const preset of prefs.presets || []) {
    if (preset.checks !== 'all' && preset.checks.some(id=>!known.has(id))) throw new Error(`Preset “${preset.label}” refers to removed checks.  Edit it under Configure → Presets before exporting.`);
  }
  return {format:ID, version:1, configuration:clone({columns:prefs.columns, shortcuts:prefs.shortcuts,
    presets:prefs.presets || [], highlightConditions:prefs.highlightConditions !== false})};
}
export function parseConfiguration(text, parseAction) {
  if (typeof text !== 'string' || text.length > 262144) throw new Error('Choose a configuration JSON file smaller than 256 KB.');
  let data; try {data = JSON.parse(text);} catch {throw new Error('The file is not valid JSON.');}
  if (data?.format !== ID || data.version !== 1 || !data.configuration) throw new Error('This is not a supported GM Control Sheet configuration.');
  const source = data.configuration;
  if (!Array.isArray(source.columns) || source.columns.some(c => !Object.hasOwn(COLUMNS, c))) throw new Error('Unknown statistic in configuration.');
  const columns = [...new Set(source.columns)];
  const shortcuts = {}, identities = new Map();
  for (const group of ['pc','npc']) {
    if (!Array.isArray(source.shortcuts?.[group]) || !source.shortcuts[group].length || source.shortcuts[group].length > 100) throw new Error('Keep between 1 and 100 checks in each roster.');
    shortcuts[group] = source.shortcuts[group].map(s => {
      const id = safeId(s.id), label = textValue(s.label, 'Shortcut label', 60), otf = textValue(s.otf, 'OtF');
      validateAction(parseAction(otf));
      if (identities.has(id) && identities.get(id) !== normalise(label)) throw new Error('A check identifier is used for different labels.');
      identities.set(id, normalise(label));
      return {id,label,otf};
    });
    if (new Set(shortcuts[group].map(s=>s.id)).size !== shortcuts[group].length ||
        new Set(shortcuts[group].map(s=>normalise(s.label))).size !== shortcuts[group].length) throw new Error('Check names and identifiers must be unique in each roster.');
  }
  if (!Array.isArray(source.presets) || source.presets.length > 100) throw new Error('Invalid preset list.');
  const presets = source.presets.map(p => validatePreset(p, new Set(identities.keys())));
  if (new Set(presets.map(p=>normalise(p.label))).size !== presets.length || new Set(presets.map(p=>p.id)).size !== presets.length) throw new Error('Preset names and identifiers must be unique.');
  if (typeof source.highlightConditions !== 'boolean') throw new Error('Invalid condition highlighting setting.');
  return {columns,shortcuts,presets,highlightConditions:source.highlightConditions};
}
export function importConfiguration(prefs, incoming, randomID) {
  // Retain local identities for matching check names, so roster overrides and
  // assigned character modifiers keep referring to those checks across worlds.
  const existing = ['pc','npc'].flatMap(g=>prefs.shortcuts[g]);
  const ids = new Map(), used = new Set(existing.map(s=>s.id));
  for (const s of ['pc','npc'].flatMap(g=>incoming.shortcuts[g])) {
    if (ids.has(s.id)) continue;
    let id = existing.find(old=>normalise(old.label)===normalise(s.label))?.id;
    if (!id || [...ids.values()].includes(id)) {do {id=randomID();} while (used.has(id));}
    used.add(id); ids.set(s.id,id);
  }
  const result = clone(prefs);
  result.columns = clone(incoming.columns);
  result.highlightConditions = incoming.highlightConditions;
  result.shortcuts = Object.fromEntries(['pc','npc'].map(g=>[g,incoming.shortcuts[g].map(s=>({...s,id:ids.get(s.id)}))]));
  result.presets = incoming.presets.map(p=>({...p,id:randomID(),checks:p.checks==='all'?'all':p.checks.map(id=>ids.get(id))}));
  return result;
}
