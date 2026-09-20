import { refreshOriginals } from './original-message.mjs';
import * as log from './log.mjs';
import { ID } from './core.mjs';
import { GMControlSheet } from './control-sheet.mjs';
import {
  wireRequest,
  recordResponse,
  reconcileResponses,
  refreshRequestCards,
} from './requests.mjs';

let sheet;
export function openSheet() {
  if (!game.user.isGM)
    return ui.notifications.warn('The GM Control Sheet is available only to GMs.');
  sheet ||= new GMControlSheet();
  if (sheet.rendered) {
    sheet.maximize();
    sheet.bringToFront();
  } else sheet.render({ force: true });
  return sheet;
}
class Launcher extends foundry.applications.api.ApplicationV2 {
  render() {
    openSheet();
    return this;
  }
}
Hooks.once('init', () => {
  game.settings.registerMenu(ID, 'open', {
    name: 'GM Control Sheet',
    label: 'Open control sheet',
    hint: 'PC and NPC overview, rolls, and group modifiers.',
    icon: 'fas fa-clipboard-list',
    type: Launcher,
    restricted: true,
  });
  game.keybindings.register(ID, 'toggle', {
    name: 'Toggle GM Control Sheet',
    editable: [{ key: 'KeyG', modifiers: ['Alt'] }],
    restricted: true,
    onDown: () => {
      if (!game.user.isGM) return false;
      if (sheet?.rendered) sheet.close();
      else openSheet();
      return true;
    },
  });
});
Hooks.on('getSceneControlButtons', (controls) => {
  if (!game.user?.isGM) return;
  const group = Array.isArray(controls)
    ? controls.find((c) => c.name === 'tokens')
    : controls.tokens;
  if (!group) return;
  const tool = {
    name: ID,
    title: 'GM Control Sheet',
    icon: 'fa-solid fa-clipboard-list',
    button: true,
    visible: true,
    order: 99,
    onChange: () => openSheet(),
    onClick: () => openSheet(),
  };
  if (Array.isArray(group.tools)) group.tools.push(tool);
  else group.tools[ID] = tool;
});
Hooks.once('ready', () => {
  game.modules.get(ID).api = { open: openSheet };
  reconcileResponses().catch((error) => log.error('Request tracking', error));
});
for (const hook of [
  'updateWorldTime',
  'updateActor',
  'updateToken',
  'deleteActor',
  'deleteToken',
  'createToken',
  'updateCombat',
  'deleteCombat',
  'createCombat',
  'updateCombatant',
  'createCombatant',
  'deleteCombatant',
  'updateUser',
  'userConnected',
  'createActiveEffect',
  'updateActiveEffect',
  'deleteActiveEffect',
  'canvasReady',
])
  Hooks.on(hook, () => {
    sheet?.refresh();
    if (hook === 'updateUser') refreshOriginals();
  });
Hooks.on('renderChatMessageHTML', wireRequest);
Hooks.on('createChatMessage', (message) => {
  recordResponse(message).catch((error) => log.error('Request tracking', error));
  sheet?.refresh();
  refreshRequestCards();
});
for (const hook of ['updateChatMessage', 'deleteChatMessage'])
  Hooks.on(hook, () => {
    sheet?.refresh();
    refreshRequestCards();
    refreshOriginals();
  });
