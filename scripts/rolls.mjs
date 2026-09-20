import {
  clone,
  escapeHTML as esc,
  integer,
  isFright,
  isUnfazeable,
  modifierLabel,
  modifiersFor,
  rollModifiers,
  sanitiseObject,
  validateAction,
} from './core.mjs';
import {
  assertRollCompatibility,
  createRollContext,
  publishRollContext,
  closeRollContext,
} from './roll-context.mjs';
import { collectTaggedModifiers, bucketSnapshot, consumeSnapshot } from './roll-modifiers.mjs';

let nativeRoll;
let queue = Promise.resolve();
export function serial(task) {
  const run = queue.then(task);
  queue = run.catch(() => {});
  return run;
}
export async function resolveRoll(actor, shortcut, entry = {}) {
  const otf = (entry.overrides?.[shortcut.id] || shortcut.otf).trim().replace(/^\[(.*)\]$/, '$1');
  if (isFright(otf) && isUnfazeable(actor, entry)) return { exempt: true, otf };
  const action = clone(validateAction(GURPS.parselink(otf).action));
  let calculated;
  if (action.type === 'controlroll')
    calculated = { target: Number(action.target), thing: action.desc || 'Self-control' };
  else {
    if (action.type === 'skill-spell' && !action.target) {
      const skill = GURPS.findSkillSpell(
        actor.system,
        action.name,
        !!action.isSkillOnly,
        !!action.isSpellOnly,
      );
      if (!skill) return { missing: true, otf };
    }
    // A shortcut is already restricted to one action.  Calling performAction
    // would run GGA's chain-selection logic, which warns when a skill is absent
    // even in calcOnly mode.  Its underlying calculators have no such warning.
    const calculate = GURPS.actionFuncs?.[action.type];
    if (typeof calculate !== 'function')
      throw new Error('This GGA version does not expose the required check calculator.');
    calculated = await calculate({
      action,
      actor,
      event: null,
      targets: [],
      originalOtf: otf,
      calcOnly: true,
    });
  }
  if (!calculated || !Number.isFinite(Number(calculated.target)) || Number(calculated.target) <= 0)
    return { missing: true, otf };
  return {
    otf,
    action,
    target: Number(calculated.target),
    thing: calculated.thing || shortcut.label,
    fright: isFright(otf),
  };
}

// Keep the installed GGA roller and its chat template.  The invocation facade
// bypasses sheet actions; all modifiers and output belong to a private context.
export async function rollOne({
  actor,
  entry = {},
  shortcut,
  shared = 0,
  reason = 'GM adjustment',
  personal = 0,
  mode = 'blindroll',
  includeBucket = false,
  request = null,
  managed = null,
  batch = null,
}) {
  return serial(async () => {
    assertRollCompatibility();
    if (!actor?.testUserPermission(game.user, 'OWNER'))
      throw new Error('You do not own this character.');
    if (!['blindroll', 'publicroll'].includes(mode))
      throw new Error('Unsupported check visibility.');
    const resolved = await resolveRoll(actor, shortcut, entry);
    if (resolved.exempt) return { name: actor.name, label: shortcut.label, status: 'Exempt' };
    if (resolved.missing) return { name: actor.name, label: shortcut.label, status: 'Not found' };
    nativeRoll ||= (await import('../../../systems/gurps/module/dierolls/dieroll.js')).doRoll;
    if (typeof nativeRoll !== 'function')
      throw new Error('This GGA version does not expose the required roll integration.');
    const bucket = GURPS.ModifierBucket;
    const snapshot = bucketSnapshot(bucket);
    const autoEmpty = bucket.modifierStack.AUTO_EMPTY;
    const optionalArgs = {
      blind: mode === 'blindroll',
      event: { blind: mode === 'blindroll', shiftKey: false },
      action: clone(validateAction(resolved.action)),
      obj: sanitiseObject(resolved.action.obj),
      text: '',
    };
    delete optionalArgs.action.obj;
    const assigned = (managed ?? modifiersFor(actor, shortcut)).map((m) => ({
      ...m,
      name: modifierLabel(m.name),
      value: integer(m.value),
    }));
    const modifiers = rollModifiers(
      assigned,
      [
        { name: modifierLabel(reason), value: integer(shared) },
        { name: 'Individual adjustment', value: integer(personal) },
      ],
      includeBucket ? snapshot.map((s) => s.copy) : [],
    );
    modifiers.push(
      ...(await collectTaggedModifiers(actor, `[${resolved.otf}]`, optionalArgs, entry)),
    );
    if (
      modifiers.some(
        (m) => !Number.isFinite(m.modint) || /\*\s*(?:costs?|per)\b/i.test(m.desc || ''),
      )
    ) {
      throw new Error(
        'Remove invalid modifiers or cost directives before making this information check.',
      );
    }
    const context = createRollContext(
      actor,
      entry,
      modifiers,
      resolved.fright,
      mode,
      request,
      resolved.otf,
    );
    context.batch = batch;
    try {
      await nativeRoll({
        actor: context.facade,
        formula: '3d6',
        origtarget: resolved.target,
        thing: resolved.thing,
        chatthing: `[${resolved.otf}]`,
        prefix: `${shortcut.label}:`,
        targetmods: [{ gcsContext: context.id }],
        optionalArgs,
        action: optionalArgs.action,
      });
      await publishRollContext(context);
      if (includeBucket && !game.user.isGM && autoEmpty) consumeSnapshot(bucket, snapshot);
      const result = context.result;
      return {
        messageId: context.messageId,
        name: entry.name || actor.name,
        label: shortcut.label,
        target: result.finaltarget,
        total: result.rtotal,
        margin: result.margin,
        critical: result.isCritSuccess
          ? 'Critical success'
          : result.isCritFailure
            ? 'Critical failure'
            : '',
        status: result.failure ? 'Failure' : 'Success',
      };
    } finally {
      closeRollContext(context);
    }
  });
}

export function resultTable(results) {
  return `<table class="gcs-results-table"><thead><tr><th>Character</th><th>Check</th><th>Target</th><th>Roll</th><th>Result</th><th>Margin</th></tr></thead><tbody>${results
    .map(
      (r) =>
        `<tr><td>${esc(r.name)}</td><td>${esc(r.label)}</td><td>${esc(r.target ?? '—')}</td><td>${esc(r.total ?? '—')}</td><td>${esc(r.critical || r.status)}</td><td>${esc(r.margin ?? '—')}</td></tr>`,
    )
    .join('')}</tbody></table>`;
}
