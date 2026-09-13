import {ID, bucketPacket, clone, integer, modifierLabel, uniqueActors, upsertModifier} from './core.mjs';

export async function applyCharacterModifier(rows, data) {
  if (!game.user.isGM) throw new Error('Only a GM can apply group modifiers.');
  const mod = {id: foundry.utils.randomID(), name: modifierLabel(data.name), value: integer(data.value), checks: data.checks};
  if (mod.checks !== 'all' && (!Array.isArray(mod.checks) || !mod.checks.length)) throw new Error('Choose at least one check for this modifier.');
  const errors = [];
  let count = 0;
  for (const {actor} of uniqueActors(rows)) {
    try {await actor.setFlag(ID, 'modifiers', upsertModifier(actor.getFlag(ID, 'modifiers') || [], mod)); count++;}
    catch (e) {errors.push(`${actor.name}: ${e.message}`);}
  }
  return {count, errors};
}
export async function removeCharacterModifiers(rows, names) {
  if (!game.user.isGM) throw new Error('Only a GM can remove group modifiers.');
  const errors = [];
  let count = 0;
  for (const {actor} of uniqueActors(rows)) {
    try {
      const existing = actor.getFlag(ID, 'modifiers') || [];
      const remaining = existing.filter(m => !names.includes(m.name.toLocaleLowerCase()));
      if (remaining.length === existing.length) continue;
      await actor.setFlag(ID, 'modifiers', remaining); count++;
    } catch (e) {errors.push(`${actor.name}: ${e.message}`);}
  }
  return {count, errors};
}
export async function sendBuckets(users, modifiers, add) {
  if (!game.user.isGM) throw new Error('Only a GM can distribute modifiers.');
  const recipients = [...new Map(users.map(u => [u.id,u])).values()];
  if (!recipients.length) throw new Error('Choose at least one recipient.');
  if (recipients.some(u => !u.active)) throw new Error('One or more recipients went offline.  Review the recipient list and send again.');
  const checked = modifiers.map(m => ({name: modifierLabel(m.name), value: integer(m.value)}));
  if (!checked.length) throw new Error('There are no modifiers to send.');
  const packet = bucketPacket(checked);
  const remote = recipients.filter(u => u.id !== game.user.id);
  // Use GGA's own receiver, with an explicit add/replace choice instead of
  // relying on the keyboard modifier that its bucket UI normally reads.
  if (remote.length) game.socket.emit('system.gurps', {type: 'updatebucket', users: remote.map(u => u.id), bucket: clone(packet), add: !!add});
  if (recipients.some(u => u.id === game.user.id)) {
    if (add) for (const mod of packet.modifierList) GURPS.ModifierBucket.addModifier(mod.mod, mod.desc);
    else GURPS.ModifierBucket.updateModifierBucket(packet);
  }
  return recipients.map(u => u.name);
}
