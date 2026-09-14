import { createHelpController, helpResolver } from './tooltip-engine.mjs';
export const helpConfig = {
  id: 'gga-gm-control-sheet',
  scope:
    '.gcs-window, .gcs-dialog, .gcs-request, [name^="gga-gm-control-sheet."], [data-key^="gga-gm-control-sheet."], [data-tool="gga-gm-control-sheet"], [data-control="gga-gm-control-sheet"]',
  actions: {
    add: 'Choose actors to add to this GM roster.',
    tokens: 'Add the currently selected scene tokens to the roster.',
    select: 'Select every character currently visible in this roster view.',
    clear: 'Clear the selection across both rosters.',
    roll: 'Make private GM rolls for the characters in the chosen scope, using the selected check and modifiers.',
    request: 'Send a roll request to the eligible players for the characters in scope.',
    modifiers:
      'Manage modifiers for the characters in the chosen scope, or send a modifier to players’ buckets.',
    refresh: 'Refresh the displayed roster and actor values.',
    settings: 'Configure the roster display, shortcuts, and layout.',
    sheet: 'Open this character’s sheet.',
    locate: 'Locate the associated token on its scene.',
    edit: 'Edit this roster entry’s options, shortcuts, and permissions.',
    remove: 'Remove this entry from the control-sheet roster; keep its actor and token.',
    summary: 'Post a GM-only chat summary of the latest control-sheet results.',
    tracker: 'Open the player-request tracker to review completion and send reminders.',
  },
  fields: {
    scope:
      'Choose which roster characters receive the group action. Selection can include characters hidden by the current filter.',
    shortcut: 'Select the check used by the group roll or player request.',
    shared: 'Shared modifier added to the chosen group action.',
    reason: 'Description shown with this group modifier.',
    includeBucket: 'Include your current Modifier Bucket in private GM rolls.',
    actors: 'Choose this actor for the roster.',
    users: 'Choose this user as a recipient or permitted responder.',
    checks: 'Choose which control-sheet checks this modifier affects.',
    columns: 'Show or hide this statistic in the roster.',
    resetSectionSizes: 'Restore the default section heights when you save Configure.',
    highlightConditions: 'Show condition indicators alongside roster characters.',
    instruction: 'Instructions included in the roll request sent to players.',
    presetName: 'Name used to save and identify this reusable setup.',
    savePreset: 'Save these options as a reusable preset.',
    value: 'Signed modifier. Negative values penalise the roll; positive values improve it.',
    names: 'Choose the assigned modifiers to remove from characters in scope.',
  },
  rules: [
    [
      '[data-filter]',
      'Filter which roster characters are visible. This does not clear selections in the other view.',
    ],
    ['[data-select]', 'Include this character in the selected group-action scope.'],
    [
      '[data-divider]',
      'Drag to resize these sections, or focus here and use the Up and Down arrow keys.',
    ],
    ['[data-tracker="refresh"]', 'Refresh the completion status of player roll requests.'],
    [
      '[data-tracker="remind"]',
      'Send a reminder to players with outstanding rolls on this request.',
    ],
    [
      '[data-gcs-request]',
      'Make this requested roll for the named character, subject to the request’s permissions.',
    ],
  ],
  actionAttributes: ['data-gcs', 'data-action'],
};
let resolve = helpResolver(helpConfig);

export const helpController = createHelpController({ ...helpConfig, resolve });
if (globalThis.Hooks) {
  Hooks.once('init', () => helpController.register());
  Hooks.once('ready', () => helpController.start());
}
