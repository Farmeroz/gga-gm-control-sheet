import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const fixture = {
  repository: 'crnormand/gurps',
  commit: '4fb95f7ed8e114993c65ef77dc912a7b77957b02', // v0.18.23
  version: '0.18.23',
};
export const fixturePath = fileURLToPath(new URL('../.cache/gga/', import.meta.url));
export const sourceFiles = ['system.json', 'module/gurps.js', 'module/dierolls/dieroll.js'];

export async function fetchFixture() {
  const hashes = {};
  for (const path of sourceFiles) {
    const url = `https://raw.githubusercontent.com/${fixture.repository}/${fixture.commit}/${path}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Unable to fetch ${path}: HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    hashes[path] = createHash('sha256').update(bytes).digest('hex');
    const target = new URL(path, new URL('../.cache/gga/', import.meta.url));
    await mkdir(new URL('.', target), { recursive: true });
    await writeFile(target, bytes);
  }
  const version = JSON.parse(await readFile(resolve(fixturePath, 'system.json'), 'utf8')).version;
  if (version !== fixture.version) throw new Error(`Unexpected GGA fixture version: ${version}`);
  await writeFile(
    resolve(fixturePath, 'fixture.json'),
    JSON.stringify({ ...fixture, hashes }, null, 2) + '\n',
  );
  console.log(`Downloaded GGA ${version} test sources at ${fixture.commit}.`);
}

export async function verifyFixture() {
  const saved = JSON.parse(await readFile(resolve(fixturePath, 'fixture.json'), 'utf8'));
  if (saved.commit !== fixture.commit || saved.version !== fixture.version) {
    throw new Error('The cached GGA fixture is out of date. Run npm run test:setup.');
  }
  for (const path of sourceFiles) {
    const hash = createHash('sha256')
      .update(await readFile(resolve(fixturePath, path)))
      .digest('hex');
    if (saved.hashes[path] !== hash)
      throw new Error(`The cached ${path} changed. Run npm run test:setup.`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await fetchFixture();
}
