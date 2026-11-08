#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

// Offline review build; it never signs with an Apple identity, installs files,
// creates an account, starts a service, or removes an existing output directory.
const die = () => { throw new Error('PROTECTED_BROKER_BUILD_UNAVAILABLE'); };
const values = {}, args = process.argv.slice(2);
if (args.length % 2) die();
for (let i = 0; i < args.length; i += 2) {
  const key = args[i]; if (!['--out', '--node', '--esbuild', '--postject', '--uid', '--root', '--fixture'].includes(key) || values[key] !== undefined) die();
  values[key] = args[i + 1];
}
for (const key of ['--out', '--node', '--esbuild', '--postject', '--root']) if (!isAbsolute(values[key] || '')) die();
const uid = Number(values['--uid']), fixture = values['--fixture'] === '1';
if (!Number.isSafeInteger(uid) || uid < 1 || (!fixture && (uid < 450 || uid > 499)) || !['0', '1'].includes(values['--fixture'])) die();
const out = values['--out'], node = values['--node'], esbuild = values['--esbuild'], postject = values['--postject'];
const sha = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const toolEnvironment = { PATH: '/usr/bin:/bin', HOME: '/var/empty', LANG: 'C', LC_ALL: 'C' };
const run = (command, argv, options = {}) => execFileSync(command, argv, { encoding: 'utf8', timeout: 180000, maxBuffer: 4 * 1024 * 1024,
  env: toolEnvironment, ...options });
const treeHash = root => {
  const list = [];
  const visit = path => { for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const name = join(path, entry.name); if (entry.isDirectory()) visit(name);
    else if (entry.isFile()) list.push([relative(root, name), sha(name)]); else die();
  } };
  visit(root); return createHash('sha256').update(JSON.stringify(list)).digest('hex');
};
const postjectRoot = realpathSync(resolve(dirname(postject), '..'));
const requireFromPostject = createRequire(postject);
let commanderRoot = dirname(realpathSync(requireFromPostject.resolve('commander')));
while (!readdirSync(commanderRoot).includes('package.json')) {
  const parent = dirname(commanderRoot); if (parent === commanderRoot) die(); commanderRoot = parent;
}
const postjectTreeSha256 = treeHash(postjectRoot), commanderTreeSha256 = treeHash(commanderRoot);
mkdirSync(out, { mode: 0o700 }); // Exclusive: refuse to overwrite or reuse an output.
const bundle = join(out, 'broker.cjs'), blob = join(out, 'broker.blob'), executable = join(out, 'protected-broker'), metafile = join(out, 'inputs-meta.json');
const entry = resolve('native/codex-vm-supervisor/package/protected-broker-entry.js');
run(esbuild, [entry, '--bundle', '--platform=node', '--format=cjs', '--target=node24', `--outfile=${bundle}`,
  `--define:__TURNLINK_PROTECTED_BROKER_FIXTURE__=${fixture}`, `--define:__TURNLINK_PROTECTED_BROKER_ROOT__=${JSON.stringify(values['--root'])}`,
  `--define:__TURNLINK_PROTECTED_BROKER_UID__=${uid}`, `--metafile=${metafile}`]);
const inputs = Object.keys(JSON.parse(readFileSync(metafile, 'utf8')).inputs).sort().map(path => [path, sha(resolve(path))]);
writeFileSync(join(out, 'inputs.json'), `${JSON.stringify(inputs, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
const inputGraphSha256 = createHash('sha256').update(JSON.stringify(inputs)).digest('hex');
const config = join(out, 'sea-config.json');
writeFileSync(config, JSON.stringify({ main: 'broker.cjs', output: 'broker.blob', disableExperimentalSEAWarning: true, useSnapshot: false, useCodeCache: false }));
run(node, ['--experimental-sea-config', 'sea-config.json'], { cwd: out });
copyFileSync(node, executable); run('/usr/bin/codesign', ['--remove-signature', executable]);
run(node, [postject, executable, 'NODE_SEA_BLOB', blob, '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2', '--macho-segment-name', 'NODE_SEA']);
run('/usr/bin/codesign', ['--force', '--sign', '-', '--options', 'runtime', '--entitlements', resolve('native/codex-vm-supervisor/package/node-entitlements.plist'), executable]);
run('/usr/bin/codesign', ['--verify', '--strict', executable]);
const manifest = { version: 1, fixture, uid, root: values['--root'], nodeSha256: sha(node), esbuildSha256: sha(esbuild), postjectSha256: sha(postject),
  postjectTreeSha256, commanderTreeSha256, inputGraphSha256, inputCount: inputs.length,
  lockSha256: sha(resolve('package-lock.json')), entrySha256: sha(entry), bundleSha256: sha(bundle), blobSha256: sha(blob), executableSha256: sha(executable),
  signature: 'ad-hoc-review-only', productionReady: false };
writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
