// Keep official binaries independent of VS Code extension cleanup.
import { existsSync, lstatSync, readdirSync, readFileSync, mkdirSync, cpSync, renameSync,
  rmSync, copyFileSync, constants } from 'node:fs';
import { join, dirname, basename, isAbsolute } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const required = ['codex.exe', 'codex-code-mode-host.exe'];
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');

function inventory(directory, prefix = '') {
  if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink()) throw new Error('Runtime must be a real directory');
  const entries = [];
  for (const name of readdirSync(directory).sort()) {
    const path = join(directory, name), relative = prefix ? `${prefix}/${name}` : name;
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error('Runtime symlinks are not supported');
    if (stat.isDirectory()) entries.push([relative, 'directory'], ...inventory(path, relative));
    else if (stat.isFile()) entries.push([relative, hash(path)]);
    else throw new Error('Unsupported runtime entry');
  }
  return entries;
}

export function resolveCodexRuntime(profile, explicit) {
  if (explicit !== undefined) {
    if (!isAbsolute(explicit) || basename(explicit).toLowerCase() !== 'codex.exe') throw new Error('An absolute official codex.exe path is required');
    validateSource(explicit);
    return explicit;
  }
  const extensions = join(profile, '.vscode', 'extensions');
  const names = readdirSync(extensions).filter(name => /^openai\.chatgpt-[0-9.]+-win32-x64$/.test(name))
    .sort(new Intl.Collator('en', { numeric: true }).compare).reverse();
  for (const name of names) {
    const path = join(extensions, name, 'bin', 'windows-x86_64', 'codex.exe');
    if (required.every(file => existsSync(join(dirname(path), file)))) {
      validateSource(path);
      return path;
    }
  }
  throw new Error('No complete official Codex runtime installed');
}

function validateSource(codex) {
  for (const name of required) {
    const path = join(dirname(codex), name);
    if (!existsSync(path) || !lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) throw new Error(`Official runtime is missing a regular ${name}`);
  }
}

export function stageCodexRuntime(root, codex) {
  validateSource(codex);
  const bin = join(root, 'bin'), source = dirname(codex);
  if (!existsSync(bin) || !lstatSync(bin).isDirectory() || lstatSync(bin).isSymbolicLink()) throw new Error('Prepared deployment bin directory required');
  const files = inventory(source), fingerprint = createHash('sha256').update(JSON.stringify(files)).digest('hex');
  const runtime = join(bin, `runtime-${fingerprint}`);
  const companion = join(bin, 'codex-code-mode-host.exe');
  const expectedCompanion = hash(join(source, 'codex-code-mode-host.exe'));
  if (existsSync(companion) && (!lstatSync(companion).isFile() || lstatSync(companion).isSymbolicLink() || hash(companion) !== expectedCompanion)) {
    throw new Error('Existing launcher companion differs; coordinate runtime upgrade before replacing it');
  }
  if (existsSync(runtime)) {
    if (JSON.stringify(inventory(runtime)) !== JSON.stringify(files)) throw new Error('Staged runtime differs from official source');
  } else {
    const temporary = join(bin, `.runtime-${randomUUID()}`);
    try {
      mkdirSync(temporary);
      cpSync(source, temporary, { recursive: true, errorOnExist: true, force: false });
      if (JSON.stringify(inventory(temporary)) !== JSON.stringify(files)) throw new Error('Runtime copy verification failed');
      renameSync(temporary, runtime);
    } finally { rmSync(temporary, { recursive: true, force: true }); }
  }
  // Clients may resolve this relative to cliExecutable rather than real Codex.
  if (!existsSync(companion)) copyFileSync(join(runtime, 'codex-code-mode-host.exe'), companion, constants.COPYFILE_EXCL);
  if (hash(companion) !== expectedCompanion) throw new Error('Launcher companion verification failed');
  return join(runtime, 'codex.exe');
}
