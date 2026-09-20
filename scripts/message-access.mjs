const values = (v) => v?.contents || Array.from(v || []);
const idOf = (v) => (typeof v === 'string' ? v : v?.id);
export function readable(message, user) {
  if (!user?.isGM || !message || message.visible === false || message.isContentVisible === false)
    return false;
  const ids = values(message.whisper).map(idOf);
  // Foundry GM/author privileges alone must not widen a specific whisper audience.
  return ids.length ? ids.includes(user.id) : !message.blind;
}
