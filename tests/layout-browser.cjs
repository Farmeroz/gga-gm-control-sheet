const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'),
  path = require('node:path');

(async () => {
  const root = path.resolve(__dirname, '..'),
    output = path.join(root, 'test-output');
  fs.mkdirSync(output, { recursive: true });
  const server = require('node:http').createServer((req, res) => {
    const file = path.resolve(root, '.' + decodeURIComponent(req.url.split('?')[0]));
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
    fs.readFile(file, (error, data) => {
      res.statusCode = error ? 404 : 200;
      res.end(error ? 'missing' : data);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.GCS_CHROMIUM_EXECUTABLE || undefined,
      args: ['--no-sandbox'],
    });
    const page = await browser.newPage({ viewport: { width: 1360, height: 1000 } }),
      errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/tests/preview.html`);
    await page.waitForFunction(() => window.ready);
    const settle = () =>
      page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
    const heights = () =>
      page
        .locator('[data-section]')
        .evaluateAll((elements) => elements.map((el) => el.getBoundingClientRect().height));
    const near = (a, b) => assert.ok(Math.abs(a - b) < 2, `${a} is not close to ${b}`);
    const waitSave = () => page.evaluate(() => sheet._saveQueue);
    const key = async (index, value) => {
      await page.locator(`[data-divider="${index}"]`).press(value);
      await settle();
      await waitSave();
    };
    const drag = async (index, delta, during) => {
      const rect = await page.locator(`[data-divider="${index}"]`).boundingBox();
      await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
      await page.mouse.down();
      await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2 + delta, {
        steps: 8,
      });
      if (during) await during();
      await page.mouse.up();
      await settle();
      await waitSave();
    };
    await settle();
    assert.equal(await page.getByRole('separator').count(), 2);
    assert.equal(await page.evaluate(() => sheet.prefs.sectionSizes), undefined);
    const original = await heights();
    assert.ok(
      await page
        .locator('#gcs-group-actions .gcs-section-body')
        .evaluate((el) => el.scrollHeight <= el.clientHeight + 1),
    );
    const outerHeight = await page
      .locator('#gga-gm-control-sheet')
      .evaluate((el) => el.getBoundingClientRect().height);

    // Drag only reallocates the adjacent pair, saves it, and keeps the outer window unchanged.
    await drag(0, -85);
    let changed = await heights();
    near(changed[0], original[0] - 85);
    near(changed[1], original[1] + 85);
    near(changed[2], original[2]);
    near(
      await page
        .locator('#gga-gm-control-sheet')
        .evaluate((el) => el.getBoundingClientRect().height),
      outerHeight,
    );
    const stored = await page.evaluate(
      () => game.user.getFlag('gga-gm-control-sheet', 'preferences').sectionSizes,
    );
    assert.equal(stored.length, 3);
    await page.evaluate(() => sheet.render());
    await settle();
    (await heights()).forEach((n, i) => near(n, changed[i]));

    // The section may be made smaller than its content without hiding its heading or controls.
    await key(0, 'End');
    assert.ok(
      await page
        .locator('#gcs-group-actions .gcs-section-body')
        .evaluate((el) => el.scrollHeight > el.clientHeight),
    );
    const actionHeading = await page.locator('#gcs-group-actions .gcs-action-title').boundingBox();
    await page
      .locator('#gcs-group-actions .gcs-section-body')
      .evaluate((el) => (el.scrollTop = el.scrollHeight));
    near(
      (await page.locator('#gcs-group-actions .gcs-action-title').boundingBox()).y,
      actionHeading.y,
    );
    await page.getByRole('button', { name: 'Group modifiers', exact: true }).focus();
    assert.ok(
      await page.locator('#gcs-group-actions .gcs-section-body').evaluate((el) => el.scrollTop > 0),
    );
    const scrolled = await page
      .locator('#gcs-group-actions .gcs-section-body')
      .evaluate((el) => el.scrollTop);
    await page.evaluate(() => sheet.render());
    await settle();
    near(
      await page.locator('#gcs-group-actions .gcs-section-body').evaluate((el) => el.scrollTop),
      scrolled,
    );

    // A roster refresh completing during a pointer drag waits until release.
    await drag(0, -40, async () => {
      await page.evaluate(() => sheet.render());
      assert.equal(await page.evaluate(() => sheet._sectionLayout.dragging), true);
      assert.equal(await page.locator('.gcs-divider').count(), 2);
    });
    assert.equal(await page.evaluate(() => sheet._pendingSectionHTML), null);
    assert.equal(await page.evaluate(() => sheet._sectionLayout.dragging), false);

    // Reopening with a new application instance reads the user preference.
    const reopening = await heights();
    await page.evaluate(async () => {
      await sheet.close();
      const { GMControlSheet } = await import('../scripts/control-sheet.mjs');
      window.sheet = new GMControlSheet();
      await sheet.render();
    });
    await settle();
    (await heights()).forEach((n, i) => near(n, reopening[i]));

    // Another GM starts with their own default layout.
    await page.evaluate(async () => {
      window.savedGM = game.user;
      await sheet.close();
      const flags = {};
      game.user = {
        ...savedGM,
        id: 'second-gm',
        getFlag: (_id, key) => flags[key],
        setFlag: async (_id, key, value) => (flags[key] = value),
      };
      const { GMControlSheet } = await import('../scripts/control-sheet.mjs');
      window.sheet = new GMControlSheet();
      await sheet.render();
    });
    await settle();
    assert.equal(await page.evaluate(() => sheet.prefs.sectionSizes), undefined);
    await page.evaluate(async () => {
      await sheet.close();
      game.user = savedGM;
      const { GMControlSheet } = await import('../scripts/control-sheet.mjs');
      window.sheet = new GMControlSheet();
      await sheet.render();
    });
    await settle();
    (await heights()).forEach((n, i) => near(n, reopening[i]));

    // Keyboard resizing works on both dividers; table and section headings stay visible when scrolling.
    await key(0, 'Home');
    const beforeResults = await heights();
    await drag(1, -60);
    const afterResults = await heights();
    near(afterResults[0], beforeResults[0]);
    near(afterResults[1], beforeResults[1] - 60);
    near(afterResults[2], beforeResults[2] + 60);
    const beforeKey = await heights();
    await key(1, 'ArrowUp');
    near((await heights())[2], beforeKey[2] + 10);
    assert.equal(await page.evaluate(() => document.activeElement.dataset.divider), '1');
    await page.evaluate(async () => {
      sheet.results = Array.from({ length: 18 }, (_, i) => ({
        name: `Character ${i + 1}`,
        label: 'Observation',
        target: 14,
        total: 10,
        status: 'Success',
        margin: 4,
      }));
      await sheet.render();
    });
    await settle();
    assert.ok(
      await page.locator('#gcs-characters').evaluate((el) => el.scrollHeight > el.clientHeight),
    );
    const tableTop = await page.locator('#gcs-characters th').first().boundingBox();
    await page.locator('#gcs-characters').evaluate((el) => (el.scrollTop = el.scrollHeight));
    near((await page.locator('#gcs-characters th').first().boundingBox()).y, tableTop.y);
    await key(1, 'End');
    assert.ok(
      await page
        .locator('#gcs-latest-results .gcs-section-body')
        .evaluate((el) => el.scrollHeight > el.clientHeight),
    );
    const resultHeading = await page.locator('#gcs-latest-results .gcs-action-title').boundingBox();
    await page
      .locator('#gcs-latest-results .gcs-section-body')
      .evaluate((el) => (el.scrollTop = el.scrollHeight));
    near(
      (await page.locator('#gcs-latest-results .gcs-action-title').boundingBox()).y,
      resultHeading.y,
    );

    // Escape cancels an in-progress drag without replacing the saved arrangement.
    const beforeCancel = await heights(),
      savedBeforeCancel = await page.evaluate(() => sheet.prefs.sectionSizes);
    await drag(0, 25, async () => {
      await page.keyboard.press('Escape');
    });
    (await heights()).forEach((n, i) => near(n, beforeCancel[i]));
    assert.deepEqual(await page.evaluate(() => sheet.prefs.sectionSizes), savedBeforeCancel);

    // Sizes scale to a smaller outer window and preserve reachable minimum sections.
    await page.setViewportSize({ width: 760, height: 950 });
    await page.evaluate(() => {
      sheet.element.style.width = '720px';
      sheet.element.style.height = '560px';
    });
    await settle();
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    assert.ok(
      await page
        .locator('.gcs-panels')
        .evaluate(
          (el) =>
            Array.from(el.children).reduce((n, c) => n + c.getBoundingClientRect().height, 0) <=
            el.clientHeight + 2,
        ),
    );
    await key(0, 'End');
    await key(1, 'Home');
    assert.ok((await heights()).every((n) => n >= 70));
    await page.screenshot({ path: path.join(output, 'v0.2.2-sections-small.png') });

    // Reset through the user-facing Configure dialog; all other saved data is retained.
    await page.setViewportSize({ width: 1360, height: 1000 });
    await page.evaluate(() => {
      sheet.element.style.width = '1180px';
      sheet.element.style.height = '770px';
    });
    const roster = await page.evaluate(() => JSON.stringify(sheet.prefs.roster));
    await page.getByRole('button', { name: 'Configure', exact: true }).click();
    await page.getByLabel('Reset section sizes').check();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await settle();
    await waitSave();
    assert.equal(await page.evaluate(() => sheet.prefs.sectionSizes), null);
    assert.equal(
      await page.evaluate(
        () => game.user.getFlag('gga-gm-control-sheet', 'preferences').sectionSizes,
      ),
      null,
    );
    assert.equal(await page.evaluate(() => JSON.stringify(sheet.prefs.roster)), roster);
    await page.evaluate(async () => {
      sheet.results = [];
      await sheet.render();
    });
    await settle();
    (await heights()).forEach((n, i) => near(n, original[i]));
    await page.screenshot({ path: path.join(output, 'v0.2.2-sections-default.png') });
    await drag(0, -60);
    await drag(1, -45);
    await page.screenshot({ path: path.join(output, 'v0.2.2-sections-adjusted.png') });
    assert.deepEqual(await page.evaluate(() => errors), []);
    assert.deepEqual(errors, []);
    console.log(
      'Section browser checks passed: both dividers, keyboard, minimum sizes, independent scrolling, refresh during drag, scroll retention, reopening, separate GM preferences, cancellation, small windows, and reset.',
    );
  } finally {
    if (browser) await browser.close();
    server.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
