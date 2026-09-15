import test from 'node:test';
import assert from 'node:assert/strict';
import { sceneRoster, rosterIdentity } from '../scripts/roster.mjs';
const actor = (id, hp) => ({ id, uuid: `Actor.${id}`, system: { HP: { value: hp } } });
const row = (id, a, t = null) => ({
  actor: a,
  token: t,
  entry: {
    id,
    uuid: t?.uuid || a.uuid,
    name: 'Roselyn',
    group: 'pc',
    adjustment: 1,
    overrides: {},
  },
});
function token(id, base, scene = 'grotto', linked = false) {
  return {
    id,
    uuid: `Scene.${scene}.Token.${id}`,
    actorId: base.id,
    actorLink: linked,
    name: `Roselyn ${id}`,
    parent: { id: scene, name: scene },
    actor: linked
      ? base
      : { ...actor(base.id, 16), uuid: `Scene.${scene}.Token.${id}.Actor.${base.id}` },
  };
}
test('actor entries show all current tokens, their own statistics, and concrete action identities', () => {
  const a = actor('r', 18),
    t1 = token('one', a),
    t2 = token('two', a);
  const rows = sceneRoster([row('r', a)], { tokens: [t1, t2] }, [a]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].actor, t1.actor);
  assert.equal(rows[0].actor.system.HP.value, 16);
  assert.equal(rows[0].entry.uuid, t1.uuid);
  assert.equal(rows[0].entry.tokenUuid, t1.uuid);
  assert.notEqual(rows[0].entry.id, rows[1].entry.id);
});
test('actor plus token entries show each instance once and preserve token-specific settings', () => {
  const a = actor('r', 18),
    t = token('one', a),
    specific = row('saved-token', t.actor, t);
  specific.entry.adjustment = -4;
  const rows = sceneRoster([row('r', a), specific], { tokens: [t] }, [a]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].entry.id, 'saved-token');
  assert.equal(rows[0].entry.adjustment, -4);
});
test('token-added characters follow another scene and fall back to the actor with no scene tokens', () => {
  const a = actor('r', 18),
    old = token('one', a),
    next = token('two', a, 'forest'),
    saved = row('r', old.actor, old);
  assert.equal(sceneRoster([saved], { tokens: [next] }, [a])[0].token, next);
  const fallback = sceneRoster([saved], { tokens: [] }, [a]);
  assert.equal(fallback.length, 1);
  assert.equal(fallback[0].actor, a);
  assert.equal(fallback[0].entry.uuid, a.uuid);
  assert.equal(fallback[0].entry.tokenUuid, undefined);
  assert.notEqual(
    rosterIdentity(fallback),
    rosterIdentity(sceneRoster([saved], { tokens: [next] }, [a])),
  );
});
test('duplicate sources collapse to one actor fallback and deleted tokens retain their family', () => {
  const a = actor('r', 18),
    t = token('one', a),
    missing = { actor: null, token: null, entry: { id: 'old', uuid: t.uuid, actorUuid: a.uuid } };
  assert.equal(sceneRoster([row('r', a), missing], { tokens: [] }, [a]).length, 1);
  assert.equal(sceneRoster([missing], { tokens: [] }, [a])[0].actor, a);
});
test('same-name unrelated actors and unlinked NPC copies remain distinct; linked tokens share actor state', () => {
  const a = actor('r', 18),
    b = actor('other', 9),
    t1 = token('one', a),
    t2 = token('two', a),
    t3 = token('three', b);
  const rows = sceneRoster([row('r', a), row('b', b)], { tokens: [t1, t2, t3] }, [a, b]);
  assert.equal(rows.length, 3);
  const linked = token('linked', a, 'grotto', true);
  assert.equal(sceneRoster([row('r', a)], { tokens: [linked] }, [a])[0].actor, a);
});
