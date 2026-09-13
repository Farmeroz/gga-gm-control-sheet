# Contributing

Use Node.js 22 or later and npm. Work from the repository root.

```sh
npm ci
npm run test:setup
npx playwright install chromium
npm run check
```

On Linux, `npx playwright install --with-deps chromium` also installs the browser's operating-system dependencies. Installing those dependencies may require administrator access. No Foundry installation, world, account, or licence is needed for these automated checks.

`test:setup` downloads three files from GGA 0.18.23, pinned to commit `4fb95f7ed8e114993c65ef77dc912a7b77957b02`, into the ignored `.cache/gga/` directory. The files remain upstream GGA sources and are not redistributed in this repository or its releases. After installing dependencies and preparing the fixture and browser, the checks run locally without network access.

## Commands

| Command                | Purpose                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------- |
| `npm run format`       | Apply the pinned Prettier version to supported source, test, and documentation files. |
| `npm run format:check` | Check formatting without changing files.                                              |
| `npm run check:syntax` | Parse the JavaScript runtime, tests, and build tools.                                 |
| `npm test`             | Run the automated suite against the prepared GGA fixture.                             |
| `npm run test:browser` | Run both browser workflow and section-resizing suites.                                |
| `npm run test:layout`  | Run only the section-resizing browser suite.                                          |
| `npm run build`        | Build and verify the clean ZIP, manifest, and user guide in `dist/`.                  |
| `npm run check`        | Run formatting, syntax, automated tests, both browser suites, and the package build.  |

See [tests/README.md](tests/README.md) for coverage, fixture details, alternative GGA installations, and manual integration checks.

## Changes and reviews

Keep formatting-only changes separate from behaviour changes. Use `import * as log from './log.mjs'` for runtime console errors and pass the original error object to `log.error(...)`. User notifications still belong at the call site.

Pull requests run the same checks in GitHub Actions and attach the verified package as an artifact. Do not commit `node_modules/`, `.cache/`, `test-output/`, or `dist/`. Review the resulting ZIP when changing packaging or adding runtime files.

## Releases

Update the version in `module.json`, `package.json`, and the user README, and update the versioned `download` URL in `module.json`. Run `npm install --package-lock-only` to synchronise the lockfile, then run the checks.

The release workflow runs after a merge to `main`, repeats all checks, and publishes the verified artifact if that version does not already exist. It never replaces an existing release. A pull request alone does not publish a release.

`tools/build-release.mjs` contains the explicit list of shipped files. Add new runtime files to that list. The ZIP includes the module, licence, README, and PDF user guide. Tests, development tools, contributor documentation, dependency files, caches, and workflow files stay in the repository.
