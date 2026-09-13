import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveRoll } from '../scripts/rolls.mjs';
import { upgradePreferences, DEFAULT_SHORTCUTS, walkList } from '../scripts/core.mjs';
import { actionFuncs } from './native-calculators.mjs';

const warnings = [];
globalThis.ui = { notifications: { warn: (m) => warnings.push(m) } };
globalThis.game = { i18n: { localize: (k) => k } };
globalThis.foundry = {
  utils: { getProperty: (o, p) => p.split('.').reduce((value, key) => value?.[key], o) },
};
globalThis.GURPS = {
  actionFuncs,
  performAction() {
    throw new Error('Noisy action selection must not run for an overview value.');
  },
  findSkillSpell(system, name, skillOnly, spellOnly) {
    return walkList(spellOnly ? system.spells : system.skills).find((s) => s.name === name);
  },
  parselink(otf) {
    let m = otf.match(/^(S|Sp):"([^"]+)"([+-]\d+)?$/);
    if (m)
      return {
        action: {
          type: 'skill-spell',
          orig: otf,
          name: m[2],
          mod: m[3],
          isSpellOnly: m[1] === 'Sp',
        },
      };
    if (otf === 'Fixed skill')
      return { action: { type: 'skill-spell', orig: otf, name: 'Observation', target: 12 } };
    const name = otf.replace(/[+-]\d+$/, '');
    const path = name === 'Fright Check' ? 'frightcheck' : `attributes.${name.toUpperCase()}.value`;
    return {
      action: { type: 'attribute', orig: otf, name, path, mod: otf.match(/[+-]\d+$/)?.[0] },
    };
  },
};
const actor = () => ({
  system: {
    attributes: { DX: { value: 13 }, IQ: { value: 14 }, PER: { value: 15 } },
    skills: {
      a: {
        name: 'Observation',
        level: 16,
        relativelevel: 'Per+1',
        modifierTags: 'vision',
        contains: { b: { name: 'Search', level: 12 } },
      },
    },
    spells: { a: { name: 'Light', level: 14, class: 'Regular' } },
  },
});
const shortcut = (otf) => ({ id: 'test', label: 'Test', otf });
test('absent skills, spells, and attributes stay quiet over repeated refreshes', async () => {
  for (let i = 0; i < 5; i++)
    for (const otf of ['S:"Missing"', 'Sp:"Missing"', 'HT', 'Fright Check']) {
      const r = await resolveRoll(actor(), shortcut(otf));
      assert.equal(r.missing, true);
    }
  assert.deepEqual(warnings, []);
});
test('a positive modifier cannot fabricate a missing skill', async () => {
  assert.equal((await resolveRoll(actor(), shortcut('S:"Missing"+5'))).missing, true);
});
test('native calculators retain skill tags, nested skills, spells, and OtF modifiers', async () => {
  const r = await resolveRoll(actor(), shortcut('S:"Observation"-2'));
  assert.equal(r.target, 14);
  assert.equal(r.action.obj.modifierTags, 'vision');
  assert.equal((await resolveRoll(actor(), shortcut('S:"Search"'))).target, 12);
  assert.equal((await resolveRoll(actor(), shortcut('Sp:"Light"'))).target, 14);
  assert.equal((await resolveRoll(actor(), shortcut('Fixed skill'))).target, 12);
});
test('DX, IQ, and actor-specific explicit defaults use native attribute calculations', async () => {
  assert.equal((await resolveRoll(actor(), shortcut('DX'))).target, 13);
  assert.equal((await resolveRoll(actor(), shortcut('IQ'))).target, 14);
  assert.equal(
    (await resolveRoll(actor(), shortcut('S:"Missing"'), { overrides: { test: 'Per-5' } })).target,
    10,
  );
});
test('existing preferences gain DX and IQ without losing roster, columns, or custom shortcuts', () => {
  const saved = {
    roster: [{ id: 'a', uuid: 'Actor.a' }],
    columns: ['HP', 'IQ'],
    shortcuts: {
      pc: [{ id: 'custom', label: 'Dexterity', otf: 'DX' }],
      npc: [{ id: 'custom2', label: 'Sneak', otf: 'S:"Stealth"' }],
    },
  };
  const upgraded = upgradePreferences(saved);
  assert.deepEqual(upgraded.roster, saved.roster);
  assert.deepEqual(upgraded.columns, saved.columns);
  assert.equal(upgraded.shortcuts.pc.length, 2);
  assert.equal(upgraded.shortcuts.pc[0].id, 'custom');
  assert.equal(upgraded.shortcuts.npc.length, 3);
  assert.deepEqual(upgradePreferences(upgraded), upgraded);
  assert.equal(saved.shortcuts.pc.length, 1);
});
test('removing a new default after upgrade is respected on later opens', () => {
  const upgraded = upgradePreferences({});
  upgraded.shortcuts.pc = upgraded.shortcuts.pc.filter((s) => s.id !== 'dx');
  assert.equal(
    upgradePreferences(upgraded).shortcuts.pc.some((s) => s.id === 'dx'),
    false,
  );
  assert.equal(
    DEFAULT_SHORTCUTS.some((s) => s.otf === 'DX'),
    true,
  );
  assert.equal(
    DEFAULT_SHORTCUTS.some((s) => s.otf === 'IQ'),
    true,
  );
  assert.equal(
    DEFAULT_SHORTCUTS.some((s) => s.otf === 'ST'),
    false,
  );
});
