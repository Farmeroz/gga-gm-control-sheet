import { ID } from './core.mjs';
import { matchesRequestedCheck } from './requests.mjs';
const collection = (v) => v?.contents || Array.from(v || []);

// Read the original roll documents on the GM's client. Never copy blind results
// into a shared request's content, completion flags, or a public summary.
export async function collectedRequestResults(message) {
  if (!game.user.isGM) throw new Error('Only a GM can collect requested roll results.');
  const payload = message?.getFlag(ID, 'requestData');
  if (!message?.author?.isGM || payload?.version !== 1 || payload.source) return [];
  const found = new Map();
  const candidates = collection(game.messages)
    .filter((m) => m.getFlag(ID, 'request')?.messageId === message.id)
    .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  for (const result of candidates) {
    const ref = result.getFlag(ID, 'request'),
      index = ref.index,
      row = payload.entries[index];
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      !row ||
      found.has(index) ||
      ref.key !== `${message.id}:${index}` ||
      !result.isRoll ||
      !result.getFlag(ID, 'roll') ||
      !payload.users.includes(result.author?.id) ||
      result.visible === false ||
      !matchesRequestedCheck(result, row, payload)
    )
      continue;
    let actor;
    try {
      actor = await fromUuid(row.uuid);
    } catch {
      continue;
    }
    if (!actor?.testUserPermission(result.author, 'OWNER') || result.speaker?.actor !== actor.id)
      continue;
    const tokenUuid =
      row.entry.tokenUuid || (row.uuid.startsWith('Scene.') ? row.uuid.split('.Actor.')[0] : null);
    if (
      tokenUuid &&
      (result.speaker?.scene !== tokenUuid.split('.')[1] ||
        result.speaker?.token !== tokenUuid.split('.')[3])
    )
      continue;
    const data = result.getFlag(ID, 'result'),
      total = collection(result.rolls)[0].total;
    const valid =
      data?.version === 1 &&
      Number.isFinite(data.target) &&
      Number.isFinite(data.margin) &&
      data.total === total &&
      data.margin === data.target - total &&
      ['Success', 'Failure'].includes(data.status) &&
      ['', 'Critical success', 'Critical failure'].includes(data.critical);
    found.set(index, {
      index,
      messageId: result.id,
      total,
      target: valid ? data.target : null,
      margin: valid ? data.margin : null,
      outcome: valid ? data.critical || data.status : 'See original chat roll',
      complete: !!valid,
    });
  }
  return [...found.values()];
}
