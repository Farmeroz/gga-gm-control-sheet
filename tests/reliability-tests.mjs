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

const { sendBuckets } = await import('../scripts/modifiers.mjs');
const { recordResponse, matchesRequestedCheck } = await import('../scripts/requests.mjs');
const runDuringRoll = async (callback, options = {}) => {
  const create = Roll.create;
  Roll.create = () => {
    const r = create();
    r.evaluate = async function () {
      await callback();
      return this;
    };
    return r;
  };
  try {
    return await rollOne({ actor: new Actor(), shortcut, ...options });
  } finally {
    Roll.create = create;
  }
};
test('foreign wrappers and LastActor changes survive a pending control-sheet roll', async () => {
  reset();
  const get = game.settings.get,
    chat = ChatMessage.create;
  let externalGet, externalChat;
  const other = { id: 'other' };
  try {
    await runDuringRoll(() => {
      externalGet = function (...args) {
        return get.apply(this, args);
      };
      externalChat = function (...args) {
        return chat.apply(this, args);
      };
      game.settings.get = externalGet;
      ChatMessage.create = externalChat;
      GURPS.LastActor = other;
    });
    assert.equal(game.settings.get, externalGet);
    assert.equal(ChatMessage.create, externalChat);
    assert.equal(game.settings.get('core', 'rollMode'), 'publicroll');
    assert.equal(GURPS.LastActor, other);
  } finally {
    game.settings.get = get;
    ChatMessage.create = chat;
  }
});
test('GM bucket receives new modifiers during a pending roll without changing that roll', async () => {
  reset();
  users[0].active = true;
  const result = await runDuringRoll(() =>
    sendBuckets([game.user], [{ name: 'Incoming darkness', value: -2 }], true),
  );
  assert.equal(result.target, 13);
  assert.equal(stack.currentSum, 1);
  assert.equal(stack.modifierList.length, 2);
});
test('player consumption removes only unchanged snapshot entries and preserves arrivals', async () => {
  reset();
  game.user = users[1];
  await runDuringRoll(() => GURPS.ModifierBucket.addModifier('-2', 'Incoming'), {
    includeBucket: true,
  });
  assert.deepEqual(
    stack.modifierList.map((m) => m.desc),
    ['Incoming'],
  );
  assert.equal(stack.currentSum, -2);
});
test('player bucket replacement during a check is preserved', async () => {
  reset();
  game.user = users[1];
  await runDuringRoll(() => stack.reset([{ desc: 'Replacement', mod: '-4', modint: -4 }]), {
    includeBucket: true,
  });
  assert.equal(stack.currentSum, -4);
  assert.equal(stack.modifierList[0].desc, 'Replacement');
});
test('changed bucket entries are retained with a warning rather than silently discarded', async () => {
  reset();
  game.user = users[1];
  let warning = '';
  const warn = ui.notifications.warn;
  ui.notifications.warn = (m) => (warning = m);
  try {
    await runDuringRoll(
      () => {
        stack.modifierList[0].modint = 5;
        stack.modifierList[0].mod = '+5';
      },
      { includeBucket: true },
    );
    assert.equal(stack.modifierList[0].modint, 5);
    assert.match(warning, /changed during/);
  } finally {
    ui.notifications.warn = warn;
  }
});
test('unrelated public roll for a token sharing the actor ID keeps its own identity and visibility', async () => {
  reset();
  const request = { key: 'request:0', messageId: 'request', index: 0 };
  await runDuringRoll(
    () =>
      ChatMessage.create({
        user: 'gm',
        speaker: { actor: 'a', scene: 's', token: 'two' },
        rolls: [{ formula: '3d6', total: 9 }],
        content: 'Unrelated',
      }),
    { entry: { tokenUuid: 'Scene.s.Token.one' }, request },
  );
  const other = created.find((m) => m.content === 'Unrelated');
  assert.equal(other.speaker.token, 'two');
  assert.equal(other.flags, undefined);
  assert.equal(other.blind, undefined);
  const ours = created.find((m) => m.flags?.[ID]?.roll);
  assert.equal(ours.speaker.token, 'one');
  assert.equal(ours.blind, true);
  assert.deepEqual(ours.flags[ID].request, request);
});
test('missing cap callback fails before result broadcast or chat publication', async () => {
  reset();
  totals = [14];
  const actor = new Actor();
  actor.target = 18;
  const { rollOne: uncapped } = await import('../scripts/uncapped-rolls.mjs');
  await assert.rejects(
    uncapped({
      actor,
      shortcut: { id: 'fright', label: 'Fright Check', otf: 'Fright Check' },
      shared: 5,
    }),
    /Fright Check limit/,
  );
  assert.equal(created.length, 0);
  assert.equal(emitted.length, 0);
  assert.equal(stack.currentSum, 3);
});
test('supplementary native messages without dice receive the same GM-only audience', async () => {
  reset();
  const { rollOne: supplementary } = await import('../scripts/supplementary-rolls.mjs');
  await supplementary({ actor: new Actor(), shortcut });
  assert.equal(created.length, 2);
  for (const message of created) {
    assert.equal(message.blind, true);
    assert.deepEqual(message.whisper, ['gm']);
    assert.equal(message.speaker.actor, 'a');
  }
});
test('missing-skill checks are quiet and self-control checks remain private', async () => {
  reset();
  const parse = GURPS.parselink;
  GURPS.findSkillSpell = () => null;
  try {
    GURPS.parselink = () => ({ action: { type: 'skill-spell', name: 'Missing' } });
    assert.equal((await rollOne({ actor: new Actor(), shortcut })).status, 'Not found');
    assert.equal(created.length, 0);
    GURPS.parselink = () => ({ action: { type: 'controlroll', target: 12, desc: 'Self-control' } });
    const result = await rollOne({
      actor: new Actor(),
      shortcut: { id: 'control', label: 'Self-control', otf: 'CR:12' },
    });
    assert.equal(result.target, 11);
    assert.equal(created[0].blind, true);
  } finally {
    GURPS.parselink = parse;
  }
});
test('college-tagged spell adjustments reach the native target without executing component scripts', async () => {
  reset();
  const parse = GURPS.parselink,
    funcs = GURPS.actionFuncs;
  try {
    const actor = new Actor();
    actor.system.conditions.usermods = ['-2 College penalty #fire'];
    actor._getTagsFromItemOrAttr = (_text, _settings, args) => [args.obj.college.toLowerCase()];
    GURPS.parselink = () => ({ action: { type: 'skill-spell', name: 'Fireball', target: 15 } });
    GURPS.actionFuncs = {
      'skill-spell': async ({ action }) => {
        action.obj = {
          name: 'Fireball',
          college: 'Fire',
          modifierTags: '',
          passotf: 'must not run',
          checkotf: 'must not run',
        };
        return { target: 15, thing: 'Fireball' };
      },
    };
    const result = await rollOne({
      actor,
      shortcut: { id: 'spell', label: 'Fireball', otf: 'Sp:Fireball' },
    });
    assert.equal(result.target, 13);
    assert.equal(created.length, 1);
  } finally {
    GURPS.parselink = parse;
    GURPS.actionFuncs = funcs;
  }
});
test('cost directives in tagged modifiers are rejected before any roll or actor mutation', async () => {
  reset();
  const actor = new Actor();
  actor.system.conditions.usermods = ['+0 *Costs 2 FP #test'];
  await assert.rejects(rollOne({ actor, shortcut }), /cost directives/);
  assert.equal(created.length, 0);
  assert.equal(stack.currentSum, 3);
});
test('unsupported system versions fail without changing global state', async () => {
  reset();
  game.system.version = '0.19.0';
  try {
    await assert.rejects(rollOne({ actor: new Actor(), shortcut }), /0.18.0/);
    assert.equal(created.length, 0);
  } finally {
    game.system.version = '0.18.23';
  }
});
test('receipt rejects wrong formula, check, actor, and audience while retaining completion-only storage', async () => {
  reset();
  const row = { uuid: 'Actor.a', entry: {} },
    payload = { shortcut: { id: 'per', otf: 'Per' }, mode: 'blindroll' };
  const data = {
    check: { version: 1, actorUuid: 'Actor.a', otf: 'Per', mode: 'blindroll' },
    rolls: [{ formula: '3d6[Per]', total: 10 }],
    blind: true,
    whisper: ['gm'],
  };
  const message = (x) => ({ ...x, getFlag: (_id, key) => x[key] });
  assert.equal(matchesRequestedCheck(message(data), row, payload), true);
  for (const patch of [
    { rolls: [{ formula: '1d6', total: 6 }] },
    { blind: false },
    { whisper: ['gm', 'player'] },
    { check: { ...data.check, actorUuid: 'Actor.b' } },
    { check: { ...data.check, otf: 'Will' } },
    { check: undefined },
  ])
    assert.equal(matchesRequestedCheck(message({ ...data, ...patch }), row, payload), false);
});
test('bulk roster add resolves once and still deduplicates the incoming batch', async () => {
  globalThis.foundry.applications = { api: { ApplicationV2: class {} } };
  let counter = 0,
    calls = 0;
  foundry.utils.randomID = () => `id${++counter}`;
  ui.notifications.info = () => {};
  const { GMControlSheet } = await import('../scripts/control-sheet.mjs');
  const sheet = Object.create(GMControlSheet.prototype);
  sheet.prefs = { roster: Array.from({ length: 40 }, (_, i) => ({ uuid: `Actor.old${i}` })) };
  sheet.resolveEntry = async (entry) => {
    calls++;
    return { entry, actor: { uuid: entry.uuid } };
  };
  sheet.save = async () => {};
  sheet.render = async () => {};
  const docs = Array.from({ length: 20 }, (_, i) => ({
    documentName: 'Actor',
    uuid: `Actor.new${i}`,
    name: `New ${i}`,
  }));
  await sheet.addDocuments([...docs, ...docs], 'pc');
  assert.equal(calls, 40);
  assert.equal(sheet.prefs.roster.length, 60);
});
