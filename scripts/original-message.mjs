import * as log from './log.mjs';
import { readable } from './activity.mjs';
const open = new Map();
class OriginalMessage extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    classes: ['gcs-original-message'],
    window: { title: 'Original chat message', resizable: true },
    position: { width: 440, height: 'auto' },
  };
  constructor(messageId) {
    super();
    this.messageId = messageId;
  }
  async _renderHTML() {
    const message = game.messages.get(this.messageId);
    if (!readable(message, game.user))
      throw new Error('This message is no longer available to you.');
    const html = await foundry.applications.sidebar.tabs.ChatLog.renderMessage(message);
    if (game.messages.get(this.messageId) !== message || !readable(message, game.user))
      throw new Error('This message is no longer available to you.');
    return html;
  }
  _replaceHTML(result, content) {
    content.replaceChildren(result);
  }
  async _preClose(options) {
    open.delete(this.messageId);
    return super._preClose(options);
  }
}
export async function openOriginal(messageId) {
  if (!readable(game.messages.get(messageId), game.user))
    throw new Error('This message is no longer available to you.');
  let app = open.get(messageId);
  if (!app) {
    app = new OriginalMessage(messageId);
    open.set(messageId, app);
  }
  await app.render({ force: true });
  app.bringToFront();
}
export function refreshOriginals() {
  for (const [id, app] of open) {
    if (!readable(game.messages.get(id), game.user)) void app.close();
    else
      void app.render({ force: true }).catch((error) => {
        log.error('Refreshing original message', error);
        void app.close();
      });
  }
}
