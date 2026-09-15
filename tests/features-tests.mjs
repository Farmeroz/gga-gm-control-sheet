import test from 'node:test';
import assert from 'node:assert/strict';
import { ID, upgradePreferences } from '../scripts/core.mjs';
import {
  rowMatchesFilter,
  conditionHighlights,
  exportConfiguration,
  parseConfiguration,
  importConfiguration,
  validatePreset,
} from '../scripts/features.mjs';
import {
  createRequests,
  requestStatus,
  recordResponse,
  remindOutstanding,
  requestReference,
  wasRolled,
  reconcileResponses,
} from '../scripts/requests.mjs';

const col = (a) => Object.assign(a, { get: (id) => a.find((x) => x.id === id) });
const gm = { id: 'gm', isGM: true },
  player = { id: 'p', name: 'Player', active: true },
  offline = { id: 'offline', name: 'Away', active: false };
const docs = new Map();
let counter = 0;
globalThis.game = { user: gm, users: col([gm, player, offline]), messages: col([]) };
globalThis.fromUuid = async (uuid) => docs.get(uuid);
globalThis.GURPS = {
  parselink: (otf) => ({
    action: otf === 'bad' ? { type: 'chat' } : { type: 'attribute', name: otf },
  }),
  actionFuncs: { attribute: async ({ actor }) => ({ target: actor.target }) },
};
globalThis.ChatMessage = {
  getWhisperRecipients: () => [gm],
  create: async (data) => {
    const message = {
      ...data,
      id: `m${++counter}`,
      isRoll: !!data.rolls?.length,
      author: game.users.get(data.user),
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
    game.messages.push(message);
    return message;
  },
};
const actor = (uuid, target = 12, owner = 'p') => {
  const a = {
    uuid,
    id: uuid.split('.').at(-1),
    name: uuid,
    target,
    system: {},
    testUserPermission: (u) => u.isGM || u.id === owner,
    getFlag: () => [],
  };
  docs.set(uuid, a);
  return a;
};
const rows = () =>
  [
    actor('Actor.a'),
    actor('Actor.b', 12, 'offline'),
    actor('Actor.c', 0),
    actor('Actor.d', 12, 'none'),
  ].map((a) => ({ actor: a, entry: { name: a.name, overrides: {}, adjustment: 1 } }));
const shortcut = { id: 'dx', label: 'DX', otf: 'DX' };
const request = () =>
  createRequests(rows(), shortcut, {
    shared: -2,
    reason: 'Darkness',
    mode: 'blindroll',
    audience: 'whisper',
    users: [player, offline],
    instruction: 'Carefully.',
  });

test('v0.1.1 migration preserves deliberate removal of DX/IQ and adds feature defaults once', () => {
  const prefs = upgradePreferences({
    schemaVersion: 1,
    shortcuts: {
      pc: [{ id: 'ht', label: 'HT', otf: 'HT' }],
      npc: [{ id: 'ht', label: 'HT', otf: 'HT' }],
    },
    roster: [{ id: 'a' }],
  });
  assert.deepEqual(
    prefs.shortcuts.pc.map((s) => s.id),
    ['ht'],
  );
  assert.deepEqual(prefs.presets, []);
  assert.equal(prefs.highlightConditions, true);
  assert.deepEqual(upgradePreferences(prefs), prefs);
});
test('scene and combat filters distinguish unlinked instances and linked actor rows', () => {
  const a = actor('Actor.base'),
    t1 = { uuid: 'Scene.s.Token.one', actorLink: false, actorId: 'base' },
    t2 = { uuid: 'Scene.s.Token.two', actorLink: false, actorId: 'base' },
    linked = { uuid: 'Scene.s.Token.linked', actorLink: true, actorId: 'base' };
  const row = { actor: a, token: t1 };
  assert.equal(rowMatchesFilter(row, 'scene', { tokens: [t2] }, null), false);
  assert.equal(rowMatchesFilter(row, 'scene', { tokens: [t1] }, null), true);
  assert.equal(rowMatchesFilter({ actor: a }, 'scene', { tokens: [t1] }, null), false);
  assert.equal(rowMatchesFilter({ actor: a }, 'scene', { tokens: [linked] }, null), true);
  assert.equal(rowMatchesFilter(row, 'combat', null, { combatants: [{ token: t2 }] }), false);
  assert.equal(rowMatchesFilter(row, 'combat', null, { combatants: [{ token: t1 }] }), true);
  assert.equal(rowMatchesFilter(row, 'combat', null, null), false);
});
test('condition indicators use sheet values and GGA flags without changing actor data', () => {
  const a = {
    system: { HP: { value: 4, max: 12 }, FP: { value: 3, max: 12 }, conditions: {} },
    statuses: new Set(['unconscious', 'stun']),
  };
  const before = structuredClone(a),
    first = conditionHighlights(a);
  assert.equal(
    first.some((x) => x.stat === 'HP'),
    false,
  );
  assert.equal(
    first.some((x) => x.label === 'Low FP'),
    true,
  );
  assert.equal(
    first.some((x) => x.label === 'Unconscious'),
    true,
  );
  assert.deepEqual(a, before);
  a.system.HP.value = 0;
  assert.equal(conditionHighlights(a).find((x) => x.stat === 'HP').severity, 'critical');
  a.system.HP.value = 12;
  a.system.conditions.reeling = true;
  assert.equal(conditionHighlights(a).find((x) => x.stat === 'HP').label, 'Reeling');
});
test('configuration round-trip preserves allowed settings and excludes roster, secrets, and position', () => {
  const prefs = upgradePreferences({
    roster: [{ uuid: 'Actor.secret' }],
    position: { left: 99 },
    requestHistory: 'secret',
    showCastingEffects: false,
  });
  prefs.presets = [{ id: 'dark', label: 'Night', name: 'Darkness', value: -2, checks: ['dx'] }];
  const json = JSON.stringify(exportConfiguration(prefs)),
    parsed = parseConfiguration(json, (x) => GURPS.parselink(x).action);
  assert.ok(!json.includes('secret'));
  assert.ok(!json.includes('position'));
  assert.deepEqual(parsed.presets, prefs.presets);
  const destination = upgradePreferences({ roster: [{ id: 'local' }] });
  destination.shortcuts.pc[7].id = 'localdx';
  destination.shortcuts.npc[7].id = 'localdx';
  const imported = importConfiguration(destination, parsed, () => `new${++counter}`);
  assert.deepEqual(imported.roster, destination.roster);
  assert.equal(imported.showCastingEffects, false);
  assert.deepEqual(imported.presets[0].checks, ['localdx']);
  assert.equal(imported.shortcuts.pc.find((s) => s.label === 'DX').id, 'localdx');
});
test('malformed, executable, unknown-check and oversized configuration inputs are rejected atomically', () => {
  const prefs = upgradePreferences({}),
    valid = exportConfiguration(prefs);
  for (const change of [
    (x) => (x.version = 99),
    (x) => (x.configuration.columns = ['__proto__']),
    (x) => (x.configuration.shortcuts.pc[0].otf = 'bad'),
    (x) => (x.configuration.shortcuts.pc[0].id = '__proto__'),
    (x) =>
      (x.configuration.presets = [
        { id: 'p', label: 'P', name: 'Darkness', value: -2, checks: ['missing'] },
      ]),
    (x) =>
      (x.configuration.presets = [
        { id: 'p', label: 'P', name: '*Cost 2 FP', value: -2, checks: 'all' },
      ]),
  ]) {
    const input = structuredClone(valid);
    change(input);
    assert.throws(() =>
      parseConfiguration(JSON.stringify(input), (x) => GURPS.parselink(x).action),
    );
  }
  assert.throws(() => parseConfiguration('x'.repeat(262145), () => {}));
  assert.deepEqual(exportConfiguration(prefs), valid);
  assert.throws(() =>
    validatePreset({ id: 'p', label: 'P', name: 'Darkness', value: -2, checks: [] }, new Set()),
  );
});
test('request tracking distinguishes offline awaiting from missing/unowned unavailable checks quietly', async () => {
  game.messages.length = 0;
  const m = await request();
  const status = await requestStatus(m);
  assert.deepEqual(
    status.map((s) => s.status),
    ['Awaiting roll', 'Awaiting roll', 'Unavailable', 'Unavailable'],
  );
  assert.match(status[1].detail, /offline/);
  assert.equal(status[2].detail, 'Not found');
  assert.deepEqual(m.whisper, ['p', 'offline', 'gm']);
});
test('GM records completion without exposing blind result data; survives deleted roll messages', async () => {
  game.messages.length = 0;
  const m = await request();
  const result = await ChatMessage.create({
    user: 'p',
    rolls: [{ formula: '3d6', total: 7 }],
    blind: true,
    whisper: ['gm'],
    speaker: { actor: 'a' },
    flags: {
      [ID]: {
        roll: true,
        request: requestReference(m, 0),
        check: { version: 1, actorUuid: 'Actor.a', otf: 'DX', mode: 'blindroll' },
      },
    },
  });
  await recordResponse(result);
  assert.deepEqual(m.getFlag(ID, 'responses'), { 0: { rolled: true } });
  game.messages.splice(game.messages.indexOf(result), 1);
  assert.equal(wasRolled(m, 0), true);
  assert.equal((await requestStatus(m))[0].status, 'Rolled');
});
test('reminder targets only outstanding eligible owners and retains original snapshot/receipt key', async () => {
  game.messages.length = 0;
  const m = await request();
  m.flags[ID].responses = { 0: { rolled: true } };
  docs.get('Actor.b').getFlag = () => [{ name: 'Changed', value: 10, checks: 'all' }];
  const reminder = await remindOutstanding(m),
    data = reminder.getFlag(ID, 'requestData');
  assert.equal(data.entries.length, 1);
  assert.equal(data.entries[0].uuid, 'Actor.b');
  assert.deepEqual(data.users, ['offline']);
  assert.equal(data.shared, -2);
  assert.deepEqual(data.entries[0].managed, []);
  assert.equal(data.instruction, 'Carefully.');
  assert.equal(data.mode, 'blindroll');
  assert.deepEqual(reminder.whisper, ['offline', 'gm']);
  assert.deepEqual(requestReference(reminder, 0), requestReference(m, 1));
  m.flags[ID].responses[1] = { rolled: true };
  assert.equal(wasRolled(reminder, 0), true);
  await assert.rejects(() => remindOutstanding(m), /no available characters/);
});
test('response recording verifies recipient, roll message, and exact synthetic-token speaker', async () => {
  game.messages.length = 0;
  const a = actor('Scene.s.Token.one.Actor.base');
  const m = await createRequests(
    [{ actor: a, entry: { tokenUuid: 'Scene.s.Token.one' } }],
    shortcut,
    { shared: 0, reason: 'GM', mode: 'blindroll', audience: 'whisper', users: [player] },
  );
  const data = {
    user: 'p',
    rolls: [{ formula: '3d6', total: 10 }],
    blind: true,
    whisper: ['gm'],
    speaker: { actor: 'base', scene: 's', token: 'two' },
    flags: {
      [ID]: {
        roll: true,
        request: requestReference(m, 0),
        check: { version: 1, actorUuid: a.uuid, otf: 'DX', mode: 'blindroll' },
      },
    },
  };
  const result = await ChatMessage.create(data);
  await recordResponse(result);
  assert.equal(m.getFlag(ID, 'responses'), undefined);
  result.speaker.token = 'one';
  game.user = player;
  await recordResponse(result);
  assert.equal(m.getFlag(ID, 'responses'), undefined);
  game.user = gm;
  await reconcileResponses();
  assert.deepEqual(m.getFlag(ID, 'responses'), { 0: { rolled: true } });
});
