import { cp, mkdtemp, readFile, writeFile, mkdir, symlink, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { fixturePath, verifyFixture } from '../tools/gga-fixture.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const supplied = process.argv[2] || process.env.GGA_PATH;
let gga = resolve(supplied || fixturePath);
if (!supplied) {
  try {
    await access(join(gga, 'system.json'));
    await verifyFixture();
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    gga = resolve(root, '../../systems/gurps');
    try {
      await access(join(gga, 'system.json'));
    } catch {
      throw new Error(
        'GGA test sources are missing. Run npm run test:setup, or supply a GGA 0.18.x directory: npm test -- /path/to/gurps.',
      );
    }
  }
}
const source = await readFile(join(gga, 'module/gurps.js'), 'utf8');
const native = await readFile(join(gga, 'module/dierolls/dieroll.js'), 'utf8');
const version = JSON.parse(await readFile(join(gga, 'system.json'), 'utf8')).version;
if (!/^0\.18\./.test(version)) throw new Error('Supply an installed GGA 0.18.x source directory.');
const work = await mkdtemp(join(tmpdir(), 'gcs-tests-'));
try {
  const mod = join(work, 'Data/modules/gga-gm-control-sheet'),
    system = join(work, 'Data/systems/gurps');
  await mkdir(mod, { recursive: true });
  await mkdir(join(system, 'module/dierolls'), { recursive: true });
  await cp(join(root, 'scripts'), join(mod, 'scripts'), { recursive: true });
  await cp(join(root, 'tests'), join(mod, 'tests'), { recursive: true });
  await symlink(join(root, 'node_modules'), join(mod, 'node_modules'), 'junction');
  await writeFile(join(system, 'package.json'), '{"type":"module"}');
  const start = native.indexOf('export async function doRoll(');
  if (start < 0) throw new Error('The supplied GGA roller has an unsupported source layout.');
  await writeFile(join(system, 'module/dierolls/dieroll.js'), native.slice(start));
  const extract = (startText, endText) => {
    const a = source.indexOf(startText),
      b = source.indexOf(endText, a);
    if (a < 0 || b < 0) throw new Error('Unsupported GGA calculator layout');
    return source.slice(a, b + endText.length);
  };
  const calculators =
    'const stripBracketContents=s=>s.replace(/\\[[^\\]]*\\]/g, "");\n' +
    extract('  function processSkillSpell(', '\n  }\n') +
    '\nexport const actionFuncs={' +
    extract('    async attribute(', '\n    },') +
    extract("    async ['skill-spell'](", '\n    },') +
    '};\n';
  await writeFile(join(mod, 'tests/native-calculators.mjs'), calculators);
  // Fault injection is generated from exactly the same supplied native source.
  const replaceOnce = (text, search, replacement) => {
    if (text.split(search).length !== 2)
      throw new Error(`Unsupported GGA fault-injection layout: ${search}`);
    return text.replace(search, replacement);
  };
  await writeFile(
    join(system, 'module/dierolls/uncapped.js'),
    replaceOnce(
      native.slice(start),
      'maxtarget = (await GURPS.applyModifierDesc(actor, m.desc)) || maxtarget',
      '// Simulate a missing cap callback.',
    ),
  );
  await writeFile(
    join(mod, 'scripts/uncapped-rolls.mjs'),
    (await readFile(join(mod, 'scripts/rolls.mjs'), 'utf8')).replace('/dieroll.js', '/uncapped.js'),
  );
  await writeFile(
    join(system, 'module/dierolls/supplementary.js'),
    replaceOnce(
      native.slice(start),
      'ChatMessage.create(messageData, options)',
      "ChatMessage.create({...messageData, rolls:[], content:'Supplementary native message'}, options); ChatMessage.create(messageData, options)",
    ),
  );
  await writeFile(
    join(mod, 'scripts/supplementary-rolls.mjs'),
    (await readFile(join(mod, 'scripts/rolls.mjs'), 'utf8')).replace(
      '/dieroll.js',
      '/supplementary.js',
    ),
  );
  console.log(
    `Testing the packaged module with native GGA ${version} roll/calculator bodies; Foundry services are mocked.`,
  );
  const files = [
    'tooltip.test.mjs',
    'core-tests.mjs',
    'activity-tests.mjs',
    'original-message-tests.mjs',
    'resolve-tests.mjs',
    'features-tests.mjs',
    'roster-tests.mjs',
    'casting-effects-tests.mjs',
    'roll-tests.mjs',
    'request-integration-tests.mjs',
    'ui-model-tests.mjs',
    'reliability-tests.mjs',
  ];
  const run = spawnSync(process.execPath, ['--test', ...files.map((f) => join(mod, 'tests', f))], {
    cwd: mod,
    stdio: 'inherit',
  });
  process.exitCode = run.status ?? 1;
} finally {
  await rm(work, { recursive: true, force: true });
}
