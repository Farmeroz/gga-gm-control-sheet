import {ID, clone, escapeHTML as esc, integer, modifierLabel, modifiersFor, validateAction} from './core.mjs';
import {resolveRoll, rollOne} from './rolls.mjs';

const inFlight = new Set();
const completed = new Set();
const collection = value => value?.contents || Array.from(value || []);
const checkText = text => String(text || '').trim().replace(/^\[(.*)\]$/, '$1');
export function matchesRequestedCheck(result, row, payload) {
  const check = result.getFlag(ID, 'check');
  const expected = checkText(row.entry.overrides?.[payload.shortcut.id] || payload.shortcut.otf);
  if (check?.version !== 1 || check.actorUuid !== row.uuid || check.otf !== expected || check.mode !== payload.mode) return false;
  const rolls = collection(result.rolls);
  if (rolls.length !== 1 || !/^3d6(?:\s*\[[^\]]*\])?$/i.test(String(rolls[0].formula || '').trim()) ||
      !Number.isInteger(rolls[0].total) || rolls[0].total < 3 || rolls[0].total > 18) return false;
  const recipients = collection(result.whisper).map(u=>typeof u === 'string' ? u : u.id);
  if (payload.mode === 'blindroll') return result.blind === true && recipients.length > 0 &&
    recipients.every(id=>collection(game.users).some(u=>u.id === id && u.isGM));
  return payload.mode === 'publicroll' && !result.blind && recipients.length === 0;
}
export function requestReference(message, index) {
  const payload = message.getFlag(ID, 'requestData');
  const messageId = payload?.source || message.id;
  const sourceIndex = payload?.source ? payload.entries[index]?.sourceIndex : index;
  return {key:`${messageId}:${sourceIndex}`, messageId, index:sourceIndex};
}
export function wasRolled(message, index) {
  const ref = requestReference(message, index);
  const source = game.messages.get(ref.messageId);
  const payload = source?.getFlag(ID, 'requestData'), row = payload?.entries?.[ref.index];
  return completed.has(ref.key) || !!source?.getFlag(ID, 'responses')?.[ref.index] ||
    collection(game.messages).some(m => m.author?.id === game.user.id && m.isRoll &&
      m.getFlag(ID, 'roll') && m.getFlag(ID, 'request')?.key === ref.key && row && matchesRequestedCheck(m, row, payload));
}

async function postRequest(payload, {audience, instruction = '', reminder = false}) {
  const html = `<section class="gcs-request"><h3>${reminder ? 'Reminder' : 'GM roll request'} · ${esc(payload.shortcut.label)}</h3>
    ${instruction ? `<p>${esc(instruction)}</p>` : ''}<p class="gcs-request-meta">${payload.mode === 'publicroll' ? 'Public results' : 'Results visible only to GMs'} · Each button rolls for its named character.</p>
    ${payload.entries.map((e,i) => `<div class="gcs-request-row"><strong>${esc(e.name)}</strong><button type="button" data-gcs-request="${i}">Roll ${esc(payload.shortcut.label)}</button><code>${esc(e.entry.overrides?.[payload.shortcut.id] || payload.shortcut.otf)}</code></div>`).join('')}
    <p class="gcs-request-meta">Request adjustment: ${payload.shared >= 0 ? '+' : ''}${payload.shared} ${esc(payload.reason)}.  Character adjustments and your current bucket apply when you roll.${reminder ? '  This is the same request; roll from either card.' : ''}</p></section>`;
  const data = {user:game.user.id, content:html, flags:{[ID]:{requestData:{...payload, audience, instruction}}}};
  if (audience !== 'public') data.whisper = [...new Set([...payload.users, ...ChatMessage.getWhisperRecipients('GM').map(u=>u.id)])];
  return ChatMessage.create(data);
}
export async function createRequests(rows, shortcut, {shared, reason, mode, audience, users, instruction}) {
  if (!game.user.isGM) throw new Error('Only a GM can request rolls.');
  const entries = rows.map(r => ({uuid:r.actor.uuid, name:r.entry.name || r.actor.name,
    entry:clone(r.entry), personal:integer(r.entry.adjustment || 0), managed:clone(modifiersFor(r.actor, shortcut))}));
  const payload = {version:1, entries, shortcut:clone(shortcut), shared:integer(shared), reason:modifierLabel(reason),
    mode:mode === 'publicroll' ? 'publicroll' : 'blindroll', users:users.map(u=>u.id)};
  return postRequest(payload, {audience, instruction});
}
export async function requestStatus(message) {
  if (!game.user.isGM) throw new Error('Only a GM can track requests.');
  const payload = message.getFlag(ID, 'requestData');
  if (!message.author?.isGM || payload?.version !== 1) return [];
  return Promise.all(payload.entries.map(async (entry, index) => {
    const row = {index, name:entry.name};
    if (wasRolled(message, index)) return {...row,status:'Rolled',detail:''};
    let actor;
    try {actor = await fromUuid(entry.uuid);} catch {}
    if (!actor) return {...row,status:'Unavailable',detail:'Character or token no longer exists'};
    const owners = collection(game.users).filter(u=>!u.isGM && payload.users.includes(u.id) && actor.testUserPermission(u,'OWNER'));
    if (!owners.length) return {...row,status:'Unavailable',detail:'No addressed player owns this character'};
    try {
      const check = await resolveRoll(actor, payload.shortcut, entry.entry);
      if (check.missing || check.exempt) return {...row,status:'Unavailable',detail:check.exempt ? 'Exempt from this check' : 'Not found'};
    } catch {return {...row,status:'Unavailable',detail:'Check cannot be resolved'};}
    return {...row,status:'Awaiting roll',detail:owners.map(u=>`${u.name}${u.active?'':' (offline)'}`).join(', '),users:owners.map(u=>u.id)};
  }));
}
export async function remindOutstanding(message) {
  if (!game.user.isGM || !message?.author?.isGM) throw new Error('Only a GM can remind players.');
  const payload = message.getFlag(ID, 'requestData');
  if (payload?.source) message = game.messages.get(payload.source);
  if (!message) throw new Error('The original request has been deleted.  Send a new request.');
  const original = message.getFlag(ID, 'requestData');
  const pending = (await requestStatus(message)).filter(r=>r.status==='Awaiting roll');
  if (!pending.length) throw new Error('There are no available characters awaiting a roll.');
  const users = [...new Set(pending.flatMap(r=>r.users))];
  const entries = pending.map(r=>({...clone(original.entries[r.index]), sourceIndex:r.index}));
  return postRequest({...clone(original), entries, users, source:message.id}, {
    // Older cards did not store audience/instruction; retain their actual privacy.
    audience:original.audience || (message.whisper?.length ? 'whisper' : 'public'),
    instruction:original.instruction || '', reminder:true,
  });
}

export async function recordResponse(result) {
  if (!game.user?.isGM || !result.getFlag(ID, 'roll') || !result.isRoll) return;
  const ref = result.getFlag(ID, 'request');
  if (!ref || !Number.isInteger(ref.index) || ref.index < 0 || ref.key !== `${ref.messageId}:${ref.index}`) return;
  const original = game.messages.get(ref.messageId), payload = original?.getFlag(ID, 'requestData');
  if (!original?.author?.isGM || payload?.version !== 1 || original.getFlag(ID,'responses')?.[ref.index]) return;
  const row = payload.entries[ref.index], user = result.author;
  if (!row || !user || !payload.users.includes(user.id)) return;
  if (!matchesRequestedCheck(result, row, payload)) return;
  let actor; try {actor = await fromUuid(row.uuid);} catch {return;}
  if (!actor?.testUserPermission(user,'OWNER') || result.speaker?.actor !== actor.id) return;
  const tokenUuid = row.entry.tokenUuid || (row.uuid.startsWith('Scene.') ? row.uuid.split('.Actor.')[0] : null);
  if (tokenUuid && (result.speaker?.scene !== tokenUuid.split('.')[1] || result.speaker?.token !== tokenUuid.split('.')[3])) return;
  // Store completion only, never dice, target, margin, or blind result content.
  // Separate paths preserve simultaneous responses from different characters.
  await original.update({[`flags.${ID}.responses.${ref.index}`]:{rolled:true}});
}
export async function reconcileResponses() {
  if (!game.user?.isGM) return;
  for (const message of collection(game.messages)) {
    if (message.getFlag(ID,'request')) await recordResponse(message);
  }
}
export function refreshRequestCards() {
  for (const root of document.querySelectorAll('[data-message-id]')) {
    const message = game.messages.get(root.dataset.messageId);
    if (message?.getFlag(ID,'requestData')) wireRequest(message, root);
  }
}
export function wireRequest(message, html) {
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root) return;
  const payload = message.getFlag(ID, 'requestData');
  if (!payload) return;
  for (const button of root.querySelectorAll('[data-gcs-request]')) {
    const index = Number(button.dataset.gcsRequest), ref = requestReference(message, index), key = ref.key;
    if (wasRolled(message, index)) {button.disabled=true;button.textContent='Rolled';continue;}
    if (payload.source && !game.messages.get(payload.source)) {button.disabled=true;button.textContent='Request removed';continue;}
    if (!message.author?.isGM || !payload.users?.includes(game.user.id)) {button.disabled=true;continue;}
    fromUuid(payload.entries[index]?.uuid || '').then(actor=>{
      button.disabled = !actor?.testUserPermission(game.user,'OWNER') || inFlight.has(key) || wasRolled(message,index);
      if (!actor?.testUserPermission(game.user,'OWNER')) button.title='Only this character’s owner can roll.';
    }).catch(()=>{button.disabled=true;});
    if (button.dataset.gcsWired) continue;
    button.dataset.gcsWired='true';
    button.addEventListener('click',async event=>{
      event.preventDefault();event.stopImmediatePropagation();
      if (inFlight.has(key) || wasRolled(message,index)) return;
      inFlight.add(key);button.disabled=true;
      try {
        if (!message.author?.isGM || !payload.users.includes(game.user.id)) throw new Error('This request is not addressed to you.');
        if (payload.source && !game.messages.get(payload.source)) throw new Error('The original request has been deleted.');
        const row=payload.entries[index];
        if (!row || payload.version!==1) throw new Error('This roll request is no longer supported.');
        const actor=await fromUuid(row.uuid);
        if (!actor || !actor.testUserPermission(game.user,'OWNER')) throw new Error('You do not own this character.');
        validateAction(GURPS.parselink(row.entry.overrides?.[payload.shortcut.id] || payload.shortcut.otf).action);
        const result=await rollOne({actor,entry:row.entry,shortcut:payload.shortcut,
          shared:integer(payload.shared),reason:modifierLabel(payload.reason),personal:integer(row.personal),
          mode:payload.mode==='publicroll'?'publicroll':'blindroll',includeBucket:true,request:ref,managed:row.managed});
        if (['Success','Failure'].includes(result.status)) {
          completed.add(key);button.textContent='Rolled';refreshRequestCards();
          ui.notifications.info(`Roll made for ${row.name}${payload.mode==='blindroll'?'; the result is visible only to GMs':''}.`);
        } else {button.disabled=false;button.textContent=result.status;}
      } catch(error) {button.disabled=false;ui.notifications.error(error.message);console.error(`${ID} | Request`,error);}
      finally {inFlight.delete(key);}
    });
  }
}
