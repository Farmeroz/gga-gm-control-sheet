import { escapeHTML as esc } from './core.mjs';
const moduleId = 'gga-casting-assistant';
export async function castingEffectsFor(actor) {
  if (!game.user.isGM) throw new Error('Only a GM can view the control sheet.');
  const mod = game.modules?.get(moduleId);
  if (!actor || !mod?.active || typeof mod.api?.getActiveEffects !== 'function') return [];
  const effects = await mod.api.getActiveEffects(actor.uuid);
  return Array.isArray(effects)
    ? effects.filter(
        (e) =>
          e.schema === 1 &&
          e.actorUuid === actor.uuid &&
          ['active', 'due', 'review'].includes(e.state),
      )
    : [];
}
export function castingEffectBadges(effects) {
  if (!effects?.length) return '';
  return `<div class="gcs-casting-effects">${effects
    .map((e) => {
      const role = e.cast && e.received ? 'Self' : e.cast ? 'Cast' : 'Received';
      const time =
        e.state === 'due'
          ? 'Maintenance due'
          : e.state === 'review'
            ? 'GM review'
            : e.remaining === null
              ? 'No expiry'
              : e.remaining < 60
                ? `${Math.ceil(e.remaining)}s`
                : e.remaining < 3600
                  ? `${Math.ceil(e.remaining / 60)}m`
                  : `${Math.ceil(e.remaining / 3600)}h`;
      const detail = `${e.name} · ${role} · Caster: ${e.casterName} · ${time}${e.maintainable ? ` · Maintenance: ${e.maintenanceCost} energy` : ''}${e.recipientNames?.length ? ` · Recipients: ${e.recipientNames.join(', ')}` : ''}${e.summary ? ` · ${e.summary}` : ''}`;
      return `<button type="button" data-gcs="casting-effect" data-caster="${esc(e.casterUuid)}" class="gcs-casting-effect ${e.state !== 'active' ? 'is-due' : ''}" title="${esc(detail)}"><span>${esc(role)}: ${esc(e.name)}</span><small>${esc(time)}</small></button>`;
    })
    .join('')}</div>`;
}
export async function manageCastingEffects(casterUuid) {
  if (!game.user.isGM) throw new Error('Only a GM can manage effects from this sheet.');
  const mod = game.modules?.get(moduleId);
  if (!mod?.active || typeof mod.api?.activeEffects !== 'function')
    throw new Error('Enable Casting Assistant 0.5.0 or later to manage these effects.');
  return mod.api.activeEffects(casterUuid);
}
