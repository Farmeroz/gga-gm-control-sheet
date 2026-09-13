# Reproducing the checks

These tests live in the development repository and are excluded from the user ZIP. Run commands from the repository root with Node.js 22 or later.

## Automated suite

```sh
npm ci
npm run test:setup
npm test
```

`test:setup` downloads GGA 0.18.23's `system.json`, `module/gurps.js`, and `module/dierolls/dieroll.js` from upstream commit `4fb95f7ed8e114993c65ef77dc912a7b77957b02`. The cache records the revision and file hashes; the runner checks them before use. A changed cache fails with instructions to prepare it again. Setup requires network access; subsequent test runs do not.

To test another installed GGA 0.18.x version:

```sh
npm test -- /absolute/path/to/Foundry/Data/systems/gurps
```

Quote paths containing spaces. `GGA_PATH` may also supply the path. Resolution order is the command-line argument, `GGA_PATH`, the prepared cache, then the usual `../../systems/gurps` location relative to the module. An explicitly supplied installation is read directly and does not use the pinned cache.

The runner stages the module in a temporary Foundry-style directory and extracts GGA's native roll body and attribute/skill calculators for execution against mocked Foundry services. It does not change the supplied GGA installation or a world. Source layouts that cannot be extracted or fault-injected fail explicitly. The temporary directory is removed afterwards.

The suite covers:

- Selection, roster deduplication, and actor/token identity.
- Modifier filtering, presets, configuration migration/import, and missing checks.
- Request creation, reminders, ownership checks, and completion-only receipts.
- Native private/public rolls and the Fright Check cap, including a fault that removes the cap callback.
- Concurrent wrappers and rolls, arriving/replaced/edited bucket entries, spell college modifiers, unsupported versions, and supplementary native messages.

The libWrapper test double models the MIXED wrapper-chain contract. The suite does not run the complete Foundry application, the real libWrapper installation, every GGA helper, or a multiplayer connection. It does not claim complete code coverage.

## Browser workflows

```sh
npx playwright install chromium
npm run test:browser
```

On Linux, use `npx playwright install --with-deps chromium` if the browser needs operating-system dependencies. Set `GCS_CHROMIUM_EXECUTABLE` to an existing compatible Chromium executable to use it instead.

Both browser suites load the actual module window in a simulated Foundry UI. The first checks dialogs, scoped selection, filters, presets, condition indicators, import/export, request tracking, reminders, and narrow-window layout. The second checks both section dividers, pointer and keyboard resizing, minimum sizes, independent scrolling, refresh during dragging, per-GM persistence, reopening, cancellation, and layout reset.

The harness saves screenshots and the configuration round trip under the ignored `test-output/` directory. Its HTTP server listens only on loopback. Browser failures and uncaught page errors produce a non-zero exit status.

## GitHub checks and packages

Pull requests run `npm ci`, prepare the pinned GGA fixture and Chromium, check formatting and syntax, run both test groups, and build the package. A failed check prevents release publication. The release uses the artifact produced by these checks.

The builder validates matching package/manifest versions, release URLs, manifest assets, local runtime imports, the archive's exact file list, and every archived file's bytes. Its explicit file list keeps this directory and all other development files out of the ZIP.

## Manual integration checks

Use this checklist when changing roll integration, supported Foundry/GGA versions, or related modules. Run it in a test world with a separate player client, then repeat with the world's normal module combination.

| Check                                                                 | Expected outcome                                                                                                                                     |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| GM blind Fright Check, including a high target                        | GMs receive the capped result. The player receives no check message, follow-up, or dice animation.                                                   |
| GM check against a missing skill                                      | The sheet shows Not found. No roll or repeated warning appears in the player's chat.                                                                 |
| GM blind self-control check                                           | Only GMs receive the result and dice.                                                                                                                |
| Player blind request, then reminder                                   | Addressees see the request. Only GMs receive the result; original and reminder show completion without totals or success/failure.                    |
| Public player request                                                 | The result is public and attributed to the requested actor/token.                                                                                    |
| Two tokens sharing an actor ID, with another roll while a check waits | Each roll retains its speaker and visibility. The unrelated roll has no request marker.                                                              |
| Second GM sends modifiers while a check waits                         | New/replaced entries survive. A completed player request consumes only unchanged entries it used. Edited entries are retained with a review warning. |
| Spell with a college-tagged modifier                                  | The matching modifier affects the target; no spell cost, script, or combat action is triggered.                                                      |
| Existing critical-success or dice-display modules                     | Classification, display, privacy, and attribution remain consistent with the world's configuration.                                                  |
| Resize sections, refresh, and reopen the sheet                        | Sizes and scrolling remain usable, preferences are retained, and Configure can reset section sizes.                                                  |
