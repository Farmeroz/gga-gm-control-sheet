import test from 'node:test';
import assert from 'node:assert/strict';
import {
  castingEffectsFor,
  castingEffectBadges,
  manageCastingEffects,
} from '../scripts/casting-effects.mjs';
const actor = { uuid: 'Actor.patient' };
globalThis.game = { user: { isGM: true }, modules: new Map() };
test('Casting Assistant is optional, and incompatible summaries are ignored', async () => {
  game.modules.clear();
  assert.deepEqual(await castingEffectsFor(actor), []);
  game.modules.set('gga-casting-assistant', {
    active: true,
    api: { getActiveEffects: async () => [{ schema: 9, actorUuid: actor.uuid }] },
  });
  assert.deepEqual(await castingEffectsFor(actor), []);
});
test('effect badges preserve original caster, received role, due status and escape user text', async () => {
  const effect = {
    schema: 1,
    id: 'e',
    actorUuid: actor.uuid,
    casterUuid: 'Actor.caster',
    casterName: 'Mage',
    received: true,
    cast: false,
    state: 'due',
    name: '<img src=x>',
    summary: 'Shield',
    maintainable: true,
    maintenanceCost: 2,
  };
  let opened;
  game.modules.set('gga-casting-assistant', {
    active: true,
    api: {
      getActiveEffects: async () => [effect],
      activeEffects: async (id) => {
        opened = id;
      },
    },
  });
  const html = castingEffectBadges(await castingEffectsFor(actor));
  assert.match(html, /Received/);
  assert.match(html, /Maintenance due/);
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<img/);
  await manageCastingEffects(effect.casterUuid);
  assert.equal(opened, effect.casterUuid);
});
test('players cannot read or manage effects through the GM integration', async () => {
  game.user.isGM = false;
  await assert.rejects(castingEffectsFor(actor), /Only a GM/);
  await assert.rejects(manageCastingEffects('Actor.caster'), /Only a GM/);
  game.user.isGM = true;
});
test('pending target summaries name the caster and focus the original effect', async () => {
  const effect = {
    schema: 2,
    id: 'sleep-2',
    actorUuid: actor.uuid,
    casterUuid: 'Actor.mage',
    casterName: 'Roselyn',
    name: 'Sleep',
    cast: false,
    received: false,
    pending: true,
    state: 'active',
    remaining: 60,
  };
  let opened;
  game.modules.set('gga-casting-assistant', {
    active: true,
    api: {
      getActiveEffects: async () => [effect],
      activeEffects: async (...args) => {
        opened = args;
      },
    },
  });
  const html = castingEffectBadges(await castingEffectsFor(actor));
  assert.match(html, /Pending: Sleep · from Roselyn/);
  assert.doesNotMatch(html, /Received:/);
  assert.match(html, /data-effect="sleep-2"/);
  await manageCastingEffects(effect.casterUuid, effect.id);
  assert.deepEqual(opened, ['Actor.mage', 'sleep-2']);
  effect.cast = true;
  assert.match(castingEffectBadges([effect]), /Self · pending: Sleep/);
});
