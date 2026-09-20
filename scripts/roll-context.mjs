import { ID, clone } from './core.mjs';

const contexts = new Map();
const actorContexts = new WeakMap();
const modifierContexts = new WeakMap();
const speakerContext = Symbol('GM Control Sheet roll');
let registered = false;
export function assertRollCompatibility() {
  if (game.system?.id !== 'gurps' || !/^0\.18\.(?:\d|[1-9]\d)$/.test(game.system?.version || '')) {
    throw new Error('GM Control Sheet rolls require GGA 0.18.0–0.18.99.');
  }
}

// Stable libWrapper adapters dispatch using a private invocation identity, never
// actor ID, the current user, or a global "roll in progress" switch.  No global
// is temporarily replaced across an await.  Ordinary GGA calls pass through.
export function initialiseRollAdapters() {
  assertRollCompatibility();
  if (registered) return;
  if (!globalThis.libWrapper?.register)
    throw new Error('Install and enable libWrapper to use GM Control Sheet rolls.');
  const required = [
    GURPS.ModifierBucket?.applyMods,
    GURPS.applyModifierDesc,
    GURPS.setLastTargetedRoll,
    ChatMessage.getSpeaker,
    ChatMessage.create,
  ];
  if (required.some((f) => typeof f !== 'function'))
    throw new Error('This GGA/Foundry version does not expose the required roll integration.');
  const installed = [];
  const wrap = (target, fn) => {
    libWrapper.register(ID, target, fn, 'MIXED');
    installed.push(target);
  };
  try {
    wrap('GURPS.ModifierBucket.applyMods', function (wrapped, mods = []) {
      const context = contexts.get(mods[0]?.gcsContext);
      if (!context) return wrapped(mods);
      context.bucketUsed = true;
      const result = clone(context.modifiers);
      modifierContexts.set(result, context);
      return result;
    });
    wrap('GURPS.applyModifierDesc', function (wrapped, actor, desc) {
      const context = actorContexts.get(actor);
      if (!context) return wrapped(actor, desc);
      return (async () => {
        if (desc === context.capDescription) {
          context.capUsed = true;
          return context.cap;
        }
        const cap = await wrapped(context.actor, desc);
        if (cap && (!Number.isFinite(cap) || cap <= 0))
          throw new Error('GGA returned an unsupported target limit.');
        if (context.fright && cap) context.cap = Math.min(context.cap, cap);
        return cap && context.fright ? context.cap : cap;
      })();
    });
    wrap('ChatMessage.getSpeaker', function (wrapped, options = {}) {
      const context = actorContexts.get(options.actor);
      if (!context) return wrapped(options);
      // No real token is supplied to native action accounting: these are
      // information checks, not spell casts or combat actions.  Real identity
      // is restored on the outgoing message and on last-targeted-roll data.
      return { ...context.speaker, token: null, [speakerContext]: context };
    });
    wrap('GURPS.setLastTargetedRoll', function (wrapped, data, actorId, tokenId, broadcast) {
      const context = modifierContexts.get(data?.targetmods);
      if (!context) return wrapped(data, actorId, tokenId, broadcast);
      validateResult(context, data);
      context.result = data;
      // Keep native integrations in the chain; private data never uses GGA's
      // separate last-roll socket broadcast.
      return wrapped(
        data,
        context.speaker.actor,
        context.speaker.token,
        context.mode === 'blindroll' ? false : broadcast,
      );
    });
    wrap('ChatMessage.create', function (wrapped, data, options = {}) {
      const context = data?.speaker?.[speakerContext];
      if (!context) return wrapped(data, options);
      if (context.closed) throw new Error('A completed check tried to create another message.');
      // Buffer every message bearing this invocation's identity, including
      // supplementary messages without dice.  Publish only after validation.
      context.messages.push({ data, options });
      return Promise.resolve(null);
    });
    registered = true;
  } catch (error) {
    for (const target of installed.reverse()) libWrapper.unregister(ID, target);
    throw error;
  }
}

export function validateResult(context, data = context.result) {
  if (!context.bucketUsed)
    throw new Error('GGA bypassed the isolated modifier list; the check was not posted.');
  if (!data || !Number.isFinite(data.finaltarget) || !Number.isFinite(data.rtotal))
    throw new Error('GGA did not return a valid targeted roll; the check was not posted.');
  if (
    context.fright &&
    (!context.capUsed || data.finaltarget > 13 || (data.rtotal >= 14 && !data.failure))
  ) {
    throw new Error('GGA did not enforce the Fright Check limit; the check was not posted.');
  }
}

export function createRollContext(actor, entry, modifiers, fright, mode, request, otf) {
  initialiseRollAdapters();
  const id = `gcs-${crypto.randomUUID()}`;
  let speaker = ChatMessage.getSpeaker({ actor, token: actor.token || undefined });
  if (entry.tokenUuid) {
    const match = /^Scene\.([^.]+)\.Token\.([^.]+)$/.exec(entry.tokenUuid);
    if (!match) throw new Error('This roster entry has an invalid token reference.');
    speaker = { ...speaker, scene: match[1], token: match[2] };
  }
  speaker = { ...speaker, actor: actor.id, alias: entry.name || actor.name };
  const context = {
    id,
    actor,
    speaker,
    modifiers: clone(modifiers),
    fright,
    cap: 13,
    capUsed: false,
    capDescription: 'GM Control Fright Check limit',
    mode,
    request,
    otf,
    messages: [],
    bucketUsed: false,
  };
  // An explicit plain facade makes doRoll skip sheet confirmation, canRoll,
  // tagged bucket writes, and action selection.  Calculators and tags have
  // already been resolved against the real Actor.  _doRoll remains native.
  context.facade = Object.freeze({
    id: actor.id,
    uuid: actor.uuid,
    name: actor.name,
    isSelf: true,
    getOwners() {
      throw new Error('GGA tried an unsupported follow-up during an information check.');
    },
  });
  if (fright) context.modifiers.unshift({ mod: '+0', modint: 0, desc: context.capDescription });
  actorContexts.set(context.facade, context);
  contexts.set(id, context);
  return context;
}

export async function publishRollContext(context) {
  validateResult(context);
  if (context.messages.filter((m) => m.data.rolls?.length).length !== 1)
    throw new Error(
      'GGA returned an unexpected number of roll messages; the check was not posted.',
    );
  for (const { data, options } of context.messages) {
    const clean = { ...data, speaker: { ...context.speaker }, flags: { ...data.flags } };
    if (data.rolls?.length)
      clean.flags[ID] = {
        ...data.flags?.[ID],
        roll: true,
        request: context.request,
        batch: game.user.isGM ? context.batch || null : null,
        check: { version: 1, actorUuid: context.actor.uuid, otf: context.otf, mode: context.mode },
        result: {
          version: 1,
          target: context.result.finaltarget,
          total: context.result.rtotal,
          margin: context.result.margin,
          status: context.result.failure ? 'Failure' : 'Success',
          critical: context.result.isCritSuccess
            ? 'Critical success'
            : context.result.isCritFailure
              ? 'Critical failure'
              : '',
        },
      };
    ChatMessage.applyRollMode(clean, context.mode);
    clean.blind = context.mode === 'blindroll';
    clean.whisper = clean.blind ? ChatMessage.getWhisperRecipients('GM').map((u) => u.id) : [];
    if (clean.blind && !clean.whisper.length)
      throw new Error('No GM recipients are available; the private check was not posted.');
    const created = await ChatMessage.create(clean, { ...options, rollMode: context.mode });
    if (data.rolls?.length) context.messageId = created?.id;
  }
}

export function closeRollContext(context) {
  context.closed = true;
  contexts.delete(context.id);
}
