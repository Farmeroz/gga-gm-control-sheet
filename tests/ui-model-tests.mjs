import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
globalThis.window = globalThis;
window.innerWidth = 1320;
window.innerHeight = 900;
globalThis.document = { createElement: () => ({ innerHTML: '', className: '' }) };

const flags = {};
class ApplicationV2 {
  constructor(options = {}) {
    this.position = { ...this.constructor.DEFAULT_OPTIONS.position, ...options.position };
    this.rendered = false;
  }
  async render() {
    this.html = (await this._renderHTML(await this._prepareContext())).innerHTML;
    this.rendered = true;
    return this;
  }
  async _preClose() {}
  async close() {
    await this._preClose();
    this.rendered = false;
  }
}
const responses = [];
const DialogV2 = {
  wait: async () => {
    const response = responses.shift();
    if (!response) return null;
    const fd = new FormData();
    for (const [key, values] of Object.entries(response)) {
      for (const value of Array.isArray(values) ? values : [values]) fd.append(key, value);
    }
    return fd;
  },
};
window.errors = [];
window.notices = [];
window.foundry = {
  applications: { api: { ApplicationV2, DialogV2 } },
  utils: {
    getProperty: (o, p) => p.split('.').reduce((a, k) => a?.[k], o),
    randomID: () => crypto.randomUUID().replaceAll('-', '').slice(0, 16),
  },
};
window.ui = {
  notifications: {
    info: (m) => notices.push(m),
    warn: (m) => notices.push(m),
    error: (m) => errors.push(m),
  },
};
window.CONFIG = {
  statusEffects: [
    { id: 'stunned', name: 'Stunned' },
    { id: 'prone', name: 'Prone' },
  ],
};
const group = (a) => Object.assign(a, { get: (id) => a.find((x) => x.id === id), contents: a });
const users = group([
  { id: 'gm', name: 'Mark', isGM: true, active: true },
  { id: 'phil', name: 'Phil', isGM: false, active: true },
  { id: 'squizz', name: 'Squizz', isGM: false, active: true },
  { id: 'offline', name: 'Offline player', isGM: false, active: false },
]);
users[0].getFlag = (_id, key) => flags[key];
users[0].setFlag = async (_id, key, value) => (flags[key] = value);
const colors = ['#b99160', '#b8bfc4', '#6e8392', '#a88265'];
const docs = new Map();
window.Actor = class {
  constructor(id, name, owner, idx, token = false) {
    this.id = id;
    this.name = name;
    this.owner = owner;
    this.documentName = 'Actor';
    this.uuid = token ? `Scene.dock.Token.${id}.Actor.base` : `Actor.${id}`;
    this.img = `/tmp/avatar${idx}.svg`;
    this.prototypeToken = { texture: { src: `/tmp/token${idx}.svg` } };
    this.flags = {};
    this.statuses = new Set(idx === 2 ? ['stunned'] : []);
    this.system = {
      HP: { value: idx === 0 ? 18 : idx === 2 ? 7 : 12, max: idx === 0 ? 20 : 12 },
      FP: { value: idx === 0 ? 13 : 10, max: 14 },
      attributes: {
        ST: { value: 14 },
        DX: { value: 13 },
        IQ: { value: 14 },
        HT: { value: 12 },
        PER: { value: idx === 0 ? 16 : 13 },
        WILL: { value: idx === 0 ? 18 : 13 },
      },
      currentmove: idx === 2 ? 3 : 6,
      currentdodge: 9,
      vision: idx === 0 ? 18 : 13,
      hearing: 14,
      frightcheck: idx === 0 ? 20 : 13,
      conditions: { posture: 'standing', maneuver: 'do_nothing' },
      skills: {
        0: { name: 'Observation', level: idx === 0 ? 18 : 14 },
        1: { name: 'Search', level: 13 },
      },
      ads: {},
    };
    this.sheet = { render: () => notices.push('Opened sheet ' + name) };
    docs.set(this.uuid, this);
  }
  getFlag(id, key) {
    return this.flags[key];
  }
  async setFlag(id, key, v) {
    this.flags[key] = v;
  }
  testUserPermission(u) {
    return u.isGM || u.id === this.owner;
  }
  getActiveTokens() {
    return [];
  }
  getOwners() {
    return users.filter((u) => u.id === this.owner);
  }
};
const luke = new Actor('luke', 'Luke Morningstar', 'phil', 0);
const zoe = new Actor('zoe', 'Zoé de Sancerre', 'phil', 1);
const g1 = new Actor('guard1', 'Legion Guard · North Door', null, 2, true);
const g2 = new Actor('guard2', 'Legion Guard · South Door', null, 3, true);
const actors = group([luke, zoe]);
const scene = {
  id: 'dock',
  name: 'Eveningstar · Arrival',
  async view() {
    canvas.scene = this;
  },
  tokens: [],
};
const tokenDoc = (a) => ({
  id: a.id,
  uuid: `Scene.dock.Token.${a.id}`,
  documentName: 'Token',
  name: a.name,
  actor: a,
  actorLink: false,
  actorId: 'base',
  texture: a.prototypeToken.texture,
  parent: scene,
});
scene.tokens = group([tokenDoc(g1), tokenDoc(g2)]);
scene.tokens.forEach((t) => docs.set(t.uuid, t));
window.fromUuid = async (uuid) => docs.get(uuid);
window.canvas = {
  scene,
  tokens: {
    controlled: [],
    placeables: [],
    get: () => ({ center: { x: 100, y: 100 }, control: () => {} }),
  },
  animatePan: async () => {},
};
window.game = {
  user: users[0],
  users,
  actors,
  scenes: group([scene]),
  messages: group([]),
  i18n: { localize: (v) => v },
  settings: { get: () => false },
  socket: { emit: (...x) => notices.push(x) },
  keyboard: { isModifierActive: () => false },
};
window.GURPS = {
  parselink: (s) => ({
    action: s.startsWith('S:')
      ? { type: 'skill-spell', name: s.slice(2).replaceAll('"', ''), orig: s }
      : { type: 'attribute', name: s, orig: s },
  }),
  performAction: async (a, actor) => {
    const s = actor.system;
    return {
      target:
        a.type === 'skill-spell'
          ? Object.values(s.skills).find((x) => x.name === a.name)?.level
          : (s.attributes[a.name.toUpperCase()]?.value ??
            s[a.name.toLowerCase().replaceAll(' ', '')]),
      thing: a.name,
    };
  },
  ModifierBucket: { modifierStack: { modifierList: [] } },
};
window.ChatMessage = {
  getWhisperRecipients: () => [users[0]],
  create: async (data) => {
    game.messages.push(data);
    notices.push('Chat created');
    return data;
  },
};
flags.preferences = {
  roster: [
    { id: 'l', uuid: luke.uuid, name: luke.name, group: 'pc', fright: 'auto', overrides: {} },
    { id: 'z', uuid: zoe.uuid, name: zoe.name, group: 'pc', fright: 'auto', overrides: {} },
    {
      id: 'g1',
      uuid: scene.tokens[0].uuid,
      name: g1.name,
      group: 'npc',
      fright: 'auto',
      overrides: {},
    },
    {
      id: 'g2',
      uuid: scene.tokens[1].uuid,
      name: g2.name,
      group: 'npc',
      fright: 'auto',
      overrides: {},
    },
  ],
  tab: 'both',
};
luke.flags.modifiers = [
  { id: 'dark', name: 'Darkness', value: -2, checks: ['vision', 'observation', 'search'] },
];
zoe.flags.modifiers = luke.flags.modifiers;
const { GMControlSheet } = await import('../scripts/control-sheet.mjs');
window.sheet = new GMControlSheet();
await sheet.render();
window.ready = true;

assert.equal(sheet.rows.length, 4);
assert.equal((sheet.html.match(/data-select=/g) || []).length, 4);
// HTML is also exercised by the browser workflow.
sheet.selection = new Set(['l', 'g2']);
sheet.prefs.tab = 'pc';
assert.equal((await sheet.targetRows()).length, 2);
responses.push(
  { action: 'character' },
  { name: 'Darkness', value: '-2', scope: 'checks', checks: ['vision', 'observation', 'search'] },
);
await sheet.groupModifiers();
assert.equal(g2.flags.modifiers[0].value, -2);
assert.equal(g1.flags.modifiers, undefined);
sheet.draft.scope = 'both';
responses.push(
  { action: 'character' },
  { name: 'Darkness', value: '-3', scope: 'checks', checks: ['vision', 'observation', 'search'] },
);
await sheet.groupModifiers();
assert.equal(
  sheet.rows.every(
    (r) => r.actor.flags.modifiers.length === 1 && r.actor.flags.modifiers[0].value === -3,
  ),
  true,
);
responses.push({ action: 'remove' }, { names: ['darkness'] });
await sheet.groupModifiers();
assert.equal(
  sheet.rows.every((r) => r.actor.flags.modifiers.length === 0),
  true,
);
sheet.draft.scope = 'pc';
responses.push({
  audience: 'whisper',
  mode: 'blindroll',
  instruction: 'Check the windows.',
  users: ['phil'],
});
await sheet.requestRolls();
const request = game.messages[0];
assert.equal(request.flags['gga-gm-control-sheet'].requestData.entries.length, 2);
assert.deepEqual(request.whisper, ['phil', 'gm']);
assert.match(request.content, /Luke Morningstar/);
assert.match(request.content, /Zoé de Sancerre/);
responses.push({
  name: 'Zoé <test>',
  group: 'npc',
  position: '1',
  fright: 'roll',
  ...Object.fromEntries(
    sheet.shortcuts.map((s) => ['override-' + s.id, s.id === 'observation' ? 'S:"Search"' : '']),
  ),
});
await sheet.editEntry('z');
assert.equal(sheet.prefs.roster[0].id, 'z');
assert.equal(sheet.prefs.roster[0].group, 'npc');
assert.equal(sheet.prefs.roster[0].overrides.observation, 'S:"Search"');
sheet.prefs.tab = 'both';
await sheet.render();
assert.match(sheet.html, /Zoé &lt;test&gt;/);
assert.equal(errors.length, 0);
console.log(
  'UI model checks passed: mixed selection, subset/all modifier updates and removal, actor-specific player requests, reorder/group change, OtF override, escaped names, generated HTML.',
);

// Scene-following rows bind all actions to the displayed token, not its base actor.
const liveLuke = new Actor('luke-live', 'Luke on scene', 'phil', 0, true);
liveLuke.system.HP.value = 16;
const liveToken = tokenDoc(liveLuke);
liveToken.actorId = luke.id;
scene.tokens.push(liveToken);
docs.set(liveToken.uuid, liveToken);
await assert.rejects(sheet.targetRows(), /scene roster changed/);
const tokenRow = sheet.rows.find((r) => r.token?.uuid === liveToken.uuid);
assert.ok(tokenRow);
assert.equal(tokenRow.actor, liveLuke);
assert.equal(
  sheet.rows.some((r) => r.actor === luke),
  false,
);
sheet.draft.scope = 'pc';
assert.equal((await sheet.targetRows())[0].actor, liveLuke);
let openedActor;
liveLuke.sheet = {
  render: () => {
    openedActor = liveLuke.uuid;
  },
};
await sheet.handleAction('sheet', { dataset: { id: tokenRow.entry.id } });
assert.equal(openedActor, liveLuke.uuid);
await sheet.handleChange({
  target: { dataset: { adjust: tokenRow.entry.id }, value: '-4', hasAttribute: () => false },
});
await sheet.render();
assert.equal(sheet.rows.find((r) => r.token?.uuid === liveToken.uuid).entry.adjustment, -4);
assert.equal(sheet.prefs.roster.find((e) => e.id === 'l').adjustment, undefined);
responses.push({
  audience: 'whisper',
  mode: 'blindroll',
  instruction: 'Scene check',
  users: ['phil'],
});
await sheet.requestRolls();
const sceneRequest = game.messages.at(-1).flags['gga-gm-control-sheet'].requestData.entries[0];
assert.equal(sceneRequest.uuid, liveLuke.uuid);
assert.equal(sceneRequest.entry.tokenUuid, liveToken.uuid);
scene.tokens.splice(scene.tokens.indexOf(liveToken), 1);
await assert.rejects(sheet.targetRows(), /scene roster changed/);
assert.equal(sheet.rows.find((r) => r.entry.id === 'l').actor, luke);
assert.equal(sceneRequest.uuid, liveLuke.uuid); // Already-issued requests never change their target.
