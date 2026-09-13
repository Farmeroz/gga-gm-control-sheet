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

const { parseHTML } = await import('linkedom');
const { window } = parseHTML('<html><body></body></html>');
globalThis.document = window.document;
globalThis.HTMLElement = window.HTMLElement;
const { createRequests, wireRequest, recordResponse, requestReference, remindOutstanding } =
  await import('./request-test-module.mjs');
const messages = [];
messages.get = (id) => messages.find((m) => m.id === id);
game.messages = messages;
const actorDocs = new Map();
globalThis.fromUuid = async (uuid) => actorDocs.get(uuid);
ui.notifications = {
  info() {},
  warn() {},
  error(message) {
    throw new Error(message);
  },
};
const create = ChatMessage.create;
ChatMessage.create = async function (data) {
  const output = await create.call(this, data);
  const message = {
    ...output,
    id: `message${messages.length}`,
    author: users.find((u) => u.id === output.user),
    isRoll: !!output.rolls?.length,
    getFlag(scope, key) {
      return this.flags?.[scope]?.[key];
    },
    async update(changes) {
      for (const [key, value] of Object.entries(changes)) {
        this.flags[ID].responses ??= {};
        this.flags[ID].responses[key.split('.').at(-1)] = value;
      }
    },
  };
  messages.push(message);
  return message;
};
const waitUntil = async (condition) => {
  for (let i = 0; i < 200; i++) {
    if (condition()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('Click did not finish');
};
test('clicking a reminder executes the native blind roll once and completes both cards without revealing its result', async () => {
  reset();
  messages.length = 0;
  const actor = new Actor('Scene.s.Token.t2.Actor.a');
  actorDocs.set(actor.uuid, actor);
  const original = await createRequests(
    [{ actor, entry: { name: 'Guard instance', tokenUuid: 'Scene.s.Token.t2', overrides: {} } }],
    shortcut,
    {
      shared: -2,
      reason: 'Darkness',
      mode: 'blindroll',
      audience: 'whisper',
      users: [users[1]],
      instruction: 'Look carefully.',
    },
  );
  const reminder = await remindOutstanding(original);
  game.user = users[1];
  const originalRoot = document.createElement('div'),
    reminderRoot = document.createElement('div');
  for (const [message, root] of [
    [original, originalRoot],
    [reminder, reminderRoot],
  ]) {
    root.dataset.messageId = message.id;
    root.innerHTML = message.content;
    document.body.append(root);
    wireRequest(message, root);
  }
  await new Promise((r) => setTimeout(r, 0));
  const button = reminderRoot.querySelector('button');
  button.click();
  button.click();
  await waitUntil(() => button.textContent === 'Rolled');
  const result = messages.find((m) => m.isRoll);
  assert.ok(result);
  assert.equal(messages.filter((m) => m.isRoll).length, 1);
  assert.equal(result.blind, true);
  assert.deepEqual(result.whisper, ['gm']);
  assert.equal(emitted.length, 0);
  assert.equal(stack.modifierList.length, 0);
  assert.equal(result.speaker.token, 't2');
  assert.equal(result.flags[ID].request.key, requestReference(original, 0).key);
  assert.equal(originalRoot.querySelector('button').textContent, 'Rolled');
  assert.equal(originalRoot.textContent.includes('margin'), false);
  game.user = users[0];
  await recordResponse(result);
  assert.deepEqual(original.flags[ID].responses, { 0: { rolled: true } });
});
