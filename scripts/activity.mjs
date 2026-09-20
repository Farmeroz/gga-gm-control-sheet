import { readable } from './message-access.mjs';
export { readable } from './message-access.mjs';
import { ID, escapeHTML as esc } from './core.mjs';
import { collectedRequestResults } from './request-results.mjs';

export const SOURCES = {
  all: 'All',
  gm: 'GM rolled',
  requested: 'GM requested',
  player: 'Player initiated',
};
const values = (v) => v?.contents || (v instanceof Map ? [...v.values()] : Array.from(v || []));
const idOf = (v) => (typeof v === 'string' ? v : v?.id);
const flag = (m, key) => m.getFlag?.(ID, key) ?? m.flags?.[ID]?.[key];
const rolls = (m) => values(m.rolls);
export function plainPreview(content, Parser = globalThis.DOMParser) {
  if (!Parser || typeof content !== 'string') return 'Open the original message for details.';
  const doc = new Parser().parseFromString(content, 'text/html');
  doc.querySelectorAll('script, style, template').forEach((n) => n.remove());
  return (doc.body?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 360);
}
export function localTime(timestamp) {
  if (
    typeof timestamp !== 'number' ||
    !Number.isFinite(timestamp) ||
    !Number.isFinite(new Date(timestamp).getTime())
  )
    return 'Time unavailable';
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(timestamp);
}
function visibility(m, users) {
  const ids = values(m.whisper).map(idOf);
  if (!ids.length) return 'Public';
  const gmAudience = ids.every((id) => users.get?.(id)?.isGM || id === idOf(m.author));
  if (!m.isRoll && !rolls(m).length)
    return gmAudience ? (m.blind ? 'Blind to GM' : 'Private to GM') : 'Private · Custom recipients';
  if (m.blind)
    return gmAudience ? 'Blind to GM · Player cannot see result' : 'Blind · Custom recipients';
  return gmAudience ? 'Private to GM · Roller can see result' : 'Private · Custom recipients';
}
function rollSummary(m) {
  const data = flag(m, 'result');
  const dice = rolls(m);
  const total = dice.length === 1 && Number.isFinite(dice[0].total) ? dice[0].total : null;
  if (
    flag(m, 'roll') &&
    data?.version === 1 &&
    total === data.total &&
    Number.isFinite(data.target) &&
    Number.isFinite(data.margin) &&
    data.margin === data.target - total &&
    ['Success', 'Failure'].includes(data.status) &&
    ['', 'Critical success', 'Critical failure'].includes(data.critical)
  ) {
    return `Target ${data.target} · Roll ${total} · ${data.critical || data.status} · Margin ${data.margin}`;
  }
  return total === null ? '' : `Roll ${total} · See original for outcome`;
}

/** Read original messages only; no forwarding, actor writes, or shared result flags. */
export async function collectActivity({
  messages = game.messages,
  user = game.user,
  users = game.users,
  includeIncoming = true,
} = {}) {
  if (!user?.isGM) return [];
  const all = values(messages);
  const requested = new Map();
  for (const request of all) {
    if (
      !readable(request, user) ||
      !flag(request, 'requestData') ||
      flag(request, 'requestData').source
    )
      continue;
    for (const row of await collectedRequestResults(request)) requested.set(row.messageId, request);
  }
  const seen = new Set();
  const result = [];
  for (const m of all) {
    if (!m.id || seen.has(m.id) || !readable(m, user)) continue;
    seen.add(m.id);
    const isRoll = m.isRoll === true || rolls(m).length > 0;
    const ids = values(m.whisper).map(idOf);
    const author = typeof m.author === 'object' ? m.author : users.get?.(m.author ?? m.user);
    if (
      m.flags?.['gga-roll-clarity']?.receipt ||
      flag(m, 'summary') ||
      flag(m, 'requestData') ||
      (m.content?.startsWith('<h3>GM Control Sheet</h3>') &&
        m.content.includes('gcs-results-table'))
    )
      continue;
    if (!m.blind && ids.length === 1 && ids[0] === idOf(author)) continue;
    const request = requested.get(m.id);
    if (!ids.length && !request) continue;
    const source = request ? 'requested' : author?.isGM ? 'gm' : 'player';
    const own = author?.id === user.id;
    if (!includeIncoming && !(own && flag(m, 'roll') && !request)) continue;
    const batch = source === 'gm' && flag(m, 'roll') ? flag(m, 'batch') : null;
    result.push({
      id: m.id,
      source,
      sourceLabel: source === 'gm' && !isRoll ? 'GM message' : SOURCES[source],
      group: request
        ? `request:${request.id}`
        : batch
          ? `batch:${author.id}:${batch}`
          : `message:${m.id}`,
      groupLabel: request
        ? `Requested: ${flag(request, 'requestData').shortcut?.label || 'Check'}`
        : batch
          ? 'GM batch'
          : '',
      author: author?.name || 'Unknown sender',
      character: m.speaker?.alias || '',
      timestamp: m.timestamp,
      visibility: visibility(m, users),
      isRoll,
      check: flag(m, 'check')?.otf || '',
      summary: isRoll ? rollSummary(m) : '',
      preview: plainPreview(m.content),
      incoming: !own,
    });
  }
  return result.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0) || a.id.localeCompare(b.id));
}
export function activityGroups(entries, source = 'all') {
  const groups = new Map();
  for (const entry of entries) {
    if (source !== 'all' && entry.source !== source) continue;
    if (!groups.has(entry.group)) groups.set(entry.group, []);
    groups.get(entry.group).push(entry);
  }
  return [...groups.values()];
}
export function activityHTML(groups, readIds = []) {
  const read = new Set(readIds);
  return groups
    .map(
      (entries) =>
        `<section class="gcs-activity-group">${entries[0].groupLabel ? `<h4>${esc(entries[0].groupLabel)}</h4>` : ''}${entries.map((e) => `<article class="gcs-activity-entry" data-entry="${esc(e.id)}"><div class="gcs-activity-meta"><strong>${esc(e.sourceLabel)}</strong><span>${esc(e.visibility)}</span>${e.incoming && !read.has(e.id) ? '<span class="gcs-unread">Unread</span>' : ''}<time>${esc(localTime(e.timestamp))}</time></div><div><strong>${esc(e.character || e.author)}</strong>${e.character ? ` · ${esc(e.author)}` : ''}${e.check ? ` · ${esc(e.check)}` : ''}</div>${e.summary ? `<p>${esc(e.summary)}</p>` : ''}<p class="gcs-activity-preview">${esc(e.preview || (e.isRoll ? 'Roll' : 'Message'))}</p><button type="button" data-gcs="original-message" data-message="${esc(e.id)}">Open original</button></article>`).join('')}</section>`,
    )
    .join('');
}
