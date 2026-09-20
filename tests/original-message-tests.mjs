import test from 'node:test';
import assert from 'node:assert/strict';
const apps = [];
let rendered = 0;
class App {
  constructor() {
    apps.push(this);
  }
  async render() {
    this.html = await this._renderHTML();
    return this;
  }
  bringToFront() {}
  async close() {
    this.closed = true;
    await this._preClose({});
  }
  async _preClose() {}
}
globalThis.foundry = {
  applications: {
    api: { ApplicationV2: App },
    sidebar: {
      tabs: {
        ChatLog: {
          renderMessage: async (m) => {
            rendered++;
            return { original: m.id };
          },
        },
      },
    },
  },
};
const message = { id: 'm', whisper: ['gm'], visible: true, isContentVisible: true };
globalThis.game = { user: { id: 'gm', isGM: true }, messages: new Map([['m', message]]) };
const { openOriginal, refreshOriginals } = await import('../scripts/original-message.mjs');
test('opens and reuses native original view, rejects other recipients, and closes on deletion', async () => {
  await openOriginal('m');
  await openOriginal('m');
  assert.equal(apps.length, 1);
  assert.equal(rendered, 2);
  assert.deepEqual(apps[0].html, { original: 'm' });
  message.whisper = ['other'];
  await assert.rejects(openOriginal('m'), /no longer available/);
  refreshOriginals();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(apps[0].closed, true);
  message.whisper = ['gm'];
  await openOriginal('m');
  assert.equal(apps.length, 2);
  game.messages.delete('m');
  refreshOriginals();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(apps[1].closed, true);
});
