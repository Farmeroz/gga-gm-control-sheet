import test from 'node:test';
import assert from 'node:assert/strict';
import * as c from '../scripts/core.mjs';
const entries = [
  { id: 'l', group: 'pc' },
  { id: 'z', group: 'pc' },
  { id: 'g1', group: 'npc' },
  { id: 'g2', group: 'npc' },
];
test('selection works across tabs and an empty selection never becomes everyone', () => {
  assert.deepEqual(
    c.scopedEntries(entries, 'selected', new Set(['l', 'g2']), 'pc').map((e) => e.id),
    ['l', 'g2'],
  );
  assert.equal(c.scopedEntries(entries, 'selected', new Set(), 'both').length, 0);
  assert.equal(c.scopedEntries(entries, 'both', new Set(), 'pc').length, 4);
  assert.equal(c.scopedEntries(entries, 'npc', new Set(), 'pc').length, 2);
});
test('unlinked token actors retain individual identities; linked duplicates roll once', () => {
  const rows = ['Actor.a', 'Actor.a', 'Scene.s.Token.t1.Actor.a', 'Scene.s.Token.t2.Actor.a'].map(
    (uuid) => ({ actor: { uuid } }),
  );
  assert.equal(c.uniqueActors(rows).length, 3);
});
test('same-name character modifiers update without stacking or disturbing other effects', () => {
  const old = [
    { id: 'dark', name: 'Darkness', value: -2, checks: ['vision'] },
    { id: 'wind', name: 'Wind', value: -1, checks: 'all' },
  ];
  const result = c.upsertModifier(old, {
    id: 'new',
    name: 'darkness',
    value: -3,
    checks: ['vision', 'observation'],
  });
  assert.equal(result.length, 2);
  assert.equal(result[0].id, 'dark');
  assert.equal(result[0].value, -3);
  assert.equal(old[0].value, -2);
});
test('assigned character modifier replaces its transmitted bucket copy for this roll', () => {
  const out = c.rollModifiers(
    [{ name: 'Darkness', value: -2 }],
    [],
    [
      { desc: 'Darkness (GM Control)', modint: -2 },
      { desc: 'Aim', modint: 1 },
      { desc: 'Old actor', modint: -4, tagged: true },
    ],
  );
  assert.equal(out.length, 2);
  assert.equal(
    out.reduce((n, m) => n + m.modint, 0),
    -1,
  );
});
test('owner resolution sends once to a multi-character player and once to the GM for NPCs', () => {
  const users = [
    { id: 'p', isGM: false },
    { id: 'g', isGM: true },
  ];
  const player = { testUserPermission: (u) => u.id === 'p' },
    npc = { testUserPermission: () => false };
  assert.deepEqual(
    c
      .resolveOwners(
        [{ actor: player }, { actor: player }, { actor: npc }, { actor: npc }],
        users,
        users[1],
      )
      .map((u) => u.id),
    ['p', 'g'],
  );
});
test('Fright exemption can be detected or explicitly overridden', () => {
  const actor = {
    system: { ads: { '000': { name: 'Advantages', contains: { '000': { name: 'Unfazeable' } } } } },
  };
  assert.equal(c.isUnfazeable(actor), true);
  assert.equal(c.isUnfazeable(actor, { fright: 'roll' }), false);
  assert.equal(c.isFright('Fright Check -2'), true);
});
test('modifier descriptions cannot invoke GGA cost or macro directives', () => {
  for (const name of ['Darkness *Cost 2 FP', '[DX]', '<b>bad</b>', 'x\nnew', 'Test @margin'])
    assert.throws(() => c.modifierLabel(name));
  assert.equal(c.modifierLabel('Darkness'), 'Darkness');
});
test('unsupported OtF side effects are rejected', () => {
  for (const action of [
    { type: 'damage' },
    { type: 'chat' },
    { type: 'attribute', next: {} },
    { type: 'skill-spell', costs: '*Cost 2 FP' },
    { type: 'attribute', sourceId: 'x' },
  ])
    assert.throws(() => c.validateAction(action));
});
