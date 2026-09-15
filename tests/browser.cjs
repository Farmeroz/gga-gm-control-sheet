const { chromium } = require('playwright');
const assert = require('node:assert/strict');
(async () => {
  const fs = require('fs'),
    path = require('path'),
    root = path.resolve(__dirname, '..');
  const output = path.join(root, 'test-output');
  fs.mkdirSync(output, { recursive: true });
  const server = require('http').createServer((req, res) => {
    let file;
    try {
      file = path.resolve(root, '.' + decodeURIComponent(req.url.split('?')[0]));
    } catch {
      res.statusCode = 400;
      return res.end();
    }
    if (!file.startsWith(root + path.sep)) {
      res.statusCode = 403;
      return res.end();
    }
    res.setHeader(
      'Content-Type',
      {
        '.mjs': 'text/javascript',
        '.html': 'text/html',
        '.css': 'text/css',
        '.svg': 'image/svg+xml',
      }[path.extname(file)] || 'text/plain',
    );
    fs.readFile(file, (err, data) => {
      res.statusCode = err ? 404 : 200;
      res.end(err ? 'missing' : data);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.GCS_CHROMIUM_EXECUTABLE || undefined,
    args: ['--no-sandbox'],
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1360, height: 1000 },
      acceptDownloads: true,
    });
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/tests/preview.html`);
    await page.waitForFunction(() => window.ready);
    // Optional help must work on actual generated controls without invoking them.
    await page.evaluate(async () => {
      const previous = game.settings.get;
      game.settings.get = (id, key) => (key === 'helpTooltips' ? true : previous(id, key));
      (await import('/scripts/help.mjs')).helpController.start();
    });
    await page.locator('[data-gcs="request"]').focus();
    await page.getByRole('tooltip').waitFor();
    assert.match(await page.getByRole('tooltip').textContent(), /eligible players/);
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('tooltip').count(), 0);

    const choose = async (selector, value) => {
      await page.locator(selector).selectOption(value);
      await page.waitForTimeout(50);
    };
    const click = async (name) => {
      await page.getByRole('button', { name, exact: true }).click();
      await page.waitForTimeout(50);
    };
    // Selection and all-roster actions stay explicit across scene/combat filters.
    await page.locator('[data-select=l]').check();
    await page.waitForTimeout(50);
    await choose('[data-filter]', 'scene');
    assert.equal(await page.locator('.gcs-character-name').count(), 2);
    await click('Select visible');
    assert.equal(await page.evaluate(() => sheet.selection.size), 3);
    await choose('[data-draft=scope]', 'both');
    assert.match(await page.locator('.gcs-target-count').innerText(), /4 roster entries.*2 hidden/);
    await choose('[data-draft=scope]', 'visible');
    assert.match(await page.locator('.gcs-target-count').innerText(), /2 roster entries/);
    await page.evaluate(
      () => (game.combat = { combatants: [{ token: game.scenes[0].tokens[1] }] }),
    );
    await choose('[data-filter]', 'combat');
    assert.equal(await page.locator('.gcs-character-name').count(), 1);
    assert.match(await page.locator('.gcs-character-name').innerText(), /South Door/);
    await page.evaluate(() => (game.combat = null));
    await click('Refresh');
    assert.match(await page.locator('.gcs-empty').innerText(), /No characters/);
    assert.equal(await page.evaluate(() => sheet.targetEntries().length), 0);
    await choose('[data-filter]', 'all');
    await choose('[data-draft=scope]', 'both');
    // Save one preset and apply only to a selected NPC on reuse.
    await click('Group modifiers');
    await click('Continue');
    await page.locator('[name=savePreset]').check();
    await page.locator('[name=presetName]').fill('Night patrol');
    await click('Apply to characters');
    assert.equal(await page.evaluate(() => sheet.prefs.presets[0].label), 'Night patrol');
    await click('Clear selection');
    await page.locator('[data-select=g2]').check();
    await page.waitForTimeout(50);
    await choose('[data-draft=scope]', 'selected');
    await click('Group modifiers');
    await choose('[name=action]', 'preset');
    await click('Continue');
    await click('Continue');
    await page.locator('[name=value]').fill('-4');
    await click('Apply to characters');
    assert.equal(
      await page.evaluate(
        () => sheet.rows.find((r) => r.entry.id === 'g2').actor.flags.modifiers[0].value,
      ),
      -4,
    );
    assert.equal(
      await page.evaluate(
        () => sheet.rows.find((r) => r.entry.id === 'g1').actor.flags.modifiers[0].value,
      ),
      -2,
    );
    assert.equal(await page.evaluate(() => sheet.prefs.presets[0].value), -2);
    // Presets may also be sent as numeric bucket adjustments.
    await click('Group modifiers');
    await choose('[name=action]', 'bucket');
    await click('Continue');
    const presetId = await page.evaluate(() => sheet.prefs.presets[0].id);
    assert.equal(await page.locator(`[name=source] option[value="preset:${presetId}"]`).count(), 1);
    await click('Cancel');
    // Export a real browser download, then import after changing settings.
    await click('Configure');
    const downloadPromise = page.waitForEvent('download');
    await click('Export');
    const download = await downloadPromise;
    await download.saveAs(path.join(output, 'configuration-export.json'));
    const exported = JSON.parse(
      fs.readFileSync(path.join(output, 'configuration-export.json'), 'utf8'),
    );
    assert.equal(exported.configuration.presets[0].label, 'Night patrol');
    assert.equal(exported.configuration.roster, undefined);
    const rosterBefore = await page.evaluate(() => JSON.stringify(sheet.prefs.roster));
    await page.evaluate(async () => {
      sheet.prefs.columns = ['HP'];
      sheet.prefs.presets = [];
      sheet.prefs.highlightConditions = false;
      await sheet.save();
      await sheet.render();
    });
    await click('Configure');
    await click('Import');
    await page
      .locator('[name=configuration]')
      .setInputFiles(path.join(output, 'configuration-export.json'));
    await click('Review');
    assert.match(await page.locator('.gcs-dialog').innerText(), /Night patrol/);
    await click('Import configuration');
    assert.equal(await page.evaluate(() => sheet.prefs.presets[0].label), 'Night patrol');
    assert.equal(await page.evaluate(() => JSON.stringify(sheet.prefs.roster)), rosterBefore);
    // Preset editor updates saved defaults without changing previously assigned modifiers.
    await click('Configure');
    await click('Presets');
    await click('Continue');
    await page.locator('[name=value]').fill('-3');
    await click('Save preset');
    assert.equal(await page.evaluate(() => sheet.prefs.presets[0].value), -3);
    assert.equal(
      await page.evaluate(
        () => sheet.rows.find((r) => r.entry.id === 'g2').actor.flags.modifiers[0].value,
      ),
      -4,
    );
    // Low resource and status indicators remain visible even if the Conditions column is hidden.
    await page.evaluate(async () => {
      sheet.rows[0].actor.system.HP.value = 3;
      sheet.rows[0].actor.statuses.add('unconscious');
      sheet.prefs.columns = sheet.prefs.columns.filter((c) => c !== 'conditions');
      await sheet.render();
    });
    assert.match(
      await page.locator('.gcs-condition-chips').first().innerText(),
      /Low HP.*Unconscious/s,
    );
    assert.equal(await page.locator('.gcs-resource-alert').count(), 1);
    // Create a real module request and display the tracker.
    await choose('[data-draft=scope]', 'pc');
    await click('Request rolls');
    await click('Send request');
    await click('Requested roll results');
    const tracker = page.locator('#gcs-request-tracker');
    assert.equal(await tracker.locator('.gcs-request-state').count(), 2);
    // Simulate the native chat roll produced on another connected client, then reconcile its receipt.
    await page.evaluate(async () => {
      const { recordResponse, requestReference } = await import('../scripts/requests.mjs');
      const original = game.messages[0];
      const roll = await ChatMessage.create({
        user: 'phil',
        rolls: [{ formula: '3d6', total: 9 }],
        blind: true,
        whisper: ['gm'],
        speaker: { actor: 'luke' },
        flags: {
          'gga-gm-control-sheet': {
            roll: true,
            result: {
              version: 1,
              target: 16,
              total: 9,
              margin: 7,
              status: 'Success',
              critical: '',
            },
            request: requestReference(original, 0),
            check: {
              version: 1,
              actorUuid: 'Actor.luke',
              otf: original.flags['gga-gm-control-sheet'].requestData.entries[0].entry.overrides[
                original.flags['gga-gm-control-sheet'].requestData.shortcut.id
              ],
              mode: 'blindroll',
            },
          },
        },
      });
      await recordResponse(roll);
      await sheet.tracker.render();
    });
    assert.equal(await tracker.locator('.gcs-done').count(), 1);
    const completed = tracker.locator('tbody tr').first();
    assert.deepEqual((await completed.locator('td').allTextContents()).slice(2, 6), [
      '16',
      '9',
      'Success',
      '7',
    ]);
    await tracker.getByRole('button', { name: 'Remind outstanding', exact: true }).click();
    await page.waitForTimeout(100);
    assert.equal(
      await page.evaluate(
        () => game.messages.at(-1).flags['gga-gm-control-sheet'].requestData.entries.length,
      ),
      1,
    );
    assert.equal(
      await page.evaluate(
        () => game.messages.at(-1).flags['gga-gm-control-sheet'].requestData.entries[0].name,
      ),
      'Zoé de Sancerre',
    );
    // Player cards recognise completion on either card; ownership still gates buttons.
    await page.evaluate(async () => {
      const { wireRequest } = await import('../scripts/requests.mjs');
      game.user = game.users.get('phil');
      for (const m of [game.messages[0], game.messages.at(-1)]) {
        const root = document.createElement('div');
        root.dataset.messageId = m.id;
        root.innerHTML = m.content;
        root.className = 'test-chat';
        document.body.append(root);
        wireRequest(m, root);
      }
    });
    assert.equal(
      await page.locator('.test-chat').first().locator('button').first().innerText(),
      'Rolled',
    );
    assert.equal(
      await page.locator('.test-chat').first().locator('button').first().isDisabled(),
      true,
    );
    assert.equal(await page.locator('.test-chat').last().locator('button').isDisabled(), false);
    await page.evaluate(async () => {
      game.user = game.users.get('gm');
      document.querySelectorAll('.test-chat').forEach((e) => e.remove());
      sheet.tracker.element.style.position = 'fixed';
      sheet.tracker.element.style.top = '180px';
      sheet.tracker.element.style.left = '400px';
      sheet.tracker.element.style.zIndex = '10';
    });
    await page.evaluate(() => document.querySelector('.gcs-grid').scrollTo(0, 0));
    await page.screenshot({ path: path.join(output, 'tracker.png') });
    await page.evaluate(async () => {
      await sheet.tracker.close();
      sheet.prefs.tab = 'both';
      sheet.draft.scope = 'both';
      await sheet.render();
    });
    // Read-only Casting Assistant summaries appear beside recipients and open the caster.
    await page.evaluate(async () => {
      game.modules = new Map([
        [
          'gga-casting-assistant',
          {
            active: true,
            api: {
              getActiveEffects: async (actorUuid) =>
                actorUuid === 'Actor.zoe'
                  ? [
                      {
                        schema: 1,
                        actorUuid,
                        id: 'shield',
                        name: 'Shield of the evening watch',
                        casterUuid: 'Actor.luke',
                        casterName: 'Luke Morningstar',
                        cast: false,
                        received: true,
                        remaining: 0,
                        state: 'due',
                        maintainable: true,
                        maintenanceCost: 2,
                        recipientNames: ['Zoé de Sancerre'],
                        summary: 'Defence bonus recorded by the GM.',
                      },
                    ]
                  : [],
              activeEffects: (uuid) => {
                window.openedCaster = uuid;
              },
            },
          },
        ],
      ]);
      await sheet.render();
    });
    assert.match(
      await page.locator('.gcs-casting-effect').innerText(),
      /Received: Shield.*Maintenance due/s,
    );
    await page.locator('.gcs-casting-effect').click();
    assert.equal(await page.evaluate(() => openedCaster), 'Actor.luke');
    await page.screenshot({ path: path.join(output, 'wide.png') });
    await page.setViewportSize({ width: 760, height: 950 });
    await page.evaluate(() => {
      sheet.element.style.width = '720px';
      sheet.element.style.height = '900px';
    });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    await page.screenshot({ path: path.join(output, 'narrow.png') });
    assert.deepEqual(await page.evaluate(() => errors), []);
    assert.deepEqual(pageErrors, []);
    console.log(
      'Browser workflows passed: filters/scope, selected preset reuse, preset editor, export/import file round trip, conditions, tracking, reminders, player card completion, and narrow layout.',
    );
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
