import './wrapper-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { rollOne } from './test-rolls.mjs';
import { ID } from '../scripts/core.mjs';

let emitted = [],
  created = [],
  totals = [],
  rejectChat = false;
globalThis.Settings = {
  SYSTEM_NAME: 'gurps',
  SETTING_USE_TAGGED_MODIFIERS: 'use-tagged-modifiers',
  SETTING_SHOW_CONFIRMATION_ROLL_DIALOG: 'show-confirmation-roll-dialog',
  SETTING_SHIFT_CLICK_BLIND: 'shiftblind',
};
globalThis.Actor = class {
  constructor(uuid = 'Actor.a') {
    this.id = 'a';
    this.uuid = uuid;
    this.name = 'Test character';
    this.system = {
      attributes: { PER: { value: 14 } },
      ads: {},
      conditions: { usermods: ['-1 Tagged condition #test'] },
    };
    this.items = new Map();
  }
  testUserPermission() {
    return true;
  }
  getOwners() {
    return users.filter((u) => !u.isGM);
  }
  async canRoll() {
    return { canRoll: true, hasActions: true };
  }
  getFlag(_id, key) {
    return key === 'modifiers' ? this.mods || [] : undefined;
  }
  _getTagsFromCheck() {
    return ['test'];
  }
  _getTagsFromItemOrAttr() {
    return ['test'];
  }
  async addTaggedRollModifiers() {
    GURPS.ModifierBucket.addModifier('-1', 'Tagged condition', undefined, true);
  }
};
const users = [
  { id: 'gm', isGM: true },
  { id: 'player', isGM: false },
];
const settingsValues = {
  'use-tagged-modifiers': { autoAdd: true },
  'show-confirmation-roll-dialog': true,
  rollMode: 'publicroll',
};
globalThis.game = {
  system: { id: 'gurps', version: '0.18.23' },
  user: users[0],
  users,
  settings: {
    get(_n, k) {
      return settingsValues[k];
    },
  },
  socket: {
    emit(...args) {
      emitted.push(args);
    },
  },
  i18n: { localize: (k) => k },
  keyboard: { isModifierActive: () => false },
};
globalThis.canvas = { tokens: { placeables: [] } };
globalThis.ui = { notifications: { warn() {} } };
globalThis.getTokenForActor = () => null;
globalThis.foundry = { utils: { getProperty: (o, p) => p.split('.').reduce((a, k) => a?.[k], o) } };
globalThis.KeyboardManager = { MODIFIER_KEYS: { CONTROL: 'Control' } };
globalThis.TokenActions = { fromToken: async () => ({ consumeAction: async () => {} }) };
globalThis.CONFIG = { sounds: { dice: 'dice.wav' } };
globalThis.MessageMode = { Blind: { value: 'blindroll' } };
globalThis.Foundry = {
  getMessageMode: () => ({
    value: game.settings.get('core', 'rollMode'),
    isBlind: () => game.settings.get('core', 'rollMode') === 'blindroll',
  }),
  applyMessageMode: (o) => o,
};
globalThis.renderTemplate = async (_path, data) => JSON.stringify(data);
globalThis.Roll = {
  create: () => ({
    formula: '3d6',
    total: totals.shift() ?? 10,
    dice: [{ results: [{ result: 3 }, { result: 3 }, { result: 4 }] }],
    async evaluate() {
      return this;
    },
  }),
};
globalThis.ChatMessage = {
  getSpeaker: ({ actor, token }) => ({ actor: actor.id, token: token?.id }),
  getWhisperRecipients: () => users.filter((u) => u.isGM),
  applyRollMode(data, mode) {
    data.blind = mode === 'blindroll';
    data.whisper = mode === 'blindroll' ? ['gm'] : [];
  },
  async create(data) {
    await new Promise((r) => setTimeout(r, 2));
    if (rejectChat) throw new Error('Chat rejected');
    created.push(data);
    return data;
  },
};
const stack = {
  modifierList: [],
  AUTO_EMPTY: true,
  currentSum: 0,
  reset(list = []) {
    this.modifierList = list;
    this.sum();
  },
  sum() {
    this.currentSum = this.modifierList.reduce((n, m) => n + m.modint, 0);
  },
};
globalThis.GURPS = {
  LastActor: { id: 'previous' },
  PARSELINK_MAPPINGS: { PER: 'attributes.PER.value', FRIGHTCHECK: 'frightcheck' },
  PendingOTFs: [],
  parselink(otf) {
    return { action: { type: 'attribute', name: otf, orig: otf, path: 'attributes.PER.value' } };
  },
  async performAction() {
    throw new Error('Do not use the noisy action selector for display');
  },
  actionFuncs: {
    attribute: async ({ actor, calcOnly }) => {
      assert.equal(calcOnly, true);
      return { target: actor.target ?? 14, thing: 'Per' };
    },
  },
  setLastTargetedRoll(data, a, t, broadcast) {
    this.lastTargetedRoll = data;
    if (broadcast)
      game.socket.emit('system.gurps', { type: 'setLastTargetedRoll', chatdata: data });
  },
  applyModifierDesc: async () => null,
  ModifierBucket: {
    modifierStack: stack,
    refresh() {},
    currentSum() {
      return stack.currentSum;
    },
    clearTaggedModifiers() {
      stack.modifierList = stack.modifierList.filter((m) => !m.tagged);
    },
    addModifier(mod, desc, target, tagged = false) {
      (target || stack.modifierList).push({ mod, modint: Number(mod), desc, tagged });
      stack.sum();
    },
    async applyMods(mods = []) {
      const result = mods.concat(stack.modifierList);
      if (stack.AUTO_EMPTY) stack.reset();
      return result;
    },
  },
};
const shortcut = { id: 'per', label: 'Per', otf: 'Per' };
function reset() {
  emitted = [];
  created = [];
  totals = [10];
  rejectChat = false;
  game.user = users[0];
  stack.reset([{ desc: 'GM bucket', mod: '+3', modint: 3 }]);
  stack.AUTO_EMPTY = true;
}
const { initialiseRollAdapters } = await import('../scripts/roll-context.mjs');
initialiseRollAdapters();
test('native GGA roll remains GM-only with no last-roll socket broadcast and preserves GM state', async () => {
  reset();
  const originalActor = GURPS.LastActor,
    originalCreate = ChatMessage.create,
    originalSetting = game.settings.get;
  const actor = new Actor();
  actor.mods = [{ name: 'Darkness', value: -2, checks: ['per'] }];
  const result = await rollOne({ actor, shortcut });
  assert.equal(result.target, 11);
  assert.equal(result.total, 10);
  assert.equal(result.margin, 1);
  assert.equal(created.length, 1);
  assert.deepEqual(created[0].whisper, ['gm']);
  assert.equal(created[0].blind, true);
  assert.equal(emitted.length, 0);
  assert.equal(stack.currentSum, 3);
  assert.equal(GURPS.LastActor, originalActor);
  assert.equal(ChatMessage.create, originalCreate);
  assert.equal(game.settings.get, originalSetting);
});
test('each batch member gets a fresh copy of the GM bucket when explicitly included', async () => {
  reset();
  totals = [10, 10];
  const actor = new Actor();
  const first = await rollOne({ actor, shortcut, includeBucket: true });
  const second = await rollOne({ actor, shortcut, includeBucket: true });
  assert.equal(first.target, 16);
  assert.equal(second.target, 16);
  assert.equal(stack.currentSum, 3);
});
test('native Fright Check cap is applied after all positive modifiers', async () => {
  reset();
  totals = [14];
  const actor = new Actor();
  actor.target = 18;
  const result = await rollOne({
    actor,
    shortcut: { id: 'fright', label: 'Fright Check', otf: 'Fright Check' },
    shared: 5,
  });
  assert.equal(result.target, 13);
  assert.equal(result.status, 'Failure');
  assert.equal(result.margin, -1);
});
test('explicit token instance is retained in native chat speaker', async () => {
  reset();
  await rollOne({
    actor: new Actor('Scene.s.Token.t2.Actor.a'),
    entry: { tokenUuid: 'Scene.s.Token.t2', name: 'Guard 2' },
    shortcut,
  });
  assert.equal(created[0].speaker.token, 't2');
  assert.equal(created[0].speaker.scene, 's');
  assert.equal(created[0].speaker.alias, 'Guard 2');
});
test('player blind requests consume the bucket once and retain the request receipt', async () => {
  reset();
  game.user = users[1];
  await rollOne({
    actor: new Actor(),
    shortcut,
    includeBucket: true,
    request: { key: 'message:0' },
  });
  assert.equal(stack.modifierList.length, 0);
  assert.equal(emitted.length, 0);
  assert.equal(created[0].flags[ID].request.key, 'message:0');
});
test('public requests explicitly produce public native rolls', async () => {
  reset();
  game.user = users[1];
  await rollOne({ actor: new Actor(), shortcut, includeBucket: true, mode: 'publicroll' });
  assert.equal(created[0].blind, false);
  assert.deepEqual(created[0].whisper, []);
  assert.equal(emitted.length, 1);
});
test('native chat failure preserves the player bucket and stable adapters', async () => {
  reset();
  game.user = users[1];
  rejectChat = true;
  const create = ChatMessage.create,
    get = game.settings.get,
    setLast = GURPS.setLastTargetedRoll;
  await assert.rejects(
    rollOne({ actor: new Actor(), shortcut, includeBucket: true }),
    /Chat rejected/,
  );
  assert.equal(stack.currentSum, 3);
  assert.equal(ChatMessage.create, create);
  assert.equal(game.settings.get, get);
  assert.equal(GURPS.setLastTargetedRoll, setLast);
});
test('two rapid roll actions are serialised and neither inherits the other actor’s modifiers', async () => {
  reset();
  const a = new Actor();
  a.mods = [{ name: 'Darkness', value: -2, checks: ['per'] }];
  const b = new Actor();
  const results = await Promise.all([
    rollOne({ actor: a, shortcut }),
    rollOne({ actor: b, shortcut }),
  ]);
  assert.equal(results[0].target, 11);
  assert.equal(results[1].target, 13);
  assert.equal(stack.currentSum, 3);
});
