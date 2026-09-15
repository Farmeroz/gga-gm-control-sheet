const collection = (value) => value?.contents || Array.from(value || []);

// The roster remembers characters; its rows follow instances on the viewed scene.
// Explicit token settings win for that instance. No statistics or flags are copied.
export function sceneRoster(resolved, scene, actors = globalThis.game?.actors) {
  const tokens = collection(scene?.tokens).filter((t) => t.actor);
  const world = collection(actors),
    families = new Map(),
    missing = [];
  for (const row of resolved) {
    const family =
      row.entry.actorUuid || (row.token?.actorId ? `Actor.${row.token.actorId}` : row.actor?.uuid);
    if (!family) {
      missing.push(row);
      continue;
    }
    const list = families.get(family) || [];
    list.push(row);
    families.set(family, list);
  }
  const rows = [];
  for (const [family, saved] of families) {
    const actor =
      world.find((a) => a.uuid === family) ||
      saved.find((r) => !r.token && r.actor?.uuid === family)?.actor;
    const actorId = actor?.id || saved.find((r) => r.token)?.token.actorId;
    const source = saved.find((r) => !r.token && r.entry.uuid === family) || saved[0];
    const matches = tokens.filter((t) => t.actorId === actorId);
    if (!matches.length) {
      rows.push({
        actor: actor || null,
        token: null,
        entry: {
          ...source.entry,
          sourceId: source.entry.id,
          uuid: family,
          tokenUuid: undefined,
          name: source.entry.uuid === family ? source.entry.name : actor?.name || source.entry.name,
        },
      });
      continue;
    }
    for (const token of matches) {
      const exact = saved.find((r) => r.token?.uuid === token.uuid);
      const entry = (exact || source).entry;
      rows.push({
        actor: token.actor,
        token,
        entry: {
          ...entry,
          sourceId: entry.id,
          id: exact ? entry.id : `${entry.id}~${token.id}`,
          uuid: token.uuid,
          tokenUuid: token.uuid,
          name: exact ? entry.name : token.name,
          adjustment: entry.tokenAdjustments?.[token.uuid] ?? entry.adjustment,
        },
      });
    }
  }
  return [...rows, ...missing];
}
export const rosterIdentity = (rows) =>
  JSON.stringify(
    rows.map((r) => [r.entry.id, r.entry.uuid, r.actor?.uuid || null, r.token?.actorLink ?? null]),
  );
