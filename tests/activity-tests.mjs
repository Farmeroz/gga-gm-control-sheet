import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from 'linkedom';
import { ID, upgradePreferences } from '../scripts/core.mjs';
import {
  collectActivity,
  activityGroups,
  activityHTML,
  readable,
  plainPreview,
  localTime,
} from '../scripts/activity.mjs';
globalThis.DOMParser = DOMParser;
const gm = { id: 'gm', isGM: true, name: 'GM' },
  other = { id: 'other', isGM: true, name: 'Other GM' },
  player = { id: 'player', isGM: false, name: 'Phil' };
const users = new Map([gm, other, player].map((u) => [u.id, u]));
function message(id, extra = {}) {
  return {
    id,
    author: player,
    whisper: ['gm'],
    blind: false,
    visible: true,
    isContentVisible: true,
    timestamp: 1000,
    rolls: [{ total: 10, formula: '3d6' }],
    isRoll: true,
    content: '<html><body>Search roll</body></html>',
    speaker: { alias: 'Luke', actor: 'a' },
    flags: {},
    getFlag(scope, key) {
      return this.flags?.[scope]?.[key];
    },
    ...extra,
  };
}
async function collect(list, options = {}) {
  globalThis.game = { user: gm, users, messages: list };
  return collectActivity(options);
}
test('collects private and blind player rolls and plain whispers without altering originals', async () => {
  const list = [
    message('private'),
    message('blind', { blind: true }),
    message('text', { rolls: [], isRoll: false }),
  ];
  const before = JSON.stringify(list);
  const result = await collect(list);
  assert.equal(result.length, 3);
  assert.ok(result.every((e) => e.source === 'player'));
  assert.equal(result.find((e) => e.id === 'text').summary, '');
  assert.match(result.find((e) => e.id === 'blind').visibility, /Player cannot see result/);
  assert.equal(JSON.stringify(list), before);
});
test('excludes other GM recipients, hidden content, public rolls, self rolls, receipts, and summaries', async () => {
  const list = [
    message('other', { whisper: ['other'] }),
    message('hidden', { visible: false }),
    message('content', { isContentVisible: false }),
    message('public', { whisper: [] }),
    message('self', { author: gm, whisper: ['gm'] }),
    message('receipt', { flags: { 'gga-roll-clarity': { receipt: true } } }),
    message('summary', { flags: { [ID]: { summary: true } } }),
  ];
  assert.deepEqual(await collect(list), []);
  assert.equal(readable(message('author-only', { author: gm, whisper: ['other'] }), gm), false);
  assert.deepEqual(await collect([message('p')], { user: player }), []);
});
test('source filters distinguish GM rolls and ordinary GM messages, with stable batch groups and no duplicates', async () => {
  const flags = { [ID]: { roll: true, batch: 'b' } };
  const a = message('a', { author: gm, blind: true, flags });
  const list = [
    a,
    a,
    message('b', { author: gm, blind: true, flags, timestamp: 2000 }),
    message('c'),
    message('note', { author: other, isRoll: false, rolls: [] }),
  ];
  const entries = await collect(list);
  assert.equal(entries.length, 4);
  assert.equal(activityGroups(entries, 'gm').length, 2);
  assert.equal(activityGroups(entries, 'player').flat().length, 1);
  assert.equal(entries.find((e) => e.id === 'note').sourceLabel, 'GM message');
  assert.equal(activityGroups(entries)[0].length, 2);
  assert.equal((await collect(list, { includeIncoming: false })).length, 2);
});
test('invalid outcome metadata falls back to original; previews cannot inject markup or controls', async () => {
  const list = [
    message('bad', {
      content:
        '<html><body><script>SECRET()</script><img src=x onerror=bad()>Text &lt;button&gt;</body></html>',
      flags: {
        [ID]: {
          roll: true,
          result: {
            version: 1,
            total: 10,
            target: 15,
            margin: 99,
            status: 'Success',
            critical: '',
          },
        },
      },
    }),
  ];
  const entries = await collect(list);
  assert.match(entries[0].summary, /See original/);
  const html = activityHTML(activityGroups(entries));
  assert.ok(!html.includes('<script') && !html.includes('<img') && !html.includes('SECRET'));
  assert.match(html, /&lt;button&gt;/);
  assert.equal(plainPreview('anything', null), 'Open the original message for details.');
});
test('requested responses require real matching request, actor, owner and check; public responses stay grouped', async () => {
  globalThis.fromUuid = async () => ({ id: 'a', testUserPermission: () => true });
  const request = message('req', {
    author: gm,
    whisper: [],
    isRoll: false,
    rolls: [],
    flags: {
      [ID]: {
        requestData: {
          version: 1,
          users: ['player'],
          entries: [{ uuid: 'Actor.a', entry: { overrides: {} } }],
          shortcut: { id: 'search', otf: 'S:Search', label: 'Search' },
          mode: 'publicroll',
        },
      },
    },
  });
  const flags = {
    [ID]: {
      roll: true,
      request: { messageId: 'req', index: 0, key: 'req:0' },
      check: { version: 1, actorUuid: 'Actor.a', otf: 'S:Search', mode: 'publicroll' },
    },
  };
  const response = message('response', { whisper: [], flags });
  let entries = await collect([request, response]);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].source, 'requested');
  assert.equal(entries[0].group, 'request:req');
  response.speaker.actor = 'wrong';
  assert.deepEqual(await collect([request, response]), []);
  response.whisper = ['gm'];
  entries = await collect([request, response]);
  assert.equal(entries[0].source, 'player');
});
test('changes to recipients and deletions are reflected on recollection; unread is per viewer', async () => {
  const m = message('m');
  let entries = await collect([m]);
  assert.match(activityHTML(activityGroups(entries)), /Unread/);
  assert.ok(!activityHTML(activityGroups(entries), ['m']).includes('Unread'));
  m.whisper = ['other'];
  assert.deepEqual(await collect([m]), []);
  assert.deepEqual(await collect([]), []);
});
test('preferences migrate with collection enabled, filters remembered, and local seconds displayed', () => {
  const prefs = upgradePreferences({ activitySource: 'requested', activityRead: ['a'] });
  assert.equal(prefs.activitySource, 'requested');
  assert.deepEqual(prefs.activityRead, ['a']);
  assert.equal(prefs.collectIncoming, true);
  assert.equal(upgradePreferences({ activitySource: 'bad' }).activitySource, 'all');
  assert.match(localTime(new Date(2026, 8, 20, 17, 42, 18).getTime()), /17:42:18/);
  assert.equal(localTime(null), 'Time unavailable');
});
